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
import { lsGet, lsSet } from './storage';

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

// Irregular field pairs the generic converter can't round-trip. A trailing
// all-caps acronym loses its case on the way back (includesGST → includes_gst →
// includesGst), so map those explicitly in BOTH directions. Add any future
// acronym-tailed field here.
const FIELD_TO_DB   = { includesGST: 'includes_gst' };
const FIELD_FROM_DB = Object.fromEntries(Object.entries(FIELD_TO_DB).map(([camel, snake]) => [snake, camel]));

function toDb(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[FIELD_TO_DB[k] || toSnake(k)] = v;
  }
  return out;
}

export function fromDb(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[FIELD_FROM_DB[k] || toCamel(k)] = v;
  }
  return out;
}

const fromDbAll = (rows) => (rows || []).map(fromDb);

// ── localStorage helpers (shared codec — large values LZ-compressed) ──
const LS = {
  get: (key) => lsGet(key) ?? [],
  set: (key, val) => lsSet(key, val),
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
  takeoffs:             'lusso_takeoffs',
  reviewRequests:       'lusso_review_requests',
  measureSheetOptions:  'lusso_measure_sheet_options',
  schedulingDismissals: 'lusso_scheduling_dismissals',
  curtainRates:         'lusso_curtain_rates',
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
    // DB columns: id, name, sort_order, is_active, specs, options, updated_at,
    // created_at, deleted_at. `slug` is app-only (no column). updated_at now
    // exists and IS written, so cross-device edits reconcile by newer-wins
    // (without it the server row looked like epoch 0 and local always won, so
    // one device's product-type edits never reached another).
    'slug',
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
    // Notes & to-dos live here. kind / photo_paths / author_name ARE real
    // columns (see supabase/migrations/notes_and_todos.sql) and sync normally.
    // What's listed below is legacy shape only — records written before the
    // notes UI existed, which would otherwise fail on column-not-found the
    // first time someone ticks one off.
    //
    // App used 'assignedEmployeeId' (a staff id); the column is assigned_to,
    // a profiles UUID, which the composer writes directly.
    'assigned_employee_id',
    'assigned_employee',
    // created_by expects a UUID; the app records the writer's name in
    // author_name instead, which is what the feed actually renders.
    'created_by',
    // The old seed carried a free-text `notes` field. There is no such column —
    // the note's own text is title + description.
    'notes',
  ],
  quotes: [
    // Server-owned: written ONLY by track_quote_event when the customer opens,
    // accepts or declines. They are pulled down for display, so every browser
    // holds a copy — and a full-row upsert used to push that copy straight back
    // over the live values. A staff machine holding a pre-open copy therefore
    // reset first_opened_at to null, and the customer's next open announced
    // itself as their first all over again. Read them, never write them.
    'first_opened_at', 'last_viewed_at', 'view_count', 'customer_last_seen_at',
    // App-only fields that do NOT exist as DB columns:
    'version', 'measure_sheet_id',
    'internal_notes', 'follow_up_date',
    'viewed_at', 'declined_at', 'accepted_by', 'activity', 'deleted_by',
    'source', 'import_note',
    // site_address / terms_and_conditions / show_sizes_to_client used to be
    // listed here, so they were stripped from every write and existed only in
    // the author's own localStorage. The customer opening the link on their
    // phone therefore got a quote with no site address, the generic default
    // terms rather than the ones written for them, and sizes permanently
    // hidden however the "Show dimensions to client" box was set. They are real
    // columns now — see supabase/migrations/public_quote_link_hardening.sql.
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

// ── Server-owned lifecycle fields (camelCase — these are post-fromDb names) ──
// Where a quote or a job is up to is decided on the server: track_quote_event
// when the customer opens / accepts / declines, job_advance_status behind it,
// and the guard triggers that arbitrate between those and a staff write
// (supabase/migrations/quote_status_guard.sql, job_status_guard.sql).
//
// Hydration below merges by updatedAt, and most of those server paths never
// touch it — only the accept path bumps updated_at, and then only via
// quote_recompute_totals. So after a decline, or a plain open moving Sent →
// Viewed, a browser whose own updatedAt happens to be newer keeps its entire
// local row: the server is right and that screen goes on showing "Sent" until
// it next writes something.
//
// Taking these fields from the server row whenever we keep a local one closes
// that, and does it without needing the browser's clock to agree with the
// database's. It is safe because it runs AFTER the pending-outbox check: a
// local write not yet confirmed returns early and is never overwritten here.
const SERVER_LIFECYCLE_FIELDS = {
  quotes: ['status', 'statusChangedAt', 'acceptedAt', 'sentAt', 'declineReason',
           'selectedLineItemIds', 'firstOpenedAt', 'lastViewedAt', 'viewCount',
           'customerLastSeenAt'],
  jobs:   ['status', 'statusChangedAt'],
};

// Only the fields the server actually returned: a column that doesn't exist yet
// (status_changed_at before its migration is applied) must not blank the local
// value on its way through.
function serverLifecycle(table, sbRow) {
  const fields = SERVER_LIFECYCLE_FIELDS[table];
  if (!fields) return null;
  const out = {};
  for (const f of fields) if (f in sbRow) out[f] = sbRow[f];
  return out;
}

// ── Tables skipped by the bulk pushAllToSupabase() sweep ─────────────
// `employees` has no Supabase table at all (profiles is used instead).
// `notifications` does exist and IS written one row at a time by
// db.saveNotification — read state has to reach the server or hydrate puts it
// back. It stays out of the bulk sweep only because those rows are generated
// server-side, so re-uploading a device's local copy of them proves nothing.
const SKIP_PUSH_TABLES = new Set(['employees', 'notifications']);

// ── Per-table upsert conflict column override ─────────────────────────
// quotes has a unique constraint on quote_number, so upsert on that
// column to avoid duplicate key errors when re-pushing.
const TABLE_CONFLICT_COL = {
  quotes: 'quote_number',
};

// A write must never hang forever (a half-open socket on site never settles).
// Turn a hang into a deterministic rejection so the write-ahead pending marking
// covers it and flushPending retries later. supabase-js sets no timeout itself.
const WRITE_TIMEOUT_MS = 15_000;
const withTimeout = (promise, ms = WRITE_TIMEOUT_MS) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('supabase write timed out')), ms)),
  ]);

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
  { table: 'suppliers',              key: 'lusso_suppliers' },
  { table: 'takeoffs',               key: KEYS.takeoffs },
  { table: 'review_requests',        key: KEYS.reviewRequests },
  { table: 'measure_sheet_options',  key: KEYS.measureSheetOptions },
  { table: 'scheduling_dismissals',  key: KEYS.schedulingDismissals },
  { table: 'curtain_rates',          key: KEYS.curtainRates },
  // NOTE: 'activity' is intentionally NOT here — it's append-only and synced
  // via a union (see hydrateFromSupabase) so existing local history is never
  // dropped by the "Supabase is authoritative" rule.
  // employees table doesn't exist in Supabase — uses profiles table instead
  // { table: 'employees',           key: KEYS.employees },
];

