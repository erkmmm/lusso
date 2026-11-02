// ─── Integrations & exports ───────────────────────────────────────────────────
// How Lusso talks to another system: Xero for invoicing, and the BUZ export
// mapping that turns a measure sheet into an order BUZ will accept.
//
// Xero needs cloud mode AND an account manager, so the section can be legitimately
// empty — Settings.jsx says why rather than rendering a blank panel.
import { useState, useEffect } from 'react';
import {
  Link2, Link2Off, Loader, Save, Edit3, X, Check, Plus, Trash2,
  CheckCircle2, AlertTriangle, Building2, ToggleLeft, ToggleRight, FileDown,
} from 'lucide-react';
import { useDataRefresh } from '../../hooks/useDataRefresh';
import {
  xeroGetConnection, xeroStartOAuth, xeroDisconnect,
  xeroSaveSettings, xeroDismissErrors,
  xeroActivateOrganisation, xeroGetBrandingThemes,
} from '../../lib/xero';
import {
  getBuzFabricCodes, saveBuzFabricCode, deleteBuzFabricCode,
  getBuzValueMap, setBuzValueMapEntry,
} from '../../store/data';
import { BUZ_MAP_FIELDS } from '../../lib/buzExport';
import { buzCatalogueMeta } from '../../lib/buzFabricResolver';
import { toast } from '../../components/ToastContainer';
import Card from '../../components/Card';
import SettingsCard, { ScopeBadge } from './SettingsCard';

// ─── Xero Integration Section ─────────────────────────────────────────────────
const DEFAULT_XERO_SETTINGS = {
  autoCreateInvoice:       false,
  brandingThemeId:         '',
  defaultInvoiceStatus:    'DRAFT',
  defaultAccountCode:      '200',
  defaultTaxType:          'OUTPUT',
  defaultPaymentTermsDays: 30,
};

