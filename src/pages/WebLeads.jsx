import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Globe, Phone, Mail, MapPin, RefreshCw, UserPlus, Archive,
  ArchiveRestore, Check, Clock, MessageSquare, ExternalLink,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { formatDistanceToNow, parseISO, format } from 'date-fns';
import { supabase } from '../lib/supabase';
import { saveCustomer } from '../store/data';
import { useProfile } from '../contexts/UserProfileContext';
import { toast } from '../components/ToastContainer';
import EmptyState from '../components/EmptyState';

// Enquiries submitted from the public marketing site land in public.web_enquiries.
// This page is the staff inbox for those leads: review, mark progress, and
// convert a lead into a CRM customer.

const STATUS_META = {
  new:       { label: 'New',       pill: 'bg-amber-100 text-amber-700' },
  contacted: { label: 'Contacted', pill: 'bg-blue-100 text-blue-700' },
  converted: { label: 'Converted', pill: 'bg-emerald-100 text-emerald-700' },
  archived:  { label: 'Archived',  pill: 'bg-slate-100 text-slate-500' },
};

const FILTERS = [
  { key: 'active',    label: 'Active' },
  { key: 'new',       label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'converted', label: 'Converted' },
  { key: 'archived',  label: 'Archived' },
  { key: 'all',       label: 'All' },
];

function timeAgo(ts) {
  if (!ts) return '';
  try { return formatDistanceToNow(parseISO(ts), { addSuffix: true }); }
  catch { return ''; }
}

function Avatar({ name }) {
  const letter = (name || '?').trim()[0]?.toUpperCase() || '?';
  const colors = ['bg-violet-500', 'bg-amber-500', 'bg-teal-500', 'bg-rose-500', 'bg-blue-500', 'bg-emerald-500'];
  const color = colors[(letter.charCodeAt(0) || 0) % colors.length];
  return (
    <div className={`w-11 h-11 ${color} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0`}>
      {letter}
    </div>
  );
}

