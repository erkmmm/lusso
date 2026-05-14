import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import {
  HardHat, Plus, Search, X, Phone, Mail, MapPin,
  CheckCircle2, XCircle, ChevronRight, Wrench, Save,
  Trash2, CheckSquare, Square, AlertTriangle,
} from 'lucide-react';
import { getInstallers, saveInstaller, deleteInstaller, bulkDeleteInstallers, getInstallRequestsByInstaller, INSTALLER_SERVICES } from '../store/data';
import Card from '../components/Card';
import EmptyState from '../components/EmptyState';

function Toast({ message, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-xl flex items-center gap-2">
      <CheckSquare size={15} className="text-green-400" /> {message}
    </div>
  );
}

function DeleteModal({ count, onConfirm, onCancel }) {
  const isBulk = count > 1;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Trash2 size={18} className="text-red-500" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-base">
              {isBulk ? `Delete ${count} installers?` : 'Delete this installer?'}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              {isBulk
                ? `Are you sure you want to delete ${count} installers? This action cannot be undone.`
                : 'Are you sure you want to delete this installer? This action cannot be undone.'}
            </p>
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onCancel}
            className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
            {isBulk ? `Delete ${count} Installers` : 'Delete Installer'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Installers() {
  const navigate  = useNavigate();
  const [search, setSearch]         = useState('');
  const [filter, setFilter]         = useState('active');
  const [showNew, setShowNew]       = useState(false);
  const [installers, setInstallers] = useState(getInstallers);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected]     = useState(new Set());
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast]           = useState(null);

  const [newForm, setNewForm] = useState({
    name: '', businessName: '', email: '', phone: '',
    serviceAreas: '', servicesOffered: [], availabilityNotes: '',
    internalNotes: '', isActive: true,
  });

  const refresh = () => setInstallers(getInstallers());

  const filtered = useMemo(() => {
    let list = installers;
    if (filter === 'active')   list = list.filter(i => i.isActive);
    if (filter === 'inactive') list = list.filter(i => !i.isActive);
    if (search) {
      const term = search.toLowerCase();
      list = list.filter(i =>
        [i.name, i.businessName, i.email, i.phone, i.serviceAreas].join(' ').toLowerCase().includes(term)
      );
    }
    return list;
  }, [installers, search, filter]);

  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()); };
  const toggleSelect = (id, e) => {
    e.stopPropagation();
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const allSelected = filtered.length > 0 && filtered.every(i => selected.has(i.id));
  const toggleAll   = () => setSelected(allSelected ? new Set() : new Set(filtered.map(i => i.id)));
  const targetIds   = deleteTarget === 'bulk' ? [...selected] : deleteTarget ? [deleteTarget] : [];
  const handleConfirmDelete = () => {
    const count = targetIds.length;
    bulkDeleteInstallers(targetIds);
    refresh();
    setSelected(new Set()); setDeleteTarget(null); setSelectMode(false);
    setToast(count === 1 ? 'Installer deleted.' : `${count} installers deleted.`);
  };

  const toggleService = (svc) => {
    setNewForm(f => ({
      ...f,
      servicesOffered: f.servicesOffered.includes(svc)
        ? f.servicesOffered.filter(s => s !== svc)
        : [...f.servicesOffered, svc],
    }));
  };

  const handleSave = () => {
    if (!newForm.name.trim() || !newForm.email.trim()) return;
    saveInstaller({ ...newForm, id: uuidv4() });
    setShowNew(false);
    setNewForm({ name:'',businessName:'',email:'',phone:'',serviceAreas:'',servicesOffered:[],availabilityNotes:'',internalNotes:'',isActive:true });
    refresh();
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Installers</h1>
          <p className="text-slate-500 text-sm mt-0.5">{filtered.length} installer{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2 self-start">
          {installers.length > 0 && (
            selectMode ? (
              <>
                <button onClick={toggleAll}
                  className="flex items-center gap-1.5 text-sm text-slate-600 border border-slate-200 hover:bg-slate-50 px-3 py-2.5 rounded-lg transition-colors">
                  {allSelected ? <CheckSquare size={14} className="text-amber-500" /> : <Square size={14} className="text-slate-400" />}
                  {allSelected ? 'Deselect all' : 'Select all'}
                </button>
                <button onClick={exitSelectMode}
                  className="text-sm font-medium px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setSelectMode(true)}
                className="text-sm font-medium px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                Select
              </button>
            )
          )}
          {!selectMode && (
            <button onClick={() => setShowNew(true)}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors">
              <Plus size={16} /> Add Installer
            </button>
          )}
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, business, area…"
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X size={14} /></button>}
        </div>
        <div className="flex gap-1 bg-white border border-slate-200 rounded-lg p-1">
          {[['all','All'],['active','Active'],['inactive','Inactive']].map(([val,label]) => (
            <button key={val} onClick={() => setFilter(val)}
              className={`flex-1 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${filter === val ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {selectMode && selected.size > 0 && (
        <div className="flex items-center gap-3 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg">
          <span className="text-sm font-medium flex-1">
            {selected.size} installer{selected.size !== 1 ? 's' : ''} selected
          </span>
          <button onClick={() => setDeleteTarget('bulk')}
            className="flex items-center gap-1.5 bg-red-500 hover:bg-red-400 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
            <Trash2 size={13} /> Delete Selected
          </button>
          <button onClick={() => setSelected(new Set())}
            className="text-slate-400 hover:text-white text-xs px-2 py-1.5 rounded-lg transition-colors">
            Clear
          </button>
        </div>
      )}

      {/* New installer form */}
      {showNew && (
        <Card>
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><Plus size={14} /> New Installer</h2>
            <button onClick={() => setShowNew(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
          </div>
          <div className="p-5 space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                ['name','Full Name *','text'],
                ['businessName','Business Name','text'],
                ['email','Email Address *','email'],
                ['phone','Phone Number','text'],
                ['serviceAreas','Service Areas','text'],
              ].map(([key, label, type]) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
                  <input type={type} value={newForm[key]} onChange={e => setNewForm(f => ({...f, [key]: e.target.value}))}
                    className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400" />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
                <div className="flex gap-2">
                  {[['true','Active'],['false','Inactive']].map(([val, label]) => (
                    <button key={val} onClick={() => setNewForm(f => ({...f, isActive: val === 'true'}))}
                      className={`flex-1 text-sm py-2.5 rounded-lg border transition-colors ${String(newForm.isActive) === val ? 'bg-amber-500 text-white border-amber-500' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-2">Services Offered</label>
              <div className="flex flex-wrap gap-2">
                {INSTALLER_SERVICES.map(svc => (
                  <button key={svc} onClick={() => toggleService(svc)}
                    className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${newForm.servicesOffered.includes(svc) ? 'bg-amber-500 text-white border-amber-500' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                    {svc}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Availability Notes</label>
                <textarea value={newForm.availabilityNotes} onChange={e => setNewForm(f => ({...f, availabilityNotes: e.target.value}))}
                  rows={2} className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Internal Notes</label>
                <textarea value={newForm.internalNotes} onChange={e => setNewForm(f => ({...f, internalNotes: e.target.value}))}
                  rows={2} className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={handleSave}
                className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                <Save size={13} /> Save Installer
              </button>
              <button onClick={() => setShowNew(false)}
                className="text-sm text-slate-500 border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* Installer grid */}
      {filtered.length === 0 ? (
        <Card><EmptyState icon={HardHat} title="No installers found" description="Add your first installer to get started." /></Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(installer => {
            const jobs     = getInstallRequestsByInstaller(installer.id);
            const accepted = jobs.filter(j => j.status === 'Accepted').length;
            const pending  = jobs.filter(j => j.status === 'Sent').length;
            const isSelected = selected.has(installer.id);
            return (
              <div key={installer.id}
                className={`relative bg-white rounded-xl border shadow-sm transition-all ${
                  selectMode && isSelected ? 'border-amber-400 bg-amber-50/30 shadow-md' : 'border-slate-200 hover:shadow-md hover:border-slate-300'
                }`}
              >
                {/* Checkbox — top-left in select mode */}
                {selectMode && (
                  <button onClick={e => toggleSelect(installer.id, e)} className="absolute top-3 left-3 z-10">
                    {isSelected
                      ? <CheckSquare size={17} className="text-amber-500" />
                      : <Square size={17} className="text-slate-300 hover:text-slate-500 transition-colors" />}
                  </button>
                )}

                {/* Delete — top-right in select mode */}
                {selectMode && (
                  <button onClick={e => { e.stopPropagation(); setDeleteTarget(installer.id); }}
                    className="absolute top-3 right-3 z-10 p-1 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                    <Trash2 size={14} />
                  </button>
                )}

                <button
                  onClick={() => selectMode ? toggleSelect(installer.id, { stopPropagation: () => {} }) : navigate(`/installers/${installer.id}`)}
                  className={`w-full p-5 text-left group ${selectMode ? 'pl-9' : ''}`}
                >
                  <div className="flex items-start gap-3 mb-3">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${installer.isActive ? 'bg-amber-100' : 'bg-slate-100'}`}>
                      <HardHat size={20} className={installer.isActive ? 'text-amber-700' : 'text-slate-400'} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900 text-sm truncate">{installer.name}</div>
                      <div className="text-xs text-slate-500 truncate">{installer.businessName}</div>
                      <div className={`inline-flex items-center gap-1 text-xs mt-1 font-medium ${installer.isActive ? 'text-green-600' : 'text-slate-400'}`}>
                        {installer.isActive ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                        {installer.isActive ? 'Active' : 'Inactive'}
                      </div>
                    </div>
                    {!selectMode && <ChevronRight size={16} className="text-slate-300 group-hover:text-amber-500 flex-shrink-0 transition-colors" />}
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-500 mb-3">
                    {installer.phone && <div className="flex items-center gap-1.5"><Phone size={11} />{installer.phone}</div>}
                    {installer.email && <div className="flex items-center gap-1.5 truncate"><Mail size={11} /><span className="truncate">{installer.email}</span></div>}
                    {installer.serviceAreas && <div className="flex items-center gap-1.5"><MapPin size={11} /><span className="truncate">{installer.serviceAreas}</span></div>}
                  </div>

                  {installer.servicesOffered?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {installer.servicesOffered.slice(0, 3).map(s => (
                        <span key={s} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{s}</span>
                      ))}
                      {installer.servicesOffered.length > 3 && (
                        <span className="text-xs text-slate-400">+{installer.servicesOffered.length - 3} more</span>
                      )}
                    </div>
                  )}

                  <div className="pt-3 border-t border-slate-100 flex gap-4 text-xs">
                    <div><span className="text-slate-400">Jobs:</span> <span className="font-medium text-slate-700">{jobs.length}</span></div>
                    <div><span className="text-slate-400">Accepted:</span> <span className="font-medium text-green-600">{accepted}</span></div>
                    {pending > 0 && <div><span className="text-slate-400">Pending:</span> <span className="font-medium text-blue-600">{pending}</span></div>}
                  </div>
                </button>
              </div>
            );
          })}
        </div>
      )}

      {deleteTarget && (
        <DeleteModal count={targetIds.length} onConfirm={handleConfirmDelete} onCancel={() => setDeleteTarget(null)} />
      )}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
