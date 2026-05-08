import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Phone, Mail, MapPin, Edit3, Save, X, Briefcase, ClipboardList, MessageSquare } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { getCustomer, getJobsByCustomer, saveCustomer } from '../store/data';
import StatusBadge from '../components/StatusBadge';
import Card from '../components/Card';

export default function CustomerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState(getCustomer(id));
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState({});

  if (!customer) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500">Customer not found.</p>
        <button onClick={() => navigate('/customers')} className="text-amber-600 hover:underline mt-2 text-sm">Back to customers</button>
      </div>
    );
  }

  const jobs = getJobsByCustomer(id);

  const handleSave = () => {
    const updated = { ...customer, ...edits };
    saveCustomer(updated);
    setCustomer(updated);
    setEditing(false);
    setEdits({});
  };

  const field = (key) => edits[key] ?? customer[key] ?? '';
  const set = (key) => (e) => setEdits(p => ({ ...p, [key]: e.target.value }));

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <button onClick={() => navigate('/customers')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors">
        <ArrowLeft size={15} /> Back to Customers
      </button>

      {/* Header */}
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-100 to-blue-300 flex items-center justify-center flex-shrink-0 text-blue-700 font-bold text-2xl">
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
                    { key: 'name', label: 'Full Name' },
                    { key: 'phone', label: 'Phone' },
                    { key: 'email', label: 'Email' },
                    { key: 'address', label: 'Site Address' },
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
                      className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400">
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
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                <Briefcase size={15} /> Jobs ({jobs.length})
              </h2>
              <button
                onClick={() => navigate(`/measure-sheets/new?customerId=${id}`)}
                className="text-xs bg-amber-500 hover:bg-amber-400 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
              >
                + New Measure Sheet
              </button>
            </div>
            {jobs.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">No jobs yet.</div>
            ) : (
              <div className="divide-y divide-slate-50">
                {[...jobs].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).map(job => (
                  <button
                    key={job.id}
                    onClick={() => navigate(`/jobs/${job.id}`)}
                    className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-slate-800">{job.jobNumber}</span>
                        <span className="text-slate-400 text-xs">{job.jobType}</span>
                        <StatusBadge status={job.status} size="sm" />
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5 flex gap-3">
                        {job.assignedStaff && <span>👤 {job.assignedStaff}</span>}
                        <span>Updated {format(parseISO(job.updatedAt), 'd MMM yyyy')}</span>
                      </div>
                    </div>
                    <span className="text-slate-300 text-xs">→</span>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right */}
        <div className="space-y-5">
          <Card>
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm">Contact Details</h2>
            </div>
            <div className="p-5 space-y-3 text-sm">
              <Row label="Phone" value={customer.phone} />
              <Row label="Email" value={customer.email} />
              <Row label="Site Address" value={customer.address} />
              <Row label="Billing Address" value={customer.billingAddress} />
              <Row label="Preferred Contact" value={customer.preferredContact} />
            </div>
          </Card>

          {customer.notes && (
            <Card>
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><MessageSquare size={14} /> Notes</h2>
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
