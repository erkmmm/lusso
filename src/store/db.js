/**
 * Supabase data layer for Lusso.
 *
 * Strategy: "write-through + hydration"
 *   - On app start: fetch from Supabase → populate localStorage
 *   - On every write: update localStorage immediately (sync UI stays fast)
 *                     + fire async Supabase write in background
 *
 * Field mapping: app uses camelCase, DB uses snake_case.
 */

import { supabase } from '../lib/supabase';

// ── Field name converters ────────────────────────────────────────────
// Two-pass conversion handles acronyms (GST, API, etc.) correctly:
// Pass 1: insert _ before a run of UPPERCASE followed by Uppercase+lowercase (e.g. GSTRate → GST_Rate)
// Pass 2: standard camelCase split (e.g. grandTotal → grand_Total)
// Then toLowerCase throughout.
const toSnake = (s) => s
  .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
  .replace(/([a-z\d])([A-Z])/g, '$1_$2')
  .toLowerCase();
const toCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function toDb(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[toSnake(k)] = v;
  }
  return out;
}

function fromDb(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[toCamel(k)] = v;
  }
  return out;
}

const fromDbAll = (rows) => (rows || []).map(fromDb);

// ── localStorage helpers (mirrors data.js internals) ─────────────────
const LS = {
  get: (key) => { try { return JSON.parse(localStorage.getItem(key)) ?? []; } catch { return []; } },
  set: (key, val) => localStorage.setItem(key, JSON.stringify(val)),
};

const KEYS = {
  customers:            'lusso_customers',
  jobs:                 'lusso_jobs',
  measureSheets:        'lusso_measure_sheets',
  quotes:               'lusso_quotes',
  installers:           'lusso_installers',
  installRequests:      'lusso_install_requests',
  staff:                'lusso_staff',
  productTypes:         'lusso_product_types',
  pricedItems:          'lusso_priced_items',
  pricedItemBatches:    'lusso_priced_item_batches',
  importBatches:        'lusso_import_batches',
  notifications:        'lusso_notifications',
  employees:            'lusso_employees',
  tasks:                'lusso_tasks',
};

// ── Per-table column exclusions ──────────────────────────────────────
// Fields that exist in app data but not yet in the DB schema.
// Listed as snake_case so they can be stripped after toDb() conversion.
const EXCLUDE_COLUMNS = {
  customers:     ['first_name', 'last_name', 'deleted_by', 'suburb', 'company'],
  jobs:          ['deleted_by'],
  measure_sheets:['deleted_by'],
  installers:    ['availability_notes', 'business_name', 'deleted_by'],
  installations: ['access_notes', 'arrival_time', 'deleted_by'],
  notifications: ['install_request_id'],
  quotes: [
    'version', 'measure_sheet_id', 'site_address', 'terms_and_conditions',
    'internal_notes', 'follow_up_date', 'show_sizes_to_client',
    'viewed_at', 'declined_at', 'accepted_by', 'activity', 'deleted_by',
  ],
};

// ── Tables skipped during push (DB table doesn't exist yet) ──────────
const SKIP_PUSH_TABLES = new Set(['employees', 'tasks', 'notifications']);

// ── Table manifest (shared by hydrate + push) ────────────────────────
const TABLES = [
  { table: 'customers',              key: KEYS.customers },
  { table: 'jobs',                   key: KEYS.jobs },
  { table: 'measure_sheets',         key: KEYS.measureSheets },
  { table: 'quotes',                 key: KEYS.quotes },
  { table: 'installers',             key: KEYS.installers },
  { table: 'installations',          key: KEYS.installRequests },
  { table: 'staff',                  key: KEYS.staff },
  { table: 'product_types',          key: KEYS.productTypes },
  { table: 'priced_items',           key: KEYS.pricedItems },
  { table: 'priced_item_batches',    key: KEYS.pricedItemBatches },
  { table: 'contact_import_batches', key: KEYS.importBatches },
  { table: 'notifications',          key: KEYS.notifications },
  // employees & tasks tables not yet created in Supabase — skip both hydration and push
  // { table: 'employees',           key: KEYS.employees },
  // { table: 'tasks',               key: KEYS.tasks },
];

