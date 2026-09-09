/**
 * Content — the whole pipeline on one page.
 *
 * Everything this needs lives here rather than half here and half in Settings.
 * Writing a page, reading it, changing it, deciding when it goes out, and the
 * things that govern all of that — the house style, the prompts, the keyword
 * list, the social connections — are one job done in one sitting, and splitting
 * them across two screens only means going back and forth.
 *
 * The old git-backed queue is not replaced. It still runs, it still holds the
 * pages already written, and it still publishes them on the same timetable. It
 * is linked from the Queue tab and lives on at /content/queue.
 */

import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  FileStack, Plus, RefreshCw, Loader2, AlertTriangle, Clock, Trash2, Wand2,
  Check, X, Globe, Camera, MessageCircle, Pencil, Tags, Share2, PenLine,
  FileSpreadsheet, CheckCircle2, GitBranch, ChevronRight, Send, Images, Upload,
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { supabase } from '../lib/supabase';
import Card from '../components/Card';
import { toast } from '../components/ToastContainer';
import { nextFreeSlot, perDay } from '../lib/contentSchedule';
import { publishImage, unpublishImage } from '../lib/contentMedia';

const CHANNEL_ICON = { web: Globe, instagram: Camera, facebook: MessageCircle };

const STATUS = {
  draft:     { label: 'Draft',     cls: 'bg-slate-100 text-slate-600' },
  queued:    { label: 'In site queue', cls: 'bg-amber-100 text-amber-700' },
  scheduled: { label: 'Scheduled', cls: 'bg-blue-100 text-blue-700' },
  published: { label: 'Live',      cls: 'bg-emerald-100 text-emerald-700' },
  failed:    { label: 'Failed',    cls: 'bg-rose-100 text-rose-700' },
};

const TABS = [
  { id: 'queue',    label: 'Queue',    Icon: FileStack },
  { id: 'prompts',  label: 'Prompts',  Icon: PenLine },
  { id: 'keywords', label: 'Keywords', Icon: Tags },
  { id: 'social',   label: 'Social',   Icon: Share2 },
  { id: 'schedule', label: 'Schedule', Icon: Clock },
];

