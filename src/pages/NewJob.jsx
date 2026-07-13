/**
 * NewJob — 2-step job creation wizard.
 *
 * URL params:
 *   ?customerId=X  → skips Step 1 entirely (coming from a Customer page)
 *
 * Step 1 — Customer (skipped if customerId is provided)
 *   Select an existing customer OR create a new one.
 *   Confirming a customer automatically advances to Step 2.
 *
 * Step 2 — Job details
 *   Fill in job info. Submit creates the job and opens the Job Workspace.
 */

import { useState, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, User, Briefcase, X, UserCheck, UserPlus,
  ChevronRight, Loader2, AlertCircle, ArrowLeft,
} from 'lucide-react';
import { useActiveSalespeople } from '../hooks/useActiveSalespeople';
import AddressAutocomplete from '../components/AddressAutocomplete';
import {
  getCustomers, getCustomer, saveCustomer, createJob,
  JOB_TYPES, JOB_STATUSES,
} from '../store/data';
import Card from '../components/Card';

// ─── Shared input styles ──────────────────────────────────────────────────────
const inp = (err) =>
  `w-full border rounded-xl text-sm px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 transition-colors ${
    err ? 'border-red-400 bg-red-50' : 'border-slate-200'
  }`;

// ─── Step indicator ────────────────────────────────────────────────────────────
function StepPips({ step, total }) {
  return (
    <div className="flex items-center gap-1.5 mb-5">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1.5 rounded-full transition-all ${
            i < step ? 'flex-1 bg-amber-500' : i === step ? 'flex-1 bg-amber-300' : 'flex-1 bg-slate-200'
          }`}
        />
      ))}
    </div>
  );
}

// ─── Customer chip (confirmed state) ─────────────────────────────────────────
function CustomerChip({ customer, onClear, locked }) {
  return (
    <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-xl">
      <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0 text-sm font-bold text-green-700">
        {customer.name?.charAt(0)?.toUpperCase() || '?'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 truncate">{customer.name}</p>
        <p className="text-xs text-slate-400 truncate">{customer.phone || customer.email || customer.address || ''}</p>
      </div>
      {!locked && (
        <button onClick={onClear} className="text-slate-400 hover:text-red-500 transition-colors flex-shrink-0 p-1" aria-label="Change customer">
          <X size={14} />
        </button>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
export default function NewJob() {
  const navigate          = useNavigate();
  const [params]          = useSearchParams();
  const preCustomerId     = params.get('customerId') || null;
  const { salespeople }   = useActiveSalespeople();

  // ── Step management ────────────────────────────────────────────────────────
  // If customerId is pre-set, jump straight to Step 2
  const [step, setStep] = useState(preCustomerId ? 1 : 0);

  // ── Customer state ────────────────────────────────────────────────────────
  const [customerId,     setCustomerId]     = useState(preCustomerId);
  const [customerMode,   setCustomerMode]   = useState('select'); // 'select' | 'new'
  const [customerSearch, setCustomerSearch] = useState('');
  const [newCust,        setNewCust]        = useState({ name: '', phone: '', email: '', address: '', notes: '' });
  const [newCustErr,     setNewCustErr]     = useState({});
  const [custSaving,     setCustSaving]     = useState(false);

  // ── Derived ────────────────────────────────────────────────────────────────
  const allCustomers = getCustomers();
  const customer     = customerId ? allCustomers.find(c => c.id === customerId) : null;

  // ── Job state ──────────────────────────────────────────────────────────────
  const [title,         setTitle]         = useState('');
  const [jobType,       setJobType]        = useState('');
  const [status,        setStatus]         = useState('New Enquiry');
  const [urgency,       setUrgency]        = useState('Normal');
  const [assignedStaff, setAssignedStaff]  = useState('');
  // Pre-fill address from customer when coming from customer page
  const [siteAddress,   setSiteAddress]    = useState(customer?.address || '');
  const [accessInstructions, setAccessInstructions] = useState('');
  const [internalNotes, setInternalNotes]  = useState('');
  const [jobErrors,     setJobErrors]      = useState({});
  const [saving,        setSaving]         = useState(false);
  const [saveError,     setSaveError]      = useState('');
  const submitLock = useRef(false); // double-click guard

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    return allCustomers.filter(c =>
      (c.name  || '').toLowerCase().includes(q) ||
      (c.phone || '').replace(/\s/g, '').includes(q.replace(/\s/g, '')) ||
      (c.email || '').toLowerCase().includes(q)
    ).slice(0, 8);
  }, [customerSearch, allCustomers]);

  // ── Customer actions ───────────────────────────────────────────────────────
  const confirmCustomer = (id) => {
    setCustomerId(id);
    setCustomerSearch('');
    // Pre-fill site address from customer address
    const c = allCustomers.find(x => x.id === id);
    if (c?.address) setSiteAddress(c.address);
    setStep(1); // advance to job details
  };

  const clearCustomer = () => {
    setCustomerId(null);
    setCustomerSearch('');
    setNewCust({ name: '', phone: '', email: '', address: '', notes: '' });
    setNewCustErr({});
    setStep(0);
  };

  const ncf = (field, value) => {
    setNewCust(f => ({ ...f, [field]: value }));
    setNewCustErr(e => { const n = { ...e }; delete n[field]; return n; });
  };

  const handleCreateCustomer = () => {
    const errs = {};
    if (!newCust.name.trim()) errs.name = 'Name is required';
    if (Object.keys(errs).length) { setNewCustErr(errs); return; }

    setCustSaving(true);
    try {
      const id = uuidv4();
      saveCustomer({
        id,
        name:    newCust.name.trim(),
        phone:   newCust.phone.trim(),
        email:   newCust.email.trim(),
        address: newCust.address.trim(),
        notes:   newCust.notes.trim(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      if (newCust.address.trim()) setSiteAddress(newCust.address.trim());
      setCustomerId(id);
      setStep(1);
    } catch (err) {
      setNewCustErr({ _: 'Failed to save customer. Please try again.' });
    } finally {
      setCustSaving(false);
    }
  };

  // ── Job actions ────────────────────────────────────────────────────────────
  const validateJob = () => {
    const errs = {};
    if (!jobType) errs.jobType = 'Job type is required';
    setJobErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleCreateJob = async () => {
    if (submitLock.current || saving) return; // double-click guard
    if (!validateJob()) return;

    submitLock.current = true;
    setSaving(true);
    setSaveError('');

    try {
      const newJob = createJob({
        customerId,
        title:              title.trim() || `${customer?.name || ''} – ${jobType}`,
        jobType,
        status,
        urgency,
        assignedStaff,
        siteAddress,
        accessInstructions,
        internalNotes,
        createdBy: 'Admin',
      });
      navigate(`/jobs/${newJob.id}`);
    } catch (err) {
      setSaveError(err?.message || 'Failed to create job. Please try again.');
      setSaving(false);
      submitLock.current = false;
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto pb-32 space-y-5 overflow-x-hidden">

      <div>
        <h1 className="text-2xl font-bold text-slate-900">New Project</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {step === 0 ? 'Step 1 of 2 · Choose a customer' : 'Step 2 of 2 · Project details'}
        </p>
      </div>

      {!preCustomerId && <StepPips step={step} total={2} />}

      {/* ── STEP 0: Customer selection ──────────────────────────────────── */}
      {step === 0 && (
        <Card className="p-5">
          <h2 className="font-semibold text-slate-800 text-sm mb-4 flex items-center gap-2">
            <User size={15} className="text-slate-400" /> Choose Customer
          </h2>

          {/* Mode toggle */}
          <div className="flex rounded-xl border border-slate-200 overflow-hidden text-sm font-medium mb-4">
            <button
              onClick={() => { setCustomerMode('select'); setCustomerSearch(''); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 transition-colors ${
                customerMode === 'select' ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <UserCheck size={14} /> Select Existing
            </button>
            <button
              onClick={() => { setCustomerMode('new'); setCustomerSearch(''); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 border-l border-slate-200 transition-colors ${
                customerMode === 'new' ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <UserPlus size={14} /> Create New
            </button>
          </div>

          {customerMode === 'select' ? (
            /* ── Search existing ── */
            <div className="space-y-2">
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  autoFocus
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                  placeholder="Search by name, phone or email…"
                  className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              {customerSearch.length >= 1 && customerSearch.length < 2 && (
                <p className="text-xs text-slate-400 pl-1">Keep typing to search…</p>
              )}
              {filteredCustomers.length > 0 && (
                <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 shadow-sm">
                  {filteredCustomers.map(c => (
                    <button
                      key={c.id}
                      onClick={() => confirmCustomer(c.id)}
                      className="w-full flex items-center gap-3 px-3 py-3 hover:bg-amber-50 text-left transition-colors"
                    >
                      <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0 text-xs font-bold text-amber-700">
                        {c.name?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{c.name}</p>
                        <p className="text-xs text-slate-400 truncate">{[c.phone, c.email].filter(Boolean).join(' · ')}</p>
                      </div>
                      <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
                    </button>
                  ))}
                </div>
              )}
              {customerSearch.length >= 2 && filteredCustomers.length === 0 && (
                <p className="text-xs text-slate-400 pl-1">
                  No match — <button className="text-amber-600 hover:underline font-medium" onClick={() => setCustomerMode('new')}>create a new customer</button>
                </p>
              )}
            </div>
          ) : (
            /* ── Create new customer ── */
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Customer Name <span className="text-red-400">*</span>
                </label>
                <input
                  autoFocus
                  value={newCust.name}
                  onChange={e => ncf('name', e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && document.getElementById('cust-phone')?.focus()}
                  placeholder="Full name or business name"
                  className={inp(newCustErr.name)}
                />
                {newCustErr.name && <p className="text-xs text-red-500 mt-1">{newCustErr.name}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                  <input
                    id="cust-phone"
                    value={newCust.phone}
                    onChange={e => ncf('phone', e.target.value)}
                    placeholder="04xx xxx xxx"
                    type="tel"
                    className={inp()}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                  <input
                    value={newCust.email}
                    onChange={e => ncf('email', e.target.value)}
                    placeholder="email@example.com"
                    type="email"
                    inputMode="email"
                    className={inp()}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Address</label>
                <AddressAutocomplete
                  value={newCust.address}
                  onChange={v => ncf('address', v)}
                  placeholder="Start typing an address…"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Notes <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={newCust.notes}
                  onChange={e => ncf('notes', e.target.value)}
                  placeholder="e.g. Prefers morning appointments"
                  rows={2}
                  className="w-full border border-slate-200 rounded-xl text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                />
              </div>

              {newCustErr._ && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600">
                  <AlertCircle size={14} className="flex-shrink-0" /> {newCustErr._}
                </div>
              )}

              <button
                onClick={handleCreateCustomer}
                disabled={custSaving || !newCust.name.trim()}
                className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white text-sm font-semibold py-3 rounded-xl transition-colors"
              >
                {custSaving ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                {custSaving ? 'Saving…' : 'Save Customer & Continue'}
              </button>
            </div>
          )}
        </Card>
      )}

      {/* ── STEP 1: Job details ────────────────────────────────────────── */}
      {step === 1 && (
        <>
          {/* Customer chip — always show at top of Step 2 */}
          <Card className="p-4">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Customer</p>
            {customer ? (
              <CustomerChip customer={customer} onClear={clearCustomer} locked={!!preCustomerId} />
            ) : (
              <button onClick={() => setStep(0)} className="text-sm text-amber-600 hover:underline">← Change customer</button>
            )}
          </Card>

          {/* Job details form */}
          <Card className="p-5">
            <h2 className="font-semibold text-slate-800 text-sm mb-4 flex items-center gap-2">
              <Briefcase size={15} className="text-slate-400" /> Project Details
            </h2>

            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Job Name / Reference <span className="text-slate-400 font-normal">(optional — auto-generated if blank)</span>
                </label>
                <input
                  autoFocus
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={`e.g. ${customer?.name || 'Customer'} – Living Room Blinds`}
                  className={inp()}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Job type */}
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Project Type <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={jobType}
                    onChange={e => { setJobType(e.target.value); setJobErrors(er => ({ ...er, jobType: '' })); }}
                    className={inp(jobErrors.jobType)}
                  >
                    <option value="">Select type…</option>
                    {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                  {jobErrors.jobType && <p className="text-xs text-red-500 mt-1">{jobErrors.jobType}</p>}
                </div>

                {/* Status */}
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value)}
                    className={inp()}
                  >
                    {JOB_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                {/* Priority */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Priority</label>
                  <select
                    value={urgency}
                    onChange={e => setUrgency(e.target.value)}
                    className={inp()}
                  >
                    {['Low', 'Normal', 'High', 'Urgent'].map(u => <option key={u}>{u}</option>)}
                  </select>
                </div>

                {/* Assigned staff */}
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Assigned Staff</label>
                  <select
                    value={assignedStaff}
                    onChange={e => setAssignedStaff(e.target.value)}
                    className={inp()}
                  >
                    <option value="">— Unassigned —</option>
                    {salespeople.map(p => (
                      <option key={p.id} value={p.fullName || p.displayName}>
                        {p.fullName || p.displayName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Site address */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Site Address</label>
                <AddressAutocomplete
                  value={siteAddress}
                  onChange={setSiteAddress}
                  placeholder="Start typing an address…"
                />
              </div>

              {/* Access instructions */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Access Instructions <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  value={accessInstructions}
                  onChange={e => setAccessInstructions(e.target.value)}
                  placeholder="e.g. Key under mat, buzz unit 3"
                  className={inp()}
                />
              </div>

              {/* Internal notes */}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Notes <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={internalNotes}
                  onChange={e => setInternalNotes(e.target.value)}
                  rows={3}
                  placeholder="e.g. Customer wants motorised option, check Acmeda stock"
                  className="w-full border border-slate-200 rounded-xl text-sm px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
                />
              </div>
            </div>
          </Card>

          {/* Error */}
          {saveError && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-600">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
              <span>{saveError}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3">
            {!preCustomerId && (
              <button
                onClick={() => setStep(0)}
                className="flex items-center justify-center gap-1.5 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-3 px-5 rounded-xl transition-colors"
              >
                <ArrowLeft size={14} /> Back
              </button>
            )}
            <button
              onClick={handleCreateJob}
              disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white text-sm font-semibold py-3 px-6 rounded-xl transition-colors shadow-sm"
            >
              {saving
                ? <><Loader2 size={15} className="animate-spin" /> Creating…</>
                : <><Briefcase size={15} /> Create Project &amp; Open</>
              }
            </button>
          </div>
        </>
      )}
    </div>
  );
}