const TABLE_TO_KEY = Object.fromEntries(TABLES.map(t => [t.table, t.key]));

// ── Pending-sync outbox ───────────────────────────────────────────────────────
// When a write to Supabase fails (e.g. a flaky on-site connection), the record
// still lives in localStorage but is NOT on the server. We record it here so:
//   1. hydrateFromSupabase never discards it (it isn't "deleted elsewhere" — it
//      just hasn't synced yet), and
//   2. flushPending() keeps retrying the write until it succeeds.
// This prevents on-site work (new customer/job/measure sheet) from vanishing.
const PENDING_KEY = 'lusso_pending_sync';
// Route through lsGet/lsSet so the outbox is mirrored to the durable IndexedDB
// backup too — it tracks unsynced work, so it must survive a localStorage
// eviction just like the records it points at.
const getPending = () => { try { return lsGet(PENDING_KEY) || {}; } catch { return {}; } };
const savePending = (p) => { try { lsSet(PENDING_KEY, p); } catch { /* best-effort */ } };
function markPending(table, id) {
  if (!table || !id) return;
  const p = getPending();
  const bucket = (p[table] = p[table] || {});
  // Entries were plain timestamps; keep tolerating that shape while carrying a
  // strip counter forward, so a queued-because-incomplete record doesn't reset
  // its budget every time it is retried.
  const prev = bucket[id];
  const strips = (prev && typeof prev === 'object' && prev.strips) || 0;
  bucket[id] = strips ? { at: Date.now(), strips } : Date.now();
  savePending(p);
}

