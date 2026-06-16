/**
 * Xero API helpers — all calls go through Supabase Edge Functions.
 * The frontend never touches Xero tokens or client secrets.
 */
import { supabase } from './supabase';

const FN = (name) => `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;

async function authHeaders() {
  if (!supabase) throw new Error('Supabase not configured');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

// ── Connection ────────────────────────────────────────────────────────────────

/** Returns { connected, integration, recentErrors } */
export async function xeroGetConnection() {
  const headers = await authHeaders();
  const res = await fetch(FN('xero-connection'), { headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** Returns the Xero authorization URL to redirect the user to */
export async function xeroStartOAuth() {
  const headers = await authHeaders();
  const res = await fetch(FN('xero-oauth-start'), { method: 'POST', headers });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'OAuth start failed');
  return data.url; // redirect user to this URL
}

/** Updates Xero integration settings */
export async function xeroSaveSettings(settings) {
  const headers = await authHeaders();
  const res = await fetch(FN('xero-connection'), {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ settings }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Save failed');
  return data.settings;
}

/** Disconnects Xero */
export async function xeroDisconnect() {
  const headers = await authHeaders();
  const res = await fetch(FN('xero-connection'), { method: 'DELETE', headers });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Disconnect failed');
  return data;
}

// ── Contacts ──────────────────────────────────────────────────────────────────

/** Search Xero contacts. Returns [{ xeroContactId, name, email, phone }] */
export async function xeroSearchContacts(query) {
  const headers = await authHeaders();
  const res = await fetch(`${FN('xero-search-contacts')}?q=${encodeURIComponent(query)}`, { headers });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Contact search failed');
  return data.contacts ?? [];
}

// ── Items ─────────────────────────────────────────────────────────────────────

/** Search Xero inventory items. Returns [{ xeroItemId, code, name, description, unitPrice, accountCode, taxType }] */
export async function xeroSearchItems(query) {
  const headers = await authHeaders();
  const res = await fetch(`${FN('xero-search-items')}?q=${encodeURIComponent(query)}`, { headers });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Item search failed');
  return data.items ?? [];
}

// ── Invoices ──────────────────────────────────────────────────────────────────

/** Create a Xero invoice from an accepted Lusso quote */
export async function xeroCreateInvoice(quoteId) {
  const headers = await authHeaders();
  const res = await fetch(FN('xero-create-invoice'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ quoteId }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Invoice creation failed');
  return data; // { xeroInvoiceId, xeroInvoiceNumber, xeroInvoiceStatus, xeroInvoiceUrl }
}

/** Sync invoice status from Xero back to Lusso */
export async function xeroSyncInvoice(quoteId) {
  const headers = await authHeaders();
  const res = await fetch(FN('xero-sync-invoice'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ quoteId }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || 'Sync failed');
  return data;
}

// ── Status label helpers ──────────────────────────────────────────────────────

export const XERO_INVOICE_STATUS_LABELS = {
  DRAFT:     { label: 'Draft',            color: 'bg-slate-100 text-slate-600' },
  SUBMITTED: { label: 'Awaiting Approval', color: 'bg-blue-100 text-blue-700' },
  AUTHORISED:{ label: 'Awaiting Payment', color: 'bg-amber-100 text-amber-700' },
  PAID:      { label: 'Paid',             color: 'bg-green-100 text-green-700' },
  VOIDED:    { label: 'Voided',           color: 'bg-red-100 text-red-600' },
  DELETED:   { label: 'Deleted',          color: 'bg-red-100 text-red-600' },
};

export function xeroInvoiceStatusBadge(status) {
  return XERO_INVOICE_STATUS_LABELS[status] ?? { label: status ?? '—', color: 'bg-slate-100 text-slate-500' };
}