// A datetime-local input speaks the browser's local time and carries no zone in
// its value, so it has to be fed and read in local parts — toISOString() here
// would shift every schedule by the UTC offset.
const toLocalInput = (iso) => {
  const d = new Date(iso), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

export default function Content() {
  const offline = !supabase;
  const [tab, setTab]       = useState('queue');
  const [posts, setPosts]   = useState(null);
  const [cfg, setCfg]       = useState(null);
  const [kinds, setKinds]   = useState([]);
  const [job, setJob]       = useState(null);
  const [error, setError]   = useState(null);
  const [busy, setBusy]     = useState(false);
  const [topic, setTopic]   = useState('');
  const [open, setOpen]     = useState(null);
  const [edit, setEdit]     = useState(null);
  const [instruction, setInstruction] = useState('');
  const [repo, setRepo] = useState(null);

  const load = useCallback(async () => {
    const posts$ = supabase.from('content_posts')
      // select('*') rather than a column list. Four separate bugs in this file
      // and in content-publish came from the same cause: a column the code
      // needed that the query did not ask for, failing silently as undefined
      // rather than erroring. The list is already fetching body_html, so the
      // remaining columns cost almost nothing, and the whole class of mistake
      // disappears.
      .select('*')
      .is('deleted_at', null)
      .order('scheduled_for', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    const cfg$   = supabase.from('content_settings').select('*').eq('id', 1).maybeSingle();
    const kinds$ = supabase.from('content_prompts').select('*').order('sort');
    const jobs$  = supabase.from('content_jobs').select('*').eq('status', 'running')
      .order('started_at', { ascending: false }).limit(1);
    // The pages already written and waiting on the `queue` branch. They are the
    // real backlog — showing only what this system wrote would report an empty
    // pipeline while two dozen pages sit ready to go.
    const repo$  = supabase.functions.invoke('content-queue-status');
    const [{ data: rows, error: e1 }, { data: c }, { data: k }, { data: j }, repoRes] =
      await Promise.all([posts$, cfg$, kinds$, jobs$, repo$]);

    if (e1) return setError(e1.message);
    setError(null);
    setPosts(rows ?? []);
    setCfg(c);
    setKinds(k ?? []);
    setJob(j?.[0] ?? null);
    setRepo(repoRes?.data?.ok ? repoRes.data : null);
  }, []);

  useEffect(() => { if (!offline) load(); }, [load, offline]);

  // Watch a running job rather than making anyone refresh.
  useEffect(() => {
    if (!job || offline) return;
    const t = setInterval(async () => {
      const { data } = await supabase.from('content_jobs').select('*').eq('id', job.id).maybeSingle();
      // Keep the step fresh even while it runs -- writing a page is a
      // three-call, four-minute affair and silence reads as a hang.
      if (data?.step && data.step !== job.step) setJob(j => ({ ...j, step: data.step }));
      if (!data || data.status === 'running') return;
      clearInterval(t);
      setJob(null);
      toast(data.status === 'failed'
        ? `Couldn't write that: ${data.error}`
        : (data.kind === 'revise' ? 'Revision applied.' : 'A new draft is ready.'),
        data.status === 'failed' ? 'error' : 'success',
        data.status === 'failed' ? { duration: 12000 } : undefined);
      load();
    }, 3000);
    return () => clearInterval(t);
  }, [job, load, offline]);

  const slots = cfg?.slots ?? [{ hour: 9, count: 2 }, { hour: 14, count: 2 }];
  const rate  = perDay(slots);

  const drafts    = (posts ?? []).filter(p => p.status === 'draft');
  const upcoming  = (posts ?? []).filter(p => ['queued', 'scheduled'].includes(p.status));
  const failed    = (posts ?? []).filter(p => p.status === 'failed');
  const live      = (posts ?? []).filter(p => p.status === 'published');
  // One list, in the order things actually publish. A page written here that has
  // reached the branch appears in BOTH sources — the row carries the commit sha
  // in external_id — so the repo entry is dropped when a row already covers it.
  const repoRate = repo?.perDay || rate || 1;
  const covered = new Set(
    (posts ?? []).map(p => p.external_id).filter(Boolean).map(sha => sha.slice(0, 7)));

  const repoWaiting = (repo?.all ?? [])
    .filter(c => !covered.has(c.sha))
    .map((c, i) => ({
      key: `repo-${c.sha}`,
      source: 'repo',
      sha: c.sha,
      // Commit subjects read "Add the X post" / "Add the X service page".
      title: c.message.replace(/^Add (the )?/i, '').replace(/\s+(post|service page|page)$/i, ''),
      landsInDays: Math.floor(i / repoRate),
    }));

  // Rows not yet on the branch come first: they publish on their own date,
  // whereas a repo page waits its turn behind everything ahead of it.
  const waiting = [
    ...upcoming.map(p => ({ key: p.id, source: 'db', post: p })),
    ...repoWaiting,
  ];

  const totalWaiting = upcoming.length + repoWaiting.length;
  const daysLeft  = Math.floor(totalWaiting / (rate || 1));

  // `override` exists because a topic chip sets the input and starts the write
  // in the same click, and the state update has not landed by then.
  const write = async (kind, override) => {
    setBusy(true);
    const { data, error: err } = await supabase.functions.invoke('content-write', {
      body: { action: 'write', kind, topic: (override ?? topic).trim() || undefined },
    });
    setBusy(false);
    if (err || data?.error) return toast(`Couldn't start: ${data?.error || err.message}`, 'error', { duration: 9000 });
    if (data.alreadyRunning) return toast(data.why, 'info');
    setTopic('');
    toast('Writing — this takes a few minutes.', 'success');
    load();
  };

  const patch = async (id, fields, note) => {
    const { error: err } = await supabase.from('content_posts').update(fields).eq('id', id);
    if (err) return toast(`Couldn't save: ${err.message}`, 'error');
    if (note) toast(note, 'success');
    load();
  };

  // Approving resolves the slot to a real timestamp now, so the list shows the
  // date a page lands rather than its position in a pile.
  const approve = (post) => {
    const when = nextFreeSlot(slots, cfg?.timezone || 'Australia/Brisbane',
      upcoming.filter(p => p.scheduled_for).map(p => p.scheduled_for));
    if (!when) return toast('No publishing times set — add one under Schedule.', 'error');
    patch(post.id, { status: 'scheduled', scheduled_for: when.toISOString(), publish_error: null },
      `Scheduled for ${format(when, 'EEE d MMM, h:mmaaa')}`);
  };

  // Two very different costs behind one button, so it always asks first: for a
  // page not yet committed this is instant and affects nothing else, but for one
  // already on the queue branch git history is linear — publishing it publishes
  // everything queued ahead of it too.
  const postNow = async (post) => {
    setBusy(true);
    const { data: plan, error: e1 } = await supabase.functions.invoke('content-post-now', {
      body: { postId: post.id, preview: true },
    });
    setBusy(false);
    if (e1 || plan?.error) return toast(`Couldn't check: ${plan?.error || e1.message}`, 'error');
    if (plan.alreadyLive) { toast('That page is already live.', 'info'); return load(); }
    if (!window.confirm(`${plan.message}\n\nGo ahead?`)) return;

    setBusy(true);
    const { data, error: e2 } = await supabase.functions.invoke('content-post-now', {
      body: { postId: post.id },
    });
    setBusy(false);
    if (e2 || data?.error) return toast(`Couldn't publish: ${data?.error || e2.message}`, 'error', { duration: 9000 });
    toast(data.mode === 'commit'
      ? 'Added to the site queue.'
      : `Published ${data.published} page${data.published === 1 ? '' : 's'} — the deploy takes a minute or two.`,
      'success');
    load();
  };

  /**
   * Delete a post, with a confirmation that says what it will actually do.
   *
   * The wording changes with status because the consequences do: a draft is
   * just a row, a queued page is also a file on the site's queue branch, and a
   * live page stays live — taking a published URL down is an SEO decision, not
   * a tidy-up, so this deliberately does not do it.
   */
  const remove = async (post) => {
    const what = post.title || post.caption?.slice(0, 60) || 'this post';
    const consequence =
      post.status === 'queued'   ? 'It will also be removed from the site queue, so it cannot publish.'
    : post.status === 'published' ? 'The page STAYS LIVE on the site — this only removes it from the list. '
                                  + 'To take it off the site, delete the page from the repo.'
    : post.status === 'scheduled' ? 'It will not publish.'
                                  : '';
    if (!window.confirm(`Delete "${what}"?\n\n${consequence}\n\nThis cannot be undone from here.`)) return;

    setBusy(true);
    const { data, error: err } = await supabase.functions.invoke('content-post-now', {
      body: { action: 'delete', postId: post.id },
    });
    setBusy(false);
    if (err || data?.error) return toast(`Couldn't delete: ${data?.error || err.message}`, 'error', { duration: 9000 });
    toast(data.removedFile ? `Deleted, and removed ${data.removedFile} from the queue.` : 'Deleted.', 'success');
    if (open?.id === post.id) setOpen(null);
    load();
  };

  const revise = async () => {
    const text = instruction.trim();
    if (text.length < 4) return;
    setBusy(true);
    const { data, error: err } = await supabase.functions.invoke('content-write', {
      body: { action: 'revise', postId: open.id, instruction: text, kind: open.kind ?? 'blog' },
    });
    setBusy(false);
    if (err || data?.error) return toast(`Couldn't start: ${data?.error || err.message}`, 'error');
    if (data.alreadyRunning) return toast(data.why, 'info');
    setInstruction('');
    toast('Revising — a couple of minutes.', 'success');
    load();
  };

  if (offline) {
    return (
      <div className="p-4 sm:p-6 max-w-6xl mx-auto">
        <Card className="px-5 py-4 text-sm text-slate-500">
          Not connected to a database — this page has nothing to show.
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <FileStack size={22} className="text-amber-500" /> Content
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Write it, read it, change it, and decide when it goes out.
          </p>
        </div>
        <button onClick={load} aria-label="Refresh" className="mt-1 text-slate-400 hover:text-slate-600">
          <RefreshCw size={16} />
        </button>
      </div>

      {error && (
        <Card className="px-5 py-4 flex items-center gap-2 text-sm text-rose-600">
          <AlertTriangle size={15} /> {error}
        </Card>
      )}

      {/* ── The numbers ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Days of content" value={posts === null ? '—' : daysLeft}
          hint={`${rate}/day`} warn={posts !== null && daysLeft < (cfg?.low_water_days ?? 2)} />
        <Stat label="Waiting to publish" value={posts === null ? '—' : totalWaiting}
          hint={repoWaiting.length ? `${repoWaiting.length} from the repo` : null} />
        <Stat label="Drafts to read" value={posts === null ? '—' : drafts.length} />
        <Stat label="Live" value={posts === null ? '—' : live.length} />
      </div>

      {/* ── Write something ────────────────────────────────────────────── */}
      <Card className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {kinds.filter(k => k.enabled).map(({ kind, label, channel }) => {
            const Icon = CHANNEL_ICON[channel] ?? Globe;
            return (
              <button key={kind} onClick={() => write(kind)} disabled={busy || !!job}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5
                           text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                {job ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                <Icon size={14} /> {label}
              </button>
            );
          })}
        </div>
        <input value={topic} onChange={e => setTopic(e.target.value)}
          placeholder="Optional — a topic to write about. Leave empty to use the best unspent keyword."
          className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" />

        {job && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-600">
            <Loader2 size={12} className="animate-spin" />
            {job.step
              ? job.step.charAt(0).toUpperCase() + job.step.slice(1)
              : (job.kind === 'revise' ? 'Revising' : 'Writing')} — started {formatDistanceToNow(new Date(job.started_at))} ago.
            You can leave this page.
          </p>
        )}
      </Card>

      {/* ── Tabs ───────────────────────────────────────────────────────── */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
              tab === id ? 'border-amber-500 text-amber-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'queue' && (
        <QueueTab posts={posts} drafts={drafts} upcoming={upcoming} failed={failed} live={live}
          onOpen={(p) => { setOpen(p); setEdit(null); }} onApprove={approve}
          onPostNow={postNow} onDelete={remove} busy={busy} waiting={waiting}
          onReschedule={(p, v) => patch(p.id, { scheduled_for: new Date(v).toISOString() }, 'Moved.')} />
      )}
      {tab === 'prompts'  && <PromptsTab kinds={kinds} reload={load} />}
      {tab === 'keywords' && <KeywordsTab kinds={kinds} />}
      {tab === 'social'   && <SocialTab />}
      {tab === 'schedule' && <ScheduleTab cfg={cfg} slots={slots} reload={load} />}

      {open && (
        <Reader post={open} edit={edit} setEdit={setEdit} busy={busy} job={job}
          instruction={instruction} setInstruction={setInstruction} onRevise={revise}
          onSave={async () => {
            await patch(open.id, edit, 'Saved.');
            setOpen({ ...open, ...edit });
            setEdit(null);
          }}
          onClose={() => { setOpen(null); setEdit(null); setInstruction(''); }}
          onDelete={() => remove(open)} />
      )}
    </div>
  );
}

function Stat({ label, value, hint, warn }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-0.5 text-2xl font-bold ${warn ? 'text-amber-600' : 'text-slate-900'}`}>{value}</p>
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
    </Card>
  );
}

/* ── Queue ───────────────────────────────────────────────────────────────── */

function QueueTab({ posts, drafts, failed, live, onOpen, onApprove, onReschedule, onPostNow, onDelete, busy, waiting }) {
  if (posts === null) return <p className="text-sm text-slate-400">Loading…</p>;
  return (
    <div className="space-y-4">
      {/* The pipeline that is live today still runs on its own branch. Linking
          it rather than hiding it keeps the real state of the world visible
          while pages move across. */}
      <Card className="px-5 py-3">
        <Link to="/content/queue" className="flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900">
          <GitBranch size={15} className="text-slate-400" />
          <span className="flex-1">The original queue — pages already written, publishing from the SEO repo</span>
          <ChevronRight size={15} className="text-slate-400" />
        </Link>
      </Card>

      {drafts.length > 0 && (
        <Section title="Drafts" note="read before they go out">
          {drafts.map(p => (
            <Row key={p.id} post={p} onOpen={() => onOpen(p)} onDelete={onDelete} action={
              <button onClick={() => onApprove(p)}
                className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-slate-700">
                <Check size={12} /> Approve
              </button>} />
          ))}
        </Section>
      )}

      <Section title="Waiting to publish"
        note={waiting.length
          ? 'in the order they go out'
          : 'nothing yet — approve a draft to queue it'}>
        {waiting.map(item => item.source === 'db' ? (
          <Row key={item.key} post={item.post} onOpen={() => onOpen(item.post)}
            onReschedule={(v) => onReschedule(item.post, v)} onDelete={onDelete}
            action={
              <button onClick={() => onPostNow(item.post)} disabled={busy}
                title={item.post.status === 'queued'
                  ? 'Publish this page — and anything queued ahead of it'
                  : 'Add this page to the site queue now'}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1
                           text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                <Send size={11} /> Post now
              </button>} />
        ) : (
          <RepoRow key={item.key} item={item} />
        ))}
      </Section>

      {failed.length > 0 && (
        <Section title="Didn't publish" tone="rose">
          {failed.map(p => (
            <li key={p.id} className="py-2.5">
              <button onClick={() => onOpen(p)} className="text-left text-sm font-medium text-slate-800 hover:underline">
                {p.title || p.caption?.slice(0, 60) || 'Untitled'}
              </button>
              {p.publish_error?.startsWith('audit failed') ? (
                <div className="mt-1 rounded-md bg-rose-50 px-2.5 py-2">
                  <p className="text-xs font-medium text-rose-800">
                    {p.publish_error.slice(0, p.publish_error.indexOf(':'))} — fix these, then try again
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {p.publish_error.slice(p.publish_error.indexOf(':') + 1).split(';').map((f, i) => (
                      <li key={i} className="text-xs text-rose-700">• {f.trim()}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="mt-0.5 text-xs text-rose-600">{p.publish_error}</p>
              )}
              <button onClick={() => onPostNow(p)} disabled={busy}
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 disabled:opacity-40">
                <Send size={11} /> Try again
              </button>
            </li>
          ))}
        </Section>
      )}

      {live.length > 0 && (
        <Section title="Live">
          {live.slice(0, 20).map(p => <Row key={p.id} post={p} onOpen={() => onOpen(p)} />)}
        </Section>
      )}
    </div>
  );
}

function Section({ title, note, tone, children }) {
  return (
    <Card className="px-5 py-4">
      <h2 className={`text-sm font-semibold ${tone === 'rose' ? 'text-rose-700' : 'text-slate-800'}`}>
        {title}{note && <span className="ml-1 font-normal text-slate-400">— {note}</span>}
      </h2>
      <ul className="mt-2 divide-y divide-slate-100">{children}</ul>
    </Card>
  );
}

function RepoRow({ item }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <GitBranch size={15} className="shrink-0 text-slate-300" />
      <Link to="/content/queue" className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm text-slate-700 hover:underline">{item.title}</span>
        <span className="block truncate text-xs text-slate-400">already written · from the repo</span>
      </Link>
      <span className="shrink-0 text-xs text-slate-400">
        {item.landsInDays === 0 ? 'today' : item.landsInDays === 1 ? 'tomorrow' : `in ${item.landsInDays} days`}
      </span>
    </li>
  );
}

function Row({ post, onOpen, onReschedule, onDelete, action }) {
  const Icon = CHANNEL_ICON[post.channel] ?? Globe;
  const s = STATUS[post.status] ?? STATUS.draft;
  // A picture is most of what a social post IS — a list that shows only the
  // caption is asking you to approve something you cannot see.
  const thumb = post.images?.[0]?.url;
  return (
    <li className="flex items-center gap-3 py-2.5">
      {thumb ? (
        <img src={thumb} alt="" loading="lazy"
          className="h-10 w-10 shrink-0 rounded object-cover ring-1 ring-slate-200" />
      ) : (
        <Icon size={15} className="shrink-0 text-slate-400" />
      )}
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-sm font-medium text-slate-800 hover:underline">
          {post.title || post.caption?.slice(0, 70) || 'Untitled'}
        </span>
        {post.slug && <span className="block truncate text-xs text-slate-400">/{post.slug}</span>}
      </button>
      <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.label}</span>
      {onReschedule && post.scheduled_for && post.status !== 'queued' ? (
        <input type="datetime-local" value={toLocalInput(post.scheduled_for)}
          onChange={e => e.target.value && onReschedule(e.target.value)}
          className="shrink-0 rounded border border-slate-200 px-2 py-1 text-xs text-slate-600" />
      ) : post.status === 'queued' ? (
        <span className="shrink-0 text-xs text-slate-400">waiting its turn</span>
      ) : post.published_at ? (
        <span className="shrink-0 text-xs text-slate-400">{format(new Date(post.published_at), 'd MMM')}</span>
      ) : null}
      {action}
      {onDelete && (
        <button onClick={() => onDelete(post)}
          className="shrink-0 text-slate-300 hover:text-rose-600" aria-label="Delete">
          <Trash2 size={14} />
        </button>
      )}
    </li>
  );
}

/* ── Prompts ─────────────────────────────────────────────────────────────── */

/**
 * One editor per kind, ported from .claude/skills/{blog,service}/SKILL.md.
 *
 * The durable half of those files: non-negotiables, voice, section order. Not
 * the tooling they wrap — preflight, Pexels, Higgsfield, audit-seo.py, the
 * commit and the push — because none of that exists once a page is a row.
 */
function PromptsTab({ kinds, reload }) {
  const [open, setOpen]     = useState(null);
  const [draft, setDraft]   = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (kind) => {
    setSaving(true);
    const { error } = await supabase.from('content_prompts')
      .update({ prompt: draft, updated_at: new Date().toISOString() }).eq('kind', kind);
    setSaving(false);
    if (error) return toast(`Couldn't save: ${error.message}`, 'error');
    toast('Saved — the next one written will follow it.', 'success');
    setOpen(null); reload();
  };

  const toggle = async (row) => {
    // Turning a kind off hides its button without discarding the prompt, so
    // turning it back on is not a rewrite.
    await supabase.from('content_prompts').update({ enabled: !row.enabled }).eq('kind', row.kind);
    reload();
  };

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-slate-800">What each kind should be</h2>
      <p className="mt-1 text-xs text-slate-500">
        One prompt per button above. A blog post explains, a service page sells, a caption has
        one line to land — these are what tell the writer which it is doing.
      </p>

      {kinds.map(row => (
        <div key={row.kind} className="mt-3 rounded-lg border border-slate-200">
          <div className="flex items-center gap-2 px-3 py-2">
            <button className="flex-1 text-left"
              onClick={() => { setOpen(open === row.kind ? null : row.kind); setDraft(row.prompt ?? ''); }}>
              <span className="text-sm font-medium text-slate-800">{row.label}</span>
              <span className="ml-2 text-xs text-slate-400">
                {row.channel}
                {row.keyword_intent?.length ? ` · ${row.keyword_intent.join(', ')}` : ''}
                {row.max_kd != null ? ` · KD ≤ ${row.max_kd}` : ''}
              </span>
            </button>
            <button onClick={() => toggle(row)}
              className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                row.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {row.enabled ? 'On' : 'Off'}
            </button>
          </div>
          {open === row.kind && (
            <div className="border-t border-slate-100 p-3">
              <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={18}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs leading-relaxed" />
              <div className="mt-2 flex gap-2">
                <button onClick={() => save(row.kind)} disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40">
                  {saving && <Loader2 size={14} className="animate-spin" />} Save
                </button>
                <button onClick={() => setOpen(null)} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:text-slate-800">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </Card>
  );
}

/* ── Keywords ────────────────────────────────────────────────────────────── */

function KeywordsTab({ kinds }) {
  const [rows, setRows] = useState(null);
  const [kind, setKind] = useState('blog');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('content_keywords')
      .select('id, keyword, volume, difficulty, intent, tags, kind, used_at, excluded, score')
      .order('score', { ascending: false, nullsFirst: false }).limit(500);
    setRows(data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  /**
   * A Semrush export, as exported — 18 columns, of which we use seven.
   *
   * Semrush quotes any field containing a comma (SERP Features and Trend always
   * do), so a naive split on "," tears rows apart at the wrong place.
   *
   * The do-not-target tag rides along in `tags` rather than being flattened into
   * `excluded`: that column is the user's own skip, and conflating the two means
   * a re-import resurrects something deliberately skipped.
   */
  const parseCsv = (text) => {
    const out = []; let field = '', row = [], quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); out.push(row); row = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field || row.length) { row.push(field); out.push(row); }
    if (!out.length) return [];

    const head = out[0].map(h => h.trim().toLowerCase());
    const at = (r, n) => { const i = head.indexOf(n); return i === -1 ? '' : (r[i] ?? '').trim(); };
    const num = (v) => { const n = Number(String(v).replace(/[^\d.]/g, '')); return Number.isFinite(n) && n !== 0 ? n : null; };

    return out.slice(1).filter(r => r.length > 1).map(r => {
      const keyword = at(r, 'keyword').toLowerCase();
      if (!keyword) return null;
      // Note what is absent: `used_at` and `excluded`. Those are decisions, and
      // a re-import must never overwrite them.
      return {
        keyword,
        volume:     num(at(r, 'volume')),
        difficulty: num(at(r, 'keyword difficulty')) ?? 0,
        cpc:        num(at(r, 'cpc (usd)')),
        intent:     at(r, 'intent') || null,
        seed:       at(r, 'seed keyword') || null,
        tags:       at(r, 'tags') || null,
        kind,
      };
    }).filter(Boolean);
  };

  const syncKeywords = async () => {
    setBusy(true); setNote(null);
    try {
      const { data, error } = await supabase.functions.invoke('semrush-sync', { body: { source: 'auto' } });
      if (error) throw new Error(error.message);
      if (!data?.ok) throw new Error(data?.notes?.join('; ') || 'the sync returned nothing');
      // The notes carry the source actually used. A sync that fell back to the
      // committed exports must say so rather than implying a live pull.
      setNote(`Synced ${data.imported} keywords`
        + (data.source === 'repo' ? ' from the exports in the site repo' : ' live from Semrush')
        + (data.notes?.length ? ` · ${data.notes.join(' · ')}` : ''));
      load();
    } catch (e) {
      toast(`Couldn't sync: ${e.message}`, 'error', { duration: 9000 });
    } finally { setBusy(false); }
  };

  const importFile = async (file) => {
    if (!file) return;
    setBusy(true); setNote(null);
    try {
      const parsed = parseCsv(await file.text());
      if (!parsed.length) throw new Error('no keyword rows found — is this a Semrush export?');
      const seen = new Set();
      const unique = parsed.filter(r => !seen.has(r.keyword) && seen.add(r.keyword));
      // A real upsert, not ignoreDuplicates: a fresher export should correct
      // last quarter's volume rather than being discarded because the term is
      // already listed.
      const { error } = await supabase.from('content_keywords').upsert(unique, { onConflict: 'keyword' });
      if (error) throw new Error(error.message);
      const blocked = unique.filter(r => /do-not-target/i.test(r.tags ?? '')).length;
      setNote(`Imported ${unique.length} as ${kind}${blocked ? ` · ${blocked} tagged do-not-target` : ''}`);
      load();
    } catch (e) {
      toast(`Couldn't import: ${e.message}`, 'error', { duration: 9000 });
    } finally { setBusy(false); }
  };

  const blockedByTag = (r) => /do-not-target/i.test(r.tags ?? '');
  const shown  = (rows ?? []).filter(r => !r.kind || r.kind === kind);
  const unused = shown.filter(r => !r.used_at && !r.excluded && !blockedByTag(r));

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-slate-800">Keywords</h2>
      <p className="mt-1 text-xs text-slate-500">
        Straight from a Semrush export, ranked the way the SEO scripts rank them — volume ÷
        (difficulty + 10), commercial intent worth 1.3× — and spent when something is written
        for it, so two pages never chase the same search.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select value={kind} onChange={e => setKind(e.target.value)}
          className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm">
          {kinds.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
        </select>
        <button onClick={syncKeywords} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-sm
                     font-medium text-white hover:bg-slate-800 disabled:opacity-40">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Sync from Semrush
        </button>
        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200
                           px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 ${busy ? 'opacity-40' : ''}`}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
          Import a Semrush CSV
          <input type="file" accept=".csv,text/csv" className="hidden" disabled={busy}
            onChange={e => { importFile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </div>
      <p className="mt-1.5 text-xs text-slate-400">
        Syncs weekly on its own. Blog and service keywords are separate lists — Semrush exports them
        as two files, because “blinds brisbane” makes a good service page and a bad article.
      </p>

      {note && <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-600">
        <CheckCircle2 size={12} /> {note}</p>}

      {rows === null && <p className="mt-3 text-sm text-slate-400">Loading…</p>}
      {rows && (
        <>
          <p className="mt-4 text-xs font-medium text-slate-600">
            {unused.length} left · {shown.length - unused.length} spent or skipped
          </p>
          <ul className="mt-2 max-h-80 divide-y divide-slate-100 overflow-y-auto">
            {shown.slice(0, 200).map(r => (
              <li key={r.id} className="flex items-center gap-2 py-1.5 text-sm">
                <span className={`flex-1 truncate ${r.used_at || r.excluded || blockedByTag(r) ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                  {r.keyword}
                </span>
                {r.volume != null && (
                  <span className="shrink-0 text-xs text-slate-400">
                    {r.volume}
                    {/* "KD ?" rather than nothing: an unrefreshed difficulty is
                        not the same as an easy one, and the blank read as
                        "nobody cared to look" instead of "Semrush has not
                        measured this". Scored as the median, 17, not as 0. */}
                    <span className="text-slate-300"> · KD {r.difficulty ?? '?'}</span>
                  </span>
                )}
                {r.used_at && <span className="shrink-0 text-[11px] text-emerald-600">written</span>}
                {r.excluded && <span className="shrink-0 text-[11px] text-slate-400">skipped</span>}
                {!r.excluded && blockedByTag(r) &&
                  <span className="shrink-0 text-[11px] text-slate-400" title="Tagged do-not-target in Semrush">blocked</span>}
                {!r.used_at && (
                  <button onClick={async () => {
                      await supabase.from('content_keywords').update({ excluded: !r.excluded }).eq('id', r.id);
                      load();
                    }}
                    className="shrink-0 text-slate-300 hover:text-rose-600"
                    aria-label={r.excluded ? 'Put this keyword back' : 'Skip this keyword'}>
                    {r.excluded ? <Plus size={13} /> : <Trash2 size={13} />}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

/* ── Social ──────────────────────────────────────────────────────────────── */

function SocialTab() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    // The view, never the table: content_channels holds the page access token
    // and no policy grants select on it. Reading through the view is what stops
    // a future `select *` here from publishing it.
    const { data } = await supabase.from('content_channels_safe').select('*');
    setRows(data ?? []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const connect = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke('meta-oauth-start');
    setBusy(false);
    if (error || !data?.url) return toast(`Couldn't start: ${data?.error || error?.message}`, 'error', { duration: 9000 });
    window.location.href = data.url;
  };

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold text-slate-800">Instagram & Facebook</h2>
      <p className="mt-1 text-xs text-slate-500">
        Instagram publishes through the Facebook Page it is linked to, so connecting once covers
        both. Meta's tokens expire about every 60 days — this warns a fortnight out, rather than
        letting posts start failing with no explanation.
      </p>

      {rows === null && <p className="mt-3 text-sm text-slate-400">Loading…</p>}
      {rows?.length === 0 && <p className="mt-3 text-sm text-slate-400">Nothing connected yet.</p>}

      {rows?.map(c => (
        <div key={c.id} className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-emerald-500" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-800">{c.display_name || c.channel}</p>
            <p className="text-xs text-slate-500">
              {c.channel}
              {c.expires_at && ` · expires ${formatDistanceToNow(new Date(c.expires_at), { addSuffix: true })}`}
            </p>
            {c.expiring_soon && (
              <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-600">
                <AlertTriangle size={12} /> Reconnect soon — posts start failing when this lapses
              </p>
            )}
            {c.last_error && <p className="mt-1 text-xs text-rose-600">{c.last_error}</p>}
          </div>
          <button onClick={async () => {
              await supabase.from('content_channels').delete().eq('id', c.id);
              toast('Disconnected.', 'success'); load();
            }}
            className="shrink-0 text-slate-400 hover:text-rose-600" aria-label="Disconnect">
            <X size={15} />
          </button>
        </div>
      ))}

      <button onClick={connect} disabled={busy}
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5
                   text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
        Connect a Facebook Page
      </button>
    </Card>
  );
}

/* ── Schedule & house style ──────────────────────────────────────────────── */

function ScheduleTab({ cfg, slots: initial, reload }) {
  const [slots, setSlots] = useState(initial);
  const [days, setDays]   = useState(cfg?.low_water_days ?? 2);
  const [brief, setBrief] = useState(cfg?.brief ?? '');
  const [saving, setSaving] = useState(false);

  const save = async (fields, note) => {
    setSaving(true);
    const { error } = await supabase.from('content_settings')
      .update({ ...fields, updated_at: new Date().toISOString() }).eq('id', 1);
    setSaving(false);
    if (error) return toast(`Couldn't save: ${error.message}`, 'error');
    toast(note, 'success'); reload();
  };

  const saveSlots = () => {
    const clean = slots
      .filter(s => Number.isFinite(+s.hour) && +s.count > 0)
      .map(s => ({ hour: Math.trunc(+s.hour), count: Math.trunc(+s.count) }))
      .filter((s, i, a) => a.findIndex(x => x.hour === s.hour) === i)
      .sort((a, b) => a.hour - b.hour);
    if (!clean.length) return toast('Add at least one publishing time.', 'error');
    save({ slots: clean }, `Saved — ${perDay(clean)} a day, from the next one scheduled on.`);
  };

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-800">When things go out</h2>
        <p className="mt-1 text-xs text-slate-500">
          In {cfg?.timezone || 'Australia/Brisbane'}. Changing these affects everything scheduled
          from here on — pages that already have a date keep it.
        </p>
        <div className="mt-3 space-y-2">
          {slots.map((s, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <select value={s.hour}
                onChange={e => setSlots(v => v.map((x, j) => j === i ? { ...x, hour: +e.target.value } : x))}
                className="rounded border border-slate-200 px-2 py-1">
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                ))}
              </select>
              <input type="number" min="1" max="4" value={s.count}
                onChange={e => setSlots(v => v.map((x, j) => j === i ? { ...x, count: +e.target.value } : x))}
                className="w-16 rounded border border-slate-200 px-2 py-1" />
              <span className="text-xs text-slate-500">post{s.count === 1 ? '' : 's'}</span>
              <button onClick={() => setSlots(v => v.filter((_, j) => j !== i))}
                className="text-slate-400 hover:text-rose-600" aria-label="Remove time">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button onClick={() => setSlots(v => [...v, { hour: 12, count: 1 }])}
            className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-slate-900">
            <Plus size={12} /> Add a time
          </button>
          <button onClick={saveSlots} disabled={saving}
            className="ml-auto rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40">
            Save times
          </button>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-800">Tell me when it's running low</h2>
        <p className="mt-1 text-xs text-slate-500">
          A notification when fewer than this many days of content remain scheduled. It links
          straight back here. One a day at most, however long the queue stays low.
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input type="number" min="0" max="30" value={days} onChange={e => setDays(+e.target.value)}
            className="w-20 rounded border border-slate-200 px-2 py-1 text-sm" />
          <span className="text-sm text-slate-500">days</span>
          <button onClick={() => save({ low_water_days: days }, `Saved — you'll hear at ${days} days.`)}
            disabled={saving}
            className="ml-auto rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40">
            Save
          </button>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold text-slate-800">House style</h2>
        <p className="mt-1 text-xs text-slate-500">
          Handed to the writer with everything, on top of the per-kind prompt. Say how the
          business sounds and what it will never say. Leave it empty to use the built-in default.
        </p>
        <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={10}
          className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-relaxed" />
        <button onClick={() => save({ brief }, 'Saved.')} disabled={saving}
          className="mt-2 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40">
          Save
        </button>
      </Card>
    </div>
  );
}

/* ── Reader ──────────────────────────────────────────────────────────────── */

function Reader({ post, edit, setEdit, busy, job, instruction, setInstruction,
                  onRevise, onSave, onClose, onDelete }) {
  const isWeb = post.channel === 'web';
  const editing = edit !== null;
  const [full, setFull] = useState(null);   // null = not asked, '' = loading

  const loadFull = async () => {
    setFull('');
    const { data, error } = await supabase.functions.invoke('content-post-now', {
      body: { action: 'preview', postId: post.id },
    });
    if (error || data?.error) {
      setFull(null);
      return toast(`Couldn't build the preview: ${data?.error || error.message}`, 'error');
    }
    // Three fixes, all of them already proven by the original queue preview —
    // see ContentQueue.jsx, which hit every one of these:
    //
    //   1. Strip the CSP meta FIRST. Inside an iframe `default-src 'self'`
    //      resolves to nothing useful and blocks the lot, including the
    //      stylesheet, so the page renders as unstyled text.
    //   2. <base> so the site's relative CSS, fonts and images resolve against
    //      lusso.com.au rather than the CRM.
    //   3. Force the reveal animation off. The site fades most of a page in on
    //      scroll (`.reveal { opacity: 0 }` until an IntersectionObserver adds
    //      `.is-in`), and no scripts run under sandbox="" — so without this the
    //      article is invisible. Killing the animation beats allowing scripts:
    //      this is a proofreading view, so every word should be on screen, and
    //      the markup stays unable to execute anything inside the CRM.
    const REVEAL_SHIM = '<style>.reveal{opacity:1 !important;transform:none !important;'
      + 'transition:none !important}</style>';
    setFull(data.html
      .replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '')
      .replace(/<head([^>]*)>/i, '<head$1><base href="https://www.lusso.com.au/">')
      // After the site stylesheet, never before it — an override that loses the
      // cascade is an override that does nothing.
      .replace(/<\/head>/i, REVEAL_SHIM + '</head>'));
  };
  const start = () => setEdit(isWeb
    ? { title: post.title ?? '', body_html: post.body_html ?? '' }
    : { caption: post.caption ?? '', images: [...(post.images ?? [])] });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:p-8"
      onClick={onClose}>
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-slate-900">{post.title || 'Post'}</h3>
            {post.slug && <p className="truncate text-xs text-slate-400">/{post.slug}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {!editing && isWeb && (
              <button onClick={() => (full === null ? loadFull() : setFull(null))}
                className={`text-xs font-medium ${full !== null ? 'text-amber-600' : 'text-slate-500 hover:text-slate-800'}`}>
                {full === '' ? 'Building…' : full ? 'Show text' : 'Real page'}
              </button>
            )}
            {!editing && <button onClick={start} className="text-slate-400 hover:text-slate-700" aria-label="Edit"><Pencil size={16} /></button>}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close"><X size={18} /></button>
          </div>
        </div>

        <div className={full ? '' : 'max-h-[60vh] overflow-y-auto px-5 py-4'}>
          {full ? (
            <iframe title="Exactly what will be published" srcDoc={full} sandbox=""
              className="h-[70vh] w-full rounded-b-xl border-0" />
          ) : editing ? (
            <div className="space-y-3">
              {isWeb && (
                <input value={edit.title} onChange={e => setEdit({ ...edit, title: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium" placeholder="Title" />
              )}
              <textarea rows={isWeb ? 18 : 6}
                value={isWeb ? edit.body_html : edit.caption}
                onChange={e => setEdit(isWeb ? { ...edit, body_html: e.target.value } : { ...edit, caption: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs leading-relaxed" />
              {!isWeb && <ImageEditor edit={edit} setEdit={setEdit} />}
            </div>
          ) : isWeb ? (
            // The body is a fragment the template wraps, so it renders here with
            // no iframe, no <base> and no stylesheet borrowed off the live site —
            // the three workarounds the git-backed preview needs, because its
            // pages only exist as whole documents on a private branch.
            <article className="article-preview" dangerouslySetInnerHTML={{ __html: post.body_html ?? '' }} />
          ) : (
            <div className="space-y-3">
              {post.images?.length ? (
                <div className="space-y-2">
                  {post.images.length > 1 && (
                    <p className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
                      <Images size={13} /> Carousel — {post.images.length} slides, in this order
                    </p>
                  )}
                  {post.images.map((im, i) => (
                    <div key={i} className="relative">
                      <img src={im.url} alt={im.alt ?? ''} className="w-full rounded-lg object-cover" />
                      {post.images.length > 1 && (
                        <span className="absolute left-2 top-2 rounded bg-slate-900/70 px-1.5 py-0.5 text-[11px] font-medium text-white">
                          {i + 1}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  <AlertTriangle size={13} /> No image — Instagram will refuse this post.
                </p>
              )}
              <p className="whitespace-pre-wrap text-sm text-slate-700">{post.caption}</p>
              {post.meta?.hashtags?.length > 0 && (
                <p className="text-sm text-sky-600">
                  {post.meta.hashtags.map(h => `#${h}`).join(' ')}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-3 border-t border-slate-100 px-5 py-4">
          {editing ? (
            <div className="flex gap-2">
              <button onClick={onSave} className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700">Save</button>
              <button onClick={() => setEdit(null)} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:text-slate-800">Cancel</button>
            </div>
          ) : (
            <>
              <div className="flex gap-2">
                <input value={instruction} onChange={e => setInstruction(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !busy && onRevise()}
                  placeholder="Ask for a change — “make the opening less formal”"
                  className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                <button onClick={onRevise} disabled={busy || !!job || instruction.trim().length < 4}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-40">
                  <Wand2 size={14} /> Revise
                </button>
              </div>
              <button onClick={onDelete} className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-rose-600">
                <Trash2 size={12} /> Delete
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Images on a post ────────────────────────────────────────────────────── */

/**
 * Add, remove and reorder the images on a social post.
 *
 * Order is the whole point for a carousel — slide 1 earns the swipe — so it is
 * editable here rather than being whatever order they happened to arrive in.
 *
 * Uploading copies the file into the PUBLIC content-media bucket, because
 * Instagram fetches image_url from its own servers and cannot use a signed
 * link. The warning under the button is not boilerplate: for a job photo that
 * is a decision about a customer's house, and it cannot be taken back once
 * Meta has fetched it.
 */
function ImageEditor({ edit, setEdit }) {
  const [busy, setBusy] = useState(false);
  const images = edit.images ?? [];
  const set = (next) => setEdit({ ...edit, images: next });

  const add = async (files) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      const added = [];
      for (const f of files) added.push({ url: await publishImage(f), alt: '' });
      set([...images, ...added].slice(0, 10));
      if (images.length + added.length > 10) {
        toast('Instagram allows 10 — the extras were dropped.', 'info');
      }
    } catch (e) {
      toast(`Couldn't add that: ${e.message}`, 'error', { duration: 9000 });
    } finally {
      setBusy(false);
    }
  };

  const move = (i, by) => {
    const j = i + by;
    if (j < 0 || j >= images.length) return;
    const next = [...images];
    [next[i], next[j]] = [next[j], next[i]];
    set(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-600">
          {images.length === 0 ? 'No images'
            : images.length === 1 ? '1 image'
            : `${images.length} slides — a carousel`}
        </p>
        <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200
                           px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 ${busy ? 'opacity-40' : ''}`}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Add photos
          <input type="file" accept="image/*" multiple className="hidden" disabled={busy}
            onChange={e => { add([...e.target.files]); e.target.value = ''; }} />
        </label>
      </div>

      {images.map((im, i) => (
        <div key={im.url} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2">
          <img src={im.url} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
          <input value={im.alt ?? ''} placeholder="Alt text — what is in the photo"
            onChange={e => set(images.map((x, j) => j === i ? { ...x, alt: e.target.value } : x))}
            className="min-w-0 flex-1 rounded border border-slate-200 px-2 py-1 text-xs" />
          <span className="shrink-0 text-xs text-slate-400">{i + 1}</span>
          <button onClick={() => move(i, -1)} disabled={i === 0}
            className="text-slate-400 hover:text-slate-700 disabled:opacity-25" aria-label="Move earlier">↑</button>
          <button onClick={() => move(i, 1)} disabled={i === images.length - 1}
            className="text-slate-400 hover:text-slate-700 disabled:opacity-25" aria-label="Move later">↓</button>
          <button onClick={async () => { await unpublishImage(im.url); set(images.filter((_, j) => j !== i)); }}
            className="text-slate-400 hover:text-rose-600" aria-label="Remove">
            <X size={14} />
          </button>
        </div>
      ))}

      <p className="text-xs text-slate-400">
        Added photos are copied to a public address so Instagram can fetch them — it cannot read
        private files. For a photo of a customer's home, that is a decision to make deliberately.
      </p>
    </div>
  );
}
