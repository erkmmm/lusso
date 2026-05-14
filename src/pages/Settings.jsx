import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Settings2, Plus, ChevronUp, ChevronDown, Edit3, Save, X,
  ToggleLeft, ToggleRight, Tag, Upload, Users, Library, History,
  ArrowRight, FileText, Cloud, CloudUpload, RefreshCw, CheckCircle2,
  AlertTriangle, Sun, Moon, Monitor, Clock, Wifi, WifiOff,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useTheme } from '../contexts/ThemeContext';
import {
  getProductTypes, saveProductType, addProductType, reorderProductType,
  getImportBatches, getPricedItemBatches,
} from '../store/data';
import { pushAllToSupabase, hydrateFromSupabase } from '../store/db';
import Card from '../components/Card';

export default function Settings() {
  const navigate = useNavigate();
  const [productTypes, setProductTypes] = useState(getProductTypes);
  const [adding, setAdding]             = useState(false);
  const [newName, setNewName]           = useState('');
  const [editingId, setEditingId]       = useState(null);
  const [editName, setEditName]         = useState('');
  const [syncStatus, setSyncStatus]     = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isCloud = Boolean(supabase);

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

  const { theme, setTheme } = useTheme();

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
    setSyncStatus({ ok: true, msg: 'Data pulled from cloud. Refresh the page to see updates.' });
    setTimeout(() => setSyncStatus(null), 5000);
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Settings2 size={22} className="text-amber-500" /> Settings
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">Platform configuration and admin controls</p>
      </div>

      {/* Appearance Card */}
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
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 text-center transition-all ${
                  active
                    ? 'border-amber-500 bg-amber-50/40'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${active ? 'bg-amber-100' : 'bg-slate-100'}`}>
                  <Icon size={20} className={active ? 'text-amber-600' : color} />
                </div>
                <div>
                  <p className={`text-sm font-semibold ${active ? 'text-amber-700' : 'text-slate-700'}`}>{label}</p>
                  <p className="text-xs text-slate-400 mt-0.5 leading-tight">{desc}</p>
                </div>
                {active && (
                  <span className="text-[10px] font-semibold bg-amber-500 text-white px-2 py-0.5 rounded-full">Active</span>
                )}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Cloud Sync status */}
      <Card>
        <div className="px-5 py-4 flex items-center gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${isCloud ? 'bg-green-50' : 'bg-slate-100'}`}>
            {isCloud
              ? <Wifi size={18} className="text-green-600" />
              : <WifiOff size={18} className="text-slate-400" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-slate-800">
              {isCloud ? 'Live cloud sync active' : 'Offline mode'}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {isCloud
                ? 'Changes save instantly and appear on all devices automatically.'
                : 'No Supabase connection — data is stored locally on this device only.'}
            </p>
          </div>
          {isCloud && <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse flex-shrink-0" />}
        </div>

        {/* Advanced diagnostics — collapsed by default */}
        {isCloud && (
          <div className="border-t border-slate-100">
            <button
              onClick={() => setShowAdvanced(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3 text-xs text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <span>Advanced diagnostics</span>
              {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            </button>

            {showAdvanced && (
              <div className="border-t border-slate-50">
                <p className="px-5 pt-3 pb-1 text-xs text-slate-400">
                  Use these only if data looks wrong or out of sync. Normal usage does not require them.
                </p>
                <div className="divide-y divide-slate-50">
                  <button
                    onClick={handlePush}
                    disabled={syncStatus === 'pushing' || syncStatus === 'pulling'}
                    className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors text-left disabled:opacity-60"
                  >
                    <CloudUpload size={15} className="text-teal-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700">Force push to cloud</p>
                      <p className="text-xs text-slate-400">Overwrite cloud with this device's data.</p>
                    </div>
                    {syncStatus === 'pushing' && <RefreshCw size={14} className="text-slate-400 animate-spin flex-shrink-0" />}
                  </button>
                  <button
                    onClick={handlePull}
                    disabled={syncStatus === 'pushing' || syncStatus === 'pulling'}
                    className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors text-left disabled:opacity-60"
                  >
                    <RefreshCw size={15} className="text-blue-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-700">Force pull from cloud</p>
                      <p className="text-xs text-slate-400">Replace this device's data with the cloud copy.</p>
                    </div>
                    {syncStatus === 'pulling' && <RefreshCw size={14} className="text-slate-400 animate-spin flex-shrink-0" />}
                  </button>
                </div>
                {syncStatus && typeof syncStatus === 'object' && (
                  <div className={`mx-5 mb-4 mt-2 flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs ${
                    syncStatus.ok ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-red-50 border border-red-200 text-red-700'
                  }`}>
                    {syncStatus.ok
                      ? <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" />
                      : <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />}
                    {syncStatus.msg}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Price Library Card */}
      <Card>
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
            <Library size={14} className="text-amber-500" /> Price Library
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage reusable priced items that can be added to any quote.
          </p>
        </div>
        <button
          onClick={() => navigate('/priced-items')}
          className="w-full flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors text-left group"
        >
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

      {/* Imports Card */}
      <ImportsSection navigate={navigate} />

      {/* Product Types Card */}
      <Card>
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
              <Tag size={14} className="text-amber-500" /> Product Types
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Used in measure sheet product dropdowns. Reorder, rename, or disable without losing history.
            </p>
          </div>
          <button
            onClick={() => { setAdding(true); setNewName(''); }}
            className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            <Plus size={13} /> Add
          </button>
        </div>

        {/* Add new form */}
        {adding && (
          <div className="px-5 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-2">
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); if (e.key === 'Escape') setAdding(false); }}
              placeholder="New product type name…"
              className="flex-1 border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
            />
            <button onClick={handleAdd} className="bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors">
              <Save size={14} />
            </button>
            <button onClick={() => setAdding(false)} className="text-slate-400 hover:text-slate-600 px-2 py-2">
              <X size={14} />
            </button>
          </div>
        )}

        {/* Product type list */}
        <div className="divide-y divide-slate-50">
          {sorted.map((pt, idx) => (
            <div
              key={pt.id}
              className={`flex items-center gap-3 px-5 py-3 ${!pt.isActive ? 'bg-slate-50/60' : ''}`}
            >
              {/* Reorder buttons */}
              <div className="flex flex-col gap-0.5 flex-shrink-0">
                <button
                  onClick={() => handleMove(pt.id, 'up')}
                  disabled={idx === 0}
                  className="text-slate-300 hover:text-slate-500 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  onClick={() => handleMove(pt.id, 'down')}
                  disabled={idx === sorted.length - 1}
                  className="text-slate-300 hover:text-slate-500 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronDown size={14} />
                </button>
              </div>

              {/* Sort order badge */}
              <span className="w-6 text-center text-xs text-slate-300 flex-shrink-0">{pt.sortOrder}</span>

              {/* Name / edit */}
              {editingId === pt.id ? (
                <input
                  autoFocus
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(pt); if (e.key === 'Escape') setEditingId(null); }}
                  className="flex-1 border border-amber-300 rounded-lg text-sm px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
              ) : (
                <span className={`flex-1 text-sm ${pt.isActive ? 'text-slate-800' : 'text-slate-400 line-through'}`}>
                  {pt.name}
                </span>
              )}

              {/* Status badge */}
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${pt.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                {pt.isActive ? 'Active' : 'Disabled'}
              </span>

              {/* Actions */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {editingId === pt.id ? (
                  <>
                    <button onClick={() => handleSaveEdit(pt)}
                      className="text-green-500 hover:text-green-700 p-1 rounded">
                      <Save size={14} />
                    </button>
                    <button onClick={() => setEditingId(null)}
                      className="text-slate-400 hover:text-slate-600 p-1 rounded">
                      <X size={14} />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => { setEditingId(pt.id); setEditName(pt.name); }}
                      className="text-slate-400 hover:text-slate-600 p-1 rounded transition-colors"
                      title="Rename"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => handleToggleActive(pt)}
                      className={`p-1 rounded transition-colors ${pt.isActive ? 'text-green-500 hover:text-red-400' : 'text-slate-300 hover:text-green-500'}`}
                      title={pt.isActive ? 'Disable' : 'Enable'}
                    >
                      {pt.isActive ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer note */}
        <div className="px-5 py-3 border-t border-slate-100">
          <p className="text-xs text-slate-400">
            Disabled product types no longer appear in new measure sheets but are preserved on existing records.
            Renaming a product type updates the display name; historical measure sheets retain a snapshot of the name at time of creation.
          </p>
        </div>
      </Card>
    </div>
  );
}

function ImportsSection({ navigate }) {
  const contactBatches    = getImportBatches();
  const pricedItemBatches = getPricedItemBatches();
  const totalImports      = contactBatches.length + pricedItemBatches.length;

  const lastContact    = contactBatches[0];
  const lastPriced     = pricedItemBatches[0];

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
