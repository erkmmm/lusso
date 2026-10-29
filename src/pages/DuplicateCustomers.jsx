/**
 * DuplicateCustomers — one person, two records.
 *
 * `Jett Hopko` and `Jett Hopkins` were the same person on two customer records,
 * same email, same phone, created a month apart. That is not a cosmetic
 * problem: their jobs, quotes and message history sat on separate records, so
 * neither one told the truth about the relationship.
 *
 * Nothing on this page merges by itself, and that is the point. Fifteen phone
 * numbers in this database are shared across customer records and only some of
 * those are duplicates — `John Stewart` and `Judy Stewart` are a couple on one
 * line, and one mobile sits on three unrelated clients, almost certainly a
 * builder's. So a shared email is presented as a near-certainty and a shared
 * phone number as a question, and a person answers it.
 *
 * Every merge is recorded with the exact rows it moved, so Undo puts them back
 * where they were rather than guessing. See migrations/customer_merge.sql.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, AlertTriangle, Loader, Merge, Check, ExternalLink, Mail, Phone, MapPin,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';
import { hydrateFromSupabase } from '../store/db';
import Card from '../components/Card';
import { toast } from '../components/ToastContainer';

/**
 * Above this, both halves of the name agree or near-miss and the records are
 * very probably one person. Below it they merely share a contact detail.
 *
 * The line sits at 0.35 because of where the real cases fall: every known
 * duplicate in this database scores 0.40 or more — `Jett Hopko`/`Jett Hopkins`
 * and `Nick Dargan`/`Nick Dargin` both 0.40, `Carmel McMahon`/`McMannon` 0.42,
 * `Warrick`/`Warrwick Baker` 0.55 — while `John Stewart` and `Judy Stewart`,
 * a couple sharing one number, score 0.11. See customer_name_match_score().
 */
const LIKELY = 0.35;

const BASIS = {
  email: { label: 'Same email address', tone: 'bg-slate-100 text-slate-600 border-slate-200' },
  phone: { label: 'Same phone number',  tone: 'bg-slate-100 text-slate-600 border-slate-200' },
};

/** How much history a record carries. The one with the most is usually the keeper. */
const weight = (m) => (m.jobs ?? 0) * 100 + (m.quotes ?? 0) * 10 + (m.messages ?? 0);

function MemberRow({ member, keep, onKeep, navigate }) {
  const counts = [
    { n: member.jobs,     label: 'job' },
    { n: member.quotes,   label: 'quote' },
    { n: member.messages, label: 'message' },
  ].filter(c => c.n > 0);

  return (
    <label
      className={`flex gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors ${
        keep ? 'border-violet-400 bg-violet-50/60' : 'border-slate-200 hover:bg-slate-50'
      }`}
    >
      <input
        type="radio"
        checked={keep}
        onChange={onKeep}
        className="mt-1 accent-violet-600"
        aria-label={`Keep ${member.name}`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-slate-900 text-sm">{member.name || 'Unnamed'}</span>
          {member.business_name && (
            <span className="text-xs text-slate-500">{member.business_name}</span>
          )}
          {keep && (
            <span className="text-[10px] font-semibold uppercase tracking-wide text-violet-700 bg-violet-100 rounded-full px-2 py-0.5">
              Keep
            </span>
          )}
        </div>

        <div className="mt-1 space-y-0.5 text-xs text-slate-500">
          {member.email   && <p className="flex items-center gap-1.5 truncate"><Mail size={12} /> {member.email}</p>}
          {member.phone   && <p className="flex items-center gap-1.5"><Phone size={12} /> {member.phone}</p>}
          {member.address && <p className="flex items-center gap-1.5 truncate"><MapPin size={12} /> {member.address}</p>}
        </div>

        <div className="mt-1.5 flex items-center gap-2 flex-wrap text-[11px]">
          {counts.length ? counts.map(c => (
            <span key={c.label} className="rounded-full bg-slate-100 text-slate-600 px-2 py-0.5">
              {c.n} {c.label}{c.n === 1 ? '' : 's'}
            </span>
          )) : (
            <span className="rounded-full bg-slate-100 text-slate-400 px-2 py-0.5">No history</span>
          )}
          {member.created_at && (
            <span className="text-slate-400">added {format(parseISO(member.created_at), 'd MMM yyyy')}</span>
          )}
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); navigate(`/customers/${member.id}`); }}
            className="inline-flex items-center gap-1 text-violet-600 hover:underline"
          >
            Open <ExternalLink size={11} />
          </button>
        </div>
      </div>
    </label>
  );
}

