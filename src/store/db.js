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

export function fromDb(obj) {
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
// ── EXCLUDE_COLUMNS is the authoritative list of app-only fields ─────────────
// Only list fields that do NOT exist as columns in the DB.
// Fields that exist in DB should NOT be here — they'll be written on every save.
// Verified against live DB schema 2026-05-14.
const EXCLUDE_COLUMNS = {
  customers: [
    // App-only fields (no DB column):
    'first_name', 'last_name', 'deleted_by',
    'suburb', 'state', 'postcode', 'country',
    'company', 'import_batch_id', 'source', 'tags',
    // assigned_to is UUID in DB but app stores display name string — exclude to avoid type error
    'assigned_to',
    // DB has: mobile, billing_address, business_name, preferred_contact,
    //         xero_contact_id — all written normally now
  ],
  jobs: [
    // App-only fields (no DB column):
    'deleted_by', 'activity', 'address', 'notes',
    // DB has: title, xero_invoice_id, assigned_to_profile — written normally now
  ],
  measure_sheets: [
    // App-only fields (no DB column):
    'deleted_by', 'notes',
    'imported_from_excel', 'original_file_name', 'imported_at', 'import_notes', 'import_status',
    // DB has: customer_name, customer_notes, email, phone, preferred_contact,
    //         internal_notes, billing_address, assigned_to_profile — written normally now
  ],
  installers: [
    // App-only fields (no DB column):
    'deleted_by',
    // DB now has: business_name, availability_notes, internal_notes,
    //             service_areas, services_offered — all written normally now
  ],
  installations: [
    // DB only has: id, job_id, installer_id, scheduled_date, scheduled_time,
    //              duration_hours, status, accept_token, responded_at, notes,
    //              created_at, updated_at, deleted_at
    'access_notes', 'arrival_time', 'deleted_by', 'assigned_salesperson',
    'created_by', 'expected_duration', 'installation_notes',
    'parking_notes', 'pickup_locations', 'pickup_type', 'product_summary',
    'reveal_full_details', 'secure_accept_token', 'secure_decline_token',
    'site_notes', 'suburb',
  ],
  notifications: ['install_request_id'],
  product_types: [
    'is_active', 'sort_order', 'slug',
  ],
  // priced_items: batchUpsertPricedItems uses its own explicit mapper (toPricedItemDbRow)
  // so toDb() + EXCLUDE_COLUMNS is NOT used for this table during import.
  // pushAllToSupabase still uses toDb() so we list the app-only fields here:
  priced_items: [
    'sku',            // DB has no sku column
    'notes',          // DB has no notes column
    'tags',           // DB has no tags column
    'unit_type',      // DB uses 'unit' — handled by toPricedItemDbRow rename
    'import_batch_id',// DB uses 'batch_id' — handled by toPricedItemDbRow rename
  ],
  priced_item_batches: [
    // DB has error_count and skipped_count — written normally now
  ],
  calendar_events: [
    // No exclusions needed: DB schema designed to match app fields exactly
  ],
  tasks: [
    // App uses 'assignedEmployeeId' but DB column is 'assigned_to' (UUID FK)
    // Exclude to avoid column-not-found error; assignment syncs via assigned_to when set
    'assigned_employee_id',
    // created_by in app may be a display name string, but DB column expects UUID
    'created_by',
    // Any other app-only task fields
    'assigned_employee',
  ],
  quotes: [
    // App-only fields that do NOT exist as DB columns:
    'version', 'measure_sheet_id', 'site_address', 'terms_and_conditions',
    'internal_notes', 'follow_up_date', 'show_sizes_to_client',
    'viewed_at', 'declined_at', 'accepted_by', 'activity', 'deleted_by',
    // DB has: grand_total, gst_amount, public_token, comments, selected_line_item_ids,
    //         total_cost, total_sell, xero_invoice_id, xero_invoice_number,
    //         xero_invoice_status, xero_invoice_url, xero_invoice_created_at,
    //         xero_invoice_created_by, xero_last_synced_at,
    //         salesperson_id, assigned_to_profile — all written normally now
  ],
  // customers: xero_contact_id, xero_contact_name, xero_last_synced_at — written normally
  // priced_items: xero_item_id, xero_item_code, xero_account_code, xero_tax_type,
  //               xero_last_synced_at — written normally via pushAllToSupabase
};

// ── Tables skipped during push (DB table doesn't exist yet) ──────────
const SKIP_PUSH_TABLES = new Set(['employees', 'notifications']);

// ── Per-table upsert conflict column override ─────────────────────────
// quotes has a unique constraint on quote_number, so upsert on that
// column to avoid duplicate key errors when re-pushing.
const TABLE_CONFLICT_COL = {
  quotes: 'quote_number',
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
  { table: 'calendar_events',        key: 'lusso_calendar_events' },
  { table: 'tasks',                  key: KEYS.tasks },
  { table: 'po_message_presets',     key: 'lusso_po_message_presets' },
  // NOTE: 'activity' is intentionally NOT here — it's append-only and synced
  // via a union (see hydrateFromSupabase) so existing local history is never
  // dropped by the "Supabase is authoritative" rule.
  // employees table doesn't exist in Supabase — uses profiles table instead
  // { table: 'employees',           key: KEYS.employees },
];

// ── Pagination helper ─────────────────────────────────────────────────────────
/**
 * Fetch ALL rows from a table using sequential range pages.
 * Supabase / PostgREST defaults to returning at most 1000 rows without an
 * explicit range, so tables larger than 1000 rows need this helper.
 */
const PAGE_SIZE = 1000;

async function fetchAllPages(table, useDeletedFilter) {
  let all = [];
  let from = 0;

  while (true) {
    let q = supabase.from(table).select('*');
    if (useDeletedFilter) q = q.is('deleted_at', null);
    q = q.order('created_at', { ascending: true }).range(from, from + PAGE_SIZE - 1);

    const { data, error } = await q;
    if (error) return { data: null, error };

    const page = data || [];
    all = all.concat(page);
    if (page.length < PAGE_SIZE) break; // reached last page
    from += PAGE_SIZE;
  }

  return { data: all, error: null };
}

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
      // Fetch only non-deleted records so soft-deleted items stay gone after refresh.
      // Fall back to unfiltered fetch for tables without a deleted_at column.
      // fetchAllPages handles >1000 rows via range-based pagination.
      let fetchedData = null;
      const { data: d1, error: e1 } = await fetchAllPages(table, true);
      if (e1) {
        const { data: d2, error: e2 } = await fetchAllPages(table, false);
        if (e2) { console.warn(`[db] hydrate ${table}:`, e2.message); return; }
        fetchedData = d2;
      } else {
        fetchedData = d1;
      }
      const rows = fromDbAll(fetchedData || []);
      // Supabase is the source of truth.
      // Always write the Supabase result to localStorage, even if empty —
      // an empty response means everything was deleted and should stay gone.
      const local = LS.get(key) || [];
      const localById = new Map(local.map(r => [r.id, r]));

      // For records in both: keep whichever has the newer updatedAt.
      // This protects unsaved local edits made moments before hydration.
      const merged = rows.map(sbRow => {
        const localRow = localById.get(sbRow.id);
        if (!localRow) return sbRow;
        const sbMs = new Date(sbRow.updatedAt || 0).getTime();
        const locMs = new Date(localRow.updatedAt || 0).getTime();
        return locMs > sbMs ? localRow : sbRow;
      });

      // NO localOnly — Supabase is authoritative. Any local record not in
      // Supabase was either deleted by another device or never successfully
      // synced. In both cases it must not survive a refresh.
      LS.set(key, merged);
      if (rows.length > 0) hadCloudData = true;
    })
  );

  // ── Activity (append-only) — union, never drop local-only entries ──────────
  // Unlike the entity tables above, activity is never deleted, so we merge
  // Supabase rows into the local log instead of letting Supabase wipe it.
  // This pulls in activity from other devices while keeping local/seed history.
  try {
    const { data, error } = await fetchAllPages('activity', true);
    if (!error) {
      const sbRows = fromDbAll(data || []);
      const byId = new Map((LS.get('lusso_activity') || []).map(r => [r.id, r]));
      for (const r of sbRows) byId.set(r.id, r); // Supabase wins for shared ids
      const merged = Array.from(byId.values())
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      LS.set('lusso_activity', merged);
      if (sbRows.length > 0) hadCloudData = true;
    }
  } catch (e) { console.warn('[db] hydrate activity:', e.message); }

  // Sync numeric counters so generated numbers never collide with Supabase records.
  try {
    const { data: jobRows } = await supabase.from('jobs').select('job_number').limit(100);
    if (jobRows?.length) {
      const max = jobRows.reduce((m, r) => Math.max(m, parseInt((r.job_number || '').replace(/\D/g, ''), 10) || 0), 0);
      if (max > (LS.get('lusso_job_counter') || 0)) LS.set('lusso_job_counter', max);
    }
  } catch (e) { console.warn('[db] job counter sync:', e.message); }

  try {
    const { data: quoteRows } = await supabase.from('quotes').select('quote_number').limit(200);
    if (quoteRows?.length) {
      const max = quoteRows.reduce((m, r) => Math.max(m, parseInt((r.quote_number || '').replace(/\D/g, ''), 10) || 0), 0);
      if (max > (LS.get('lusso_quote_counter') || 0)) LS.set('lusso_quote_counter', max);
    }
  } catch (e) { console.warn('[db] quote counter sync:', e.message); }

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
    const excludeSet = new Set(EXCLUDE_COLUMNS[table] || []);
    const rows = records.map((r) => {
      const row = toDb(r);
      return Object.fromEntries(Object.entries(row).filter(([k]) => !excludeSet.has(k)));
    });
    // Supabase requires all rows to have identical keys.
    // Collect the union of all keys, then fill missing ones with null.
    const allKeys = [...new Set(rows.flatMap(Object.keys))];
    let normalised = rows.map((row) => {
      const out = {};
      allKeys.forEach((k) => { out[k] = row[k] ?? null; });
      return out;
    });
    // Deduplicate quotes by quote_number — keep most recently updated.
    // Supabase rejects batches where onConflict would update the same row twice.
    if (table === 'quotes') {
      const byNumber = new Map();
      normalised.forEach(row => {
        if (!row.quote_number) return;
        const existing = byNumber.get(row.quote_number);
        if (!existing || (row.updated_at || '') > (existing.updated_at || '')) {
          byNumber.set(row.quote_number, row);
        }
      });
      normalised = [...byNumber.values()];
    }
    const conflictCol = TABLE_CONFLICT_COL[table] || 'id';

    // Self-healing + chunked upsert:
    //  Phase 1 — probe with the first row to discover unknown columns, stripping
    //             them one-by-one until the probe succeeds (up to 10 attempts).
    //  Phase 2 — batch upsert the full payload in CHUNK_SIZE chunks so large
    //             tables (>1000 rows) are fully pushed, not silently truncated.
    const CHUNK_SIZE = 500;
    let payload      = normalised;
    let autoStripped = [];
    let lastError    = null;

    // Phase 1: column discovery via single-row probe
    if (payload.length > 0) {
      let probe = [{ ...payload[0] }];
      for (let attempt = 0; attempt < 10; attempt++) {
        const { error } = await supabase.from(table).upsert(probe, { onConflict: conflictCol });
        if (!error) break;
        const colMatch = error.message.match(/Could not find the '([^']+)' column/);
        if (colMatch) {
          const badCol = colMatch[1];
          autoStripped.push(badCol);
          console.warn(`[db] push ${table}: auto-stripping unknown column '${badCol}'`);
          const strip = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== badCol));
          probe   = [strip(probe[0])];
          payload = payload.map(strip);
        } else {
          lastError = error;
          break;
        }
      }
    }

    // Phase 2: chunked upsert (idempotent — first row already upserted above)
    if (!lastError) {
      for (let i = 0; i < payload.length; i += CHUNK_SIZE) {
        const chunk = payload.slice(i, i + CHUNK_SIZE);
        const { error } = await supabase.from(table).upsert(chunk, { onConflict: conflictCol });
        if (error) { lastError = error; break; }
      }
    }

    if (lastError) {
      console.warn(`[db] push ${table}:`, lastError.message);
      errors.push(`${table}: ${lastError.message}`);
    } else {
      pushed += records.length;
      if (autoStripped.length) {
        console.info(`[db] push ${table}: auto-stripped [${autoStripped.join(', ')}] — add to EXCLUDE_COLUMNS`);
      }
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
    const raw = toDb(record);
    const excludeSet = new Set(EXCLUDE_COLUMNS[table] || []);
    let row = Object.fromEntries(Object.entries(raw).filter(([k]) => !excludeSet.has(k)));
    for (let attempt = 0; attempt < 10; attempt++) {
      const { error } = await supabase.from(table).upsert(row, { onConflict: 'id' });
      if (!error) return;
      const colMatch = error.message.match(/Could not find the '([^']+)' column/);
      if (colMatch) {
        const badCol = colMatch[1];
        const { [badCol]: _dropped, ...rest } = row;
        row = rest;
      } else {
        console.warn(`[db] syncNow ${table}:`, error.message);
        errors.push(`${table}: ${error.message}`);
        return;
      }
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
  const raw = toDb(record);
  const excludeSet = new Set(EXCLUDE_COLUMNS[table] || []);
  let row = Object.fromEntries(Object.entries(raw).filter(([k]) => !excludeSet.has(k)));

  // Self-healing: if Supabase rejects an unknown column (e.g. an app-only
  // field not yet in EXCLUDE_COLUMNS, or a column that was never added to the
  // DB), strip it and retry up to 10 times so soft-deletes and other writes
  // never fail silently.
  for (let attempt = 0; attempt < 10; attempt++) {
    const { error } = await supabase.from(table).upsert(row, { onConflict: 'id' });
    if (!error) return;
    const colMatch = error.message.match(/Could not find the '([^']+)' column/);
    if (colMatch) {
      const badCol = colMatch[1];
      console.warn(`[db] upsert ${table}: auto-stripping unknown column '${badCol}' — add to EXCLUDE_COLUMNS`);
      const { [badCol]: _dropped, ...rest } = row;
      row = rest;
    } else {
      console.warn(`[db] upsert ${table}:`, error.message);
      return;
    }
  }
}