// ── Hydration ────────────────────────────────────────────────────────
/**
 * Pull ALL data from Supabase into localStorage.
 * Supabase always wins — overwrites local data completely.
 * Returns { hadCloudData: bool }
 */
export async function hydrateFromSupabase() {
  if (!supabase) return { hadCloudData: false };

  let hadCloudData = false;

  await Promise.all(
    TABLES.map(async ({ table, key }) => {
      const { data, error } = await supabase.from(table).select('*').order('created_at', { ascending: true });
      if (error) { console.warn(`[db] hydrate ${table}:`, error.message); return; }
      // Only overwrite localStorage when Supabase actually has rows.
      // If Supabase returns empty (table never pushed), keep local seed data.
      // Soft-deleted records are still present in Supabase (deletedAt set),
      // so a genuine "all gone" table in Supabase means it was never synced.
      const rows = fromDbAll(data || []);
      if (rows.length > 0) {
        const local = LS.get(key) || [];
        const localById = new Map(local.map(r => [r.id, r]));
        const supabaseIds = new Set(rows.map(r => r.id));

        // For records in both: keep whichever has the newer updatedAt.
        // This protects local edits that failed to sync (single-device use).
        const merged = rows.map(sbRow => {
          const localRow = localById.get(sbRow.id);
          if (!localRow) return sbRow;
          const sbMs = new Date(sbRow.updatedAt || 0).getTime();
          const locMs = new Date(localRow.updatedAt || 0).getTime();
          return locMs > sbMs ? localRow : sbRow;
        });

        // Preserve local-only records (never reached Supabase yet).
        const localOnly = local.filter(r => r.id && !supabaseIds.has(r.id));
        LS.set(key, [...merged, ...localOnly]);
        hadCloudData = true;
      }
    })
  );

  // Sync job counter: ensure local counter is >= the highest number in Supabase
  // so nextJobNumber() never generates a duplicate.
  try {
    const { data: jobRows } = await supabase
      .from('jobs')
      .select('job_number')
      .order('created_at', { ascending: false })
      .limit(50);
    if (jobRows?.length) {
      const maxNum = jobRows.reduce((max, r) => {
        const n = parseInt((r.job_number || '').replace(/\D/g, ''), 10);
        return isNaN(n) ? max : Math.max(max, n);
      }, 0);
      const localCounter = LS.get('lusso_job_counter') || 0;
      if (maxNum > localCounter) LS.set('lusso_job_counter', maxNum);
    }
  } catch (e) { console.warn('[db] job counter sync:', e.message); }

  return { hadCloudData };
}

// ── Push all local data up to Supabase ───────────────────────────────
/**
 * Upload everything currently in localStorage to Supabase.
 * Use this once from the device that has the "good" data.
 * Returns { pushed: number, errors: string[] }
 */
export async function pushAllToSupabase() {
  if (!supabase) return { pushed: 0, errors: ['No Supabase connection'] };

  let pushed = 0;
  const errors = [];

  for (const { table, key } of TABLES) {
    if (SKIP_PUSH_TABLES.has(table)) continue;
    const records = LS.get(key);
    if (!records || records.length === 0) continue;
    const exclude = EXCLUDE_COLUMNS[table] || [];
    const rows = records.map((r) => {
      const row = toDb(r);
      exclude.forEach((col) => delete row[col]);
      return row;
    });
    // Supabase requires all rows to have identical keys.
    // Collect the union of all keys, then fill missing ones with null.
    const allKeys = [...new Set(rows.flatMap(Object.keys))];
    const normalised = rows.map((row) => {
      const out = {};
      allKeys.forEach((k) => { out[k] = row[k] ?? null; });
      return out;
    });
    const { error } = await supabase
      .from(table)
      .upsert(normalised, { onConflict: 'id' });
    if (error) {
      console.warn(`[db] push ${table}:`, error.message);
      errors.push(`${table}: ${error.message}`);
    } else {
      pushed += records.length;
    }
  }

  return { pushed, errors };
}

