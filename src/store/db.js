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
const toSnake = (s) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
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
  installRequests:      'lusso_install_requests',   // fix: was 'lusso_installations'
  staff:                'lusso_staff',
  productTypes:         'lusso_product_types',
  pricedItems:          'lusso_priced_items',
  pricedItemBatches:    'lusso_priced_item_batches',
  importBatches:        'lusso_import_batches',
  notifications:        'lusso_notifications',
};

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
      // Always overwrite localStorage — even with an empty array.
      // This ensures deleted records on one device disappear on all devices.
      const rows = fromDbAll(data || []);
      LS.set(key, rows);
      if (rows.length > 0) hadCloudData = true;
    })
  );

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
    const records = LS.get(key);
    if (!records || records.length === 0) continue;
    const { error } = await supabase
      .from(table)
      .upsert(records.map(toDb), { onConflict: 'id' });
    if (error) {
      console.warn(`[db] push ${table}:`, error.message);
      errors.push(`${table}: ${error.message}`);
    } else {
      pushed += records.length;
    }
  }

  return { pushed, errors };
}

// ── Generic upsert / delete ──────────────────────────────────────────
async function upsert(table, record) {
  if (!supabase || !record?.id) return;
  const { error } = await supabase.from(table).upsert(toDb(record), { onConflict: 'id' });
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
};