// How many flush attempts a record gets while the server keeps rejecting one of
// its columns. A stale PostgREST schema cache clears in seconds; a column that
// genuinely doesn't exist never will, and retrying it forever would churn every
// hydration. After this many, give up loudly rather than quietly.
const MAX_STRIP_FLUSHES = 6;

/**
 * A write landed, but WITHOUT some of its columns.
 *
 * The row on the server is now incomplete, so the record deliberately STAYS in
 * the pending outbox: hydration never overwrites a pending record, which is
 * what stops the stripped server row replacing the complete local one, and the
 * next flush re-sends it once the schema catches up.
 */
function noteStrippedWrite(table, id, dropped) {
  const p = getPending();
  const bucket = (p[table] = p[table] || {});
  const prev = bucket[id];
  const strips = ((prev && typeof prev === 'object' && prev.strips) || 0) + 1;

  if (strips > MAX_STRIP_FLUSHES) {
    console.error(
      `[db] GIVING UP on ${table}/${id}: the server has rejected ${dropped.join(', ')} ` +
      `${strips} times. The row is saved WITHOUT those fields. Either add the column(s) ` +
      `to the database (then: notify pgrst, 'reload schema') or list them in EXCLUDE_COLUMNS.`
    );
    clearPending(table, id);
    return;
  }

  bucket[id] = { at: Date.now(), strips };
  savePending(p);
  console.error(
    `[db] ${table}/${id} saved WITHOUT ${dropped.join(', ')} — the server doesn't know ` +
    `those columns yet. Kept queued (attempt ${strips}/${MAX_STRIP_FLUSHES}); the local ` +
    `copy is intact and will re-send. If this persists, the schema cache is stale ` +
    `(notify pgrst, 'reload schema') or the column is missing.`
  );
}
function clearPending(table, id) {
  const p = getPending();
  if (p[table] && p[table][id] !== undefined) {
    delete p[table][id];
    if (Object.keys(p[table]).length === 0) delete p[table];
    savePending(p);
  }
}
export const pendingIds = (table) => new Set(Object.keys(getPending()[table] || {}));

// ── Pagination helper ─────────────────────────────────────────────────────────
/**
 * Fetch ALL rows from a table using sequential range pages.
 * Supabase / PostgREST defaults to returning at most 1000 rows without an
 * explicit range, so tables larger than 1000 rows need this helper.
 */
// Smaller pages keep each request light (quotes carry heavy line_items JSONB),
// which matters most on mobile connections and while the DB is disk-IO throttled.
const PAGE_SIZE = 500;
const PAGE_RETRIES = 4; // attempts per page before giving up

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Tables with no `deleted_at`. Filtering on it returns a 400, and the caller's
// fallback only kicks in AFTER the retry loop has burned four attempts and
// ~2.8s of backoff — on every hydration, for every user, filling the console
// with errors that mask real ones. Verified against the live schema
// 2026-08-31; a table missing from here still works, just slowly.
const NO_SOFT_DELETE = new Set(['scheduling_dismissals']);

