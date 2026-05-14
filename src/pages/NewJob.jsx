/**
 * NewJob — Create a new job.
 *
 * URL params:
 *   ?customerId=X  → pre-fills and locks customer (no selection needed)
 *
 * After save, navigates to /jobs/:newJobId (the Job Workspace).
 */

import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Plus, User, Briefcase, X } from 'lucide-react';
import BackButton from '../components/BackButton';
import {
  getCustomers, getCustomer, createJob,
  JOB_TYPES, getActiveEmployees,
} from '../store/data';
import Card from '../components/Card';

export default function NewJob() {
  const navigate     = useNavigate();
  const [params]     = useSearchParams();
  const preCustomerId = params.get('customerId') || null;

  // Customer selection
  const allCustomers     = getCustomers();
  const [customerId, setCustomerId]     = useState(preCustomerId);
  const [customerSearch, setCustomerSearch] = useState('');

  // Job fields
  const [jobType,       setJobType]       = useState('');
  const [assignedStaff, setAssignedStaff] = useState('');
  const [urgency,       setUrgency]       = useState('Normal');
  const [internalNotes, setInternalNotes] = useState('');
  const [errors,        setErrors]        = useState({});
  const [saving,        setSaving]        = useState(false);

  const allStaff    = getActiveEmployees();
  const customer    = customerId ? getCustomer(customerId) : null;

  const filteredCustomers = useMemo(() => {
    if (!customerSearch || customerSearch.length < 2) return [];
    const q = customerSearch.toLowerCase();
    return allCustomers.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.phone || '').includes(q) ||
      (c.email || '').toLowerCase().includes(q)
    ).slice(0, 6);
  }, [customerSearch, allCustomers]);

  const validate = () => {
    const e = {};
    if (!customerId)  e.customer = 'Please select a customer.';
    if (!jobType)     e.jobType  = 'Please select a job type.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    setSaving(true);
    const newJob = createJob({
      customerId,
      jobType,
      assignedStaff,
      urgency,
      internalNotes,
      siteAddress: customer?.address || '',
      createdBy: 'Admin',
    });
    navigate(`/jobs/${newJob.id}`);
  };

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto overflow-x-hidden pb-24 space-y-5">
      <BackButton fallback="/jobs" />

      <div>
        <h1 className="text-2xl font-bold text-slate-900">New Job</h1>
        <p className="text-slate-500 text-sm mt-0.5">Create a job and open the Job Workspace</p>
      </div>

      {/* Customer selection */}
      <Card className="p-5">
        <h2 className="font-semibold text-slate-800 text-sm mb-3 flex items-center gap-2">
          <User size={15} className="text-slate-400" /> Customer
        </h2>

        {customer ? (
          <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 text-sm font-bold text-green-700">
              {customer.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800">{customer.name}</p>
              <p className="text-xs text-slate-400">{customer.phone || customer.email || customer.address || ''}</p>
            </div>
            {!preCustomerId && (
              <button
                onClick={() => { setCustomerId(null); setCustomerSearch(''); }}
                className="text-xs text-slate-400 hover:text-red-500 transition-colors flex-shrink-0"
              >
                <X size={14} />
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                autoFocus
                value={customerSearch}
                onChange={e => setCustomerSearch(e.target.value)}
                placeholder="Search by name, phone or email…"
                className={`w-full pl-9 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 ${errors.customer ? 'border-red-400' : 'border-slate-200'}`}
              />
            </div>
            {errors.customer && <p className="text-xs text-red-500">{errors.customer}</p>}
            {filteredCustomers.length > 0 && (
              <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 shadow-sm">
                {filteredCustomers.map(c => (
                  <button
                    key={c.id}
                    onClick={() => { setCustomerId(c.id); setCustomerSearch(''); setErrors(e => ({ ...e, customer: '' })); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-amber-50 text-left transition-colors"
                  >
                    <div className="w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-amber-700">
                      {c.name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                      <p className="text-xs text-slate-400 truncate">{c.phone || c.email || ''}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {customerSearch.length > 0 && customerSearch.length < 2 && (
              <p className="text-xs text-slate-400">Keep typing to search…</p>
            )}
          </div>
        )}
      </Card>

      {/* Job details */}
      <Card className="p-5">
        <h2 className="font-semibold text-slate-800 text-sm mb-4 flex items-center gap-2">
          <Briefcase size={15} className="text-slate-400" /> Job Details
        </h2>
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Job Type <span className="text-red-400">*</span>
              </label>
              <select
                value={jobType}
                onChange={e => { setJobType(e.target.value); setErrors(er => ({ ...er, jobType: '' })); }}
                className={`w-full border rounded-xl text-sm px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 ${errors.jobType ? 'border-red-400' : 'border-slate-200'}`}
              >
                <option value="">Select type…</option>
                {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              {errors.jobType && <p className="text-xs text-red-500 mt-1">{errors.jobType}</p>}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Assigned Staff</label>
              <select
                value={assignedStaff}
                onChange={e => setAssignedStaff(e.target.value)}
                className="w-full border border-slate-200 rounded-xl text-sm px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                <option value="">Unassigned</option>
                {allStaff.map(s => <option key={s.id} value={s.fullName}>{s.fullName}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Urgency</label>
              <select
                value={urgency}
                onChange={e => setUrgency(e.target.value)}
                className="w-full border border-slate-200 rounded-xl text-sm px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
              >
                {['Low', 'Normal', 'High', 'Urgent'].map(u => <option key={u}>{u}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Internal Notes <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={internalNotes}
              onChange={e => setInternalNotes(e.target.value)}
              rows={3}
              placeholder="e.g. Customer called to book measure, wants motorised option"
              className="w-full border border-slate-200 rounded-xl text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
            />
          </div>
        </div>
      </Card>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={() => navigate(-1)}
          className="flex-1 sm:flex-none border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 px-5 rounded-xl transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 sm:flex-none flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white text-sm font-semibold py-2.5 px-6 rounded-xl transition-colors"
        >
          <Plus size={15} /> Create Job &amp; Open Workspace
        </button>
      </div>
    </div>
  );
}