function Group({ group, onMerged }) {
  const navigate = useNavigate();
  const meta = BASIS[group.basis] ?? BASIS.phone;
  const members = group.members ?? [];
  const likely = Number(group.nameAgreement) >= LIKELY;

  // Default to the record carrying the most history; on a tie, the oldest.
  const [keepId, setKeepId] = useState(() =>
    [...members].sort((a, b) => weight(b) - weight(a)
      || String(a.created_at).localeCompare(String(b.created_at)))[0]?.id);
  const [busy, setBusy] = useState(false);

  const keeper = members.find(m => m.id === keepId);
  const others = members.filter(m => m.id !== keepId);

  const merge = async () => {
    if (busy || !keeper || !others.length) return;
    setBusy(true);
    const mergeIds = [];
    try {
      // One call per record folded in, so a partial failure leaves the records
      // it did merge properly recorded and undoable rather than half-moved.
      for (const other of others) {
        const { data, error } = await supabase.rpc('merge_customers', {
          p_keep:  keeper.id,
          p_merge: other.id,
        });
        if (error) throw error;
        if (data?.mergeId) mergeIds.push(data.mergeId);
      }

      await hydrateFromSupabase();
      window.dispatchEvent(new CustomEvent('lusso:data-changed'));
      onMerged(group);

      toast(
        `${others.length === 1 ? '1 record' : `${others.length} records`} merged into ${keeper.name}.`,
        'info',
        {
          duration: 12000,
          onUndo: async () => {
            // Reverse order, so the record state unwinds the way it was built.
            for (const id of [...mergeIds].reverse()) {
              const { error } = await supabase.rpc('undo_customer_merge', { p_merge_id: id });
              if (error) { toast('Could not undo the merge.', 'error'); return; }
            }
            await hydrateFromSupabase();
            window.dispatchEvent(new CustomEvent('lusso:data-changed'));
            toast('Merge undone.', 'info');
          },
        },
      );
    } catch (err) {
      toast(err?.message || 'Could not merge these records.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`inline-flex items-center rounded-full border text-[11px] font-medium px-2.5 py-0.5 ${meta.tone}`}>
              {meta.label}
            </span>
            <span className={`inline-flex items-center rounded-full border text-[11px] font-medium px-2.5 py-0.5 ${
              likely ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                     : 'bg-amber-50 text-amber-700 border-amber-200'
            }`}>
              {likely ? 'Names agree' : 'Different names'}
            </span>
          </div>
          <p className="mt-1.5 text-sm font-medium text-slate-700 truncate">{group.matchKey}</p>
        </div>
        <button
          onClick={merge}
          disabled={busy || !others.length}
          className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-semibold px-3.5 py-2 transition-colors"
        >
          {busy ? <Loader size={14} className="animate-spin" /> : <Merge size={14} />}
          Merge {others.length === 1 ? '1 record' : `${others.length} records`} in
        </button>
      </div>

      <div className="space-y-2">
        {members.map(m => (
          <MemberRow
            key={m.id}
            member={m}
            keep={m.id === keepId}
            onKeep={() => setKeepId(m.id)}
            navigate={navigate}
          />
        ))}
      </div>

      <p className="mt-3 text-[11px] text-slate-400">
        Everything on the other {others.length === 1 ? 'record' : 'records'} — jobs, quotes, messages,
        measure sheets, tasks — moves to {keeper?.name || 'the kept record'}, which is then filled in
        from any detail it was missing. The merged {others.length === 1 ? 'record is' : 'records are'} archived, not deleted.
      </p>
    </Card>
  );
}

export default function DuplicateCustomers() {
  const [groups, setGroups]   = useState(null);
  const [error, setError]     = useState('');
  const [done, setDone]       = useState([]);   // matchKeys merged this session

  // Cancellable, and the fetch lives inside the effect rather than in a
  // callback it calls — the same shape the inbox uses, and the one the React
  // compiler accepts without a cascading-render warning.
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data, error: rpcErr } = await supabase.rpc('customer_duplicate_groups');
      if (cancelled) return;
      if (rpcErr) { setError(rpcErr.message); setGroups([]); return; }
      setGroups(Array.isArray(data) ? data : []);
    })();
    return () => { cancelled = true; };
  }, []);

  const remaining = useMemo(
    () => (groups ?? []).filter(g => !done.includes(`${g.basis}:${g.matchKey}`)),
    [groups, done],
  );
  // Bucketed on whether the NAMES agree, not on which contact detail matched.
  // Sharing an email looked like the confident signal and isn't: 23 customer
  // records carry a @lusso.com.au address a staff member typed in, and
  // builders, architects and property managers put one office inbox on every
  // client. What actually separates a duplicate from two people is the name.
  const likely = remaining.filter(g => Number(g.nameAgreement) >= LIKELY);
  const shared = remaining.filter(g => Number(g.nameAgreement) < LIKELY);

  const onMerged = (g) => setDone(prev => [...prev, `${g.basis}:${g.matchKey}`]);

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Users size={20} className="text-violet-600" /> Possible duplicates
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Records that may be the same person. Nothing merges until you say so — pick which record to
          keep, and everything else moves onto it. Every merge can be undone.
        </p>
      </div>

      {error && (
        <Card className="p-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </Card>
      )}

      {groups === null && (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-8 justify-center">
          <Loader size={16} className="animate-spin" /> Looking for duplicates…
        </div>
      )}

      {groups !== null && !remaining.length && !error && (
        <Card className="p-8 text-center">
          <Check size={28} className="mx-auto text-emerald-500 mb-2" />
          <p className="text-sm font-medium text-slate-700">No duplicates to review.</p>
          <p className="text-xs text-slate-500 mt-1">
            Nothing shares an email address or a phone number with another record.
          </p>
        </Card>
      )}

      {likely.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Likely the same person · {likely.length}
          </h2>
          <p className="text-xs text-slate-500 -mt-1">
            Both halves of the name agree or are a near-miss, and they share an email address or a
            phone number.
          </p>
          {likely.map(g => (
            <Group key={`${g.basis}:${g.matchKey}`} group={g} onMerged={onMerged} />
          ))}
        </section>
      )}

      {shared.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Shares contact details, different names · {shared.length}
          </h2>
          <Card className="p-3.5 border-amber-200 bg-amber-50 flex gap-2.5">
            <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              Most of these are not duplicates. Couples share a line, a builder's or architect's
              office inbox sits on every client they refer, and a staff address sometimes stands in
              where a customer had none. Merging two of these makes one customer out of two people.
              Read the names and the history before touching anything here.
            </p>
          </Card>
          {shared.map(g => (
            <Group key={`${g.basis}:${g.matchKey}`} group={g} onMerged={onMerged} />
          ))}
        </section>
      )}
    </div>
  );
}
