// ─── Scope vocabulary ─────────────────────────────────────────────────────────
// Keyed by where a setting is PERSISTED, verified against store/data.js and the
// TABLES list in store/db.js — not by where it is displayed. `device` means it
// genuinely does not leave this browser.
//
// Lives in its own module so SettingsCard.jsx only exports components (fast
// refresh stops working on a file that mixes the two).
export const SCOPES = {
  device:    { label: 'This device',          tone: 'slate', title: 'Saved in this browser only — other devices and staff keep their own.' },
  account:   { label: 'Your account',         tone: 'slate', title: 'Saved to your user account — applies on every device you sign in on.' },
  team:      { label: 'Everyone on the team', tone: 'blue',  title: 'Synced to the cloud — everyone on the team sees this.' },
  customers: { label: 'Shown to customers',   tone: 'amber', title: 'Part of the quote a customer reads on their own device.' },
  server:    { label: 'Everyone (automatic)', tone: 'blue',  title: 'Stored server-side and acted on automatically, for the whole business.' },
};

export const SCOPE_TONES = {
  slate: 'bg-slate-100 text-slate-600 border-slate-200',
  blue:  'bg-blue-50 text-blue-700 border-blue-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
};