async function remove(table, id) {
  if (!supabase || !id) return;
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) {
    // Use console.error so it's visible in prod DevTools, not just a warning
    console.error(`[db] DELETE ${table} id=${id} FAILED:`, error.message, error);
  }
}

// ── Per-entity write helpers ─────────────────────────────────────────
// Call these alongside the existing localStorage writes so Supabase stays in sync.

// Soft-delete: sets deleted_at instead of hard-removing the row.
// This lets us restore accidentally deleted records.
async function softDelete(table, id) {
  if (!supabase || !id) return;
  const { error } = await supabase
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) console.error(`[db] softDelete ${table} id=${id} FAILED:`, error.message);
}

async function restore(table, id) {
  if (!supabase || !id) return;
  const { error } = await supabase
    .from(table)
    .update({ deleted_at: null })
    .eq('id', id);
  if (error) console.error(`[db] restore ${table} id=${id} FAILED:`, error.message);
}

export const db = {
  // Customers — soft delete so records can be restored if deleted by accident
  saveCustomer:       (r)  => upsert('customers', r),
  deleteCustomer:     (id) => softDelete('customers', id),
  restoreCustomer:    (id) => restore('customers', id),

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

  // Calendar events
  saveCalendarEvent:    (r) => upsert('calendar_events', r),
  deleteCalendarEvent:  (id) => remove('calendar_events', id),

  // Activity log (append-only, synced via union in hydrate)
  saveActivity:         (r) => upsert('activity', r),

  // PO message presets (email → pre-written message)
  savePoMessagePreset:   (r)  => upsert('po_message_presets', r),
  deletePoMessagePreset: (id) => softDelete('po_message_presets', id),
};

