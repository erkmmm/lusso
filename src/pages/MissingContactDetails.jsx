/**
 * MissingContactDetails — the customers with live work and no way to reach them.
 *
 * Reconciling against Quotient turned up 808 customers with no phone and/or no
 * address. Quotient could only supply a fraction of it (it holds a phone for 69
 * of them), so most of this was never collected and can only be recovered by
 * asking. That makes completeness the wrong goal: of the 808, only ~45 have an
 * open job and ~112 have been active in the last year. The rest are dormant or
 * were never quoted, and perfect details on them buy nothing.
 *
 * So this page deliberately leads with open work — those are the ones where a
 * missing number actually costs you something today — and lets you widen the
 * net if you want to. Editing is inline because the realistic workflow is to
 * ring someone and type what they say, not to open a profile per customer.
 */

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, MapPin, Search, Check, ExternalLink, AlertTriangle, Users } from 'lucide-react';
import {
  getCustomers, getJobs, saveCustomer, isJobOpen, searchMatch,
} from '../store/data';
import Card from '../components/Card';
import AddressAutocomplete from '../components/AddressAutocomplete';

const blank = (v) => !String(v ?? '').trim();

const SCOPES = [
  { key: 'open',   label: 'Open work',      hint: 'Has a project still in progress' },
  { key: 'recent', label: 'Last 12 months', hint: 'Any project in the last year' },
  { key: 'all',    label: 'Everyone',       hint: 'Every customer missing details' },
];

