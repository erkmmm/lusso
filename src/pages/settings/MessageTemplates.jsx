// ─── Message templates ────────────────────────────────────────────────────────
// The three places a standard message is kept: the quote email / SMS presets,
// the per-supplier purchase-order bodies, and the website lead auto-reply.
// They used to be three cards under "Messages"; they are the same three cards,
// now with honest scope badges — and those badges are not decoration here:
//
//   · Message presets  → `message_presets`, one row per preset key.
//   · PO presets       → `po_message_presets`, one row per supplier address.
//   · Auto-reply       → internal_notify_config, server-side, business-wide.
//
// The first of those used to be localStorage-only while the second, sitting
// directly beneath it on this same card stack, synced — so they looked
// identical and reached completely different distances. Adding the scope badge
// is what made that visible; `message_presets` is what fixed it.
import { useState, useEffect } from 'react';
import { useDataRefresh } from '../../hooks/useDataRefresh';
import {
  MessageSquare, Zap, Save, X, Edit3, RefreshCw, Trash2, Loader,
  ToggleLeft, ToggleRight, AlertTriangle, Mail,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useProfile } from '../../contexts/UserProfileContext';
import {
  getMessagePresets, saveMessagePresets, resetMessagePreset,
  getPoPresets, savePoPreset, deletePoPreset,
} from '../../store/data';
import { toast } from '../../components/ToastContainer';
import SettingsCard from './SettingsCard';

const PRESET_FIELDS = [
  {
    key: 'quoteEmailIntro',
    label: 'Quote Email Introduction',
    description: 'Shown in the body of the email sent to customers with their quote.',
    rows: 5,
    group: 'Quote',
  },
  {
    key: 'quoteIntroMessage',
    label: 'Quote Introduction Message',
    description: 'Shown at the top of the quote document that the customer views online.',
    rows: 4,
    group: 'Quote',
  },
  {
    key: 'quoteTerms',
    label: 'Quote Terms & Conditions',
    description: 'Appended to the bottom of every quote. Use bullet points with •',
    rows: 6,
    group: 'Quote',
  },
  {
    key: 'smsFollowUp',
    label: 'SMS: Follow-up',
    description: 'Use {name} as a placeholder for the customer\'s first name.',
    rows: 3,
    group: 'SMS',
  },
  {
    key: 'smsQuoteReady',
    label: 'SMS: Quote Ready',
    description: 'Use {name} and {link} as placeholders.',
    rows: 3,
    group: 'SMS',
  },
  {
    key: 'smsOrderConfirmed',
    label: 'SMS: Order Confirmed',
    description: 'Use {name} as a placeholder.',
    rows: 3,
    group: 'SMS',
  },
  {
    key: 'smsAppointmentReminder',
    label: 'SMS: Appointment Reminder',
    description: 'Use {name}, {date}, {time} as placeholders.',
    rows: 3,
    group: 'SMS',
  },
  {
    key: 'smsInstallationBooked',
    label: 'SMS: Installation Booked',
    description: 'Use {name}, {date}, {time} as placeholders.',
    rows: 3,
    group: 'SMS',
  },
];

/**
 * Website lead auto-reply — the switch, plus proof that it is working.
 *
 * The flag lives in internal_notify_config, which no client may read: that
 * table also holds the shared notify token and the VAPID private key, so it
 * has RLS on with no policies at all. Both halves therefore go through
 * security-definer RPCs (see web_autoreply_settings_rpc.sql) rather than a
 * table write.
 *
 * The counts are not decoration. A bare on/off switch cannot be verified by
 * looking at it, and the failure mode here is silent — the trigger is
 * fire-and-forget, so a broken send looks exactly like a quiet week. "Last
 * sent 20 minutes ago" is the only thing on this screen that proves otherwise.
 */