// ── Batch upsert for bulk imports ────────────────────────────────────────────
/**
 * Upsert a large batch of customer records directly into Supabase.
 * Used by runContactImport so CSV imports write to the DB immediately
 * (not relying on a later manual "Push to Cloud").
 *
 * Applies EXCLUDE_COLUMNS transformation, self-heals unknown columns,
 * and sends records in chunks of 500 to stay well under PostgREST limits.
 *
 * Returns { inserted: number, errors: string[] }
 */
export async function batchUpsertCustomers(customers) {
  if (!supabase || !customers.length) return { inserted: 0, errors: [] };

  const excludeSet = new Set(EXCLUDE_COLUMNS.customers || []);
  const rows = customers.map(r => {
    const raw = toDb(r);
    return Object.fromEntries(Object.entries(raw).filter(([k]) => !excludeSet.has(k)));
  });

  // Normalise to a uniform key set (Supabase requires identical keys per batch)
  const allKeys = [...new Set(rows.flatMap(Object.keys))];
  let payload = rows.map(row => {
    const out = {};
    allKeys.forEach(k => { out[k] = row[k] ?? null; });
    return out;
  });

  let autoStripped = [];
  let lastError    = null;

  // Phase 1: column discovery via single-row probe
  if (payload.length > 0) {
    let probe = [{ ...payload[0] }];
    for (let attempt = 0; attempt < 10; attempt++) {
      const { error } = await supabase.from('customers').upsert(probe, { onConflict: 'id' });
      if (!error) break;
      const colMatch = error.message.match(/Could not find the '([^']+)' column/);
      if (colMatch) {
        const badCol = colMatch[1];
        autoStripped.push(badCol);
        const strip = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== badCol));
        probe   = [strip(probe[0])];
        payload = payload.map(strip);
      } else {
        lastError = error;
        break;
      }
    }
  }

  if (autoStripped.length) {
    console.info(`[db] batchUpsertCustomers: auto-stripped [${autoStripped.join(', ')}] — add to EXCLUDE_COLUMNS.customers`);
  }

  let inserted = 0;
  const errors = [];

  if (lastError) {
    errors.push(lastError.message);
    return { inserted, errors };
  }

  // Phase 2: chunked upsert
  const CHUNK = 500;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const chunk = payload.slice(i, i + CHUNK);
    const { error } = await supabase.from('customers').upsert(chunk, { onConflict: 'id' });
    if (error) {
      console.warn('[db] batchUpsertCustomers chunk error:', error.message);
      errors.push(error.message);
      break;
    }
    inserted += chunk.length;
  }

  return { inserted, errors };
}

