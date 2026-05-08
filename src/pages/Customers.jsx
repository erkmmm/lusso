import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Users, Phone, Mail, MapPin, X, ChevronRight,
  Trash2, CheckSquare, Square, AlertTriangle, Plus, UserPlus,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { getCustomers, getJobsByCustomer, saveCustomer, deleteCustomer, bulkDeleteCustomers } from '../store/data';
import EmptyState from '../components/EmptyState';
import Card from '../components/Card';
import StatusBadge from '../components/StatusBadge';

// ── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-xl flex items-center gap-2">
      <CheckSquare size={15} className="text-green-400" /> {message}
    </div>
  );
}

// ── Confirmation modal ───────────────────────────────────────────────────────
function DeleteModal({ count, hasJobs, onConfirm, onCancel }) {
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
              {isBulk ? `Delete ${count} customers?` : 'Delete this customer?'}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              {isBulk
                ? `Are you sure you want to delete ${count} customers? This action cannot be undone.`
                : 'Are you sure you want to delete this customer? This action cannot be undone.'}
            </p>
            {hasJobs && (
              <div className="mt-3 flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                <AlertTriangle size={14} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-yellow-700">
                  {isBulk ? 'Some customers have' : 'This customer has'} linked jobs, quotes, or measure sheets. Deleting may affect historical records.
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onCancel}
            className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
            {isBulk ? `Delete ${count} Customers` : 'Delete Customer'}
          </button>
        </div>
      </div>
    </div>
  );
}

const EMPTY_CUSTOMER = () => ({
  name: '', businessName: '', phone: '', email: '', address: '',
  billingAddress: '', preferredContact: 'Phone', notes: '',
});