// ── Awaitable multi-record sync ──────────────────────────────────────
// Use this in critical submit flows where the caller MUST wait for
// Supabase confirmation before showing a success screen.
// sequential: true writes entries one-by-one (needed when FK deps exist).
export async function syncNow(entries, { sequential = false } = {}) {
  if (!supabase) return { errors: [] };
  const errors = [];
  const write = async ({ table, record }) => {
    if (!record?.id) return;
    const row = toDb(record);
    (EXCLUDE_COLUMNS[table] || []).forEach(col => delete row[col]);
    const { error } = await supabase.from(table).upsert(row, { onConflict: 'id' });
    if (error) {
      console.warn(`[db] syncNow ${table}:`, error.message);
      errors.push(`${table}: ${error.message}`);
    }
  };
  if (sequential) {
    for (const entry of entries) await write(entry);
  } else {
    await Promise.all(entries.map(write));
  }
  return { errors };
}

// ── Generic upsert / delete ──────────────────────────────────────────
async function upsert(table, record) {
  if (!supabase || !record?.id) return;
  const row = toDb(record);
  (EXCLUDE_COLUMNS[table] || []).forEach((col) => delete row[col]);
  const { error } = await supabase.from(table).upsert(row, { onConflict: 'id' });
  if (error) console.warn(`[db] upsert ${table}:`, error.message);
}

async function remove(table, id) {
  if (!supabase || !id) return;
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) console.warn(`[db] delete ${table}:`, error.message);
}

// ── Per-entity write helpers ─────────────────────────────────────────
// Call these alongside the existing localStorage writes so Supabase stays in sync.

export const db = {
  // Customers
  saveCustomer:       (r) => upsert('customers', r),
  deleteCustomer:     (id) => remove('customers', id),

  // Jobs
  saveJob:            (r) => upsert('jobs', r),
  deleteJob:          (id) => remove('jobs', id),

  // Measure sheets
  saveMeasureSheet:   (r) => upsert('measure_sheets', r),
  deleteMeasureSheet: (id) => remove('measure_sheets', id),

  // Quotes
  saveQuote:          (r) => upsert('quotes', r),
  deleteQuote:        (id) => remove('quotes', id),

  // Installers
  saveInstaller:      (r) => upsert('installers', r),
  deleteInstaller:    (id) => remove('installers', id),

  // Install requests (calendar)
  saveInstallRequest:   (r) => upsert('installations', r),
  deleteInstallRequest: (id) => remove('installations', id),

  // Staff
  saveStaff:          (r) => upsert('staff', r),

  // Product types
  saveProductType:    (r) => upsert('product_types', r),
  deleteProductType:  (id) => remove('product_types', id),

  // Priced items
  savePricedItem:     (r) => upsert('priced_items', r),
  deletePricedItem:   (id) => remove('priced_items', id),

  // Import batches
  savePricedItemBatch:  (r) => upsert('priced_item_batches', r),
  saveContactBatch:     (r) => upsert('contact_import_batches', r),

  // Notifications
  saveNotification:     (r) => upsert('notifications', r),
  deleteNotification:   (id) => remove('notifications', id),

  // Employees
  saveEmployee:         (r) => upsert('employees', r),
  deleteEmployee:       (id) => remove('employees', id),

  // Tasks
  saveTask:             (r) => upsert('tasks', r),
  deleteTask:           (id) => remove('tasks', id),

  // Install requests
  saveInstallRequest:   (r) => upsert('installations', r),
};
