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
  Users, Loader, Merge, Check, ExternalLink, Mail, Phone, MapPin,
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

/** The record a group should keep: most history, and on a tie the oldest. */
function pickKeeper(members = []) {
  return [...members].sort((a, b) =>
    weight(b) - weight(a) || String(a.created_at).localeCompare(String(b.created_at)))[0];
}

/**
 * Fold every other record in a group into `keepId`.
 *
 * One call per record rather than one per group, so a failure part-way leaves
 * the records it did merge properly recorded and undoable rather than half
 * moved. Returns the merge ids, newest last.
 */
async function mergeGroup(group, keepId) {
  const ids = [];
  for (const other of (group.members ?? []).filter(m => m.id !== keepId)) {
    const { data, error } = await supabase.rpc('merge_customers', {
      p_keep: keepId, p_merge: other.id,
    });
    if (error) throw error;
    if (data?.mergeId) ids.push(data.mergeId);
  }
  return ids;
}

/** Reverse merges in the order they were made, newest first. */
async function undoMerges(ids) {
  for (const id of [...ids].reverse()) {
    const { error } = await supabase.rpc('undo_customer_merge', { p_merge_id: id });
    if (error) { toast('Could not undo the merge.', 'error'); return false; }
  }
  await hydrateFromSupabase();
  window.dispatchEvent(new CustomEvent('lusso:data-changed'));
  return true;
}

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
  const [keepId, setKeepId] = useState(() => pickKeeper(members)?.id);
  const [busy, setBusy] = useState(false);

  const keeper = members.find(m => m.id === keepId);
  const others = members.filter(m => m.id !== keepId);

  const merge = async () => {
    if (busy || !keeper || !others.length) return;
    setBusy(true);
    try {
      const mergeIds = await mergeGroup(group, keeper.id);

      await hydrateFromSupabase();
      window.dispatchEvent(new CustomEvent('lusso:data-changed'));
      onMerged(group);

      toast(
        `${others.length === 1 ? '1 record' : `${others.length} records`} merged into ${keeper.name}.`,
        'info',
        {
          duration: 12000,
          onUndo: async () => {
            if (await undoMerges(mergeIds)) toast('Merge undone.', 'info');
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

/**
 * One section per matching condition, each clearable in one pass.
 *
 * The conditions are ordered by how much they can be trusted, and the bulk
 * action carries the warning that belongs to its own section rather than one
 * blanket caveat at the top. Clearing nine records that agree on name and
 * email is housekeeping; clearing fifteen that share only a phone number is
 * how a husband and wife become one customer.
 */
const SECTIONS = [
  {
    key:   'name-email',
    title: 'Names agree, same email address',
    blurb: 'Both halves of the name agree or are a near-miss, and the email matches. The safest set.',
    match: (g) => Number(g.nameAgreement) >= LIKELY && g.basis === 'email',
    warn:  null,
  },
  {
    key:   'name-phone',
    title: 'Names agree, same phone number',
    blurb: 'The name agrees but only the phone matches. Usually one person; occasionally a parent and child who share a surname and a landline.',
    match: (g) => Number(g.nameAgreement) >= LIKELY && g.basis === 'phone',
    warn:  null,
  },
  {
    key:   'diff-email',
    title: 'Different names, same email address',
    blurb: 'Most of these are not duplicates.',
    match: (g) => Number(g.nameAgreement) < LIKELY && g.basis === 'email',
    warn:  'A builder, architect or property manager puts one office inbox on every client they refer, and a staff address sometimes stands in where a customer had none. Merging these makes one customer out of several people.',
  },
  {
    key:   'diff-phone',
    title: 'Different names, same phone number',
    blurb: 'Most of these are not duplicates.',
    match: (g) => Number(g.nameAgreement) < LIKELY && g.basis === 'phone',
    warn:  'Couples share a line and a trade contact\u2019s mobile sits on every job they referred. John Stewart and Judy Stewart share a number and are two people.',
  },
];

/**
 * Clear a whole section in one pass.
 *
 * Two clicks, never one: the first states what is about to happen in numbers,
 * because the only honest way to offer this on a set that is "mostly not
 * duplicates" is to say so at the moment of the decision.
 */
function BulkBar({ section, targets, onMerged }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState(0);

  const records = targets.reduce((n, g) => n + (g.members?.length ?? 0), 0);
  const risky = !!section.warn;

  const run = async () => {
    if (busy || !targets.length) return;
    setBusy(true);
    setConfirming(false);
    const ids = [];
    const merged = [];
    try {
      for (const [i, g] of targets.entries()) {
        setAt(i + 1);
        // Each group keeps the record its own card already had ticked — most
        // history, oldest on a tie — so the bulk result is what you would get
        // clicking through them one by one.
        ids.push(...await mergeGroup(g, pickKeeper(g.members)?.id));
        merged.push(g);
      }
    } catch (err) {
      toast(`Stopped after ${merged.length} of ${targets.length}: ${err?.message || 'merge failed'}`, 'error');
    } finally {
      await hydrateFromSupabase();
      window.dispatchEvent(new CustomEvent('lusso:data-changed'));
      onMerged(merged);
      setBusy(false);
      setAt(0);
      if (merged.length) {
        toast(`${merged.length} duplicate${merged.length === 1 ? '' : 's'} merged.`, 'info', {
          duration: 15000,
          onUndo: async () => {
            if (await undoMerges(ids)) {
              toast(`${merged.length} merge${merged.length === 1 ? '' : 's'} undone.`, 'info');
            }
          },
        });
      }
    }
  };

  if (!targets.length) return null;

  return (
    <Card className={`p-3.5 ${risky ? 'border-amber-200 bg-amber-50/60' : ''}`}>
      {confirming ? (
        <div className="space-y-2.5">
          <p className="text-sm font-semibold text-slate-900">
            Merge all {targets.length} group{targets.length === 1 ? '' : 's'} here ({records} records)?
          </p>
          <p className="text-xs text-slate-600">
            {risky
              ? `${section.warn} Read them first — this is the set most likely to contain people who are not duplicates.`
              : 'Each group keeps the record with the most history, already ticked on its card, and everything else moves onto it.'}
            {' '}It can all be undone in one click afterwards.
          </p>
          <div className="flex gap-2">
            <button
              onClick={run}
              className={`inline-flex items-center gap-1.5 rounded-xl text-white text-sm font-semibold px-3.5 py-2 ${
                risky ? 'bg-amber-600 hover:bg-amber-700' : 'bg-violet-600 hover:bg-violet-700'
              }`}
            >
              <Merge size={14} /> Yes, merge {targets.length}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 text-sm font-medium px-3.5 py-2"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800">{section.blurb}</p>
            {section.warn && <p className="text-xs text-amber-800 mt-0.5">{section.warn}</p>}
          </div>
          <button
            onClick={() => setConfirming(true)}
            disabled={busy}
            className={`flex-shrink-0 inline-flex items-center gap-1.5 rounded-xl text-white text-sm font-semibold px-3.5 py-2 transition-colors disabled:opacity-50 ${
              risky ? 'bg-amber-600 hover:bg-amber-700' : 'bg-violet-600 hover:bg-violet-700'
            }`}
          >
            {busy
              ? <><Loader size={14} className="animate-spin" /> Merging {at} of {targets.length}…</>
              : <><Merge size={14} /> Merge all {targets.length}</>}
          </button>
        </div>
      )}
    </Card>
  );
}

export default function DuplicateCustomers() {
  const [groups, setGroups] = useState(null);
  const [error, setError]   = useState('');
  const [done, setDone]     = useState([]);   // matchKeys merged this session

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

  const key = (g) => `${g.basis}:${g.matchKey}`;
  const remaining = useMemo(
    () => (groups ?? []).filter(g => !done.includes(key(g))),
    [groups, done],
  );

  const markMerged = (merged) =>
    setDone(prev => [...prev, ...(Array.isArray(merged) ? merged : [merged]).map(key)]);

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Users size={20} className="text-violet-600" /> Possible duplicates
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Records that may be the same person, grouped by what they have in common. Nothing merges
          until you say so, and every merge can be undone.
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

      {SECTIONS.map(section => {
        const targets = remaining.filter(section.match);
        if (!targets.length) return null;
        return (
          <section key={section.key} className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              {section.title} · {targets.length}
            </h2>
            <BulkBar section={section} targets={targets} onMerged={markMerged} />
            {targets.map(g => (
              <Group key={key(g)} group={g} onMerged={markMerged} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
