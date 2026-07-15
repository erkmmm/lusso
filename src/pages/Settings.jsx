import { useDataRefresh } from '../hooks/useDataRefresh';
import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Settings2, Plus, ChevronUp, ChevronDown, Edit3, Save, X,
  ToggleLeft, ToggleRight, Tag, Upload, Users, Library, History,
  ArrowRight, FileText, Cloud, CloudUpload, RefreshCw, CheckCircle2,
  AlertTriangle, Sun, Moon, Monitor, Clock, Wifi, WifiOff,
  Link2, Link2Off, ExternalLink, Building2, Loader, Bot, Trash2,
  MessageSquare, Database, Zap, ClipboardList,
} from 'lucide-react';
import { useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useTheme } from '../contexts/ThemeContext';
import { useProfile } from '../contexts/UserProfileContext';
import {
  getProductTypes, saveProductType, addProductType, reorderProductType,
  getImportBatches, getPricedItemBatches,
  getMessagePresets, saveMessagePresets, DEFAULT_MESSAGE_PRESETS,
  getPoPresets, savePoPreset, deletePoPreset,
  MS_OPTION_FIELDS, getMsCustomOptions, addMsOption, deleteMsOption,
} from '../store/data';
import { pushAllToSupabase, hydrateFromSupabase, flushPending } from '../store/db';
import Card from '../components/Card';
import { toast } from '../components/ToastContainer';
import {
  xeroGetConnection, xeroStartOAuth, xeroDisconnect,
  xeroSaveSettings, xeroInvoiceStatusBadge,
} from '../lib/xero';

