import { useDataRefresh } from '../hooks/useDataRefresh';
import { useState, useEffect, Fragment } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Settings2, Plus, ChevronUp, ChevronDown, Edit3, Save, X, Check,
  ToggleLeft, ToggleRight, Tag, Upload, Library,
  ArrowRight, FileText, Cloud, CloudUpload, RefreshCw, CheckCircle2,
  AlertTriangle, Sun, Moon, Monitor, Clock, Wifi, WifiOff,
  Link2, Link2Off, ExternalLink, Building2, Loader, Bot, Trash2,
  MessageSquare, Database, Zap, ClipboardList, FileDown, Bell, BellOff, Smartphone,
  Calculator, RotateCcw,
} from 'lucide-react';
import { useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useTheme } from '../contexts/ThemeContext';
import { useProfile } from '../contexts/UserProfileContext';
import {
  getProductTypes, saveProductType, addProductType, reorderProductType,
  MS_SPEC_FIELDS, getTypeSpecKeys, getMsOptions,
  getMessagePresets, saveMessagePresets, DEFAULT_MESSAGE_PRESETS,
  getPoPresets, savePoPreset, deletePoPreset,
  MS_OPTION_FIELDS, getMsCustomOptions, addMsOption, deleteMsOption,
  getQuoteSettings, saveQuoteSettings,
  getBuzFabricCodes, saveBuzFabricCode, deleteBuzFabricCode,
  getBuzValueMap, setBuzValueMapEntry,
  getCurtainRates, saveCurtainRates, resetCurtainRates,
} from '../store/data';
import { BUZ_MAP_FIELDS } from '../lib/buzExport';
import { getPushStatus, enablePush, disablePush, sendTestPush, pushSupported, needsHomeScreenInstall,
         NOTIFICATION_GROUPS, getMutedTypes, setGroupMuted } from '../lib/push';
