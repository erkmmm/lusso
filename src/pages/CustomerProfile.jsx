import { useDataRefresh } from '../hooks/useDataRefresh';
import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Phone, Mail, MapPin, Edit3, Save, X, Briefcase,
  MessageSquare, Plus, ChevronRight, Link2, Link2Off,
  Search, Loader, ExternalLink, Trash2,
} from 'lucide-react';
import OptionsMenu from '../components/OptionsMenu';
import { format, parseISO } from 'date-fns';
import { getCustomer, getJobsByCustomer, saveCustomer, updateCustomerXeroContact, deleteCustomer, restoreCustomer } from '../store/data';
import StatusBadge from '../components/StatusBadge';
import Card from '../components/Card';
import AddressAutocomplete from '../components/AddressAutocomplete';
import { toast } from '../components/ToastContainer';
import { xeroSearchContacts } from '../lib/xero';
import CommsTab from '../components/CommsTab';

export default function CustomerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  // Read directly so re-renders always get fresh data
  const customer = getCustomer(id);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState({});

  useDataRefresh();

  if (!customer) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500">Customer not found.</p>
      </div>
    );
  }

  const jobs = getJobsByCustomer(id);

  const handleSave = () => {
    const updated = { ...customer, ...edits };
    saveCustomer(updated);
    setEditing(false);
    setEdits({});
    toast('Customer saved.');
  };

  const field = (key) => edits[key] ?? customer[key] ?? '';
  const set   = (key) => (e) => setEdits(p => ({ ...p, [key]: e.target.value }));

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6 overflow-x-hidden pb-24">

      {/* Header */}
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center flex-shrink-0 text-blue-700 font-bold text-2xl">
            {customer.name?.charAt(0) || '?'}
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
          <div className="flex items-center gap-2 flex-shrink-0">
            {editing && (
              <button
                onClick={() => { setEditing(false); setEdits({}); }}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                <X size={13} /> Cancel
              </button>
            )}
            <OptionsMenu
              align="right"
              items={editing ? [
                { label: 'Save Changes', icon: Save, onClick: handleSave },
                { label: 'Cancel Edit',  icon: X,    onClick: () => { setEditing(false); setEdits({}); } },
              ] : [
                { label: 'Edit Details', icon: Edit3,  onClick: () => setEditing(true) },
                { divider: true },
                { label: 'Delete Customer', icon: Trash2, danger: true, onClick: () => {
                  const cid  = customer.id;
                  const name = customer.name;
                  deleteCustomer(cid);
                  navigate('/customers');
                  toast(`${name} deleted.`, 'info', {
                    duration: 8000,
                    onUndo: () => restoreCustomer(cid),
                  });
                }},
              ]}
            />
          </div>
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
                    { key: 'name',  label: 'Full Name' },
                    { key: 'phone', label: 'Phone' },
                    { key: 'email', label: 'Email' },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
                      <input
                        value={field(key)}
                        onChange={set(key)}
                        className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                  ))}
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-500 mb-1">Site Address</label>
                    <AddressAutocomplete
                      value={field('address')}
                      onChange={v => setEdits(p => ({ ...p, address: v }))}
                      placeholder="Start typing an address…"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-500 mb-1">Billing Address</label>
                    <AddressAutocomplete
                      value={field('billingAddress')}
                      onChange={v => setEdits(p => ({ ...p, billingAddress: v }))}
                      placeholder="Leave blank if same as site address"
                    />
                  </div>
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
                <Briefcase size={15} /> Projects ({jobs.length})
              </h2>
              <button
                onClick={() => navigate(`/jobs/new?customerId=${id}`)}
                className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-white font-medium px-3 py-1.5 rounded-lg transition-colors flex-shrink-0"
              >
                <Plus size={13} /> New Project
              </button>
            </div>

            {jobs.length === 0 ? (
              <div className="p-8 text-center">
                <Briefcase size={28} className="mx-auto mb-2 text-slate-300" />
                <p className="text-sm text-slate-400">No projects yet.</p>
                <button
                  onClick={() => navigate(`/jobs/new?customerId=${id}`)}
                  className="mt-2 text-xs text-amber-600 hover:underline font-medium"
                >
                  Create the first project →
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

          {/* Communications */}
          <div>
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2 mb-3 px-1">
              <MessageSquare size={15} /> Communications
            </h2>
            <CommsTab
              customerId={id}
              customerName={customer.name}
              customerPhone={customer.phone}
              customerEmail={customer.email}
            />
          </div>
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

          {/* Xero contact link */}
          <XeroContactCard customer={customer} onLinked={() => window.dispatchEvent(new CustomEvent('lusso:data-changed'))} />
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

// ─── Xero Contact Card ────────────────────────────────────────────────────────
function XeroContactCard({ customer, onLinked }) {
  const [searching, setSearching]   = useState(false);
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState(null); // null = idle
  const [working, setWorking]       = useState(false);
  const [error, setError]           = useState(null);
  const debounceRef                 = useRef(null);

  const handleSearch = async (q) => {
    setQuery(q);
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults(null); return; }
    debounceRef.current = setTimeout(async () => {
      setWorking(true);
      setError(null);
      try {
        const contacts = await xeroSearchContacts(q);
        setResults(contacts);
      } catch (err) {
        setError(err.message);
        setResults([]);
      } finally {
        setWorking(false);
      }
    }, 400);
  };

  const handleLink = (contact) => {
    updateCustomerXeroContact(customer.id, {
      xeroContactId:   contact.xeroContactId,
      xeroContactName: contact.name,
    });
    setSearching(false);
    setResults(null);
    setQuery('');
    toast(`Linked to Xero contact: ${contact.name}`);
    onLinked?.();
  };

  const handleUnlink = () => {
    if (!window.confirm('Remove Xero contact link?')) return;
    updateCustomerXeroContact(customer.id, { xeroContactId: null, xeroContactName: null });
    toast('Xero contact unlinked.');
    onLinked?.();
  };

  if (!customer.xeroContactId && !searching) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded bg-[#13B5EA]/10 flex items-center justify-center flex-shrink-0">
              <span className="text-[#13B5EA] font-black text-xs">X</span>
            </span>
            <div>
              <p className="text-xs font-medium text-slate-600">Xero Contact</p>
              <p className="text-xs text-slate-400">Not linked</p>
            </div>
          </div>
          <button
            onClick={() => setSearching(true)}
            className="flex items-center gap-1 text-xs font-medium text-[#13B5EA] hover:underline"
          >
            <Link2 size={11} /> Link
          </button>
        </div>
      </Card>
    );
  }

  if (customer.xeroContactId && !searching) {
    return (
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-6 h-6 rounded bg-[#13B5EA]/10 flex items-center justify-center flex-shrink-0">
              <span className="text-[#13B5EA] font-black text-xs">X</span>
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-600">Xero Contact</p>
              <p className="text-xs text-slate-700 font-semibold truncate">{customer.xeroContactName || customer.xeroContactId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setSearching(true)}
              className="text-xs text-slate-400 hover:text-slate-600"
              title="Change"
            >
              <Edit3 size={12} />
            </button>
            <button
              onClick={handleUnlink}
              className="text-xs text-red-400 hover:text-red-600"
              title="Unlink"
            >
              <Link2Off size={12} />
            </button>
          </div>
        </div>
      </Card>
    );
  }

  // Search mode
  return (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-600">Link Xero Contact</p>
        <button onClick={() => { setSearching(false); setResults(null); setQuery(''); }} className="text-slate-400 hover:text-slate-600">
          <X size={13} />
        </button>
      </div>
      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          autoFocus
          value={query}
          onChange={e => handleSearch(e.target.value)}
          placeholder="Search Xero contacts…"
          className="w-full border border-slate-200 rounded-lg text-xs pl-7 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#13B5EA]/40"
        />
        {working && <Loader size={11} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-slate-400" />}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      {results !== null && (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {results.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-2">No contacts found</p>
          ) : results.map(c => (
            <button
              key={c.xeroContactId}
              onClick={() => handleLink(c)}
              className="w-full text-left px-2.5 py-2 hover:bg-[#13B5EA]/5 rounded-lg transition-colors"
            >
              <p className="text-xs font-medium text-slate-800">{c.name}</p>
              {c.email && <p className="text-xs text-slate-400">{c.email}</p>}
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