function WebAutoReplySection() {
  const { isAM } = useProfile() ?? {};
  const [cfg, setCfg]       = useState(null);   // null while loading
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const load = async () => {
    const { data, error: e } = await supabase.rpc('web_autoreply_settings');
    if (e) { setError(e.message); return; }
    setError('');
    setCfg(data);
  };

  useEffect(() => { load(); }, []);

  const canEdit = isAM && (cfg?.can_edit ?? false);

  const toggle = async () => {
    if (!cfg || saving || !canEdit) return;
    const next = !cfg.enabled;

    // Optimistic: the switch should feel instant. Reverted below if the RPC
    // refuses, which it will for anyone who is not an account manager.
    setSaving(true);
    setCfg(c => ({ ...c, enabled: next }));

    const { data, error: e } = await supabase.rpc('web_autoreply_set_enabled', { p_enabled: next });
    setSaving(false);

    if (e) {
      setCfg(c => ({ ...c, enabled: !next }));
      toast(e.message || 'Could not change that setting.');
      return;
    }
    setCfg(data);
    toast(next
      ? 'Auto-reply is on. New website leads get an email straight away.'
      : 'Auto-reply is off. Website leads will hear nothing until someone calls.');
  };

  const when = (iso) => {
    if (!iso) return 'never';
    const d = new Date(iso);
    const mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1)    return 'just now';
    if (mins < 60)   return `${mins} min ago`;
    if (mins < 1440) return `${Math.round(mins / 60)} hr ago`;
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  };

  return (
    <SettingsCard
      id="website-auto-reply"
      icon={Zap}
      title="Website lead auto-reply"
      description="An instant acknowledgement email to anyone who sends an enquiry through lusso.com.au."
      scope="server"
      save={{ kind: 'instant' }}
      bodyClass=""
    >
      <div className="p-5 space-y-4">
        {error ? (
          <div className="flex items-start gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
            <span>Could not read the setting: {error}</span>
          </div>
        ) : cfg === null ? (
          <p className="text-xs text-slate-400 flex items-center gap-2">
            <Loader size={12} className="animate-spin" /> Loading…
          </p>
        ) : (<>
          <label className={`flex items-center justify-between gap-3 ${canEdit ? 'cursor-pointer' : ''}`}>
            <div>
              <p className="text-sm font-medium text-slate-700">Send an auto-reply to new website leads</p>
              <p className="text-xs text-slate-400">
                {cfg.enabled
                  ? 'On — sent within seconds of the form being submitted, before anyone has to look at it.'
                  : 'Off — leads hear nothing from us until a consultant calls them.'}
              </p>
            </div>
            <button
              type="button"
              onClick={toggle}
              disabled={!canEdit || saving}
              title={canEdit ? '' : 'Only an account manager can change this'}
              className={`flex-shrink-0 p-2 -m-2 disabled:opacity-40 disabled:cursor-not-allowed ${cfg.enabled ? 'text-green-500' : 'text-slate-300'}`}
            >
              {cfg.enabled ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
            </button>
          </label>

          <div className="grid grid-cols-3 gap-2 pt-1">
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Sent, 30 days</p>
              <p className="text-sm font-semibold text-slate-700 mt-0.5">{cfg.sent_30d ?? 0}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Last sent</p>
              <p className="text-sm font-semibold text-slate-700 mt-0.5">{when(cfg.last_sent_at)}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-400">Never replied</p>
              <p className="text-sm font-semibold text-slate-700 mt-0.5">{cfg.missed ?? 0}</p>
            </div>
          </div>

          {/* Turning it on does not reach backwards, and somebody will expect
              it to — the "never replied" number sits right there. */}
          {cfg.enabled && (cfg.missed ?? 0) > 0 && (
            <p className="text-xs text-slate-400">
              The {cfg.missed} older {cfg.missed === 1 ? 'lead' : 'leads'} that never got one will not be emailed
              now — this only applies to enquiries that arrive from here on.
            </p>
          )}

          {!isAM && (
            <p className="text-xs text-slate-400">Only an account manager can change this setting.</p>
          )}

          <div className="text-xs text-slate-400 border-t border-slate-100 pt-3 space-y-1">
            <p className="font-medium text-slate-500">What it says</p>
            <p>
              Thanks them by name for the product they asked about, tells them a consultant will call
              — today, tomorrow morning or Monday, worked out from the actual time of day — explains the
              free in-home consultation, and asks them to reply with their window count, whether it is new
              or a replacement, and their timeframe. Their reply threads back onto the lead in the Inbox.
            </p>
            <p>
              Newsletter signups never receive it, and nobody is emailed twice for the same enquiry.
            </p>
          </div>
        </>)}
      </div>
    </SettingsCard>
  );
}