import { pushAllToSupabase, hydrateFromSupabase, flushPending } from '../store/db';
import Card from '../components/Card';
import { toast } from '../components/ToastContainer';
import {
  xeroGetConnection, xeroStartOAuth, xeroDisconnect,
  xeroSaveSettings, xeroInvoiceStatusBadge, xeroDismissErrors,
  xeroActivateOrganisation, xeroGetBrandingThemes,
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

  // One unified editor per type (name + specs + options). editingId tracks it.
  const openEdit  = (pt) => { setEditingId(pt.id); setEditName(pt.name); };
  const saveName  = (pt) => { const n = editName.trim(); if (n && n !== pt.name) saveProductType({ ...pt, name: n }); };
  const closeEdit = (pt) => { saveName(pt); setEditingId(null); refresh(); };

  const handleToggleActive = (pt) => {
    saveProductType({ ...pt, isActive: !pt.isActive });
    refresh();
  };

  const handleMove = (id, dir) => {
    reorderProductType(id, dir);
    refresh();
  };

  const handleToggleSpec = (pt, key) => {
    const current = getTypeSpecKeys(pt);
    const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key];
    saveProductType({ ...pt, specs: next });
    refresh();
  };
  const handleResetSpecs = (pt) => {
    saveProductType({ ...pt, specs: null }); // null → falls back to the built-in default set
    refresh();
  };

  // sorted is maintained by getProductTypes (sorts by sortOrder)
  const sorted = productTypes; // already sorted

  const { theme, setTheme, colorTheme, setColorTheme, animBg, setAnimBg, bgStyle, setBgStyle } = useTheme();

  const COLOR_OPTIONS = [
    { value: 'lusso',     label: 'Lusso',     desc: 'Brand kit — bronze on paper.', swatch: '#6E5A43' },
    { value: 'apex',      label: 'Apex',      desc: 'Emerald & charcoal — demo style.', swatch: '#009368' },
    { value: 'taupe',     label: 'Taupe',     desc: 'Warm taupe & cream.',   swatch: '#644a40' },
    { value: 'green',     label: 'Green',     desc: 'Forest green & cream.',  swatch: '#2e7d32' },
    { value: 'cyberpunk', label: 'Cyberpunk', desc: 'Neon magenta on indigo — always dark.', swatch: '#ff00c8' },
    { value: 'matrix',    label: 'Matrix',    desc: 'Phosphor green on black — always dark.', swatch: '#00ff41' },
    { value: 'mono',      label: 'Mono',      desc: 'Monochrome grayscale — always dark.',    swatch: '#a1a1aa' },
    { value: 'neon-magenta', label: 'Neon Magenta', desc: 'Hot magenta on pure black — always dark.', swatch: '#ff2e9f' },
    { value: 'twitter',   label: 'Twitter',   desc: 'Twitter blue — follows light/dark.', swatch: '#1d9bf2' },
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

  // Grouped by what the setting is FOR, not by which component implements it.
  // The old flat list of nine put pricing in three different places and left
  // "Data & AI" as a bucket for whatever didn't fit.
  const NAV_GROUPS = [
    { label: 'Business', items: [
      { id: 'general',      label: 'General',        icon: Sun,           desc: 'Appearance' },
      { id: 'quote',        label: 'Quote & Brand',  icon: FileText,      desc: 'Customer quote details' },
      { id: 'messages',     label: 'Messages',       icon: MessageSquare, desc: 'Email & SMS presets' },
    ]},
    { label: 'Catalogue', items: [
      { id: 'products',     label: 'Product Types',  icon: Tag,           desc: 'Types & their specs' },
      { id: 'measure',      label: 'Measure Sheet',  icon: ClipboardList, desc: 'Dropdown options' },
      { id: 'pricing',      label: 'Price Library',  icon: Library,       desc: 'Products & fabrics' },
      { id: 'curtains',     label: 'Curtain Rates',  icon: Calculator,    desc: 'Costing rate card' },
    ]},
    { label: 'Data', items: [
      { id: 'imports',      label: 'Imports',        icon: Upload,        desc: 'Price lists & more' },
      { id: 'exports',      label: 'Exports',        icon: FileDown,      desc: 'BUZ inventory codes' },
      { id: 'integrations', label: 'Integrations',   icon: Zap,           desc: 'Xero' },
    ]},
    { label: 'Advanced', items: [
      { id: 'advanced',     label: 'Sync & Data',    icon: Database,      desc: 'Diagnostics & AI' },
    ]},
  ];
  const NAV = NAV_GROUPS.flatMap(g => g.items);

  // ?section=<id> opens straight to a settings section, so a page that sends you
  // here (the track price importer) can land you on the thing it just changed
  // rather than on General.
  const [section, setSection] = useState(() => {
    const want = searchParams.get('section');
    return NAV.some(n => n.id === want) ? want : 'general';
  });

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
        <aside className="hidden sm:flex flex-col gap-4 w-48 flex-shrink-0 sticky top-6">
          {NAV_GROUPS.map(group => (
            <div key={group.label} className="flex flex-col gap-0.5">
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {group.label}
              </p>
              {group.items.map(({ id, label, icon: Icon, desc }) => (
                <button
                  key={id}
                  onClick={() => setSection(id)}
                  className={`flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-all ${
                    section === id
                      ? 'bg-amber-50 border border-amber-200 text-amber-700'
                      : 'text-slate-600 hover:bg-slate-100 border border-transparent'
                  }`}
                >
                  <Icon size={15} className={section === id ? 'text-amber-500' : 'text-slate-400'} />
                  <div className="min-w-0">
                    <p className={`text-sm font-medium leading-tight ${section === id ? 'text-amber-700' : 'text-slate-700'}`}>{label}</p>
                    <p className="text-[10px] text-slate-400 truncate">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
          ))}
        </aside>

        {/* ── Content area ── */}
        <div className="flex-1 min-w-0 space-y-5">

          {/* ── GENERAL ── */}
          {section === 'general' && (<>
            <PushNotificationsSection />

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
                <p className="text-xs text-slate-400 mt-0.5">Pick the accent palette. Lusso, Apex, Taupe & Green follow light/dark; Cyberpunk, Matrix & Mono are always dark.</p>
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

            {/* Animated background */}
            <Card>
              <div className="px-5 py-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                    <Sun size={14} className="text-amber-500" /> Animated background
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    A slow, subtle moving gradient behind every page, tinted to your colour theme. Off by default; respects reduced-motion.
                  </p>
                </div>
                <button
                  role="switch"
                  aria-checked={animBg}
                  onClick={() => setAnimBg(!animBg)}
                  className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors ${animBg ? 'bg-amber-500' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${animBg ? 'translate-x-5' : ''}`} />
                </button>
              </div>
              {animBg && (
                <div className="px-5 pb-4 pt-1 border-t border-slate-100">
                  <p className="text-xs font-medium text-slate-500 mb-2 mt-3">Style</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { value: 'mesh',   label: 'Mesh gradient', desc: 'Soft drifting colour fields.' },
                      { value: 'plasma', label: 'Plasma',        desc: 'Fluid, marbled swirl.' },
                    ].map(({ value, label, desc }) => {
                      const active = bgStyle === value;
                      return (
                        <button key={value} onClick={() => setBgStyle(value)}
                          className={`p-3 rounded-xl border-2 text-left transition-all ${
                            active ? 'border-amber-500 bg-amber-50/40' : 'border-slate-200 hover:border-slate-300'
                          }`}>
                          <p className={`text-sm font-semibold ${active ? 'text-amber-700' : 'text-slate-700'}`}>{label}</p>
                          <p className="text-xs text-slate-400 mt-0.5 leading-tight">{desc}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>

          </>)}

          {/* ── ADVANCED ── Sync diagnostics and the destructive resync live
               here rather than under General, where they sat one scroll below
               the theme picker. */}
          {section === 'advanced' && (<>
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
                    <p className="text-xs text-slate-500 mt-0.5">Pushes anything unsaved, then re-syncs from the cloud and reconciles — your local data is kept, not wiped.</p>
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
            {isCloud && <AIKnowledgeSection />}
          </>)}

          {/* ── QUOTE & BRAND ── */}
          {section === 'quote' && <QuoteDefaultsSection />}

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
          {/* ── PRICE LIBRARY ── signposts the real page, which is in the sidebar. */}
          {section === 'pricing' && (<>
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

          </>)}

          {/* ── PRODUCT TYPES ── */}
          {section === 'products' && (<>
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
                {sorted.map((pt, idx) => {
                  const specKeys = getTypeSpecKeys(pt);
                  const isCustomSpecs = Array.isArray(pt.specs);
                  const isEditing = editingId === pt.id;
                  return (
                  <div key={pt.id} className={isEditing ? 'bg-amber-50/40' : (!pt.isActive ? 'bg-slate-50/60' : '')}>
                    <div className="flex items-center gap-3 px-5 py-3">
                      <div className="flex flex-col gap-0.5 flex-shrink-0">
                        <button onClick={() => handleMove(pt.id, 'up')} disabled={idx === 0} className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors"><ChevronUp size={14} /></button>
                        <button onClick={() => handleMove(pt.id, 'down')} disabled={idx === sorted.length - 1} className="text-slate-300 hover:text-slate-500 disabled:opacity-20 transition-colors"><ChevronDown size={14} /></button>
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className={`text-sm font-medium ${pt.isActive ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{pt.name}</span>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {specKeys.length} spec{specKeys.length !== 1 ? 's' : ''} on the measure sheet
                        </p>
                      </div>
                      {/* Enable / disable — a status toggle, distinct from editing */}
                      <button onClick={() => handleToggleActive(pt)} title={pt.isActive ? 'Disable' : 'Enable'}
                        className={`flex-shrink-0 p-1 rounded transition-colors ${pt.isActive ? 'text-green-500 hover:text-red-400' : 'text-slate-300 hover:text-green-500'}`}>
                        {pt.isActive ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                      </button>
                      {/* ONE edit button — opens name + specs + options together */}
                      <button onClick={() => isEditing ? closeEdit(pt) : openEdit(pt)}
                        className={`flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                          isEditing ? 'bg-amber-500 text-white border-amber-500 hover:bg-amber-400' : 'border-slate-200 text-slate-600 hover:border-amber-400 hover:text-amber-600'
                        }`}>
                        {isEditing ? <><Check size={14} /> Done</> : <><Edit3 size={14} /> Edit</>}
                      </button>
                    </div>

                    {isEditing && (
                      <div className="px-5 pb-4 pl-16 space-y-3">
                        {/* Rename */}
                        <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Product type name</label>
                          <input autoFocus value={editName} onChange={e => setEditName(e.target.value)}
                            onBlur={() => saveName(pt)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); closeEdit(pt); } }}
                            className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                        </div>

                        {/* Specs shown + per-spec dropdown options */}
                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-xs font-medium text-slate-500">Specs shown on the measure sheet</p>
                            {isCustomSpecs && (
                              <button onClick={() => handleResetSpecs(pt)} className="text-xs text-slate-400 hover:text-amber-600 transition-colors">Reset to default</button>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {MS_SPEC_FIELDS.map(f => {
                              const on = specKeys.includes(f.key);
                              return (
                                <button key={f.key} onClick={() => handleToggleSpec(pt, f.key)}
                                  className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                                    on ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-500 border-slate-200 hover:border-amber-300'
                                  }`}>
                                  {f.label}
                                </button>
                              );
                            })}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-2">Width, drop, quantity, fabric and notes always show. A spec that already holds a value stays visible even if switched off.</p>
                          <TypeOptionEditor pt={pt} onChange={refresh} />
                        </div>

                        <p className="text-[11px] text-slate-400">Changes save automatically and sync to everyone on your team.</p>
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
              <div className="px-5 py-3 border-t border-slate-100">
                <p className="text-xs text-slate-400">Disabled types no longer appear in new measure sheets but are preserved on existing records.</p>
              </div>
            </Card>
          </>)}

          {/* ── MEASURE SHEET ── */}
          {section === 'measure' && <MeasureSheetOptionsSection />}

          {section === 'exports' && <BuzExportSection />}

          {section === 'curtains' && <CurtainRatesSection />}

          {/* ── DATA & AI ── */}
          {/* ── IMPORTS ── A signpost, not a second copy: every importer lives
               on the Import page in the sidebar, so there's one list to keep
               right rather than two that drift. */}
          {section === 'imports' && (
            <Card className="p-6">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                <Upload size={15} className="text-amber-500" /> Imports
              </h2>
              <p className="text-xs text-slate-500 mt-1 max-w-lg">
                Loading data in — supplier price lists, track prices, priced items, contacts,
                past quotes and measure sheets — is a job rather than a setting, so it has its
                own place in the sidebar.
              </p>
              <button
                onClick={() => navigate('/imports')}
                className="mt-4 flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-400"
              >
                <Upload size={13} /> Open Import
                <ArrowRight size={13} />
              </button>
            </Card>
          )}

        </div>
      </div>
    </div>
  );
}

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
                    className={`flex-shrink-0 ${localSettings.autoCreateInvoice ? 'text-green-500' : 'text-slate-300'}`}
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

// ─── Customer-facing quote defaults (business details, payment, testimonials) ──
// These populate the public quote page ([customer]/quotes/:id/preview). Values
// live in quote settings and fall back to DEFAULT_QUOTE_SETTINGS, so a customer
// on any device sees them even without local data.
function QuoteDefaultsSection() {
  const [s, setS] = useState(() => {
    const q = getQuoteSettings();
    return { ...q, paymentDetails: { ...(q.paymentDetails || {}) }, testimonials: [...(q.testimonials || [])] };
  });
  const [saved, setSaved] = useState(false);

  const set = (k, v) => { setS(prev => ({ ...prev, [k]: v })); setSaved(false); };
  const setPay = (k, v) => { setS(prev => ({ ...prev, paymentDetails: { ...prev.paymentDetails, [k]: v } })); setSaved(false); };
  const setTesti = (i, k, v) => setS(prev => {
    const t = [...prev.testimonials]; t[i] = { ...t[i], [k]: v }; return { ...prev, testimonials: t };
  });
  const addTesti = () => setS(prev => ({ ...prev, testimonials: [...prev.testimonials, { name: '', location: '', rating: 5, quote: '' }] }));
  const removeTesti = (i) => setS(prev => ({ ...prev, testimonials: prev.testimonials.filter((_, idx) => idx !== i) }));

  const save = () => {
    saveQuoteSettings({
      ...s,
      paymentDetails: { ...s.paymentDetails, amexSurchargePercent: Number(s.paymentDetails.amexSurchargePercent) || 0 },
      googleRating: Number(s.googleRating) || undefined,
      googleReviewCount: Number(s.googleReviewCount) || undefined,
    });
    setSaved(true);
    toast('Quote defaults saved');
  };

  const field = (label, k, placeholder) => (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <input value={s[k] ?? ''} onChange={e => set(k, e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
    </div>
  );

  return (
    <>
      <Card>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><Building2 size={15} className="text-amber-500" /> Business details</h2>
          <button onClick={save} className="flex items-center gap-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg transition-colors">
            {saved ? <><Check size={13} /> Saved</> : <><Save size={13} /> Save</>}
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-400">These appear in the FROM panel and footer of the customer-facing quote — and they are what a customer sees on their own phone, where the app has no other copy of them. Anything left blank here falls back to the built-in defaults.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {field('Business name', 'businessName', 'Lusso Fashion for Windows')}
            {field('ABN', 'businessABN', '72 388 582 539')}
            {field('Phone', 'businessPhone', '07 5528 4006')}
            {field('Text / SMS number (optional)', 'businessPhoneSms', '0485 075 111')}
            {field('Email', 'businessEmail', 'jobs@lusso.com.au')}
            {field('Website', 'businessWebsite', 'www.lusso.com.au')}
            {field('Postal address', 'businessAddress', '3 Crinum Crescent, Southport QLD 4215')}
          </div>
        </div>
      </Card>

      <Card>
        <div className="px-5 py-4 border-b border-slate-100"><h2 className="font-semibold text-slate-800 text-sm">Order & payment</h2></div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">"To place your order" text</label>
            <textarea value={s.orderTerms ?? ''} onChange={e => set('orderTerms', e.target.value)} rows={3}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">"Terms of trade" card</label>
            <textarea value={s.termsOfTrade ?? ''} onChange={e => set('termsOfTrade', e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
            <p className="text-[11px] text-slate-400 mt-1">Shown beside the payment details. The deposit sentence is added automatically from the quote&rsquo;s own deposit terms — keep this to what happens after the deposit, and make sure it agrees with your T&amp;Cs.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Account name</label>
              <input value={s.paymentDetails.accountName ?? ''} onChange={e => setPay('accountName', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">BSB</label>
              <input value={s.paymentDetails.bsb ?? ''} onChange={e => setPay('bsb', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Account number</label>
              <input value={s.paymentDetails.accountNumber ?? ''} onChange={e => setPay('accountNumber', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Credit-card note</label>
              <input value={s.paymentDetails.creditCardNote ?? ''} onChange={e => setPay('creditCardNote', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Amex surcharge %</label>
              <input type="number" value={s.paymentDetails.amexSurchargePercent ?? ''} onChange={e => setPay('amexSurchargePercent', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">T&C attachment URL (optional)</label>
              <input value={s.termsAttachmentUrl ?? ''} onChange={e => set('termsAttachmentUrl', e.target.value)} placeholder="https://…"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Attachment link label</label>
              <input value={s.termsAttachmentLabel ?? ''} onChange={e => set('termsAttachmentLabel', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800 text-sm">Reviews & testimonials</h2>
          <button onClick={addTesti} className="flex items-center gap-1 text-xs font-medium text-amber-600 hover:text-amber-700"><Plus size={13} /> Add</button>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Google rating</label>
              <input type="number" step="0.1" value={s.googleRating ?? ''} onChange={e => set('googleRating', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Review count</label>
              <input type="number" value={s.googleReviewCount ?? ''} onChange={e => set('googleReviewCount', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Write-a-review URL</label>
              <input value={s.googleReviewUrl ?? ''} onChange={e => set('googleReviewUrl', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <p className="text-[11px] text-slate-400 mt-1">Where review requests send people to leave a rating.</p>
            </div>
            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-slate-500 mb-1">Read-reviews URL (optional)</label>
              <input value={s.googleReviewsUrl ?? ''} onChange={e => set('googleReviewsUrl', e.target.value)} placeholder="Leave blank to derive it from the write-a-review link"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <p className="text-[11px] text-slate-400 mt-1">Where the quote&rsquo;s &ldquo;See all reviews&rdquo; link goes. This used to point at the write-a-review form, so a customer wanting to read reviews was asked to leave one.</p>
            </div>
          </div>
          {(s.testimonials || []).map((t, i) => (
            <div key={i} className="rounded-xl border border-slate-200 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input value={t.name ?? ''} onChange={e => setTesti(i, 'name', e.target.value)} placeholder="Customer name"
                  className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                <input value={t.location ?? ''} onChange={e => setTesti(i, 'location', e.target.value)} placeholder="Suburb"
                  className="w-28 px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                <input type="number" min="1" max="5" value={t.rating ?? 5} onChange={e => setTesti(i, 'rating', Number(e.target.value))}
                  className="w-16 px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                <button onClick={() => removeTesti(i)} className="text-slate-400 hover:text-red-500 p-1"><Trash2 size={15} /></button>
              </div>
              <textarea value={t.quote ?? ''} onChange={e => setTesti(i, 'quote', e.target.value)} placeholder="Their review…" rows={2}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
            </div>
          ))}
          <button onClick={save} className="flex items-center gap-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 rounded-lg transition-colors">
            {saved ? <><Check size={13} /> Saved</> : <><Save size={13} /> Save quote defaults</>}
          </button>
        </div>
      </Card>
    </>
  );
}

// ─── Per-product-type dropdown options ────────────────────────────────────────
// Lets each product type override a spec field's option list (e.g. a Roller
// Blind's Operation Types differ from a Curtain's). Shown inside the type's spec
// panel; only the dropdown specs the type actually uses are listed.
function TypeOptionEditor({ pt, onChange }) {
  const [openField, setOpenField] = useState(null);
  const [draft, setDraft] = useState('');

  const specKeys = getTypeSpecKeys(pt);
  const fields = MS_SPEC_FIELDS.filter(f => f.optionKey && specKeys.includes(f.key));
  if (fields.length === 0) return null;

  const save = (optionKey, list) => {
    const options = { ...(pt.options || {}) };
    if (list == null) delete options[optionKey]; // reset → fall back to the global default
    else options[optionKey] = list;
    saveProductType({ ...pt, options });
    onChange();
  };
  const addOpt = (f) => {
    const v = draft.trim();
    if (!v) return;
    const cur = getMsOptions(f.optionKey, pt);
    if (!cur.some(o => String(o).toLowerCase() === v.toLowerCase())) save(f.optionKey, [...cur, v]);
    setDraft('');
  };
  const removeOpt = (f, val) => save(f.optionKey, getMsOptions(f.optionKey, pt).filter(o => o !== val));

  return (
    <div className="mt-3 border-t border-slate-200 pt-3">
      <p className="text-xs font-medium text-slate-500 mb-2">Dropdown options for {pt.name}</p>
      <div className="space-y-1.5">
        {fields.map(f => {
          const opts = getMsOptions(f.optionKey, pt);
          const isCustom = Array.isArray(pt.options?.[f.optionKey]);
          const open = openField === f.optionKey;
          return (
            <div key={f.key} className="rounded-lg border border-slate-200 bg-white overflow-hidden">
              <button type="button" onClick={() => { setOpenField(open ? null : f.optionKey); setDraft(''); }}
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50">
                <span className="text-xs font-medium text-slate-600">{f.label}</span>
                <span className="text-[11px] text-slate-400">{opts.length} option{opts.length !== 1 ? 's' : ''}{isCustom ? ' · custom' : ''}</span>
              </button>
              {open && (
                <div className="px-3 pb-3 pt-1 bg-slate-50/50">
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {opts.map(o => (
                      <span key={o} className="inline-flex items-center gap-1 text-xs bg-white border border-slate-200 text-slate-600 rounded-full pl-2.5 pr-1 py-1">
                        {o}
                        <button type="button" onClick={() => removeOpt(f, o)} className="text-slate-300 hover:text-red-500"><X size={11} /></button>
                      </span>
                    ))}
                    {opts.length === 0 && <span className="text-xs text-slate-400 italic">No options — add one below.</span>}
                  </div>
                  <div className="flex gap-1.5 items-center">
                    <input value={draft} onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOpt(f); } }}
                      placeholder={`Add ${f.label.toLowerCase()} option…`}
                      className="flex-1 border border-slate-200 rounded-lg text-xs px-2.5 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    <button type="button" onClick={() => addOpt(f)} className="text-xs font-medium px-2.5 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-400">Add</button>
                    {isCustom && <button type="button" onClick={() => save(f.optionKey, null)} className="text-xs text-slate-400 hover:text-amber-600 px-1 whitespace-nowrap">Reset</button>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
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

// ─── Curtain Rates ────────────────────────────────────────────────────────────
// The rate card behind the curtain cost calculator (lib/curtainCalc.js) — the
// numbers that used to live scattered through the Excel workbook's formulas.
//
// Only edited fields are stored; everything else falls through to the defaults,
// so "Reset" is just clearing the row.

function RateNum({ label, value, onChange, prefix, suffix, hint, step = 'any' }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">{prefix}</span>}
        <input
          type="number" step={step} value={value ?? ''}
          onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className={`w-full border border-slate-200 rounded-lg py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${prefix ? 'pl-6' : 'pl-3'} ${suffix ? 'pr-10' : 'pr-3'}`}
        />
        {suffix && <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-slate-400">{suffix}</span>}
      </div>
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function CurtainRatesSection() {
  useDataRefresh();
  const navigate = useNavigate();
  const [rates, setRates] = useState(() => getCurtainRates());
  const [dirty, setDirty] = useState(false);

  // Nested setter: path is a dot path into the rate card.
  const put = (path, value) => {
    setRates(prev => {
      const next = structuredClone(prev);
      const keys = path.split('.');
      let node = next;
      for (const k of keys.slice(0, -1)) node = node[k];
      node[keys.at(-1)] = value;
      return next;
    });
    setDirty(true);
  };

  const save = () => {
    saveCurtainRates(rates);
    setDirty(false);
    toast('Curtain rates saved.');
  };

  const reset = () => {
    setRates(resetCurtainRates());
    setDirty(false);
    toast('Curtain rates reset to defaults.');
  };

  const headings = Object.keys(rates.fullness);
  const tracks   = Object.keys(rates.trackRatePerM);
  const osloCols = Object.keys(rates.oslo.prices);
  // Each track can carry its own bands — a recess track is sold 1–6m in half
  // metres, a battery track stops at 8m. The grid is the union of every band in
  // use, and a track with no price at a band shows blank rather than the next
  // value along, which would misrepresent it on screen.
  const osloWidthsFor = (col) =>
    rates.oslo.prices[col]?.widthsMm?.length ? rates.oslo.prices[col].widthsMm : rates.oslo.widthsMm;
  const osloRows = [...new Set(osloCols.flatMap(osloWidthsFor))].sort((a, b) => a - b);
  const osloIdx  = (col, width) => osloWidthsFor(col).indexOf(width);

  return (
    <div className="space-y-6">
      <Card className="p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
              <Calculator size={15} className="text-amber-500" /> Curtain Costing Rates
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              What the curtain calculator charges. These are <span className="font-medium">cost</span> rates —
              the sell price still comes from each quote line&apos;s margin. Shared with everyone on the team,
              and never shown on a customer&apos;s quote page.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={reset}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-3 py-2">
              <RotateCcw size={13} /> Reset
            </button>
            <button onClick={save} disabled={!dirty}
              className={`flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-2 ${
                dirty ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>
              <Save size={13} /> Save
            </button>
          </div>
        </div>

        {/* Fullness */}
        <h3 className="text-xs font-semibold text-slate-700 mb-2">Fullness by heading</h3>
        <p className="text-[11px] text-slate-400 mb-3">
          The width is multiplied by this before being divided into drops. Matched regardless of capitalisation.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {headings.map(h => (
            <RateNum key={h} label={h} value={rates.fullness[h]} suffix="×"
              onChange={v => put(`fullness.${h}`, v)} />
          ))}
        </div>

        {/* Fabric + making */}
        <h3 className="text-xs font-semibold text-slate-700 mb-2">Fabric &amp; making</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <RateNum label="Default fabric roll width" value={rates.fabricWidthMm} suffix="mm"
            onChange={v => put('fabricWidthMm', v)}
            hint="A drop that fits inside this is railroaded (continuous)." />
          <RateNum label="Default fabric price" value={rates.fabricPricePerM} prefix="$" suffix="/m"
            onChange={v => put('fabricPricePerM', v)}
            hint="Used when a quote line doesn't specify one." />
          <RateNum label="Side / return allowance" value={rates.sideAllowanceM} suffix="m"
            onChange={v => put('sideAllowanceM', v)}
            hint="Added to every fullness calculation." />
          <RateNum label="Hem allowance" value={rates.hemAllowanceMm} suffix="mm"
            onChange={v => put('hemAllowanceMm', v)}
            hint="Added to the drop for a cut length." />
          <RateNum label="Making rate" value={rates.makingRatePerDrop} prefix="$" suffix="/drop"
            onChange={v => put('makingRatePerDrop', v)} />
          <RateNum label="Standard drop width" value={rates.makingDropWidthM} suffix="m"
            onChange={v => put('makingDropWidthM', v)}
            hint="Total fullness ÷ this = drops charged for making." />
        </div>

        {/* Lining */}
        <h3 className="text-xs font-semibold text-slate-700 mb-2">Attached lining</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <RateNum label="Lining price" value={rates.lining.pricePerM} prefix="$" suffix="/m"
            onChange={v => put('lining.pricePerM', v)} />
          <RateNum label="Lining roll width" value={rates.lining.fabricWidthMm} suffix="mm"
            onChange={v => put('lining.fabricWidthMm', v)} />
          <RateNum label="Lining making rate" value={rates.lining.makingRatePerDrop} prefix="$" suffix="/drop"
            onChange={v => put('lining.makingRatePerDrop', v)} />
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Lining fullness</label>
            <select
              value={rates.lining.followCurtain ? '__follow' : rates.lining.heading}
              onChange={e => {
                if (e.target.value === '__follow') put('lining.followCurtain', true);
                else { put('lining.followCurtain', false); put('lining.heading', e.target.value); }
              }}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
              <option value="__follow">Match the curtain&apos;s heading</option>
              {headings.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">The spreadsheet always used Gathered.</p>
          </div>
        </div>

        {/* Fitting */}
        <h3 className="text-xs font-semibold text-slate-700 mb-2">Fitting</h3>
        <p className="text-[11px] text-slate-400 mb-3">
          Charged on the width band, plus a surcharge for tall drops. Doubled for dual tracks
          ({rates.fitting.dualTrackTypes.join(', ')}).
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3">
          {rates.fitting.bands.map((b, i) => (
            <RateNum key={i} label={`Up to ${b.maxWidthMm}mm`} value={b.cost} prefix="$"
              onChange={v => put('fitting.bands', rates.fitting.bands.map((x, j) => j === i ? { ...x, cost: v } : x))} />
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <RateNum label={`Over ${rates.fitting.over.fromMm}mm — base`} value={rates.fitting.over.base} prefix="$"
            onChange={v => put('fitting.over.base', v)} />
          <RateNum label="…plus, per extra metre" value={rates.fitting.over.step} prefix="$"
            onChange={v => put('fitting.over.step', v)}
            hint="Whole metres only, rounded down." />
          <RateNum label="Tall-drop surcharge over" value={rates.fitting.dropSurcharge.overMm} suffix="mm"
            onChange={v => put('fitting.dropSurcharge.overMm', v)} />
          <RateNum label="…per extra metre of drop" value={rates.fitting.dropSurcharge.amount} prefix="$"
            onChange={v => put('fitting.dropSurcharge.amount', v)}
            hint="Whole metres only, rounded down." />
        </div>

        {/* Tracks priced per metre */}
        <h3 className="text-xs font-semibold text-slate-700 mb-2">Tracks priced per metre</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {tracks.map(t => (
            <RateNum key={t} label={t} value={rates.trackRatePerM[t]} prefix="$" suffix="/m"
              onChange={v => put(`trackRatePerM.${t}`, v)} />
          ))}
        </div>
      </Card>

      {/* Oslo band table */}
      <Card className="p-5">
        <div className="mb-4">
          <h2 className="font-semibold text-slate-800 text-sm">Oslo track price bands</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Motorised and Oslo tracks are priced by band, not per metre — the first band at or above the
            curtain width is the one charged. A Wave Fold heading takes the Clear Wave column.
            Widths past the last band aren&apos;t priced, and the calculator says so rather than guessing.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left font-medium text-slate-500 px-2 py-2 sticky left-0 bg-white">Width</th>
                {osloCols.map(c => (
                  <th key={c} colSpan={2} className="text-center font-medium text-slate-600 px-2 py-2 border-l border-slate-100">{c}</th>
                ))}
              </tr>
              <tr className="border-b border-slate-200">
                <th className="sticky left-0 bg-white" />
                {osloCols.map(c => (
                  <Fragment key={c}>
                    <th className="text-center font-normal text-slate-400 px-2 py-1 border-l border-slate-100">Standard</th>
                    <th className="text-center font-normal text-slate-400 px-2 py-1">Clear Wave</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {osloRows.map(w => (
                <tr key={w} className="border-b border-slate-50">
                  <td className="px-2 py-1 text-slate-600 font-medium sticky left-0 bg-white whitespace-nowrap">≤ {w}mm</td>
                  {osloCols.map(c => {
                    const bi = osloIdx(c, w);
                    const cell = (key) => bi < 0
                      ? <span className="block w-20 text-center text-xs text-slate-300">—</span>
                      : (
                        <input type="number" step="any" value={rates.oslo.prices[c][key][bi] ?? ''}
                          onChange={e => put(`oslo.prices.${c}.${key}`,
                            rates.oslo.prices[c][key].map((x, j) => j === bi ? Number(e.target.value) : x))}
                          className="w-20 border border-slate-200 rounded px-1.5 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-amber-400" />
                      );
                    return (
                      <Fragment key={c}>
                        <td className="px-1 py-1 border-l border-slate-100">{cell('standard')}</td>
                        <td className="px-1 py-1">{cell('clearWave')}</td>
                      </Fragment>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <button
            onClick={() => navigate('/curtain-rates/import')}
            className="flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-2 border border-teal-200 bg-teal-50 text-teal-700 hover:bg-teal-100"
          >
            <Upload size={13} /> Update from a supplier price book
          </button>
          <button onClick={save} disabled={!dirty}
            className={`flex items-center gap-1.5 text-xs font-semibold rounded-lg px-3 py-2 ${
              dirty ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>
            <Save size={13} /> Save
          </button>
        </div>
      </Card>
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
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <FileDown size={15} className="text-amber-500" /> BUZ Export — Fabric Codes
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          When you export a roller-blind measure sheet to BUZ, each blind needs a BUZ <span className="font-medium">INVENTORY CODE</span>.
          Map your fabric ranges to their BUZ codes here. A blind's fabric is matched by name (the longest matching range wins);
          any fabric with no match is left blank in the file for you to complete. Stored on this device only.
        </p>
      </div>

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
                  <button type="button" onClick={() => setEditId(null)} title="Cancel" className="text-slate-400 hover:text-slate-600 p-1"><X size={15} /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-0 text-sm text-slate-700 truncate">{e.range}</span>
                  <span className="flex-1 min-w-0 text-sm font-mono text-amber-700 truncate">{e.code}</span>
                  <button type="button" onClick={() => startEdit(e)} title="Edit" className="text-slate-400 hover:text-slate-600 p-1"><Edit3 size={14} /></button>
                  <button type="button" onClick={() => { deleteBuzFabricCode(e.id); toast('Fabric code removed.', 'info'); }}
                    title="Remove" className="text-slate-400 hover:text-red-500 p-1"><Trash2 size={14} /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
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
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <FileDown size={15} className="text-amber-500" /> BUZ Export — Value Translations
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Map each Lusso option to the exact BUZ dropdown wording for these columns. Leave a row blank to use the
          built-in default (shown as the faint placeholder) or, where there's no default, to pass the Lusso value
          through unchanged. Changes apply to the next export.
        </p>
      </div>
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
  const [dragOver, setDragOver]       = useState(false);
  const fileRef = useRef(null);

  const ACCEPT_EXTS = ['txt', 'md', 'csv', 'json', 'html', 'xml', 'pdf'];

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

  // Upload a single file (extract text → insert row). Throws on failure.
  const uploadOne = async (file) => {
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
  };

  // Handle one or more files (from the picker OR a drag-drop), sequentially.
  const uploadFiles = async (fileList) => {
    if (!session) return;
    const files = [...(fileList || [])];
    const accepted = files.filter(f => ACCEPT_EXTS.includes(f.name.split('.').pop().toLowerCase()));
    const rejected = files.length - accepted.length;
    if (!accepted.length) {
      setUploadError('Unsupported file type. Use PDF, TXT, MD, CSV, JSON, HTML or XML.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    let ok = 0;
    const errors = [];
    for (const file of accepted) {
      try { await uploadOne(file); ok++; }
      catch (err) { errors.push(`"${file.name}": ${err.message}`); }
    }
    setUploading(false);
    if (errors.length) setUploadError(errors.join(' · '));
    if (ok) toast(ok === 1 ? 'Added to knowledge base.' : `${ok} documents added to knowledge base.`);
    if (rejected && !errors.length) setUploadError(`${rejected} file${rejected !== 1 ? 's' : ''} skipped (unsupported type).`);
  };

  const handleFileChange = async (e) => {
    const files = e.target.files;
    if (files?.length) await uploadFiles(files);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (uploading) return;
    const files = e.dataTransfer?.files;
    if (files?.length) uploadFiles(files);
  };
  const handleDragOver = (e) => { e.preventDefault(); if (!dragOver) setDragOver(true); };
  const handleDragLeave = (e) => { if (e.currentTarget.contains(e.relatedTarget)) return; setDragOver(false); };

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
    <div className="relative"
      onDragEnter={handleDragOver} onDragOver={handleDragOver}
      onDragLeave={handleDragLeave} onDrop={handleDrop}>
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
        <input ref={fileRef} type="file" multiple className="hidden"
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
        <div className="px-5 py-8">
          <button type="button" onClick={() => fileRef.current?.click()}
            className="w-full flex flex-col items-center text-center rounded-xl border-2 border-dashed border-slate-200 hover:border-violet-300 hover:bg-violet-50/40 transition-colors py-8 px-4">
            <Upload size={26} className="mb-3 text-slate-300" />
            <p className="text-sm font-medium text-slate-600">Drag &amp; drop files here, or click to browse</p>
            <p className="text-xs text-slate-400 mt-1 max-w-xs">Your product catalogue, pricing sheet, or any reference material every job assistant should know about.</p>
            <p className="text-[11px] text-slate-300 mt-2">PDF, TXT, MD, CSV, JSON, HTML, XML</p>
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

    {/* Drag-over overlay — covers the whole card while a file is being dragged in */}
    {dragOver && (
      <div className="absolute inset-0 z-10 rounded-xl border-2 border-dashed border-violet-400 bg-violet-50/90 backdrop-blur-[1px] flex flex-col items-center justify-center pointer-events-none">
        <Upload size={30} className="text-violet-500 mb-2" />
        <p className="text-sm font-semibold text-violet-700">Drop to add to the knowledge base</p>
        <p className="text-xs text-violet-500 mt-0.5">PDF, TXT, MD, CSV, JSON, HTML, XML</p>
      </div>
    )}
    </div>
  );
}


// ── Push notifications ────────────────────────────────────────────────────────
// One switch per device: this browser subscribes with its own push endpoint, and
// every row that lands in `notifications` (quote opened/accepted/declined,
// installer responses, customer replies, tasks) is pushed to it by the
// `push-send` edge function.
function PushNotificationsSection() {
  const [status, setStatus]   = useState({ supported: true, permission: 'default', subscribed: false });
  const [devices, setDevices] = useState([]);
  const [muted, setMuted]     = useState(new Set());
  const [busy, setBusy]       = useState(false);

  const refresh = async () => {
    setStatus(await getPushStatus());
    setMuted(await getMutedTypes());
    if (supabase) {
      const { data } = await supabase
        .from('push_subscriptions')
        .select('id, label, user_agent, created_at, last_success_at')
        .order('created_at', { ascending: false });
      setDevices(data || []);
    }
  };

  useEffect(() => { refresh(); }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      if (status.subscribed) {
        await disablePush();
        toast('Notifications turned off on this device.');
      } else {
        await enablePush();
        toast('Notifications on — this device will now be alerted.');
      }
      await refresh();
    } catch (e) {
      toast(e.message || 'Could not change notification settings.', 'error', { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      const res = await sendTestPush();
      toast(`Test sent to ${res.sent} device${res.sent === 1 ? '' : 's'} — check your lock screen.`);
    } catch (e) {
      toast(e.message || 'Test failed.', 'error', { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  const toggleGroup = async (group) => {
    const isOn = !group.types.every(t => muted.has(t));
    const prev = muted;
    // Optimistic: the switch should move under your finger, not after a round trip.
    const optimistic = new Set(prev);
    group.types.forEach(t => (isOn ? optimistic.add(t) : optimistic.delete(t)));
    setMuted(optimistic);
    try {
      setMuted(await setGroupMuted(group, isOn, prev));
    } catch (e) {
      setMuted(prev);
      toast(e.message || 'Could not save that preference.', 'error');
    }
  };

  const forget = async (id) => {
    await supabase.from('push_subscriptions').delete().eq('id', id);
    await refresh();
    toast('Device removed.');
  };

  const blocked   = status.permission === 'denied';
  const needsHome = pushSupported() && needsHomeScreenInstall();

  return (
    <Card>
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <Bell size={14} className="text-amber-500" /> Notifications
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Get a push on your phone or desktop when a quote is opened or accepted, an installer responds,
          a customer replies, or a task falls due — even when Lusso is closed.
        </p>
      </div>

      <div className="p-4 space-y-3">
        {!pushSupported() ? (
          <p className="text-xs text-slate-500">This browser doesn’t support push notifications.</p>
        ) : (<>
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-700">
                {status.subscribed ? 'On for this device' : 'Off for this device'}
              </p>
              <p className="text-xs text-slate-400 mt-0.5">
                {blocked
                  ? 'Blocked in your browser settings — allow notifications for Lusso, then switch this on.'
                  : needsHome
                    ? 'On iPhone, add Lusso to your Home Screen first (Share → Add to Home Screen), then open it from there.'
                    : 'Each device you use needs its own switch.'}
              </p>
            </div>
            <button
              role="switch"
              aria-checked={status.subscribed}
              disabled={busy || blocked || (needsHome && !status.subscribed)}
              onClick={toggle}
              className={`relative flex-shrink-0 w-11 h-6 rounded-full transition-colors disabled:opacity-40 ${status.subscribed ? 'bg-amber-500' : 'bg-slate-300'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${status.subscribed ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>

          {status.subscribed && (
            <button onClick={test} disabled={busy}
              className="text-xs font-medium px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:border-slate-300 disabled:opacity-40">
              Send a test notification
            </button>
          )}

          <div className="pt-3 border-t border-slate-100">
            <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold mb-1">
              What you’re notified about
            </p>
            <p className="text-[11px] text-slate-400 mb-2 leading-snug">
              Switching one off silences the push on every one of your devices — it still appears in the bell.
            </p>
            {NOTIFICATION_GROUPS.map((g) => {
              const on = !g.types.every(t => muted.has(t));
              return (
                <div key={g.key} className="flex items-center gap-3 py-1.5">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-700">{g.label}</p>
                    <p className="text-[11px] text-slate-400 leading-tight">{g.desc}</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={on}
                    aria-label={g.label}
                    onClick={() => toggleGroup(g)}
                    className={`relative flex-shrink-0 w-9 h-5 rounded-full transition-colors ${on ? 'bg-amber-500' : 'bg-slate-300'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                </div>
              );
            })}
          </div>

          {devices.length > 0 && (
            <div className="pt-2 border-t border-slate-100 space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Subscribed devices</p>
              {devices.map(d => (
                <div key={d.id} className="flex items-center gap-2 text-xs text-slate-600 py-1">
                  <Smartphone size={13} className="text-slate-400 flex-shrink-0" />
                  <span className="truncate flex-1">{d.label || d.user_agent?.slice(0, 40) || 'Device'}</span>
                  <span className="text-slate-400 flex-shrink-0">
                    {d.last_success_at ? `last alert ${new Date(d.last_success_at).toLocaleDateString()}` : 'no alerts yet'}
                  </span>
                  <button onClick={() => forget(d.id)} className="p-1 text-slate-400 hover:text-red-500 flex-shrink-0" title="Remove">
                    <BellOff size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>)}
      </div>
    </Card>
  );
}
