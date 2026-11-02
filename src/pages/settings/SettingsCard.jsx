// ─── Shared settings card ─────────────────────────────────────────────────────
// One header treatment for every settings card: icon, title, description, a
// scope badge, and a save-state line.
//
// The scope badge is the reason this exists. Settings on this page land in
// three different places — this browser's localStorage, the team's synced
// tables, and the public `business_settings` row a customer reads on their own
// phone — and nothing on screen used to say which. That mattered most on the
// customer-facing row, where a stale tab once replayed placeholder business
// details to every quote for two months while the CRM looked correct to staff.
// Telling people what a card actually reaches is the cheap half of the fix.
import { Check, Loader, AlertTriangle } from 'lucide-react';
import Card from '../../components/Card';
import { SCOPES, SCOPE_TONES } from './scopes';

export function ScopeBadge({ scope }) {
  const s = SCOPES[scope];
  if (!s) return null;
  return (
    <span title={s.title}
      className={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${SCOPE_TONES[s.tone]}`}>
      {s.label}
    </span>
  );
}

// ── Save state ───────────────────────────────────────────────────────────────
// Cards save in three different ways and always did; the fix is to say which,
// in the same words every time, instead of the one-off sentences that used to
// be scattered through the page.
//
// `save` is one of:
//   { kind: 'auto' }                              → "Saves as you type"
//   { kind: 'manual', dirty, saving, savedAt }    → dirty / saving / saved
//   { kind: 'instant', savedAt }                  → applies immediately
function relTime(ts) {
  if (!ts) return null;
  const secs = Math.round((Date.now() - ts) / 1000);
  if (secs < 5)    return 'just now';
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
}

export function SaveState({ save }) {
  if (!save) return null;
  const { kind, dirty, saving, savedAt, error } = save;

  if (error) return (
    <p className="text-[11px] text-red-600 flex items-center gap-1">
      <AlertTriangle size={11} /> {error}
    </p>
  );
  if (saving) return (
    <p className="text-[11px] text-slate-400 flex items-center gap-1">
      <Loader size={11} className="animate-spin" /> Saving…
    </p>
  );
  if (dirty) return (
    <p className="text-[11px] text-amber-600 flex items-center gap-1">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> Unsaved changes
    </p>
  );
  if (savedAt) return (
    <p className="text-[11px] text-green-600 flex items-center gap-1">
      <Check size={11} /> Saved {relTime(savedAt)}
    </p>
  );
  if (kind === 'auto') return (
    <p className="text-[11px] text-slate-400">Saves as you type</p>
  );
  if (kind === 'instant') return (
    <p className="text-[11px] text-slate-400">Applies immediately</p>
  );
  return null;
}

/**
 * A settings card with a consistent header.
 *
 * `id` lands on the wrapper so settings search can scroll to a card and flash
 * it; `data-settings-card` is what the search indexer and the flash look for.
 */
export default function SettingsCard({
  id, icon: Icon, title, description, scope, save, actions,
  iconClass = 'text-amber-500', children, bodyClass = 'p-5', className = '',
}) {
  return (
    <Card id={id} data-settings-card={id || ''} className={`scroll-mt-24 ${className}`}>
      <div className="px-5 py-4 border-b border-slate-100">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2 flex-wrap">
              {Icon && <Icon size={15} className={iconClass} />}
              <span>{title}</span>
              <ScopeBadge scope={scope} />
            </h2>
            {description && <p className="text-xs text-slate-400 mt-1">{description}</p>}
          </div>
          {actions && <div className="flex-shrink-0 flex items-center gap-2">{actions}</div>}
        </div>
        {save && <div className="mt-2"><SaveState save={save} /></div>}
      </div>
      {children != null && <div className={bodyClass}>{children}</div>}
    </Card>
  );
}