function MessagePresetsSection() {
  const [presets, setPresets]   = useState(getMessagePresets);
  const [editingKey, setEditing] = useState(null);
  // Now that these sync, a colleague's edit can land while this card is open.
  // The presets live in useState, so a bare re-render would keep showing the
  // copy read at mount — hydration has to re-read. Not while someone is partway
  // through editing a preset, though: pulling the textarea out from under them
  // would discard what they have typed.
  const [draft, setDraft]        = useState('');
  const [activeGroup, setGroup]  = useState('Quote');
  const [savedAt, setSavedAt]    = useState(null);

  const startEdit = (key) => { setEditing(key); setDraft(presets[key] ?? ''); };
  const cancelEdit = () => setEditing(null);
  // One key, not the whole object. `presets` is the merged view — defaults
  // included — so passing it wholesale wrote a row for every preset on the
  // first edit, materialising all nine built-in defaults into the shared table
  // and freezing today's wording there permanently.
  const saveEdit = (key) => {
    setPresets(saveMessagePresets({ [key]: draft }));
    setEditing(null);
    setSavedAt(Date.now());
    toast('Preset saved.');
  };
  // Reset DELETES the override rather than storing the default's current text,
  // so a future correction to a shipped default still reaches this install.
  const resetField = (key) => {
    setPresets(resetMessagePreset(key));
    setSavedAt(Date.now());
    toast('Reset to default.');
  };

  useDataRefresh(() => { if (editingKey === null) setPresets(getMessagePresets()); });

  const groups = [...new Set(PRESET_FIELDS.map(f => f.group))];
  const fields = PRESET_FIELDS.filter(f => f.group === activeGroup);

  return (
    <SettingsCard
      id="message-presets"
      icon={MessageSquare}
      title="Quote email & SMS presets"
      description="Default messages used across quotes, emails and SMS. Edited here for everyone — each preset is saved on its own, so two people can change different messages at the same time."
      scope="team"
      save={{ kind: 'manual', dirty: editingKey !== null, savedAt }}
      bodyClass=""
    >
      {/* Group tabs */}
      <div className="flex gap-1 px-5 pt-4">
        {groups.map(g => (
          <button key={g} onClick={() => setGroup(g)}
            className={`text-xs font-medium px-3 min-h-[36px] rounded-full border transition-colors ${
              activeGroup === g ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}>
            {g}
          </button>
        ))}
      </div>

      <div className="p-5 space-y-5">
        {fields.map(({ key, label, description, rows }) => (
          <div key={key}>
            <div className="flex items-start justify-between gap-3 mb-1.5">
              <div>
                <p className="text-sm font-medium text-slate-700">{label}</p>
                <p className="text-xs text-slate-400">{description}</p>
              </div>
              {editingKey !== key && (
                <div className="flex gap-1.5 flex-shrink-0">
                  <button onClick={() => startEdit(key)}
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-amber-600 border border-slate-200 hover:border-amber-300 px-2 min-h-[36px] rounded-lg transition-colors relative before:absolute before:content-[''] before:-inset-x-1 before:-inset-y-1">
                    <Edit3 size={11} /> Edit
                  </button>
                  <button onClick={() => resetField(key)}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 border border-slate-200 px-2 min-h-[36px] rounded-lg transition-colors relative before:absolute before:content-[''] before:-inset-x-1 before:-inset-y-1"
                    title="Reset to default">
                    <RefreshCw size={11} />
                  </button>
                </div>
              )}
            </div>

            {editingKey === key ? (
              <div className="space-y-2">
                <textarea
                  value={draft}
                  onChange={e => setDraft(e.target.value)}
                  rows={rows}
                  className="w-full px-3 py-2.5 text-sm rounded-lg border border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-y font-mono leading-relaxed"
                />
                <div className="flex gap-2">
                  <button onClick={() => saveEdit(key)}
                    className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white text-xs font-medium px-3 py-1.5 rounded-lg transition-colors">
                    <Save size={12} /> Save
                  </button>
                  <button onClick={cancelEdit}
                    className="flex items-center gap-1.5 text-xs text-slate-500 border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition-colors">
                    <X size={12} /> Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                onClick={() => startEdit(key)}
                className="text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2.5 whitespace-pre-wrap leading-relaxed cursor-text hover:bg-amber-50/50 transition-colors border border-transparent hover:border-amber-200 min-h-[48px]"
              >
                {presets[key] || <span className="text-slate-400 italic">No message set</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </SettingsCard>
  );
}

// ─── Purchase Order email presets (email → pre-written message) ───────────────
const PO_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function PoMessagePresetsSection() {
  const [presets, setPresets] = useState(getPoPresets);
  const [email, setEmail]     = useState('');
  const [message, setMessage] = useState('');
  const [editId, setEditId]   = useState(null);
  const [savedAt, setSavedAt] = useState(null);

  const refresh = () => setPresets(getPoPresets());
  const reset   = () => { setEmail(''); setMessage(''); setEditId(null); };

  const save = () => {
    const e = email.trim();
    if (!PO_EMAIL_RE.test(e)) { toast('Enter a valid email address.', 'error'); return; }
    savePoPreset({ id: editId, email: e, message });
    refresh(); reset();
    setSavedAt(Date.now());
    toast('Preset saved.');
  };
  const edit = (p) => { setEditId(p.id); setEmail(p.email); setMessage(p.message || ''); };
  const del  = (p) => { deletePoPreset(p.id); if (editId === p.id) reset(); refresh(); toast('Preset deleted.', 'info'); };

  return (
    <SettingsCard
      id="po-email-presets"
      icon={Mail}
      title="Purchase order email presets"
      description="Save a pre-written message per supplier email. It auto-fills the body when you send a PO to that address."
      scope="team"
      save={{ kind: 'manual', dirty: Boolean(email.trim() || message.trim()), savedAt }}
      bodyClass=""
    >
      <div className="p-5 space-y-4">
        {presets.length > 0 && (
          <div className="space-y-2">
            {presets.map(p => (
              <div key={p.id} className={`flex items-start gap-2 border rounded-lg px-3 py-2 ${editId === p.id ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{p.email}</p>
                  <p className="text-xs text-slate-400 whitespace-pre-wrap line-clamp-2">{p.message || '—'}</p>
                </div>
                <button onClick={() => edit(p)} className="text-xs text-slate-500 hover:text-amber-600 flex-shrink-0 relative before:absolute before:content-[''] before:-inset-[14px]">Edit</button>
                <button onClick={() => del(p)} className="text-slate-400 hover:text-red-500 flex-shrink-0 relative before:absolute before:content-[''] before:-inset-[14px]" title="Delete preset"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2 border-t border-slate-100 pt-4">
          <p className="text-xs font-medium text-slate-500">{editId ? 'Edit preset' : 'Add a preset'}</p>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="supplier@email.com"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          <textarea rows={3} value={message} onChange={e => setMessage(e.target.value)} placeholder="Pre-written message for this supplier…"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-y" />
          <div className="flex gap-2">
            <button onClick={save}
              className="flex items-center gap-1.5 text-sm font-semibold px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white">
              <Save size={13} /> {editId ? 'Save changes' : 'Add preset'}
            </button>
            {editId && (
              <button onClick={reset}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">
                <X size={13} /> Cancel
              </button>
            )}
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}

export default function MessageTemplates() {
  return (<>
    <MessagePresetsSection />
    <PoMessagePresetsSection />
    <WebAutoReplySection />
  </>);
}