export default function MissingContactDetails() {
  const navigate = useNavigate();
  const [scope, setScope]   = useState('open');
  const [search, setSearch] = useState('');
  // Local edits, so a row you have just filled in stays put and visibly saved
  // instead of vanishing out from under you the moment it no longer qualifies.
  const [draft, setDraft]   = useState({});
  const [saved, setSaved]   = useState({});
  const [tick, setTick]     = useState(0);
  // Read the clock once at mount, not inside the memo: the React Compiler
  // treats Date.now() during render as impure, and "last 12 months" shifting
  // mid-session would be churn for no benefit anyway.
  const [mountedAt] = useState(() => Date.now());

  const rows = useMemo(() => {
    const jobs = getJobs().filter(j => !j.deletedAt);
    const byCustomer = new Map();
    jobs.forEach(j => {
      if (!j.customerId) return;
      const e = byCustomer.get(j.customerId) || { open: [], all: [] };
      e.all.push(j);
      if (isJobOpen(j)) e.open.push(j);
      byCustomer.set(j.customerId, e);
    });

    const yearAgo = mountedAt - 365 * 24 * 60 * 60 * 1000;

    // De-duplicate by id. `id` is the primary key server-side, but the local
    // cache can hold the same customer twice (31 of 1,981 at the time of
    // writing), which otherwise renders a row per copy and trips React's
    // duplicate-key warning. Last copy wins — it's the more recently merged one.
    const unique = [...new Map(
      getCustomers().filter(c => !c.deletedAt).map(c => [c.id, c])
    ).values()];

    return unique
      .map(c => {
        const j = byCustomer.get(c.id) || { open: [], all: [] };
        const recent = j.all.some(x => {
          const t = Date.parse(x.createdAt || x.updatedAt || '');
          return Number.isFinite(t) && t >= yearAgo;
        });
        return { c, openJobs: j.open, recent, needsPhone: blank(c.phone) && blank(c.mobile), needsAddr: blank(c.address) };
      })
      .filter(r => (r.needsPhone || r.needsAddr) || saved[r.c.id])
      .filter(r => {
        if (saved[r.c.id]) return true;               // keep what you just fixed
        if (scope === 'open')   return r.openJobs.length > 0;
        if (scope === 'recent') return r.recent;
        return true;
      })
      .filter(r => searchMatch([r.c.name, r.c.email, r.c.businessName], search))
      .sort((a, b) => b.openJobs.length - a.openJobs.length
        || (a.c.name || '').localeCompare(b.c.name || ''));
    // `tick` is in here so a save recomputes the list against fresh store data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, search, saved, tick, mountedAt]);

  const totals = useMemo(() => {
    const all = [...new Map(
      getCustomers().filter(c => !c.deletedAt).map(c => [c.id, c])
    ).values()];
    return {
      phone: all.filter(c => blank(c.phone) && blank(c.mobile)).length,
      addr:  all.filter(c => blank(c.address)).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const edit = (id, field, value) =>
    setDraft(d => ({ ...d, [id]: { ...(d[id] || {}), [field]: value } }));

  const save = (c) => {
    const d = draft[c.id] || {};
    const phone   = String(d.phone   ?? '').trim();
    const address = String(d.address ?? '').trim();
    if (!phone && !address) return;
    // Only write what was actually typed — same rule as the importer. Saving a
    // phone must never clear an address that simply wasn't being edited.
    const next = { ...c };
    if (phone)   next.phone   = phone;
    if (address) next.address = address;
    saveCustomer(next);
    setSaved(s => ({ ...s, [c.id]: true }));
    setDraft(d2 => { const n = { ...d2 }; delete n[c.id]; return n; });
    setTick(t => t + 1);
    window.dispatchEvent(new CustomEvent('lusso:toast', {
      detail: { message: `${c.name || 'Customer'} updated.`, type: 'success' },
    }));
  };

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Missing contact details</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {totals.phone} customers have no phone number and {totals.addr} have no address.
          Open work comes first — those are the ones it costs you to be missing.
        </p>
      </div>

      <Card className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {SCOPES.map(s => (
            <button
              key={s.key}
              onClick={() => setScope(s.key)}
              title={s.hint}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                scope === s.key
                  ? 'bg-amber-50 border-amber-300 text-amber-700'
                  : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              {s.label}
            </button>
          ))}
          <div className="relative ml-auto">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search name or email…"
              className="text-xs border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 w-52 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card className="px-5 py-8 text-center">
          <Users size={22} className="mx-auto text-green-500 mb-2" />
          <p className="text-sm font-semibold text-slate-800">Nothing missing here</p>
          <p className="text-xs text-slate-400 mt-0.5">
            {scope === 'open'
              ? 'Every customer with open work has a phone number and an address.'
              : 'No customers match this filter.'}
          </p>
        </Card>
      ) : (
        <Card className="divide-y divide-slate-100">
          {rows.map(({ c, openJobs, needsPhone, needsAddr }) => {
            const d = draft[c.id] || {};
            const done = saved[c.id];
            return (
              <div key={c.id} className="px-4 py-3.5">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => navigate(`/customers/${c.id}`)}
                        className="text-sm font-semibold text-slate-800 hover:text-amber-600 truncate text-left"
                      >
                        {c.name || '(no name)'}
                      </button>
                      {done && (
                        <span className="text-[11px] font-medium text-green-600 flex items-center gap-1">
                          <Check size={12} /> saved
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 truncate">
                      {c.email || 'no email'}
                      {openJobs.length > 0 && (
                        <>
                          {' · '}
                          <span className="text-amber-600 font-medium">
                            {openJobs.length === 1
                              ? openJobs[0].jobNumber || '1 open project'
                              : `${openJobs.length} open projects`}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  {openJobs.length === 1 && (
                    <button
                      onClick={() => navigate(`/jobs/${openJobs[0].id}`)}
                      className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 flex-shrink-0"
                    >
                      Project <ExternalLink size={11} />
                    </button>
                  )}
                </div>

                <div className="mt-2.5 grid sm:grid-cols-[1fr_1.4fr_auto] gap-2">
                  <div>
                    {needsPhone ? (
                      <div className="relative">
                        <Phone size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          value={d.phone ?? ''}
                          onChange={e => edit(c.id, 'phone', e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && save(c)}
                          placeholder="04xx xxx xxx"
                          type="tel"
                          className="w-full text-sm border border-slate-200 rounded-lg pl-8 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 flex items-center gap-1.5 py-2">
                        <Phone size={13} className="text-green-500" /> {c.phone || c.mobile}
                      </p>
                    )}
                  </div>
                  <div>
                    {needsAddr ? (
                      <AddressAutocomplete
                        value={d.address ?? ''}
                        onChange={v => edit(c.id, 'address', v)}
                        placeholder="Start typing an address…"
                      />
                    ) : (
                      <p className="text-xs text-slate-400 flex items-center gap-1.5 py-2 truncate">
                        <MapPin size={13} className="text-green-500 flex-shrink-0" /> {c.address}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => save(c)}
                    disabled={!String(d.phone ?? '').trim() && !String(d.address ?? '').trim()}
                    className="text-xs font-semibold px-3 py-2 rounded-lg bg-amber-500 text-white disabled:bg-slate-100 disabled:text-slate-400 hover:bg-amber-600 transition-colors"
                  >
                    Save
                  </button>
                </div>
              </div>
            );
          })}
        </Card>
      )}

      {scope !== 'all' && (
        <p className="text-xs text-slate-400 flex items-start gap-1.5">
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          Most of the rest were never asked for these details and no system has them —
          Quotient holds a phone for only 69 of them. Chasing dormant records isn't worth it;
          new customers are now required to have a phone and address up front.
        </p>
      )}
    </div>
  );
}
