import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Settings2, Plus, ChevronUp, ChevronDown, Edit3, Save, X,
  ToggleLeft, ToggleRight, Tag, Upload, Users, Library, History,
  ArrowRight, FileText,
} from 'lucide-react';
import {
  getProductTypes, saveProductType, addProductType, reorderProductType,
  getImportBatches, getPricedItemBatches,
} from '../store/data';
import Card from '../components/Card';

export default function Settings() {
  const navigate = useNavigate();
  const [productTypes, setProductTypes] = useState(getProductTypes);
  const [adding, setAdding]             = useState(false);
  const [newName, setNewName]           = useState('');
  const [editingId, setEditingId]       = useState(null);
  const [editName, setEditName]         = useState('');

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

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Settings2 size={22} className="text-amber-500" /> Settings
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">Platform configuration and admin controls</p>
      </div>

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