// ── Priced-item field mapper ──────────────────────────────────────────────────
/**
 * Converts an app priced-item object to the exact shape the DB expects.
 * Handles two field-name mismatches vs. generic toDb():
 *   unitType  → unit      (DB column is "unit", not "unit_type")
 *   importBatchId → batch_id  (DB column is "batch_id", not "import_batch_id")
 * Omits sku / notes / tags which are app-only fields with no DB column.
 */
function toPricedItemDbRow(item) {
  return {
    id:             item.id,
    item_name:      item.itemName      || '',
    item_code:      item.itemCode      || item.sku || '',
    description:    item.description   || '',
    category:       item.category      || '',
    supplier:       item.supplier      || '',
    cost_price:     item.costPrice     ?? null,
    labour_cost:    item.labourCost    ?? null,
    sell_price:     item.sellPrice     ?? null,
    margin_percent: item.marginPercent ?? null,
    markup_percent: item.markupPercent ?? null,
    tax_rate:       item.taxRate       ?? 10,
    gst_applicable: item.gstApplicable !== false,
    unit:           item.unitType      || item.unit || '',
    is_active:      item.isActive      !== false,
    price_per_sqm:  item.pricePerSqm   ?? null,
    source:         item.source        || '',
    batch_id:       item.importBatchId || item.batchId || null,
    created_at:     item.createdAt     || new Date().toISOString(),
    updated_at:     item.updatedAt     || new Date().toISOString(),
  };
}

// ── Batch upsert for bulk priced-item imports ────────────────────────────────
/**
 * Upsert a large batch of priced-item records directly into Supabase.
 * Uses toPricedItemDbRow() so field names always match the DB schema exactly.
 * Sends records in chunks of 500 to stay under PostgREST limits.
 *
 * Returns { inserted: number, errors: string[] }
 */
export async function batchUpsertPricedItems(items) {
  if (!supabase || !items.length) return { inserted: 0, errors: [] };

  const payload = items.map(toPricedItemDbRow);

  let inserted = 0;
  const errors = [];

  const CHUNK = 500;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const chunk = payload.slice(i, i + CHUNK);
    const { error } = await supabase.from('priced_items').upsert(chunk, { onConflict: 'id' });
    if (error) {
      console.warn('[db] batchUpsertPricedItems chunk error:', error.message);
      errors.push(error.message);
      break;
    }
    inserted += chunk.length;
  }

  if (inserted) console.info(`[db] batchUpsertPricedItems: ✓ ${inserted} rows saved to Supabase`);
  return { inserted, errors };
}
