import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Phone, Mail, MapPin, Edit3, Save, X, Briefcase,
  MessageSquare, Plus, ChevronRight,
} from 'lucide-react';
import BackButton from '../components/BackButton';
import { format, parseISO } from 'date-fns';
import {
  getCustomer, getJobsByCustomer, saveCustomer,
  createJob, JOB_TYPES, getActiveEmployees,
} from '../store/data';
import StatusBadge from '../components/StatusBadge';
import Card from '../components/Card';

export default function CustomerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(getCustomer(id));
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState({});

  // New job form
  const [showNewJob, setShowNewJob] = useState(false);
  const [jobForm, setJobForm]       = useState({ jobType: '', assignedStaff: '', internalNotes: '' });
  const [jobFormErr, setJobFormErr] = useState('');

  if (!customer) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500">Customer not found.</p>
        <BackButton fallback="/customers" className="mt-2" />
      </div>
    );
  }

  const jobs    = getJobsByCustomer(id);
  const allStaff = getActiveEmployees();

  const handleSave = () => {
    const updated = { ...customer, ...edits };
    saveCustomer(updated);
    setCustomer(updated);
    setEditing(false);
    setEdits({});
  };

  const handleCreateJob = () => {
    if (!jobForm.jobType) { setJobFormErr('Please select a job type.'); return; }
    const newJob = createJob({
      customerId:    id,
      jobType:       jobForm.jobType,
      assignedStaff: jobForm.assignedStaff,
      internalNotes: jobForm.internalNotes,
      siteAddress:   customer.address || '',
      createdBy:     'Admin',
    });
    navigate(`/jobs/${newJob.id}`);
  };

  const cancelNewJob = () => {
    setShowNewJob(false);
    setJobForm({ jobType: '', assignedStaff: '', internalNotes: '' });
    setJobFormErr('');
  };

  const field = (key) => edits[key] ?? customer[key] ?? '';
  const set   = (key) => (e) => setEdits(p => ({ ...p, [key]: e.target.value }));

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6 overflow-x-hidden pb-24">
      <BackButton fallback="/customers" />

      {/* Header */}
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center flex-shrink-0 text-blue-700 font-bold text-2xl">
            {customer.name.charAt(0)}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-slate-900">{customer.name}</h1>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-2 text-sm text-slate-500">
              {customer.phone && <span className="flex items-center gap-1.5"><Phone size={13} />{customer.phone}</span>}
              {customer.email && <span className="flex items-center gap-1.5"><Mail size={13} />{customer.email}</span>}
              {customer.address && <span className="flex items-center gap-1.5"><MapPin size={13} />{customer.address}</span>}
            </div>
            <p className="text-xs text-slate-400 mt-2">Customer since {format(parseISO(customer.createdAt), 'd MMM yyyy')}</p>
          </div>
          <button
            onClick={() => setEditing(!editing)}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors flex-shrink-0"
          >
            {editing ? <><X size={13} /> Cancel</> : <><Edit3 size={13} /> Edit</>}
          </button>
        </div>
      </Card>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">

          {/* Edit form */}
          {editing && (
            <Card>
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 text-sm">Edit Customer Details</h2>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid sm:grid-cols-2 gap-3">
                  {[
                    { key: 'name',           label: 'Full Name' },
                    { key: 'phone',          label: 'Phone' },
                    { key: 'email',          label: 'Email' },
                    { key: 'address',        label: 'Site Address' },
                    { key: 'billingAddress', label: 'Billing Address' },
                  ].map(({ key, label }) => (
                    <div key={key} className={key === 'address' || key === 'billingAddress' ? 'sm:col-span-2' : ''}>
                      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
                      <input
                        value={field(key)}
                        onChange={set(key)}
                        className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Preferred Contact</label>
                    <select value={field('preferredContact')} onChange={set('preferredContact')}
                      className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white">
                      {['Email', 'Phone', 'SMS', 'Any'].map(o => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Notes</label>
                  <textarea value={field('notes')} onChange={set('notes')} rows={3}
                    className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
                </div>
                <button onClick={handleSave}
                  className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                  <Save size={13} /> Save Changes
                </button>
              </div>
            </Card>
          )}

          {/* Jobs */}
          <Card>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                <Briefcase size={15} /> Jobs ({jobs.length})
              </h2>
              <button
                onClick={() => { setShowNewJob(true); setJobFormErr(''); }}
                className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-white font-medium px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
              >
                <Plus size={13} /> New Job
              </button>
            </div>

            {/* Inline new-job form */}
            {showNewJob && (
              <div className="px-5 py-4 bg-amber-50 border-b border-amber-100">
                <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-3">Create New Job for {customer.name}</p>
                <div className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Job Type <span className="text-red-400">*</span></label>
                      <select
                        value={jobForm.jobType}
                        onChange={e => { setJobForm(f => ({ ...f, jobType: e.target.value })); setJobFormErr(''); }}
                        className={`w-full border rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 ${jobFormErr ? 'border-red-400' : 'border-slate-200'}`}
                      >
                        <option value="">Select job type…</option>
                        {JOB_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      {jobFormErr && <p className="text-xs text-red-500 mt-1">{jobFormErr}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Assigned Staff</label>
                      <select
                        value={jobForm.assignedStaff}
                        onChange={e => setJobForm(f => ({ ...f, assignedStaff: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                      >
                        <option value="">Unassigned</option>
                        {allStaff.map(s => <option key={s.id} value={s.fullName}>{s.fullName}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Internal Notes <span className="text-slate-400 font-normal">(optional)</span></label>
                    <input
                      value={jobForm.internalNotes}
                      onChange={e => setJobForm(f => ({ ...f, internalNotes: e.target.value }))}
                      placeholder="e.g. Customer wants measure ASAP"
                      className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleCreateJob}
                      className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                    >
                      <Plus size={13} /> Create Job
                    </button>
                    <button
                      onClick={cancelNewJob}
                      className="text-sm text-slate-500 hover:text-slate-800 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {jobs.length === 0 && !showNewJob ? (
              <div className="p-8 text-center">
                <Briefcase size={28} className="mx-auto mb-2 text-slate-300" />
                <p className="text-sm text-slate-400">No jobs yet.</p>
                <button
                  onClick={() => setShowNewJob(true)}
                  className="mt-2 text-xs text-amber-600 hover:underline font-medium"
                >
                  Create the first job →
                </button>
              </div>
            ) : (
              <div className="divide-y divide-slate-50">
                {[...jobs].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map(job => (
                  <button
                    key={job.id}
                    onClick={() => navigate(`/jobs/${job.id}`)}
                    className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
                  >
                    <div className="w-8 h-8 rounded-xl bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <Briefcase size={14} className="text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-slate-800">{job.jobNumber}</span>
                        <span className="text-slate-400 text-xs">{job.jobType}</span>
                        <StatusBadge status={job.status} size="sm" />
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5 flex gap-3 flex-wrap">
                        {job.assignedStaff && <span>👤 {job.assignedStaff}</span>}
                        <span>Updated {format(parseISO(job.updatedAt), 'd MMM yyyy')}</span>
                      </div>
                    </div>
                    <ChevronRight size={14} className="text-slate-300 flex-shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right sidebar */}
        <div className="space-y-5">
          <Card>
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm">Contact Details</h2>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <Row label="Phone"            value={customer.phone} />
              <Row label="Email"            value={customer.email} />
              <Row label="Site Address"     value={customer.address} />
              <Row label="Billing Address"  value={customer.billingAddress} />
              <Row label="Preferred Contact" value={customer.preferredContact} />
            </div>
          </Card>

          {customer.notes && (
            <Card>
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                  <MessageSquare size={14} /> Notes
                </h2>
              </div>
              <div className="p-5">
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{customer.notes}</p>
              </div>
            </Card>
          )}

          <Card>
            <div className="p-5 space-y-2 text-xs text-slate-500">
              <div className="flex justify-between"><span>Total Jobs</span><span className="font-medium text-slate-700">{jobs.length}</span></div>
              <div className="flex justify-between"><span>Active</span><span className="font-medium text-slate-700">{jobs.filter(j => j.status !== 'Completed' && j.status !== 'Cancelled').length}</span></div>
              <div className="flex justify-between"><span>Completed</span><span className="font-medium text-slate-700">{jobs.filter(j => j.status === 'Completed').length}</span></div>
              <div className="flex justify-between"><span>Customer Since</span><span className="font-medium text-slate-700">{format(parseISO(customer.createdAt), 'd MMM yyyy')}</span></div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-slate-700 mt-0.5">{value || '—'}</dd>
    </div>
  );
}