export default function Settings() {
  useDataRefresh();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isAM } = useProfile() ?? {};
  const [productTypes, setProductTypes] = useState(getProductTypes);
  const [adding, setAdding]             = useState(false);
  const [newName, setNewName]           = useState('');
  const [editingId, setEditingId]       = useState(null);
  const [editName, setEditName]         = useState('');
  const [syncStatus, setSyncStatus]     = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isCloud = Boolean(supabase);

  // ── Handle Xero OAuth callback redirects ────────────────────────────────────
  useEffect(() => {
    const xeroParam = searchParams.get('xero');
    const xeroError = searchParams.get('xero_error');
    if (xeroParam === 'connected') {
      toast('Xero connected successfully!');
      // Remove param from URL without reload
      const url = new URL(window.location.href);
      url.searchParams.delete('xero');
      window.history.replaceState({}, '', url);
    }
    if (xeroError) {
      toast(`Xero error: ${xeroError}`, 'error');
      const url = new URL(window.location.href);
      url.searchParams.delete('xero_error');
      window.history.replaceState({}, '', url);
    }
  }, []);

  const refresh = () => setProductTypes(getProductTypes());

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    addProductType(name);
    setNewName('');
    setAdding(false);
    refresh();
  };

  const handleSaveEdit = (pt) => {
    const name = editName.trim();
    if (!name) return;
    saveProductType({ ...pt, name });
    setEditingId(null);
    refresh();
    toast('Product type saved.');
  };

  const handleToggleActive = (pt) => {
    saveProductType({ ...pt, isActive: !pt.isActive });
    refresh();
  };

  const handleMove = (id, dir) => {
    reorderProductType(id, dir);
    refresh();
  };

  // sorted is maintained by getProductTypes (sorts by sortOrder)
  const sorted = productTypes; // already sorted

  const { theme, setTheme, colorTheme, setColorTheme } = useTheme();

  const COLOR_OPTIONS = [
    { value: 'apex',  label: 'Apex',   desc: 'Emerald & charcoal — demo style.', swatch: '#009368' },
    { value: 'taupe', label: 'Taupe',  desc: 'Warm taupe & cream.',   swatch: '#644a40' },
    { value: 'green', label: 'Green',  desc: 'Forest green & cream.',  swatch: '#2e7d32' },
  ];

  const THEME_OPTIONS = [
    {
      value: 'light',
      label: 'Light',
      desc: 'Always use light mode.',
      icon: Sun,
      color: 'text-amber-500',
    },
    {
      value: 'dark',
      label: 'Dark',
      desc: 'Always use dark mode.',
      icon: Moon,
      color: 'text-slate-400',
    },
    {
      value: 'system',
      label: 'System',
      desc: "Follows your device's appearance setting.",
      icon: Monitor,
      color: 'text-blue-500',
    },
    {
      value: 'schedule',
      label: 'Schedule',
      desc: 'Dark from 7 pm to 7 am, light the rest of the day.',
      icon: Clock,
      color: 'text-teal-500',
    },
  ];

  const handlePush = async () => {
    setSyncStatus('pushing');
    const { pushed, errors } = await pushAllToSupabase();
    if (errors.length > 0) {
      setSyncStatus({ err: true, msg: `${pushed} records pushed. ${errors.length} error(s): ${errors.join(' · ')}` });
    } else {
      setSyncStatus({ ok: true, msg: `${pushed} records pushed to cloud successfully.` });
    }
    setTimeout(() => setSyncStatus(null), 5000);
  };

  const handlePull = async () => {
    setSyncStatus('pulling');
    await hydrateFromSupabase();
    window.dispatchEvent(new CustomEvent('lusso:data-changed'));
    setSyncStatus({ ok: true, msg: 'Data synced from cloud.' });
    setTimeout(() => setSyncStatus(null), 4000);
  };

  const handleResetSync = async () => {
    setSyncStatus('pulling');
    // Safe reconcile: push anything unsynced FIRST so it isn't lost, then
    // re-pull. We no longer delete local keys up front — hydration reconciles
    // (and its empty-response guard means a transient empty pull can't wipe you).
    try { await flushPending(); } catch { /* best-effort */ }
    await hydrateFromSupabase();
    window.dispatchEvent(new CustomEvent('lusso:data-changed'));
    setSyncStatus({ ok: true, msg: 'Sync complete — reconciled with the cloud.' });
    setTimeout(() => setSyncStatus(null), 4000);
    toast('Sync complete — reconciled with the cloud.');
  };

  const NAV = [
    { id: 'general',      label: 'General',       icon: Settings2,   desc: 'Appearance & sync' },
    { id: 'messages',     label: 'Messages',       icon: MessageSquare, desc: 'Presets & templates' },
    { id: 'integrations', label: 'Integrations',   icon: Zap,         desc: 'Xero & more' },
    { id: 'products',     label: 'Products',       icon: Tag,         desc: 'Types & pricing' },
    { id: 'measure',      label: 'Measure Sheet',  icon: ClipboardList, desc: 'Dropdown options' },
    { id: 'data',         label: 'Data & AI',      icon: Database,    desc: 'Knowledge & imports' },
  ];

  const [section, setSection] = useState('general');

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Settings2 size={22} className="text-amber-500" /> Settings
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">Platform configuration and admin controls</p>
      </div>

      {/* ── Mobile: horizontal pills (outside the flex row so they stack above content) ── */}
      <div className="sm:hidden flex gap-2 overflow-x-auto pb-1 mb-4 -mx-4 px-4">
        {NAV.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-full border whitespace-nowrap flex-shrink-0 transition-colors ${
              section === id
                ? 'bg-amber-500 text-white border-amber-500'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
            }`}
          >
            <Icon size={12} /> {label}
          </button>
        ))}
      </div>

      <div className="flex gap-6 items-start">

        {/* ── Sidebar nav (desktop only) ── */}
        <aside className="hidden sm:flex flex-col gap-1 w-44 flex-shrink-0 sticky top-6">
          {NAV.map(({ id, label, icon: Icon, desc }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                section === id
                  ? 'bg-amber-50 border border-amber-200 text-amber-700'
                  : 'text-slate-600 hover:bg-slate-100 border border-transparent'
              }`}
            >
              <Icon size={16} className={section === id ? 'text-amber-500' : 'text-slate-400'} />
              <div className="min-w-0">
                <p className={`text-sm font-medium leading-tight ${section === id ? 'text-amber-700' : 'text-slate-700'}`}>{label}</p>
                <p className="text-[10px] text-slate-400 truncate">{desc}</p>
              </div>
            </button>
          ))}
        </aside>

        {/* ── Content area ── */}
        <div className="flex-1 min-w-0 space-y-5">

          {/* ── GENERAL ── */}
          {section === 'general' && (<>
            {/* Appearance */}
            <Card>
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                  <Sun size={14} className="text-amber-500" /> Appearance
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">Choose how Lusso looks on this device.</p>
              </div>
              <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                {THEME_OPTIONS.map(({ value, label, desc, icon: Icon, color }) => {
                  const active = theme === value;
                  return (
                    <button key={value} onClick={() => setTheme(value)}
                      className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 text-center transition-all ${
                        active ? 'border-amber-500 bg-amber-50/40' : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${active ? 'bg-amber-100' : 'bg-slate-100'}`}>
                        <Icon size={20} className={active ? 'text-amber-600' : color} />
                      </div>
                      <div>
                        <p className={`text-sm font-semibold ${active ? 'text-amber-700' : 'text-slate-700'}`}>{label}</p>
                        <p className="text-xs text-slate-400 mt-0.5 leading-tight">{desc}</p>
                      </div>
                      {active && <span className="text-[10px] font-semibold bg-amber-500 text-white px-2 py-0.5 rounded-full">Active</span>}
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* Colour theme */}
            <Card>
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                  <Sun size={14} className="text-amber-500" /> Colour theme
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">Pick the accent palette. Works in light and dark mode.</p>
              </div>
              <div className="p-4 grid grid-cols-2 gap-3">
                {COLOR_OPTIONS.map(({ value, label, desc, swatch }) => {
                  const active = colorTheme === value;
                  return (
                    <button key={value} onClick={() => setColorTheme(value)}
                      className={`flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all ${
                        active ? 'border-amber-500 bg-amber-50/40' : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <span className="w-9 h-9 rounded-lg flex-shrink-0 border border-black/10" style={{ backgroundColor: swatch }} />
                      <div className="min-w-0">
                        <p className={`text-sm font-semibold ${active ? 'text-amber-700' : 'text-slate-700'}`}>{label}</p>
                        <p className="text-xs text-slate-400 mt-0.5 leading-tight">{desc}</p>
                      </div>
                      {active && <span className="ml-auto text-[10px] font-semibold bg-amber-500 text-white px-2 py-0.5 rounded-full">Active</span>}
                    </button>
                  );
                })}
              </div>
            </Card>

            {/* Cloud sync status */}
            <Card>
              <div className="px-5 py-4 flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isCloud ? 'bg-green-50' : 'bg-slate-100'}`}>
                  {isCloud ? <Wifi size={18} className="text-green-600" /> : <WifiOff size={18} className="text-slate-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-slate-800">{isCloud ? 'Live cloud sync active' : 'Offline mode'}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {isCloud ? 'Changes save instantly and appear on all devices automatically.' : 'No Supabase connection — data is stored locally on this device only.'}
                  </p>
                </div>
                {isCloud && <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse flex-shrink-0" />}
              </div>
              {isCloud && (
                <div className="border-t border-slate-100">
                  <button onClick={() => setShowAdvanced(v => !v)}
                    className="w-full flex items-center justify-between px-5 py-3 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors">
                    <span>Advanced diagnostics</span>
                    {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                  </button>
                  {showAdvanced && (
                    <div className="border-t border-slate-50">
                      <p className="px-5 pt-3 pb-1 text-xs text-slate-400">Use these only if data looks wrong or out of sync.</p>
                      <div className="divide-y divide-slate-50">
                        <button onClick={handlePush} disabled={syncStatus === 'pushing' || syncStatus === 'pulling'}
                          className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors text-left disabled:opacity-60">
                          <CloudUpload size={15} className="text-teal-500 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-700">Force push to cloud</p>
                            <p className="text-xs text-slate-400">Overwrite cloud with this device's data.</p>
                          </div>
                          {syncStatus === 'pushing' && <RefreshCw size={14} className="text-slate-400 animate-spin flex-shrink-0" />}
                        </button>
                        <button onClick={handlePull} disabled={syncStatus === 'pushing' || syncStatus === 'pulling'}
                          className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors text-left disabled:opacity-60">
                          <RefreshCw size={15} className="text-blue-500 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-slate-700">Force pull from cloud</p>
                            <p className="text-xs text-slate-400">Replace this device's data with the cloud copy.</p>
                          </div>
                          {syncStatus === 'pulling' && <RefreshCw size={14} className="text-slate-400 animate-spin flex-shrink-0" />}
                        </button>
                      </div>
                      {syncStatus && typeof syncStatus === 'object' && (
                        <div className={`mx-5 mb-4 mt-2 flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs ${syncStatus.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                          {syncStatus.ok ? <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" /> : <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />}
                          {syncStatus.msg}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* Reset & Resync */}
            {isCloud && (
              <Card className="p-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
                    <RefreshCw size={18} className="text-blue-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">Reset &amp; Resync from Cloud</p>
                    <p className="text-xs text-slate-500 mt-0.5">Clears this device's local data and reloads everything fresh from Supabase.</p>
                  </div>
                  <button onClick={handleResetSync} disabled={syncStatus === 'pulling' || syncStatus === 'pushing'}
                    className="flex items-center gap-1.5 text-xs font-semibold bg-blue-500 hover:bg-blue-400 disabled:opacity-60 text-white px-4 py-2 rounded-lg transition-colors flex-shrink-0">
                    {syncStatus === 'pulling' ? <><RefreshCw size={12} className="animate-spin" /> Syncing…</> : <><RefreshCw size={12} /> Reset &amp; Sync</>}
                  </button>
                </div>
                {syncStatus && typeof syncStatus === 'object' && (
                  <div className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${syncStatus.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                    {syncStatus.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                    {syncStatus.msg}
                  </div>
                )}
              </Card>
            )}
          </>)}

          {/* ── MESSAGES ── */}
          {section === 'messages' && (<>
            <MessagePresetsSection />
            <PoMessagePresetsSection />
          </>)}

          {/* ── INTEGRATIONS ── */}
          {section === 'integrations' && (
            isCloud && isAM
              ? <XeroSection />
              : <Card className="p-8 text-center">
                  <Zap size={28} className="mx-auto mb-3 text-slate-300" />
                  <p className="text-sm font-medium text-slate-600">No integrations available</p>
                  <p className="text-xs text-slate-400 mt-1">Xero integration requires admin access and cloud mode.</p>
                </Card>
          )}

          {/* ── PRODUCTS ── */}
          {section === 'products' && (<>
            {/* Price Library */}
            <Card>
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                  <Library size={14} className="text-amber-500" /> Price Library
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">Manage reusable priced items that can be added to any quote.</p>
              </div>
              <button onClick={() => navigate('/priced-items')}
                className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors text-left group">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <Library size={18} className="text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-slate-800">Priced Items Library</p>
                  <p className="text-xs text-slate-500 mt-0.5">View, search, and manage all reusable line items used in quotes.</p>
                </div>
                <ArrowRight size={16} className="text-slate-300 group-hover:text-amber-500 transition-colors flex-shrink-0" />
              </button>
            </Card>

            {/* Product Types */}
            <Card>
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                    <Tag size={14} className="text-amber-500" /> Product Types
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">Used in measure sheet product dropdowns.</p>
                </div>
                <button onClick={() => { setAdding(true); setNewName(''); }}
                  className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-white font-medium px-3 py-1.5 rounded-lg transition-colors">
                  <Plus size={13} /> Add
                </button>
              </div>
              {adding && (
                <div className="px-5 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
                  <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
                    placeholder="New product type name…"
                    className="flex-1 border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                  <button onClick={handleAdd} className="bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium px-3 py-2 rounded-lg"><Save size={14} /></button>
                  <button onClick={() => setAdding(false)} className="text-slate-400 hover:text-slate-600 px-2 py-2"><X size={14} /></button>
                </div>
              )}
              <div className="divide-y divide-slate-50">
                {sorted.map((pt, idx) => (
                  <div key={pt.id} className={`flex items-center gap-3 px-5 py-3 ${!pt.isActive ? 'bg-slate-50/60' : ''}`}>
                    <div className="flex flex-col gap-0.5 flex-shrink-0">
                      <button onClick={() => handleMove(pt.id, 'up')} disabled={idx === 0} className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors"><ChevronUp size={14} /></button>
                      <button onClick={() => handleMove(pt.id, 'down')} disabled={idx === sorted.length - 1} className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors"><ChevronDown size={14} /></button>
                    </div>
                    <span className="w-6 text-center text-xs text-slate-300 flex-shrink-0">{pt.sortOrder}</span>
                    {editingId === pt.id ? (
                      <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(pt); if (e.key === 'Escape') setEditingId(null); }}
                        className="flex-1 border border-amber-300 rounded-lg text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                    ) : (
                      <span className={`flex-1 text-sm ${pt.isActive ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{pt.name}</span>
                    )}
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${pt.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {pt.isActive ? 'Active' : 'Disabled'}
                    </span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {editingId === pt.id ? (
                        <>
                          <button onClick={() => handleSaveEdit(pt)} className="text-green-500 hover:text-green-700 p-1 rounded"><Save size={14} /></button>
                          <button onClick={() => setEditingId(null)} className="text-slate-400 hover:text-slate-600 p-1 rounded"><X size={14} /></button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => { setEditingId(pt.id); setEditName(pt.name); }} className="text-slate-400 hover:text-slate-600 p-1 rounded" title="Rename"><Edit3 size={14} /></button>
                          <button onClick={() => handleToggleActive(pt)} className={`p-1 rounded transition-colors ${pt.isActive ? 'text-green-500 hover:text-red-400' : 'text-slate-300 hover:text-green-500'}`} title={pt.isActive ? 'Disable' : 'Enable'}>
                            {pt.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-5 py-3 border-t border-slate-100">
                <p className="text-xs text-slate-400">Disabled types no longer appear in new measure sheets but are preserved on existing records.</p>
              </div>
            </Card>
          </>)}

          {/* ── MEASURE SHEET ── */}
          {section === 'measure' && <MeasureSheetOptionsSection />}

          {/* ── DATA & AI ── */}
          {section === 'data' && (<>
            <ImportsSection navigate={navigate} />
            {isCloud && <AIKnowledgeSection />}
          </>)}

        </div>
      </div>
    </div>
  );
}

// ─── Xero Integration Section ─────────────────────────────────────────────────
const DEFAULT_XERO_SETTINGS = {
  autoCreateInvoice:       false,
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

  const fmtDate = (d) => { try { return new Date(d).toLocaleString('en-AU'); } catch { return '—'; } };

  return (
    <Card>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* Xero logo-ish mark */}
          <div className="w-8 h-8 rounded-lg bg-[#13B5EA]/10 flex items-center justify-center flex-shrink-0">
            <span className="text-[#13B5EA] font-black text-sm">X</span>
          </div>
          <div>
            <h2 className="font-semibold text-slate-800 text-sm">Xero Integration</h2>
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

          {/* Settings */}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Invoice Settings</p>
              <button
                onClick={() => { setEditingSettings(!editingSettings); setLocalSettings(settings); }}
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
                    className={`flex-shrink-0 ${localSettings.autoCreateInvoice ? 'text-green-500' : 'text-slate-300'}`}
                  >
                    {localSettings.autoCreateInvoice ? <ToggleRight size={28} /> : <ToggleLeft size={28} />}
                  </button>
                </label>

                <div className="grid sm:grid-cols-2 gap-3">
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
              <div className="grid sm:grid-cols-2 gap-2 text-sm">
                <SettingRow label="Auto-create invoice" value={settings.autoCreateInvoice ? 'Enabled' : 'Disabled'} />
                <SettingRow label="Default status"      value={settings.defaultInvoiceStatus} />
                <SettingRow label="Account code"        value={settings.defaultAccountCode} />
                <SettingRow label="Tax type"            value={settings.defaultTaxType} />
                <SettingRow label="Payment terms"       value={`${settings.defaultPaymentTermsDays} days`} />
              </div>
            )}
          </div>

          {/* Recent errors */}
          {errors.length > 0 && (
            <div className="px-5 py-4">
              <p className="text-xs font-semibold text-red-600 uppercase tracking-wide mb-2">Recent Errors</p>
              <div className="space-y-1.5">
                {errors.map((e, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                    <AlertTriangle size={11} className="text-red-500 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-red-700 font-medium">{e.action}</p>
                      <p className="text-red-600 truncate">{e.error_message}</p>
                      <p className="text-red-400">{fmtDate(e.created_at)}</p>
                    </div>
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

// ─── Measure Sheet dropdown options ───────────────────────────────────────────
function MeasureSheetOptionsSection() {
  useDataRefresh();
  const [drafts, setDrafts] = useState({});
  const custom = getMsCustomOptions();

  const add = (fieldKey) => {
    const v = (drafts[fieldKey] || '').trim();
    if (!v) return;
    const row = addMsOption(fieldKey, v);
    if (!row) { toast('That option already exists.', 'info'); return; }
    setDrafts(d => ({ ...d, [fieldKey]: '' }));
    toast('Option added.');
  };

  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <ClipboardList size={15} className="text-amber-500" /> Measure Sheet Options
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Add options to the measure-sheet dropdowns (e.g. new track types). Built-in options stay; your additions apply to every measure sheet and sync to the team.
        </p>
      </div>
      <div className="space-y-4">
        {MS_OPTION_FIELDS.map(f => {
          const mine = custom.filter(o => o.field === f.key);
          return (
            <div key={f.key} className="border border-slate-200 rounded-xl p-4">
              <p className="text-sm font-medium text-slate-700 mb-2">{f.label}</p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {f.defaults.map(v => (
                  <span key={v} className="text-xs bg-slate-100 text-slate-500 rounded-full px-2.5 py-1">{v}</span>
                ))}
                {mine.map(o => (
                  <span key={o.id} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full pl-2.5 pr-1 py-1 flex items-center gap-1">
                    {o.value}
                    <button type="button" onClick={() => { deleteMsOption(o.id); toast('Option removed.', 'info'); }}
                      title="Remove option" className="text-amber-400 hover:text-red-500"><X size={12} /></button>
                  </span>
                ))}
                {f.defaults.length === 0 && mine.length === 0 && <span className="text-xs text-slate-400">No options yet.</span>}
              </div>
              <div className="flex gap-2">
                <input value={drafts[f.key] || ''} onChange={e => setDrafts(d => ({ ...d, [f.key]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(f.key); } }}
                  placeholder={`Add a ${f.label.toLowerCase()} option`}
                  className="flex-1 min-w-0 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                <button type="button" onClick={() => add(f.key)}
                  className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white flex-shrink-0">
                  <Plus size={14} /> Add
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ImportsSection({ navigate }) {
  const contactBatches    = getImportBatches();
  const pricedItemBatches = getPricedItemBatches();
  const totalImports      = contactBatches.length + pricedItemBatches.length;

  const lastContact    = contactBatches[0];
  const lastPriced     = pricedItemBatches[0];
  const lastQuotes     = contactBatches.find(b => b.source === 'Quotient Quotes CSV Import');

  const tiles = [
    {
      icon:  Users,
      color: 'text-blue-600',
      bg:    'bg-blue-50',
      label: 'Import Contacts',
      desc:  'Upload a CSV to import customer contacts from Quotient or any source.',
      meta:  lastContact
        ? `Last run: ${new Date(lastContact.completedAt || lastContact.createdAt).toLocaleDateString('en-AU')} · ${lastContact.importedCount} imported`
        : 'No imports yet',
      action: () => navigate('/import'),
    },
    {
      icon:  FileText,
      color: 'text-green-600',
      bg:    'bg-green-50',
      label: 'Import Quotes (Quotient)',
      desc:  'Upload Quotient "Summary of Quotes" + "Price Items" CSVs to bring in your full quote history.',
      meta:  lastQuotes
        ? `Last run: ${new Date(lastQuotes.completedAt || lastQuotes.createdAt).toLocaleDateString('en-AU')} · ${lastQuotes.importedCount} imported`
        : 'No imports yet',
      action: () => navigate('/quotes/import'),
    },
    {
      icon:  Library,
      color: 'text-amber-600',
      bg:    'bg-amber-50',
      label: 'Import Priced Items',
      desc:  'Upload a CSV to populate the reusable pricing library from Quotient.',
      meta:  lastPriced
        ? `Last run: ${new Date(lastPriced.completedAt || lastPriced.createdAt).toLocaleDateString('en-AU')} · ${lastPriced.importedCount} imported`
        : 'No imports yet',
      action: () => navigate('/priced-items?tab=import'),
    },
    {
      icon:  History,
      color: 'text-slate-500',
      bg:    'bg-slate-100',
      label: 'Import History',
      desc:  'View all past contact and priced item import batches in one place.',
      meta:  `${totalImports} total import${totalImports !== 1 ? 's' : ''}`,
      action: () => navigate('/import-history'),
    },
  ];

  return (
    <Card>
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <Upload size={14} className="text-amber-500" /> Imports
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Import contacts and priced items from CSV. Admin access only.
        </p>
      </div>
      <div className="divide-y divide-slate-50">
        {tiles.map(({ icon: Icon, color, bg, label, desc, meta, action }) => (
          <button
            key={label}
            onClick={action}
            className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors text-left"
          >
            <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center flex-shrink-0`}>
              <Icon size={18} className={color} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm text-slate-800">{label}</p>
              <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
              <p className="text-xs text-slate-400 mt-1">{meta}</p>
            </div>
            <ArrowRight size={16} className="text-slate-300 flex-shrink-0" />
          </button>
        ))}
      </div>
    </Card>
  );
}

// ─── Message Presets Section ──────────────────────────────────────────────────
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

function MessagePresetsSection() {
  const [presets, setPresets]   = useState(getMessagePresets);
  const [editingKey, setEditing] = useState(null);
  const [draft, setDraft]        = useState('');
  const [activeGroup, setGroup]  = useState('Quote');

  const startEdit = (key) => { setEditing(key); setDraft(presets[key] ?? ''); };
  const cancelEdit = () => setEditing(null);
  const saveEdit = (key) => {
    const updated = { ...presets, [key]: draft };
    setPresets(updated);
    saveMessagePresets(updated);
    setEditing(null);
    toast('Preset saved.');
  };
  const resetField = (key) => {
    const updated = { ...presets, [key]: DEFAULT_MESSAGE_PRESETS[key] };
    setPresets(updated);
    saveMessagePresets(updated);
    toast('Reset to default.');
  };

  const groups = [...new Set(PRESET_FIELDS.map(f => f.group))];
  const fields = PRESET_FIELDS.filter(f => f.group === activeGroup);

  return (
    <Card>
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <MessageSquare size={14} className="text-amber-500" /> Message Presets
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">Default messages used across quotes, emails and SMS.</p>
      </div>

      {/* Group tabs */}
      <div className="flex gap-1 px-5 pt-4">
        {groups.map(g => (
          <button key={g} onClick={() => setGroup(g)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
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
                    className="flex items-center gap-1 text-xs text-slate-500 hover:text-amber-600 border border-slate-200 hover:border-amber-300 px-2 py-1 rounded-lg transition-colors">
                    <Edit3 size={11} /> Edit
                  </button>
                  <button onClick={() => resetField(key)}
                    className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 border border-slate-200 px-2 py-1 rounded-lg transition-colors"
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
    </Card>
  );
}

// ─── Purchase Order email presets (email → pre-written message) ───────────────
const PO_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function PoMessagePresetsSection() {
  const [presets, setPresets] = useState(getPoPresets);
  const [email, setEmail]     = useState('');
  const [message, setMessage] = useState('');
  const [editId, setEditId]   = useState(null);

  const refresh = () => setPresets(getPoPresets());
  const reset   = () => { setEmail(''); setMessage(''); setEditId(null); };

  const save = () => {
    const e = email.trim();
    if (!PO_EMAIL_RE.test(e)) { toast('Enter a valid email address.', 'error'); return; }
    savePoPreset({ id: editId, email: e, message });
    refresh(); reset();
    toast('Preset saved.');
  };
  const edit = (p) => { setEditId(p.id); setEmail(p.email); setMessage(p.message || ''); };
  const del  = (p) => { deletePoPreset(p.id); if (editId === p.id) reset(); refresh(); toast('Preset deleted.', 'info'); };

  return (
    <Card>
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <MessageSquare size={14} className="text-amber-500" /> Purchase Order email presets
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">Save a pre-written message per supplier email. It auto-fills the body when you send a PO to that address.</p>
      </div>
      <div className="p-5 space-y-4">
        {presets.length > 0 && (
          <div className="space-y-2">
            {presets.map(p => (
              <div key={p.id} className={`flex items-start gap-2 border rounded-lg px-3 py-2 ${editId === p.id ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">{p.email}</p>
                  <p className="text-xs text-slate-400 whitespace-pre-wrap line-clamp-2">{p.message || '—'}</p>
                </div>
                <button onClick={() => edit(p)} className="text-xs text-slate-500 hover:text-amber-600 flex-shrink-0">Edit</button>
                <button onClick={() => del(p)} className="text-slate-400 hover:text-red-500 flex-shrink-0" title="Delete preset"><Trash2 size={14} /></button>
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
    </Card>
  );
}

// ─── AI Knowledge Base Section ────────────────────────────────────────────────
function AIKnowledgeSection() {
  const [docs, setDocs]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [uploading, setUploading]     = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [editingId, setEditingId]     = useState(null);
  const [editDesc, setEditDesc]       = useState('');
  const [session, setSession]         = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    supabase
      .from('ai_global_knowledge')
      .select('id, filename, file_type, description, created_at')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setDocs(data ?? []); setLoading(false); });
  }, []);

  const fileTypeIcon = (ft) => {
    if (ft === 'pdf') return '📄';
    if (ft === 'csv') return '📊';
    if (['md', 'txt'].includes(ft)) return '📝';
    return '📎';
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !session) return;
    fileRef.current.value = '';
    setUploading(true);
    setUploadError(null);
    try {
      let text = '';
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext === 'pdf') {
        const { extractPdfText } = await import('../lib/pdfExtract');
        text = await extractPdfText(file);
        if (!text.trim()) throw new Error('Could not extract text from this PDF. It may be a scanned image — try a text-based PDF.');
      } else {
        try { text = await file.text(); } catch { text = `[Binary file: ${file.name}]`; }
      }
      if (!text.trim()) throw new Error('Could not read any text from this file.');
      const { data, error: dbErr } = await supabase
        .from('ai_global_knowledge')
        .insert({
          filename: file.name,
          content: text.slice(0, 80000),
          file_type: ext,
          created_by: session.user.id,
        })
        .select('id, filename, file_type, description, created_at')
        .single();
      if (dbErr) throw new Error(dbErr.message);
      setDocs(prev => [data, ...prev]);
      toast(`"${file.name}" added to knowledge base.`);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id, filename) => {
    if (!window.confirm(`Remove "${filename}" from the knowledge base?`)) return;
    setDocs(prev => prev.filter(d => d.id !== id));
    await supabase.from('ai_global_knowledge').delete().eq('id', id);
    toast('Document removed.');
  };

  const handleSaveDesc = async (id) => {
    await supabase.from('ai_global_knowledge').update({ description: editDesc }).eq('id', id);
    setDocs(prev => prev.map(d => d.id === id ? { ...d, description: editDesc } : d));
    setEditingId(null);
    toast('Description saved.');
  };

  return (
    <Card>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
            <Bot size={15} className="text-violet-500" /> AI Knowledge Base
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Documents here are available to the Job Assistant across every job — product catalogues, pricing guides, policies.
          </p>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 text-xs font-medium bg-violet-500 hover:bg-violet-400 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
        >
          {uploading ? <Loader size={12} className="animate-spin" /> : <Upload size={12} />}
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <input ref={fileRef} type="file" className="hidden"
          accept=".txt,.md,.csv,.json,.html,.xml,.pdf"
          onChange={handleFileChange} />
      </div>

      {uploadError && (
        <div className="px-5 py-2 bg-red-50 border-b border-red-100 text-xs text-red-600">{uploadError}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader size={16} className="animate-spin text-slate-400" />
        </div>
      ) : docs.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <Bot size={28} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm font-medium text-slate-600">No global documents yet</p>
          <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">Upload your product catalogue, pricing sheet, or any reference material you want every job assistant to know about.</p>
          <button onClick={() => fileRef.current?.click()}
            className="mt-3 text-xs text-violet-600 hover:underline font-medium">
            Upload your first document →
          </button>
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {docs.map(doc => (
            <div key={doc.id} className="px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="text-xl mt-0.5">{fileTypeIcon(doc.file_type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{doc.filename}</p>
                  {editingId === doc.id ? (
                    <div className="flex items-center gap-2 mt-1.5">
                      <input
                        autoFocus
                        value={editDesc}
                        onChange={e => setEditDesc(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveDesc(doc.id); if (e.key === 'Escape') setEditingId(null); }}
                        placeholder="Short description e.g. 'Product catalogue 2025'"
                        className="flex-1 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-400"
                      />
                      <button onClick={() => handleSaveDesc(doc.id)} className="text-xs text-violet-600 font-medium hover:underline">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingId(doc.id); setEditDesc(doc.description ?? ''); }}
                      className="text-xs text-slate-400 hover:text-slate-600 mt-0.5 text-left"
                    >
                      {doc.description ? doc.description : <span className="italic">Add a description…</span>}
                    </button>
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">
                    Added {doc.created_at ? new Date(doc.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(doc.id, doc.filename)}
                  className="text-slate-300 hover:text-red-400 transition-colors flex-shrink-0 p-1 rounded"
                  title="Remove">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