async function fetchAllPages(table, useDeletedFilter) {
  let all = [];
  let from = 0;

  while (true) {
    // Retry each page with exponential backoff. A single transient page error
    // (timeout / IO-throttle hiccup) must NOT abort the whole table — that's
    // what left a fresh device with empty Jobs/Quotes/Customers while the tiny
    // activity table (one page) still loaded. Only give up after all retries.
    let page = null;
    let lastErr = null;
    for (let attempt = 0; attempt < PAGE_RETRIES; attempt++) {
      let q = supabase.from(table).select('*');
      if (useDeletedFilter && !NO_SOFT_DELETE.has(table)) q = q.is('deleted_at', null);
      q = q.order('created_at', { ascending: true }).range(from, from + PAGE_SIZE - 1);

      const { data, error } = await q;
      if (!error) { page = data || []; lastErr = null; break; }
      lastErr = error;
      if (attempt < PAGE_RETRIES - 1) await sleep(400 * Math.pow(2, attempt)); // 400, 800, 1600ms
    }
    if (lastErr) return { data: null, error: lastErr };

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

  // First, push anything still waiting to sync (failed on a flaky connection),
  // so this pull doesn't race ahead of an unsynced local record.
  try { await flushPending(); } catch { /* never block hydration */ }

  await Promise.all(
    TABLES.map(async ({ table, key }) => {
      // Fetch only non-deleted records so soft-deleted items stay gone after refresh.
      // Fall back to unfiltered fetch for tables without a deleted_at column.
      // fetchAllPages handles >1000 rows via range-based pagination.
      let fetchedData;
      const { data: d1, error: e1 } = await fetchAllPages(table, !NO_SOFT_DELETE.has(table));
      if (e1) {
        const { data: d2, error: e2 } = await fetchAllPages(table, false);
        if (e2) { console.warn(`[db] hydrate ${table}:`, e2.message); return; }
        fetchedData = d2;
      } else {
        fetchedData = d1;
      }
      const rows = fromDbAll(fetchedData || []);
      const local = LS.get(key) || [];

      // SAFETY GUARD: a 0-row but "successful" response must NEVER wipe a
      // populated local table. Empty almost always means a transient RLS/session
      // hiccup (e.g. the account momentarily not seen as active) or a flaky
      // empty page — not "every record was deleted". Keep local untouched; a
      // later healthy hydrate reconciles. (This is what wiped everything during
      // the earlier outage.) Genuine "delete them all" is vanishingly rare and
      // can be redone with an explicit resync.
      if (rows.length === 0 && local.length > 0) return;

      // SAFETY GUARD 2: a suspiciously SMALL response for a large local table is
      // almost always a partial/truncated fetch (e.g. the DB returned a short
      // result under disk-IO-throttling load), NOT a genuine mass-delete.
      // Overwriting the full local list with it is what truncated a 2000-row
      // Projects list to 2. Keep local; a later healthy hydrate / explicit resync
      // reconciles a real bulk delete (rare).
      if (local.length > 20 && rows.length < local.length * 0.5) {
        console.warn(`[db] hydrate ${table}: got ${rows.length} rows vs ${local.length} local — treating as a partial fetch, keeping local`);
        return;
      }

      const localById = new Map(local.map(r => [r.id, r]));
      const pend = pendingIds(table);

      // For records in both: keep whichever has the newer updatedAt — EXCEPT a
      // record still in the pending outbox, whose local copy hasn't been
      // confirmed to the server yet; always keep local so a queued edit isn't
      // overwritten by the stale server row (which flushPending would then push
      // back, losing the edit).
      const merged = rows.map(sbRow => {
        const localRow = localById.get(sbRow.id);
        if (!localRow) return sbRow;
        if (pend.has(sbRow.id)) return localRow;
        const sbMs = new Date(sbRow.updatedAt || 0).getTime();
        const locMs = new Date(localRow.updatedAt || 0).getTime();
        if (locMs <= sbMs) return sbRow;
        // Local is the newer row overall — but the lifecycle is the server's to
        // state, not this browser's. See SERVER_LIFECYCLE_FIELDS.
        return { ...localRow, ...serverLifecycle(table, sbRow) };
      });

      // Also keep pending records that don't exist on the server yet (new,
      // not-yet-synced). Any OTHER local-only record was deleted elsewhere.
      const mergedIds = new Set(merged.map(r => r.id));
      if (pend.size) {
        for (const localRow of local) {
          if (pend.has(localRow.id) && !mergedIds.has(localRow.id)) merged.push(localRow);
        }
      }
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
    markPending(table, record.id); // write-ahead: queued until a confirmed success
    const raw = toDb(record);
    const excludeSet = new Set(EXCLUDE_COLUMNS[table] || []);
    let row = Object.fromEntries(Object.entries(raw).filter(([k]) => !excludeSet.has(k)));
    // Same rule as upsert(): a write that had columns stripped is INCOMPLETE on
    // the server, so it stays queued rather than being cleared as a success.
    // (This path had its own copy of the strip logic and its own copy of the
    // bug — an explicit "Sync now" could quietly drop the very fields the user
    // pressed the button to push.)
    const dropped = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      let error;
      try {
        ({ error } = await withTimeout(supabase.from(table).upsert(row, { onConflict: TABLE_CONFLICT_COL[table] || 'id' })));
      } catch (e) {
        console.warn(`[db] syncNow ${table} network error:`, e?.message || e); // stays queued
        errors.push(`${table}: ${e?.message || e}`);
        return;
      }
      if (!error) {
        if (dropped.length) {
          noteStrippedWrite(table, record.id, dropped);
          errors.push(`${table}: saved without ${dropped.join(', ')} — column(s) missing on the server`);
        } else {
          clearPending(table, record.id);
        }
        return;
      }
      const colMatch = error.message.match(/Could not find the '([^']+)' column/);
      if (colMatch) {
        dropped.push(colMatch[1]);
        row = { ...row };
        delete row[colMatch[1]];
      } else {
        console.warn(`[db] syncNow ${table}:`, error.message); // stays queued for retry
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
  // Write-ahead: queue the record BEFORE attempting the write, and clear it only
  // on a confirmed success. This way a request that hangs (poor signal), a tab
  // that closes mid-write, or a crash all leave the record queued for retry —
  // never local-only-and-unmarked (which hydration could wipe).
  markPending(table, record.id);
  const raw = toDb(record);
  const excludeSet = new Set(EXCLUDE_COLUMNS[table] || []);
  let row = Object.fromEntries(Object.entries(raw).filter(([k]) => !excludeSet.has(k)));

  // Self-healing: if Supabase rejects an unknown column (an app-only field not
  // in EXCLUDE_COLUMNS, or one the schema cache hasn't picked up yet), strip it
  // and retry so the REST of the record still lands. What must not happen is
  // treating that as a clean success — the server row is missing fields, and
  // clearing the outbox would let the next hydration overwrite the complete
  // local copy with the incomplete remote one. That is how a takeoff's window
  // items vanished after the columns for them were added.
  const dropped = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    let error;
    try {
      ({ error } = await withTimeout(supabase.from(table).upsert(row, { onConflict: TABLE_CONFLICT_COL[table] || 'id' })));
    } catch (e) {
      console.warn(`[db] upsert ${table} network error:`, e?.message || e); // stays queued
      return;
    }
    if (!error) {
      if (dropped.length) noteStrippedWrite(table, record.id, dropped);  // incomplete → stays queued
      else clearPending(table, record.id);                              // confirmed complete
      return;
    }
    const colMatch = error.message.match(/Could not find the '([^']+)' column/);
    if (colMatch) {
      const badCol = colMatch[1];
      dropped.push(badCol);
      row = { ...row };
      delete row[badCol];
    } else {
      console.warn(`[db] upsert ${table}:`, error.message); // stays queued for retry
      return;
    }
  }
  // Exhausted the strip retries — leave it queued for a later flush.
}

async function remove(table, id) {
  if (!supabase || !id) return;
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) {
    // Use console.error so it's visible in prod DevTools, not just a warning
    console.error(`[db] DELETE ${table} id=${id} FAILED:`, error.message, error);
  }
}

// Retry every record still in the pending-sync outbox (writes that failed on a
// flaky connection). upsert() clears each one from the queue on success and
// re-queues on failure. Safe and cheap to call often — no-ops when empty.
// Parents before children so foreign keys resolve (a job needs its customer to
// exist first, a quote/measure sheet needs its job, etc.). Tables not listed run last.
const SYNC_ORDER = [
  'customers', 'staff', 'installers', 'product_types', 'priced_items', 'suppliers',
  'jobs', 'measure_sheets', 'quotes', 'installations', 'tasks', 'takeoffs',
  'review_requests', 'notifications', 'calendar_events', 'scheduling_dismissals',
];
export async function flushPending() {
  if (!supabase) return;
  const p = getPending();
  const tables = Object.keys(p).sort(
    (a, b) => (SYNC_ORDER.indexOf(a) + 1 || 99) - (SYNC_ORDER.indexOf(b) + 1 || 99)
  );
  if (!tables.length) return;
  for (const table of tables) {
    const key = TABLE_TO_KEY[table];
    const ids = Object.keys(p[table] || {});
    if (!key) { ids.forEach(id => clearPending(table, id)); continue; }
    const byId = new Map((LS.get(key) || []).map(r => [r.id, r]));
    for (const id of ids) {
      const rec = byId.get(id);
      if (!rec) { clearPending(table, id); continue; } // gone locally → drop from queue
      await upsert(table, rec);                         // clears on success, re-queues on failure
    }
  }
}

// Chunked bulk upsert for large imports (thousands of rows in ~dozens of
// requests). Same column filtering as upsert(); returns the failed-row count.
async function bulkUpsert(table, records, onProgress, chunkSize = 200) {
  if (!supabase || !records?.length) return { failed: 0 };
  const excludeSet = new Set(EXCLUDE_COLUMNS[table] || []);
  const rows = records.map(r =>
    Object.fromEntries(Object.entries(toDb(r)).filter(([k]) => !excludeSet.has(k)))
  );
  let failed = 0;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: 'id' });
    if (error) {
      console.error(`[db] bulkUpsert ${table} chunk ${i / chunkSize}:`, error.message);
      // Fall back to per-row upsert so one bad row doesn't sink 200 good ones
      // (per-row also self-heals unknown columns).
      for (const rec of records.slice(i, i + chunkSize)) {
        try { await upsert(table, rec); } catch { failed++; }
      }
    }
    onProgress?.(Math.min(i + chunkSize, rows.length), rows.length);
  }
  return { failed };
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

  // Takeoffs (PDF plan markups — metadata only; the PDF lives in Storage)
  saveTakeoff:        (r) => upsert('takeoffs', r),
  deleteTakeoff:      (id) => softDelete('takeoffs', id),

  // Measure-sheet custom dropdown options
  // Curtain calculator rate card (single 'default' row)
  saveCurtainRates:         (r) => upsert('curtain_rates', r),

  saveMeasureSheetOption:   (r) => upsert('measure_sheet_options', r),
  deleteMeasureSheetOption: (id) => remove('measure_sheet_options', id),

  // Scheduling-reminder dismissals (kept out of the jobs table so dismissing
  // can never churn or truncate the jobs list)
  saveSchedulingDismissal:   (r) => upsert('scheduling_dismissals', r),
  removeSchedulingDismissal: (id) => remove('scheduling_dismissals', id),

  // Quotes
  saveQuote:          (r) => upsert('quotes', r),
  deleteQuote:        (id) => remove('quotes', id),

  // Shared business/quote settings (see getBusinessSettings below)
  getBusinessSettings:  ()  => getBusinessSettings(),
  saveBusinessSettings: (s) => saveBusinessSettings(s),

  // Review requests (Google review asks)
  saveReviewRequest:  (r) => upsert('review_requests', r),

  // Bulk imports (Quotient history) — chunked so thousands of records sync
  // in a handful of requests instead of one request per row.
  bulkSaveCustomers:  (rows, onProgress) => bulkUpsert('customers', rows, onProgress),
  bulkSaveQuotes:     (rows, onProgress) => bulkUpsert('quotes', rows, onProgress),
  bulkSaveJobs:       (rows, onProgress) => bulkUpsert('jobs', rows, onProgress),

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

  // Suppliers (saved supplier list for purchase orders)
  saveSupplier:          (r)  => upsert('suppliers', r),
  deleteSupplier:        (id) => softDelete('suppliers', id),
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
    // Roll width, for fabric sold by the metre. The curtain calculator uses it
    // to decide Continuous vs Regular cutting, so losing it here would quietly
    // send every imported fabric back to the rate card's generic width.
    fabric_width_mm: item.fabricWidthMm ?? null,
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

// ─── Business / quote settings ────────────────────────────────────────────────
// One shared row (id = 1) holding the business and payment details shown on the
// public customer quote page. It exists because those settings otherwise live
// only in each staff member's localStorage, which a customer's browser doesn't
// have — so the quote page showed placeholder BSB/ABN details on a cold load.

/** Read the shared settings. Returns null when offline or not yet configured. */
export async function getBusinessSettings() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('business_settings').select('settings').eq('id', 1).maybeSingle();
  if (error) {
    console.warn('[db] getBusinessSettings:', error.message);
    return null;
  }
  return data?.settings ?? null;
}

/** Mirror the local settings to the shared row. Fire-and-forget. */
export async function saveBusinessSettings(settings) {
  if (!supabase || !settings) return;
  const { error } = await supabase
    .from('business_settings')
    .upsert({ id: 1, settings, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  if (error) console.warn('[db] saveBusinessSettings:', error.message);
}