export default function WebLeads() {
  const navigate = useNavigate();
  const { displayName = '' } = useProfile() || {};
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('active');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async (quiet = false) => {
    if (!supabase) { setLoading(false); return; }
    if (quiet) setRefreshing(true); else setLoading(true);
    const { data, error } = await supabase
      .from('web_enquiries')
      .select('*')
      .order('created_at', { ascending: false });
    if (!error && data) setLeads(data);
    if (error) toast('Could not load web leads.', 'error');
    setLoading(false);
    setRefreshing(false);
  }, []);

  // Initial load + light polling while the tab is visible (new leads arrive
  // from the public site at any time).
  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') load(true);
    }, 20000);
    return () => clearInterval(t);
  }, [load]);

  const counts = useMemo(() => {
    const c = { active: 0, new: 0, contacted: 0, converted: 0, archived: 0, all: leads.length };
    for (const l of leads) {
      const s = l.status || 'new';
      if (c[s] != null) c[s] += 1;
      if (s === 'new' || s === 'contacted') c.active += 1;
    }
    return c;
  }, [leads]);

  const visible = useMemo(() => {
    if (filter === 'all') return leads;
    if (filter === 'active') return leads.filter(l => ['new', 'contacted'].includes(l.status || 'new'));
    return leads.filter(l => (l.status || 'new') === filter);
  }, [leads, filter]);

  async function setStatus(lead, status) {
    setBusyId(lead.id);
    const { error } = await supabase.from('web_enquiries').update({ status }).eq('id', lead.id);
    setBusyId(null);
    if (error) { toast('Could not update lead.', 'error'); return; }
    setLeads(prev => prev.map(l => (l.id === lead.id ? { ...l, status } : l)));
  }

  async function convert(lead) {
    setBusyId(lead.id);
    const id = uuidv4();
    const now = new Date().toISOString();
    const noteLines = [
      'Web enquiry from lusso.com.au',
      lead.interest ? `Interested in: ${lead.interest}` : null,
      lead.suburb ? `Suburb: ${lead.suburb}` : null,
      lead.created_at ? `Submitted: ${format(parseISO(lead.created_at), 'd MMM yyyy, h:mm a')}` : null,
      '',
      lead.message || '',
    ].filter(l => l !== null);
    try {
      saveCustomer({
        id,
        name: lead.name || 'Web enquiry',
        businessName: '',
        phone: lead.phone || '',
        email: lead.email || '',
        address: lead.suburb || '',
        billingAddress: '',
        preferredContact: lead.phone ? 'Phone' : 'Email',
        notes: noteLines.join('\n'),
        assignedTo: displayName,
        createdAt: now,
        updatedAt: now,
      });
      await supabase.from('web_enquiries').update({ status: 'converted' }).eq('id', lead.id);
      setLeads(prev => prev.map(l => (l.id === lead.id ? { ...l, status: 'converted' } : l)));
      window.dispatchEvent(new CustomEvent('lusso:data-changed'));
      toast(`${lead.name || 'Lead'} added to customers.`);
      navigate(`/customers/${id}`);
    } catch {
      toast('Could not convert lead.', 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-teal-50 flex items-center justify-center">
              <Globe size={18} className="text-teal-600" />
            </div>
            <h1 className="text-xl font-bold text-slate-900">Web Leads</h1>
            {counts.new > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-white text-xs font-bold">
                {counts.new}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Enquiries submitted from the lusso.com.au website.
          </p>
        </div>
        <button
          onClick={() => load(true)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === f.key
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
            }`}
          >
            {f.label}
            <span className={`ml-1.5 ${filter === f.key ? 'text-white/70' : 'text-slate-400'}`}>
              {counts[f.key] ?? 0}
            </span>
          </button>
        ))}
      </div>

      {/* List */}
      {loading ? (
        <div className="py-20 flex justify-center">
          <RefreshCw size={22} className="animate-spin text-slate-300" />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No web leads here"
          description={
            filter === 'active'
              ? 'New enquiries from the website will appear here as they come in.'
              : 'Nothing matches this filter yet.'
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map(lead => {
            const status = lead.status || 'new';
            const meta = STATUS_META[status] || STATUS_META.new;
            const busy = busyId === lead.id;
            return (
              <div
                key={lead.id}
                className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-sm"
              >
                <div className="flex items-start gap-3.5">
                  <Avatar name={lead.name} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-slate-900 truncate">
                        {lead.name || 'Unnamed enquiry'}
                      </h3>
                      <span className={`inline-flex items-center rounded-full font-medium text-xs px-2 py-0.5 ${meta.pill}`}>
                        {meta.label}
                      </span>
                      {lead.interest && (
                        <span className="inline-flex items-center rounded-full bg-slate-100 text-slate-600 text-xs px-2 py-0.5">
                          {lead.interest}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-xs text-slate-400 ml-auto">
                        <Clock size={12} /> {timeAgo(lead.created_at)}
                      </span>
                    </div>

                    {/* Contact row */}
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-slate-600">
                      {lead.phone && (
                        <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 hover:text-teal-600">
                          <Phone size={13} /> {lead.phone}
                        </a>
                      )}
                      {lead.email && (
                        <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 hover:text-teal-600">
                          <Mail size={13} /> {lead.email}
                        </a>
                      )}
                      {lead.suburb && (
                        <span className="flex items-center gap-1.5">
                          <MapPin size={13} /> {lead.suburb}
                        </span>
                      )}
                    </div>

                    {/* Message */}
                    {lead.message && (
                      <div className="mt-3 flex gap-2 text-sm text-slate-700 bg-slate-50 rounded-xl px-3.5 py-2.5">
                        <MessageSquare size={14} className="text-slate-400 flex-shrink-0 mt-0.5" />
                        <p className="whitespace-pre-wrap">{lead.message}</p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-2 mt-3.5">
                      {status === 'new' && (
                        <button
                          disabled={busy}
                          onClick={() => setStatus(lead, 'contacted')}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors disabled:opacity-50"
                        >
                          <Check size={14} /> Mark contacted
                        </button>
                      )}
                      {status !== 'converted' && (
                        <button
                          disabled={busy}
                          onClick={() => convert(lead)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 transition-colors disabled:opacity-50"
                        >
                          <UserPlus size={14} /> Convert to customer
                        </button>
                      )}
                      {status === 'converted' && (
                        <span className="flex items-center gap-1.5 px-1 text-sm font-medium text-emerald-600">
                          <Check size={15} /> Added to customers
                        </span>
                      )}
                      {status !== 'archived' ? (
                        <button
                          disabled={busy}
                          onClick={() => setStatus(lead, 'archived')}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-50"
                        >
                          <Archive size={14} /> Archive
                        </button>
                      ) : (
                        <button
                          disabled={busy}
                          onClick={() => setStatus(lead, 'new')}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-50"
                        >
                          <ArchiveRestore size={14} /> Restore
                        </button>
                      )}
                      {lead.page_url && (
                        <a
                          href={lead.page_url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-600 ml-auto"
                        >
                          <ExternalLink size={12} /> Source
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
