/**
 * Today — the "what needs doing" list the morning brief points at.
 *
 * Every section here is the same rule the 7am brief counts (see
 * notify_morning_brief() in the migrations) and the same rule the page it links
 * to uses, so the number in the push, the number here, and the list you land on
 * can never disagree.
 */

import { useDataRefresh } from '../hooks/useDataRefresh';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, parseISO, differenceInDays, differenceInHours, isSameDay } from 'date-fns';
import {
  Sun, HardHat, CalendarDays, Clock, Star, FileText, ChevronRight, CheckCircle2, ListChecks,
  Globe, AlertTriangle, Receipt, Package, Ruler,
} from 'lucide-react';
import {
  getJobs, getCustomers, getQuotes, getTasks, isTaskOpen, getCalendarEvents,
  getInstallRequests, getReviewRequests, getDismissedSchedulingIds, getInstallers,
  getMeasureSheets,
} from '../store/data';
import Card from '../components/Card';
import ContentQueueCard from '../components/ContentQueueCard';
import { supabase } from '../lib/supabase';

const phoneOf = (c) => c?.mobile || c?.phone || '';
const dayLabel = (d) => (d ? format(typeof d === 'string' ? parseISO(d) : d, 'd MMM') : '');

export default function Today() {
  const tick = useDataRefresh();
  const navigate = useNavigate();

  const {
    installsToday, tasksDue, awaitingInstaller, needsBooking, quotesToChase, reviewReady,
    rework, notOrdered, notInvoiced, toQuote,
  } = useMemo(() => {
    const now       = new Date();
    const todayStr  = format(now, 'yyyy-MM-dd');
    const jobs      = getJobs();
    const customers = getCustomers();
    const quotes    = getQuotes();
    const reqs      = getInstallRequests();
    const installers= getInstallers();
    const reviews   = getReviewRequests();
    const dismissed = getDismissedSchedulingIds();
    const sheets    = getMeasureSheets();
    const events    = getCalendarEvents().filter(e => e.eventType === 'install');

    const custOf  = (id) => customers.find(c => c.id === id);
    const jobOf   = (id) => jobs.find(j => j.id === id);
    const nameFor = (job) => custOf(job?.customerId)?.name || 'Customer';
    const live    = (r) => !['Declined', 'Cancelled'].includes(r.status);

    // Booked = an install request that's still alive, or an install on the
    // calendar. Mirrors InstallationCalendar's "needing scheduling" panel.
    const isBooked = (jobId) =>
      reqs.some(r => r.jobId === jobId && live(r)) || events.some(e => e.jobId === jobId);

    const installsToday = [
      ...events
        .filter(e => e.startAt && isSameDay(parseISO(e.startAt), now))
        .map(e => {
          const job = jobOf(e.jobId);
          return {
            id: `ev-${e.id}`,
            title: e.title || (job ? nameFor(job) : 'Installation'),
            meta: [job?.jobNumber, e.startAt && format(parseISO(e.startAt), 'h:mma'), e.location]
              .filter(Boolean).join(' · '),
            to: job ? `/jobs/${job.id}` : '/calendar',
          };
        }),
      ...reqs
        .filter(r => live(r) && (r.proposedDate || r.scheduledDate) === todayStr)
        .map(r => {
          const job = jobOf(r.jobId);
          return {
            id: `rq-${r.id}`,
            title: job ? nameFor(job) : 'Installation',
            meta: [job?.jobNumber, installers.find(i => i.id === r.installerId)?.name, r.status]
              .filter(Boolean).join(' · '),
            to: job ? `/jobs/${job.id}` : '/calendar',
          };
        }),
    ];

    // isTaskOpen is the one definition of "still needs doing" — the same one
    // the notes feed and the SQL due sweep use, so this count, the push and the
    // list you land on can't disagree.
    const tasksDue = getTasks()
      .filter(t => isTaskOpen(t) && t.dueDate && t.dueDate <= todayStr)
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
      .map(t => ({
        id: t.id,
        title: t.title || 'Task',
        meta: [t.dueDate < todayStr ? `overdue · due ${dayLabel(t.dueDate)}` : 'due today', t.priority]
          .filter(Boolean).join(' · '),
        urgent: t.dueDate < todayStr,
        to: t.jobId ? `/jobs/${t.jobId}` : t.customerId ? `/customers/${t.customerId}` : '/notes',
      }));

    const awaitingInstaller = reqs
      .filter(r => r.status === 'Sent' && !r.respondedAt && r.sentAt
        && differenceInHours(now, parseISO(r.sentAt)) >= 24)
      .map(r => {
        const job = jobOf(r.jobId);
        return {
          id: r.id,
          title: installers.find(i => i.id === r.installerId)?.name || 'Installer',
          meta: [job && nameFor(job), job?.jobNumber, `sent ${dayLabel(r.sentAt)} — no reply`]
            .filter(Boolean).join(' · '),
          to: '/calendar',
        };
      });

    const needsBooking = jobs
      .filter(j => ['Approved', 'Ordered', 'Received'].includes(j.status)
        && !dismissed.has(j.id) && !isBooked(j.id))
      .map(j => ({
        id: j.id,
        title: nameFor(j),
        meta: [j.jobNumber, j.status, j.updatedAt && `since ${dayLabel(j.updatedAt)}`]
          .filter(Boolean).join(' · '),
        to: `/jobs/${j.id}`,
      }));

    const quotesToChase = quotes
      .filter(q => ['Sent', 'Viewed'].includes(q.status)
        && differenceInDays(now, parseISO(q.sentAt || q.createdAt)) >= 3)
      .sort((a, b) => new Date(a.sentAt || a.createdAt) - new Date(b.sentAt || b.createdAt))
      .map(q => ({
        id: q.id,
        title: custOf(q.customerId)?.name || 'Customer',
        meta: [q.quoteNumber, q.status,
          `${differenceInDays(now, parseISO(q.sentAt || q.createdAt))} days`,
          q.viewCount ? `opened ${q.viewCount}×` : 'not opened'].filter(Boolean).join(' · '),
        to: `/quotes/${q.id}`,
      }));

    // Measured, and nothing has gone out yet — the gap where a job goes quiet
    // between the tape measure and the customer hearing a price.
    //
    // Keyed on whether a quote was actually SENT, not on whether one exists: a
    // draft sitting in the builder is exactly the case worth chasing, so it
    // stays on the list and says so. The job reaches 'Measured' inside
    // saveMeasureSheet, so a sheet saved on site shows up here immediately.
    const sentQuoteJobIds = new Set(
      quotes
        .filter(q => q.sentAt || ['Sent', 'Viewed', 'Accepted', 'Declined', 'Completed'].includes(q.status))
        .map(q => q.jobId)
        .filter(Boolean),
    );
    const draftQuoteJobIds = new Set(
      quotes.filter(q => q.status === 'Draft').map(q => q.jobId).filter(Boolean),
    );
    const measuredOn = (jobId) => {
      const ms = sheets.filter(m => m.jobId === jobId)
        .map(m => m.measureDate || m.updatedAt || m.createdAt).filter(Boolean).sort();
      return ms.length ? ms[ms.length - 1] : null;
    };
    const toQuote = jobs
      .filter(j => ['Measured', 'Quote Required'].includes(j.status) && !sentQuoteJobIds.has(j.id))
      .map(j => ({ job: j, on: measuredOn(j.id) || j.updatedAt }))
      .sort((a, b) => new Date(a.on || 0) - new Date(b.on || 0))   // longest wait first
      .map(({ job: j, on }) => {
        const waited = on ? differenceInDays(now, parseISO(on)) : null;
        return {
          id: j.id,
          title: nameFor(j),
          meta: [j.jobNumber, on && `measured ${dayLabel(on)}`,
            waited >= 1 ? `${waited} day${waited === 1 ? '' : 's'} ago` : null,
            draftQuoteJobIds.has(j.id) ? 'draft started' : 'no quote yet'].filter(Boolean).join(' · '),
          urgent: waited != null && waited >= 3,
          // The project, not straight into a new quote: some of these already
          // have a draft on the go, and the job is where you can see the
          // measure sheet and whatever is already started before deciding.
          to: `/jobs/${j.id}`,
        };
      });

    const askedJobIds = new Set(reviews.map(r => r.jobId));
    const reviewReady = jobs
      .map(j => ({ job: j, finishedAt: j.completedAt || j.updatedAt }))
      .filter(({ job: j, finishedAt }) => ['Completed', 'Installed'].includes(j.status) && finishedAt
        && differenceInDays(now, parseISO(finishedAt)) <= 60
        && !askedJobIds.has(j.id)
        && phoneOf(custOf(j.customerId)))
      .sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt))
      .map(({ job: j, finishedAt }) => ({
        id: j.id,
        title: nameFor(j),
        meta: [j.jobNumber, j.status, `finished ${dayLabel(finishedAt)}`].filter(Boolean).join(' · '),
        to: '/reviews',
      }));

    // Customer is waiting on a fix — the most expensive thing to leave sitting.
    const rework = jobs
      .filter(j => j.status === 'Rework')
      .map(j => ({
        id: j.id,
        title: nameFor(j),
        meta: [j.jobNumber, j.updatedAt && `in rework since ${dayLabel(j.updatedAt)}`]
          .filter(Boolean).join(' · '),
        urgent: true,
        to: `/jobs/${j.id}`,
      }));

    // Approved a week ago and still not Ordered — usually a forgotten supplier
    // order, which only shows up later as a blown install date.
    const notOrdered = jobs
      .filter(j => j.status === 'Approved' && j.updatedAt
        && differenceInDays(now, parseISO(j.updatedAt)) >= 7)
      .map(j => ({
        id: j.id,
        title: nameFor(j),
        meta: [j.jobNumber, `approved ${differenceInDays(now, parseISO(j.updatedAt))} days ago`, 'not ordered']
          .filter(Boolean).join(' · '),
        to: `/jobs/${j.id}`,
      }));

    // Work committed, money not yet asked for. Bounded to 30 days on purpose —
    // unbounded this is 2,000+ rows of legacy imports, which is noise, not a job.
    const notInvoiced = quotes
      .filter(q => q.status === 'Accepted' && !q.xeroInvoiceId && q.acceptedAt
        && differenceInDays(now, parseISO(q.acceptedAt)) <= 30)
      .sort((a, b) => new Date(a.acceptedAt) - new Date(b.acceptedAt))
      .map(q => ({
        id: q.id,
        title: custOf(q.customerId)?.name || 'Customer',
        meta: [q.quoteNumber, `accepted ${dayLabel(q.acceptedAt)}`,
          q.grandTotal ? `$${Number(q.grandTotal).toLocaleString()}` : null].filter(Boolean).join(' · '),
        to: `/quotes/${q.id}`,
      }));

    return { installsToday, tasksDue, awaitingInstaller, needsBooking, quotesToChase, reviewReady,
             rework, notOrdered, notInvoiced, toQuote };
  // `tick` looks unused to the linter because every list is read straight out
  // of localStorage rather than from a prop — but it is the whole point: it
  // changes on 'lusso:data-changed', and without it this memo runs once at
  // mount and the page never notices anything that happens afterwards.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  // Website leads are the one list that isn't mirrored into localStorage (the
  // Inbox reads them straight from Supabase too), so they load on their own.
  const [leads, setLeads] = useState([]);
  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.from('web_enquiries')
      .select('id, name, suburb, interest, phone, created_at, status')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setLeads(data
          .filter(l => (l.status || 'new') === 'new')
          .map(l => ({
            id: l.id,
            title: l.name || 'Website enquiry',
            meta: [l.suburb, l.interest, l.phone, l.created_at && `came in ${dayLabel(l.created_at)}`]
              .filter(Boolean).join(' · '),
            urgent: true,
            to: '/inbox',
          })));
      });
    return () => { cancelled = true; };
  }, []);

  const sections = [
    { key: 'installs',  label: 'Installing today',    hint: 'On site today',                          icon: HardHat,      tone: 'text-teal-600',   items: installsToday },
    { key: 'leads',     label: 'Leads to call',       hint: 'Website enquiries nobody has picked up',  icon: Globe,        tone: 'text-amber-600',  items: leads },
    { key: 'toquote',   label: 'To quote',            hint: 'Measured, nothing sent to the customer yet', icon: Ruler,    tone: 'text-cyan-600',   items: toQuote },
    { key: 'rework',    label: 'Rework',              hint: 'Customer waiting on a fix',               icon: AlertTriangle,tone: 'text-rose-500',   items: rework },
    { key: 'tasks',     label: 'To-dos due',          hint: 'Notes you gave a date — due today or overdue',  icon: Clock,        tone: 'text-orange-500', items: tasksDue },
    { key: 'invoice',   label: 'Accepted, not invoiced', hint: 'Work committed, money not asked for',  icon: Receipt,      tone: 'text-green-600',  items: notInvoiced },
    { key: 'installer', label: 'Awaiting installer',  hint: 'Sent over a day ago, still no answer',    icon: CalendarDays, tone: 'text-blue-600',   items: awaitingInstaller },
    { key: 'booking',   label: 'Ready to book',       hint: 'Approved with nothing in the diary',      icon: CalendarDays, tone: 'text-indigo-600', items: needsBooking },
    { key: 'ordering',  label: 'Not ordered yet',     hint: 'Approved a week ago, still not ordered',  icon: Package,      tone: 'text-purple-600', items: notOrdered },
    { key: 'quotes',    label: 'Quotes to chase',     hint: 'Sent 3+ days ago, no answer yet',         icon: FileText,     tone: 'text-amber-600',  items: quotesToChase },
    { key: 'reviews',   label: 'Review asks ready',   hint: 'Finished jobs worth asking',              icon: Star,         tone: 'text-yellow-500', items: reviewReady },
  ].filter(s => s.items.length > 0);

  const total = sections.reduce((n, s) => n + s.items.length, 0);

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <ListChecks size={22} className="text-amber-500" /> Today
        </h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {format(new Date(), 'EEEE d MMMM')} · {total === 0 ? 'nothing waiting' :
            `${total} thing${total === 1 ? '' : 's'} want${total === 1 ? 's' : ''} your attention`}
        </p>
      </div>

      <ContentQueueCard />

      {sections.length === 0 ? (
        <Card className="px-5 py-12 text-center">
          <CheckCircle2 size={28} className="text-green-500 mx-auto" />
          <p className="text-sm font-medium text-slate-700 mt-3">You’re all clear</p>
          <p className="text-xs text-slate-400 mt-1">
            No installs today, nothing to book, chase or ask. Enjoy it.
          </p>
        </Card>
      ) : (
        <>
          {/* Jump strip — the same counts the 7am push quoted. */}
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
            {sections.map(s => (
              <a key={s.key} href={`#sec-${s.key}`}
                className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-full border border-slate-200 bg-white text-slate-600 whitespace-nowrap flex-shrink-0 hover:border-slate-300">
                <s.icon size={12} className={s.tone} />
                {s.label}
                <span className="font-bold text-slate-900">{s.items.length}</span>
              </a>
            ))}
          </div>

          {sections.map(s => (
            <Card key={s.key} id={`sec-${s.key}`} className="overflow-hidden scroll-mt-4">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                <s.icon size={15} className={s.tone} />
                <div className="min-w-0">
                  <h2 className="font-semibold text-slate-800 text-sm">
                    {s.label} <span className="text-slate-400 font-normal">· {s.items.length}</span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">{s.hint}</p>
                </div>
              </div>
              <div className="divide-y divide-slate-50">
                {s.items.map(item => (
                  <button key={item.id} onClick={() => navigate(item.to)}
                    className="w-full flex items-center gap-3 px-5 py-3 text-left hover:bg-slate-50 transition-colors">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-800 truncate">{item.title}</p>
                      <p className={`text-xs truncate mt-0.5 ${item.urgent ? 'text-red-500' : 'text-slate-400'}`}>
                        {item.meta}
                      </p>
                    </div>
                    <ChevronRight size={15} className="text-slate-300 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </>
      )}

      <p className="text-[11px] text-slate-400 text-center pb-2 flex items-center justify-center gap-1.5">
        <Sun size={11} className="text-amber-400" />
        This is what the 7am brief counts. Turn it off in Settings → Notifications.
      </p>
    </div>
  );
}