export default function Customers() {
  const navigate = useNavigate();
  const [search, setSearch]         = useState('');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected]     = useState(new Set());
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast]           = useState(null);
  const [showAdd, setShowAdd]       = useState(false);
  const [newCustomer, setNewCustomer] = useState(EMPTY_CUSTOMER());
  const [addErrors, setAddErrors]   = useState({});
  const [, forceUpdate]             = useState(0);

  const customers = getCustomers();

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    if (!term) return customers;
    return customers.filter(c =>
      [c.name, c.phone, c.email, c.address].join(' ').toLowerCase().includes(term)
    );
  }, [customers, search]);

  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()); };

  const handleAddCustomer = () => {
    const e = {};
    if (!newCustomer.name.trim()) e.name = 'Name is required';
    if (!newCustomer.phone.trim() && !newCustomer.email.trim()) e.phone = 'Phone or email required';
    setAddErrors(e);
    if (Object.keys(e).length > 0) return;
    saveCustomer({ ...newCustomer, id: uuidv4(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    setShowAdd(false);
    setNewCustomer(EMPTY_CUSTOMER());
    setAddErrors({});
    forceUpdate(n => n + 1);
    setToast(`${newCustomer.name} added.`);
  };

  const toggleSelect = (id, e) => {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(filtered.map(c => c.id)));

  const targetIds = deleteTarget === 'bulk' ? [...selected] : deleteTarget ? [deleteTarget] : [];

  const hasJobs = targetIds.some(id => getJobsByCustomer(id).length > 0);

  const handleConfirmDelete = () => {
    const count = targetIds.length;
    bulkDeleteCustomers(targetIds);
    setSelected(new Set());
    setDeleteTarget(null);
    setSelectMode(false);
    setToast(count === 1 ? 'Customer deleted.' : `${count} customers deleted.`);
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5 pb-24">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Customers</h1>
          <p className="text-slate-500 text-sm mt-0.5">{filtered.length} customer{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {customers.length > 0 && (
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
            <button
              onClick={() => { setShowAdd(true); setNewCustomer(EMPTY_CUSTOMER()); setAddErrors({}); }}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors"
            >
              <Plus size={16} /> Add Customer
            </button>
          )}
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, phone, email, address…"
          className="w-full pl-9 pr-10 py-2.5 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Bulk action bar */}
      {selectMode && selected.size > 0 && (
        <div className="flex items-center gap-3 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg">
          <span className="text-sm font-medium flex-1">
            {selected.size} customer{selected.size !== 1 ? 's' : ''} selected
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

      {/* Grid */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState icon={Users} title="No customers found" description="Try a different search term." />
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(customer => {
            const jobs = getJobsByCustomer(customer.id);
            const activeJobs = jobs.filter(j => j.status !== 'Completed' && j.status !== 'Cancelled');
            const latestJob = [...jobs].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
            const isSelected = selected.has(customer.id);

            return (
              <div
                key={customer.id}
                className={`relative bg-white rounded-xl border shadow-sm transition-all ${
                  selectMode && isSelected
                    ? 'border-amber-400 bg-amber-50/30 shadow-md'
                    : 'border-slate-200 hover:shadow-md hover:border-slate-300'
                }`}
              >
                {/* Checkbox overlay — top-left in select mode */}
                {selectMode && (
                  <button
                    onClick={e => toggleSelect(customer.id, e)}
                    className="absolute top-3 left-3 z-10"
                  >
                    {isSelected
                      ? <CheckSquare size={17} className="text-amber-500" />
                      : <Square size={17} className="text-slate-300 hover:text-slate-500 transition-colors" />}
                  </button>
                )}

                {/* Delete button — top-right in select mode */}
                {selectMode && (
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteTarget(customer.id); }}
                    className="absolute top-3 right-3 z-10 p-1 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Delete customer"
                  >
                    <Trash2 size={14} />
                  </button>
                )}

                {/* Card content */}
                <button
                  onClick={() => selectMode ? toggleSelect(customer.id, { stopPropagation: () => {} }) : navigate(`/customers/${customer.id}`)}
                  className={`w-full p-5 text-left ${selectMode ? 'pl-9' : ''}`}
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-100 to-blue-200 flex items-center justify-center flex-shrink-0 text-blue-700 font-bold text-base">
                      {customer.name.charAt(0)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-slate-900 text-sm truncate">{customer.name}</div>
                      {customer.businessName && <div className="text-xs text-slate-500 truncate">{customer.businessName}</div>}
                      <div className="text-xs text-slate-400">{jobs.length} job{jobs.length !== 1 ? 's' : ''} · {activeJobs.length} active</div>
                    </div>
                    {!selectMode && <ChevronRight size={16} className="text-slate-300 group-hover:text-amber-500 flex-shrink-0 transition-colors" />}
                  </div>
                  <div className="space-y-1.5 text-xs text-slate-500">
                    {customer.phone && <div className="flex items-center gap-1.5"><Phone size={11} />{customer.phone}</div>}
                    {customer.email && <div className="flex items-center gap-1.5 truncate"><Mail size={11} /><span className="truncate">{customer.email}</span></div>}
                    {customer.address && <div className="flex items-center gap-1.5"><MapPin size={11} /><span className="truncate">{customer.address}</span></div>}
                  </div>
                  {latestJob && (
                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
                      <span className="text-xs text-slate-400">{latestJob.jobNumber}</span>
                      <StatusBadge status={latestJob.status} size="sm" />
                    </div>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation modal */}
      {deleteTarget && (
        <DeleteModal
          count={targetIds.length}
          hasJobs={hasJobs}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Add Customer modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <UserPlus size={16} className="text-amber-500" /> Add Customer
              </h3>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                {/* Name */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Full Name *</label>
                  <input
                    autoFocus
                    value={newCustomer.name}
                    onChange={e => setNewCustomer(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Sarah Mitchell"
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${addErrors.name ? 'border-red-400 bg-red-50' : 'border-slate-200'}`}
                  />
                  {addErrors.name && <p className="text-xs text-red-500 mt-1">{addErrors.name}</p>}
                </div>
                {/* Company */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Company <span className="text-slate-400 font-normal">(optional)</span></label>
                  <input
                    value={newCustomer.businessName}
                    onChange={e => setNewCustomer(p => ({ ...p, businessName: e.target.value }))}
                    placeholder="e.g. Acme Pty Ltd"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                {/* Phone */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Phone</label>
                  <input
                    value={newCustomer.phone}
                    onChange={e => setNewCustomer(p => ({ ...p, phone: e.target.value }))}
                    placeholder="04XX XXX XXX"
                    className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${addErrors.phone ? 'border-red-400 bg-red-50' : 'border-slate-200'}`}
                  />
                  {addErrors.phone && <p className="text-xs text-red-500 mt-1">{addErrors.phone}</p>}
                </div>
                {/* Email */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Email</label>
                  <input
                    type="email"
                    value={newCustomer.email}
                    onChange={e => setNewCustomer(p => ({ ...p, email: e.target.value }))}
                    placeholder="customer@email.com"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                {/* Address */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Site Address</label>
                  <input
                    value={newCustomer.address}
                    onChange={e => setNewCustomer(p => ({ ...p, address: e.target.value }))}
                    placeholder="Street address, Suburb STATE Postcode"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                </div>
                {/* Notes */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Notes</label>
                  <textarea
                    value={newCustomer.notes}
                    onChange={e => setNewCustomer(p => ({ ...p, notes: e.target.value }))}
                    rows={2}
                    placeholder="Preferences, communication notes…"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-3 px-6 py-4 border-t border-slate-100">
              <button onClick={() => setShowAdd(false)}
                className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl transition-colors">
                Cancel
              </button>
              <button onClick={handleAddCustomer}
                className="flex-1 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                Add Customer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