function XeroSection() {
  const [status, setStatus]     = useState(null);   // null=loading, false=error, object=data
  const [settings, setSettings] = useState(DEFAULT_XERO_SETTINGS);
  const [working, setWorking]   = useState(false);
  const [editingSettings, setEditingSettings] = useState(false);
  const [localSettings, setLocalSettings]     = useState(DEFAULT_XERO_SETTINGS);
  const [errors, setErrors]     = useState([]);
  const [dismissing, setDismissing] = useState(false);
  const [organisations, setOrganisations] = useState([]);
  const [switchingOrg, setSwitchingOrg]   = useState(false);
  const [themes, setThemes]               = useState(null); // null = not loaded yet
  const [themesError, setThemesError]     = useState(null);

  const load = async () => {
    try {
      const data = await xeroGetConnection();
      setStatus(data);
      if (data.integration?.settings) {
        const merged = { ...DEFAULT_XERO_SETTINGS, ...data.integration.settings };
        setSettings(merged);
        setLocalSettings(merged);
      }
      setErrors(data.recentErrors ?? []);
      setOrganisations(data.organisations ?? []);
    } catch {
      setStatus({ connected: false });
    }
  };

  useEffect(() => { load(); }, []);

  const handleConnect = async () => {
    setWorking(true);
    try {
      const url = await xeroStartOAuth();
      window.location.href = url;  // full redirect to Xero auth
    } catch (err) {
      toast(err.message, 'error');
      setWorking(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Xero? Existing invoice links will be preserved but no new invoices can be created until you reconnect.')) return;
    setWorking(true);
    try {
      await xeroDisconnect();
      toast('Xero disconnected.');
      setStatus({ connected: false });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setWorking(false);
    }
  };

  const handleSaveSettings = async () => {
    setWorking(true);
    try {
      const saved = await xeroSaveSettings(localSettings);
      setSettings({ ...DEFAULT_XERO_SETTINGS, ...saved });
      setEditingSettings(false);
      toast('Xero settings saved.');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setWorking(false);
    }
  };

  // Switching organisation is a local flip — one Xero consent already covers
  // every org on the account, so no re-authorisation is needed.
  const handleSwitchOrg = async (tenantId) => {
    if (switchingOrg || !tenantId) return;
    setSwitchingOrg(true);
    try {
      const { organisationName } = await xeroActivateOrganisation(tenantId);
      await load();
      toast(`Now using ${organisationName}.`);
    } catch (err) {
      toast(err.message || 'Could not switch organisation.', 'error');
    } finally {
      setSwitchingOrg(false);
    }
  };

  // Dismissing marks the log rows in Supabase, so cleared errors stay cleared
  // across reloads. The list updates optimistically and rolls back on failure.
  const handleDismissErrors = async (target) => {
    if (dismissing) return;
    const previous = errors;
    setDismissing(true);
    setErrors(target === 'all' ? [] : errors.filter(e => !target.includes(e.id)));
    try {
      await xeroDismissErrors(target);
    } catch (err) {
      setErrors(previous);
      toast(err.message || 'Could not dismiss the error.', 'error');
    } finally {
      setDismissing(false);
    }
  };

  // Loaded only when the editor is opened — it costs a live Xero API call, so
  // there's no reason to spend one every time Settings renders.
  const loadThemes = async () => {
    if (themes !== null) return;
    try {
      setThemes(await xeroGetBrandingThemes());
      setThemesError(null);
    } catch (err) {
      setThemes([]);
      setThemesError(err.message || 'Could not load invoice templates.');
    }
  };

  const fmtDate = (d) => { try { return new Date(d).toLocaleString('en-AU'); } catch { return '—'; } };

  return (
    <Card id="xero-integration" data-settings-card="xero-integration" className="scroll-mt-24">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Xero logo-ish mark */}
          <div className="w-8 h-8 rounded-lg bg-[#13B5EA]/10 flex items-center justify-center flex-shrink-0">
            <span className="text-[#13B5EA] font-black text-sm">X</span>
          </div>
          <div>
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2 flex-wrap">
              <span>Xero Integration</span>
              <ScopeBadge scope="team" />
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">Connect your Xero account to create invoices from accepted quotes.</p>
          </div>
        </div>
        {status?.connected && (
          <span className="flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
            <CheckCircle2 size={11} /> Connected
          </span>
        )}
        {status && !status.connected && (
          <span className="flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
            <Link2Off size={11} /> Not connected
          </span>
        )}
      </div>

      {/* Loading */}
      {status === null && (
        <div className="px-5 py-6 flex items-center gap-2 text-slate-400 text-sm">
          <Loader size={14} className="animate-spin" /> Checking connection…
        </div>
      )}

      {/* Connected state */}
      {status?.connected && (
        <div className="divide-y divide-slate-50">
          {/* Org summary */}
          <div className="px-5 py-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#13B5EA]/10 flex items-center justify-center flex-shrink-0">
              <Building2 size={18} className="text-[#13B5EA]" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-800 text-sm">{status.integration?.organisationName ?? 'Xero Organisation'}</p>
              <p className="text-xs text-slate-400">
                Connected {fmtDate(status.integration?.connectedAt)}
                {status.integration?.lastSyncedAt && ` · Last sync ${fmtDate(status.integration.lastSyncedAt)}`}
              </p>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={working}
              className="flex items-center gap-1.5 text-xs font-medium text-red-500 hover:text-red-700 border border-red-200 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Link2Off size={12} /> Disconnect
            </button>
          </div>

          {/* Organisation picker — one Xero consent covers every org on the
              account, so switching (e.g. to the Demo Company for testing) is a
              dropdown rather than a fresh OAuth round-trip. */}
          {organisations.length > 1 && (
            <div className="px-5 py-4">
              <label htmlFor="xero-org" className="block text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2">
                Active organisation
              </label>
              <div className="flex items-center gap-2">
                <select
                  id="xero-org"
                  value={status.integration?.tenantId ?? ''}
                  onChange={e => handleSwitchOrg(e.target.value)}
                  disabled={switchingOrg}
                  className="flex-1 border border-slate-200 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
                >
                  {organisations.map(o => (
                    <option key={o.tenantId} value={o.tenantId}>{o.name}</option>
                  ))}
                </select>
                {switchingOrg && <Loader size={14} className="animate-spin text-slate-400 flex-shrink-0" />}
              </div>
              <p className="text-xs text-slate-400 mt-2">
                Invoices are created in this organisation. Pick your Xero Demo Company to test
                without touching your real accounts.
              </p>
            </div>
          )}

          {/* Settings */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Invoice Settings</p>
              <button
                onClick={() => { const opening = !editingSettings; setEditingSettings(opening); setLocalSettings(settings); if (opening) loadThemes(); }}
                className="text-xs text-amber-600 hover:underline flex items-center gap-1"
              >
                {editingSettings ? <><X size={11} /> Cancel</> : <><Edit3 size={11} /> Edit</>}
              </button>
            </div>

            {editingSettings ? (
              <div className="space-y-3">
                {/* Auto-create toggle */}
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <div>
                    <p className="text-sm font-medium text-slate-700">Auto-create invoice on acceptance</p>
                    <p className="text-xs text-slate-400">Automatically create a Xero invoice when a customer accepts their quote.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setLocalSettings(s => ({ ...s, autoCreateInvoice: !s.autoCreateInvoice }))}
                    className={`flex-shrink-0 p-2 -m-2 ${localSettings.autoCreateInvoice ? 'text-green-500' : 'text-slate-300'}`}
                  >
                    {localSettings.autoCreateInvoice ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
                  </button>
                </label>

                <div>
                  <label htmlFor="xero-theme" className="block text-xs font-medium text-slate-500 mb-1">Invoice template</label>
                  <select
                    id="xero-theme"
                    value={localSettings.brandingThemeId || ''}
                    onChange={e => setLocalSettings(s => ({ ...s, brandingThemeId: e.target.value }))}
                    disabled={themes === null}
                    className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white disabled:opacity-60"
                  >
                    <option value="">{themes === null ? 'Loading templates…' : "Xero's default template"}</option>
                    {(themes ?? []).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">
                    Sets the PDF layout — including whether an amount appears at the top and where the
                    due date sits. Edit the templates themselves in Xero under Settings &rarr; Invoice settings.
                  </p>
                  {themesError && <p className="text-xs text-red-500 mt-1">{themesError}</p>}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Default Invoice Status</label>
                    <select
                      value={localSettings.defaultInvoiceStatus}
                      onChange={e => setLocalSettings(s => ({ ...s, defaultInvoiceStatus: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                    >
                      <option value="DRAFT">Draft</option>
                      <option value="SUBMITTED">Submitted (Awaiting Approval)</option>
                      <option value="AUTHORISED">Authorised (Awaiting Payment)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Default Account Code</label>
                    <input
                      value={localSettings.defaultAccountCode}
                      onChange={e => setLocalSettings(s => ({ ...s, defaultAccountCode: e.target.value }))}
                      placeholder="e.g. 200"
                      className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Default Tax Type</label>
                    <select
                      value={localSettings.defaultTaxType}
                      onChange={e => setLocalSettings(s => ({ ...s, defaultTaxType: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                    >
                      <option value="OUTPUT">OUTPUT (GST on Sales)</option>
                      <option value="NONE">NONE (GST Free)</option>
                      <option value="EXEMPTOUTPUT">EXEMPTOUTPUT (GST Exempt)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Payment Terms (days)</label>
                    <input
                      type="number"
                      min={0}
                      value={localSettings.defaultPaymentTermsDays}
                      onChange={e => setLocalSettings(s => ({ ...s, defaultPaymentTermsDays: Number(e.target.value) }))}
                      className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                </div>

                <button
                  onClick={handleSaveSettings}
                  disabled={working}
                  className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  <Save size={13} /> Save Settings
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <SettingRow label="Auto-create invoice" value={settings.autoCreateInvoice ? 'Enabled' : 'Disabled'} />
                <SettingRow label="Default status"      value={settings.defaultInvoiceStatus} />
                <SettingRow label="Account code"        value={settings.defaultAccountCode} />
                <SettingRow label="Tax type"            value={settings.defaultTaxType} />
                <SettingRow label="Payment terms"       value={`${settings.defaultPaymentTermsDays} days`} />
                <SettingRow label="Invoice template"    value={
                  settings.brandingThemeId
                    ? ((themes ?? []).find(t => t.id === settings.brandingThemeId)?.name ?? 'Selected')
                    : "Xero's default"
                } />
              </div>
            )}
          </div>

          {/* Recent errors */}
          {errors.length > 0 && (
            <div className="px-5 py-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-xs font-semibold text-red-600 uppercase tracking-wide">Recent Errors</p>
                {errors.length > 1 && (
                  <button
                    onClick={() => handleDismissErrors('all')}
                    disabled={dismissing}
                    className="text-xs text-slate-400 hover:text-slate-600 disabled:opacity-50 hover:underline"
                  >
                    Dismiss all
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {errors.map((e, i) => (
                  <div key={e.id ?? i} className="flex items-start gap-2 text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    <AlertTriangle size={11} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-red-700 font-medium">{e.action}</p>
                      <p className="text-red-600 break-words">{e.error_message}</p>
                      <p className="text-red-400">{fmtDate(e.created_at)}</p>
                    </div>
                    <button
                      onClick={() => handleDismissErrors([e.id])}
                      disabled={dismissing || !e.id}
                      title="Dismiss this error"
                      aria-label={`Dismiss error: ${e.action}`}
                      className="flex-shrink-0 -mt-0.5 -mr-1 p-1 rounded text-red-300 hover:text-red-600 hover:bg-red-100 disabled:opacity-40 transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Setup notes for admin */}
          <div className="px-5 py-4 bg-slate-50">
            <p className="text-xs text-slate-400 leading-relaxed">
              <strong className="text-slate-500">Webhook URL</strong> (register in Xero Developer Portal):{' '}
              <code className="bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded text-[10px] break-all">
                {import.meta.env.VITE_SUPABASE_URL}/functions/v1/xero-sync-invoice?webhook=1
              </code>
            </p>
          </div>
        </div>
      )}

      {/* Disconnected state */}
      {status && !status.connected && (
        <div className="px-5 py-6">
          <p className="text-sm text-slate-500 mb-4">
            Connect your Xero account to create invoices directly from accepted quotes, sync payment status, and keep your accounts up to date automatically.
          </p>
          <div className="bg-slate-50 rounded-xl p-4 mb-4 text-xs text-slate-500 space-y-1.5">
            <p className="font-medium text-slate-600">Before connecting:</p>
            <p>1. Set <code className="bg-slate-200 px-1 rounded">XERO_CLIENT_ID</code>, <code className="bg-slate-200 px-1 rounded">XERO_CLIENT_SECRET</code>, <code className="bg-slate-200 px-1 rounded">XERO_REDIRECT_URI</code>, and <code className="bg-slate-200 px-1 rounded">LUSSO_APP_URL</code> as Supabase Edge Function secrets.</p>
            <p>2. Register <code className="bg-slate-200 px-1 rounded break-all">{import.meta.env.VITE_SUPABASE_URL}/functions/v1/xero-oauth-callback</code> as a redirect URI in your Xero app.</p>
          </div>
          <button
            onClick={handleConnect}
            disabled={working}
            className="flex items-center gap-2 bg-[#13B5EA] hover:bg-[#0ea5d9] disabled:opacity-60 text-white font-semibold text-sm px-5 py-2.5 rounded-xl transition-colors"
          >
            {working
              ? <><Loader size={14} className="animate-spin" /> Connecting…</>
              : <><Link2 size={14} /> Connect to Xero</>
            }
          </button>
        </div>
      )}
    </Card>
  );
}

function SettingRow({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="font-medium text-slate-700">{value ?? '—'}</dd>
    </div>
  );
}

function BuzExportSection() {
  useDataRefresh();
  const codes = getBuzFabricCodes();
  const [range, setRange]   = useState('');
  const [code, setCode]     = useState('');
  const [editId, setEditId] = useState(null);
  const [editRange, setEditRange] = useState('');
  const [editCode, setEditCode]   = useState('');

  const add = () => {
    const row = saveBuzFabricCode({ range, code });
    if (!row) { toast('Enter both a fabric range and a BUZ code.', 'info'); return; }
    setRange(''); setCode('');
    toast('Fabric code added.');
  };

  const startEdit = (e) => { setEditId(e.id); setEditRange(e.range); setEditCode(e.code); };
  const saveEdit = () => {
    const row = saveBuzFabricCode({ id: editId, range: editRange, code: editCode });
    if (!row) { toast('Enter both a fabric range and a BUZ code.', 'info'); return; }
    setEditId(null);
    toast('Fabric code updated.');
  };

  return (
    <div className="space-y-6">
    <SettingsCard
      id="buz-fabric-codes"
      icon={FileDown}
      title="BUZ export — fabric code overrides"
      scope="team"
      save={{ kind: 'auto' }}
      description={<>
          Each blind exported to BUZ needs an <span className="font-medium">INVENTORY CODE</span>, and Lusso now works it out
          from {buzCatalogueMeta().combinations.toLocaleString()} fabrics read off the BUZ catalogue — so most ranges need
          nothing here. Add a row only to pin a fabric Lusso can&rsquo;t place, or to override what it picked. Entries here
          always win, and are matched by name with the longest matching range taking precedence.
        </>}
      >

      {/* Add row */}
      <div className="flex flex-col sm:flex-row gap-2 mb-4">
        <input value={range} onChange={e => setRange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="Fabric range (e.g. Serene Blockout)"
          className="flex-1 min-w-0 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
        <input value={code} onChange={e => setCode(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="BUZ code (e.g. ROLLSERBOO1)"
          className="flex-1 min-w-0 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-400" />
        <button type="button" onClick={add}
          className="flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white flex-shrink-0">
          <Plus size={14} /> Add
        </button>
      </div>

      {/* Existing mappings */}
      {codes.length === 0 ? (
        <p className="text-xs text-slate-400">No fabric codes yet. Add your first mapping above.</p>
      ) : (
        <div className="border border-slate-200 rounded-xl divide-y divide-slate-100">
          {codes.map(e => (
            <div key={e.id} className="flex items-center gap-2 px-3 py-2">
              {editId === e.id ? (
                <>
                  <input value={editRange} onChange={ev => setEditRange(ev.target.value)}
                    className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  <input value={editCode} onChange={ev => setEditCode(ev.target.value)}
                    className="flex-1 min-w-0 border border-slate-200 rounded-lg px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  <button type="button" onClick={saveEdit} title="Save" className="text-green-600 hover:text-green-700 p-1"><Check size={15} /></button>
                  <button type="button" onClick={() => setEditId(null)} title="Cancel" className="text-slate-400 hover:text-slate-600 p-1 relative before:absolute before:content-[''] before:-inset-[11px]"><X size={15} /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-0 text-sm text-slate-700 truncate">{e.range}</span>
                  <span className="flex-1 min-w-0 text-sm font-mono text-amber-700 truncate">{e.code}</span>
                  <button type="button" onClick={() => startEdit(e)} title="Edit" className="text-slate-400 hover:text-slate-600 p-1 relative before:absolute before:content-[''] before:-inset-[11px]"><Edit3 size={14} /></button>
                  <button type="button" onClick={() => { deleteBuzFabricCode(e.id); toast('Fabric code removed.', 'info'); }}
                    title="Remove" className="text-slate-400 hover:text-red-500 p-1 relative before:absolute before:content-[''] before:-inset-[11px]"><Trash2 size={14} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </SettingsCard>
    <BuzValueMapCard />
    </div>
  );
}

// Per-option Lusso→BUZ value translations (CONTROLTYPE / ROLLDIR / BOTTOMTRIM).
// Each row maps one Lusso dropdown value to the exact BUZ wording; blank falls
// back to the built-in default (shown as the placeholder), or passes through.
function BuzValueMapCard() {
  useDataRefresh();
  const [drafts, setDrafts] = useState(() => {
    const d = {};
    BUZ_MAP_FIELDS.forEach(f => {
      const stored = getBuzValueMap(f.key);
      f.sourceOptions.forEach(opt => { d[`${f.key}|${opt}`] = stored[opt.toLowerCase()] || ''; });
    });
    return d;
  });

  const onChange = (field, opt, val) => {
    setDrafts(d => ({ ...d, [`${field}|${opt}`]: val }));
    setBuzValueMapEntry(field, opt, val);
  };

  return (
    <SettingsCard
      id="buz-value-maps"
      icon={FileDown}
      title="BUZ export — value translations"
      scope="team"
      save={{ kind: 'auto' }}
      description={<>
          Map each Lusso option to the exact BUZ dropdown wording for these columns. Leave a row blank to use the
          built-in default (shown as the faint placeholder) or, where there's no default, to pass the Lusso value
          through unchanged. Changes apply to the next export.
        </>}
      >
      <div className="space-y-5">
        {BUZ_MAP_FIELDS.map(f => (
          <div key={f.key} className="border border-slate-200 rounded-xl p-4">
            <p className="text-sm font-medium text-slate-700">
              {f.column} <span className="text-slate-400 font-normal">· from {f.sourceLabel}</span>
            </p>
            <div className="mt-2 divide-y divide-slate-100">
              {f.sourceOptions.map(opt => {
                const def = f.defaults[opt.toLowerCase()] || '';
                return (
                  <div key={opt} className="flex items-center gap-3 py-1.5">
                    <span className="w-36 sm:w-44 flex-shrink-0 text-sm text-slate-600 truncate" title={opt}>{opt}</span>
                    <span className="text-slate-300 flex-shrink-0">→</span>
                    <input value={drafts[`${f.key}|${opt}`] ?? ''} onChange={e => onChange(f.key, opt, e.target.value)}
                      placeholder={def || 'passes through unchanged'}
                      className="flex-1 min-w-0 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 placeholder:text-slate-300" />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </SettingsCard>
  );
}

export default function Integrations({ canUseXero, isCloud }) {
  return (<>
    {canUseXero ? <XeroSection /> : (
      // Not an empty panel and not a silent omission: the section still has the
      // BUZ cards, so say why the Xero card isn't among them rather than
      // leaving someone to wonder whether it moved.
      <Card className="px-5 py-4 flex items-start gap-3">
        <Link2Off size={16} className="text-slate-400 flex-shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-700">Xero isn’t available on this account</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {isCloud
              ? 'Connecting Xero and changing its settings is limited to account managers. Everything else in this section is yours to edit.'
              : 'Xero needs a live cloud connection, and this device is running offline.'}
          </p>
        </div>
      </Card>
    )}
    <BuzExportSection />
  </>);
}
