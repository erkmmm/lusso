import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import {
  MessageSquare, Mail, Inbox as InboxIcon, Loader, Search, X,
  Send, ArrowLeft, User, Trash2, Briefcase,
  Globe, Phone, MapPin, Clock, UserPlus, Archive, ArchiveRestore, Check,
  ExternalLink, Compass, BarChart3, Sparkles, AlertTriangle, ChevronDown, PhoneCall,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import OptionsMenu from '../components/OptionsMenu';
import DeliveryStatus from '../components/DeliveryStatus';
import { deleteCustomer, restoreCustomer, saveCustomer, getCustomers, findCustomerByIdentity } from '../store/data';
import { useProfile } from '../contexts/UserProfileContext';
import { toast } from '../components/ToastContainer';
import { format, parseISO, isToday, isYesterday, isThisWeek } from 'date-fns';
import { leadSource, sourceStyle, summariseLeadSources } from '../lib/leadSource';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = parseISO(dateStr);
  if (isToday(d))      return format(d, 'h:mm a');
  if (isYesterday(d))  return 'Yesterday';
  if (isThisWeek(d))   return format(d, 'EEE');
  return format(d, 'd MMM');
}

/**
 * The stamp under a message bubble.
 *
 * Time alone was ambiguous the moment a thread spanned more than a day: the
 * date dividers say which day a run of messages belongs to, but you had to
 * scroll back to the divider to find out which. The date now travels with the
 * message, and the year with it once the message is older than this one.
 */
function formatMessageStamp(dateStr) {
  const d = parseISO(dateStr);
  if (isToday(d)) return format(d, 'h:mm a');
  if (d.getFullYear() === new Date().getFullYear()) return format(d, 'd MMM, h:mm a');
  return format(d, 'd MMM yyyy, h:mm a');
}

function formatDateDivider(dateStr) {
  const d = parseISO(dateStr);
  if (isToday(d))     return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEEE, d MMMM');
}

function Avatar({ name, size = 'md' }) {
  const letter = (name || '?')[0].toUpperCase();
  const sz = size === 'lg' ? 'w-11 h-11 text-base' : 'w-10 h-10 text-sm';
  const colors = ['bg-violet-500','bg-amber-500','bg-teal-500','bg-rose-500','bg-blue-500','bg-emerald-500'];
  const color  = colors[(letter.charCodeAt(0) || 0) % colors.length];
  return (
    <div className={`${sz} ${color} rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0`}>
      {letter}
    </div>
  );
}

const LEAD_STATUS = {
  new:       { label: 'New',       pill: 'bg-amber-100 text-amber-700' },
  contacted: { label: 'Contacted', pill: 'bg-blue-100 text-blue-700' },
  converted: { label: 'Converted', pill: 'bg-emerald-100 text-emerald-700' },
  archived:  { label: 'Archived',  pill: 'bg-slate-100 text-slate-500' },
};

/** Our own addresses are a staff placeholder on a customer record, never identity. */
function emailKey(v) {
  const e = (v || '').trim().toLowerCase();
  return !e || e.endsWith('@lusso.com.au') ? '' : e;
}

/** The last nine digits — the same key match_customer_by_phone() reduces to. */
function phoneKey(v) {
  const d = (v || '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : '';
}

/** Case and punctuation removed, so "Hunter-Smith" and "Hunter - Smith" agree. */
function nameKey(v) {
  return (v || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
}

/**
 * Which conversation a website enquiry belongs to.
 *
 * One person, one chat. Someone who fills the form twice is not two leads —
 * Kelli Girard's "second enquiry" was her answering Debbie's email with the
 * measurements she'd been asked for, sent through the form because the reply
 * address on that email wasn't threaded yet. Keying on the enquiry id put her
 * in two chats; keying on who she is puts her in one.
 *
 * Email first, then the last nine digits of the phone — the same key
 * match_customer_by_phone() reduces to, so the two sides agree on what counts
 * as the same number. A lead with neither falls back to its own id, which is
 * the old behaviour and still one conversation of its own.
 */
function leadIdentityKey(e) {
  const email = emailKey(e.email);
  if (email) return `web:${email}`;
  const phone = phoneKey(e.phone);
  if (phone) return `web:${phone}`;
  return `web:${e.id}`;
}

// Turn one person's website enquiries into a conversation-shaped object so they
// can live in the same list as message threads.
//
// `msgs` is the communications tied to any of those enquiries — the replies
// staff have sent and whatever the lead sent back. They belong on this row
// rather than in a thread of their own: an inbound reply carries enquiry_id and
// no customer_id, so grouping it by address would stand a second, parallel
// conversation up next to the lead it answers. The list therefore shows the
// latest message in the conversation, not the form submission forever.
function enquiryToConv(enquiries, msgs = []) {
  const sorted = [...enquiries].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const first  = sorted[0];
  // The newest submission carries the freshest contact details and the status
  // that matters, so it is the one the panel and its actions bind to.
  const e      = sorted.at(-1);

  // Every submission after the first reads as a message in the thread — which
  // is what it is. The first stays in the enquiry header above it.
  const formBody = (x) => x.message?.trim()
    || (x.interest ? `Enquiry about ${x.interest}` : 'New website enquiry');
  const resubmissions = sorted.slice(1).map(x => ({
    id: `enq-${x.id}`,
    enquiryRow: x,
    channel: 'web',
    direction: 'inbound',
    body: formBody(x),
    created_at: x.created_at,
    read_at: x.status && x.status !== 'new' ? x.created_at : null,
  }));

  const messages = [...resubmissions, ...msgs]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const latest = messages.at(-1);

  return {
    key: leadIdentityKey(e),
    isWebLead: true,
    enquiry: e,
    enquiries: sorted,
    firstEnquiry: first,
    // Where they originally came from — a second form fill is not a new source.
    source: leadSource(first),
    customerId: null,
    customerName: e.name || 'Website enquiry',
    customerPhone: e.phone || null,
    customerEmail: e.email || null,
    jobId: null,
    last: latest ?? { channel: 'web', direction: 'inbound', body: formBody(first), created_at: first.created_at },
    lastAt: latest?.created_at || first.created_at || '',
    // A lead nobody has picked up still counts as one unread, as it always
    // has — but that is a fact about the enquiry they came in on, not about
    // the newest one. Reading it off the latest row double-counts a
    // resubmission, which is both "a new enquiry" and an unread message.
    // Anything they have sent since counts on top: an answered-then-replied-to
    // lead is the one most worth surfacing.
    unread: ((first.status || 'new') === 'new' ? 1 : 0)
      + messages.filter(m => m.direction === 'inbound' && !m.read_at).length,
    channels: ['web', ...new Set(msgs.map(m => m.channel))],
    messages,
  };
}

/**
 * A website enquiry, shaped like a communications row so it can sit in an
 * existing customer's thread rather than standing up a conversation of its own.
 *
 * `read_at` is always set: an enquiry from someone who is already a customer is
 * not an unpicked-up lead, and the inbox badge counts unread *messages*. The
 * un-actioned-lead signal belongs to Today's "Leads to call", which reads
 * web_enquiries.status and is unaffected by any of this. The conversation still
 * jumps to the top of the list with the enquiry as its preview.
 */
function enquiryMessage(e, customer) {
  return {
    id: `enq-${e.id}`,
    customer_id: customer.id,
    job_id: null,
    enquiry_id: e.id,
    channel: 'web',
    direction: 'inbound',
    subject: null,
    body: e.message?.trim() || (e.interest ? `Enquiry about ${e.interest}` : 'New website enquiry'),
    created_at: e.created_at,
    read_at: e.created_at,
    customers: { name: customer.name, phone: customer.phone, email: customer.email },
  };
}

/**
 * The customer profile behind a conversation, if there is one.
 *
 * `customerId` is set when the backend already matched the message to a
 * customer. When it has not — an unmatched inbound number, or a website
 * enquiry, which never carries one — fall back to the same strong identity
 * the rest of the app matches on, so a known customer who happens to have
 * filled in the web form is still reachable from their own name.
 */
function conversationCustomerId(conv) {
  if (conv?.customerId) return conv.customerId;
  const match = findCustomerByIdentity({ email: conv?.customerEmail, phone: conv?.customerPhone });
  return match?.id || null;
}

/**
 * The name in a thread header — a link to the profile where one exists, plain
 * text where it does not, rather than a link that goes nowhere.
 */
function CustomerNameLink({ conv, navigate }) {
  const id = conversationCustomerId(conv);
  if (!id) return <p className="font-semibold text-slate-900 text-sm truncate">{conv.customerName}</p>;
  return (
    <button
      type="button"
      onClick={() => navigate(`/customers/${id}`)}
      title={`Open ${conv.customerName}'s profile`}
      className="font-semibold text-slate-900 text-sm truncate max-w-full text-left hover:text-amber-600 hover:underline underline-offset-2 transition-colors"
    >
      {conv.customerName}
    </button>
  );
}

// Group all comms into per-customer conversations
function buildConversations(comms) {
  const map = new Map();
  for (const c of comms) {
    const key = c.customer_id
      || (c.direction === 'inbound' ? c.from_address : c.to_address)
      || 'unknown';
    if (!map.has(key)) {
      map.set(key, {
        key,
        customerId:    c.customer_id   ?? null,
        customerName:  c.customers?.name ?? (c.direction === 'inbound' ? c.from_address : c.to_address),
        customerPhone: c.customers?.phone ?? (c.channel === 'sms'   ? (c.direction === 'inbound' ? c.from_address : c.to_address) : null),
        customerEmail: c.customers?.email ?? (c.channel === 'email' ? (c.direction === 'inbound' ? c.from_address : c.to_address) : null),
        jobId:         c.job_id ?? null,
        messages:      [],
      });
    }
    const g = map.get(key);
    g.messages.push(c);
    if (c.job_id)          g.jobId         = c.job_id;
    if (c.customers?.name) g.customerName  = c.customers.name;
    if (c.customers?.phone) g.customerPhone = c.customers.phone;
    if (c.customers?.email) g.customerEmail = c.customers.email;
  }

  return Array.from(map.values())
    .map(g => {
      g.messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      g.last        = g.messages.at(-1);
      g.lastAt      = g.last?.created_at ?? '';
      g.unread      = g.messages.filter(m => m.direction === 'inbound' && !m.read_at).length;
      g.channels    = [...new Set(g.messages.map(m => m.channel))];
      return g;
    })
    .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
}

// Channel badge for the avatar corner.
function ChannelBadge({ channel }) {
  if (channel === 'web') {
    return (
      <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-teal-500 flex items-center justify-center">
        <Globe size={8} className="text-white" />
      </span>
    );
  }
  return (
    <span className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center ${
      channel === 'sms' ? 'bg-violet-500' : 'bg-blue-500'
    }`}>
      {channel === 'sms'
        ? <MessageSquare size={8} className="text-white" />
        : <Mail size={8} className="text-white" />}
    </span>
  );
}

// ── Conversation List Item ────────────────────────────────────────────────────
function ConvRow({ conv, selected, onClick, onDelete }) {
  const hasUnread = conv.unread > 0;
  return (
    /* The row is a button, so the delete control can't nest inside it — it sits
       as a sibling in a relative wrapper instead. Kept permanently visible
       rather than hover-revealed: it has to be findable on touch, and a
       hover-only affordance is the kind that goes unnoticed. */
    <div className={`group relative border-b border-slate-100 last:border-0 ${
      selected
        ? 'bg-violet-50 border-l-2 border-l-violet-500'
        : hasUnread
          ? 'bg-violet-50/30 hover:bg-slate-50'
          : 'hover:bg-slate-50'
    }`}>
    <button
      onClick={onClick}
      className="w-full text-left px-4 py-3.5 pr-11 flex items-start gap-3 transition-colors"
    >
      {/* Avatar + channel badge */}
      <div className="relative flex-shrink-0 mt-0.5">
        <Avatar name={conv.customerName} />
        <ChannelBadge channel={conv.last?.channel} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <span className={`text-sm truncate ${hasUnread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
            {conv.customerName}
          </span>
          <span className="text-[11px] text-slate-400 flex-shrink-0">{formatTime(conv.lastAt)}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {/* "Web lead:" labels the enquiry itself. Once someone has answered
              it, the preview is our own message, so it takes the same "You:"
              every other outbound preview gets. */}
          {conv.isWebLead && conv.last?.direction !== 'outbound' && (
            <span className="text-[10px] font-medium text-teal-600 flex-shrink-0">Web lead:</span>
          )}
          {conv.last?.direction === 'outbound' && (
            <span className="text-[10px] text-slate-400 flex-shrink-0">You:</span>
          )}
          <p className={`text-xs truncate ${hasUnread ? 'text-slate-700' : 'text-slate-400'}`}>
            {conv.last?.body ?? '—'}
          </p>
        </div>
        {/* Where the lead came from, at a glance — the question you ask
            before opening it, not after. */}
        {conv.isWebLead && conv.source && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-400 truncate">
            <Compass size={11} className="flex-shrink-0 text-slate-300" />
            <span className="truncate">
              {conv.source.sourceLabel}
              {conv.source.firstTouchKnown && conv.source.entryLabel
                ? ` → ${conv.source.entryLabel}`
                : ''}
            </span>
          </p>
        )}
      </div>

      {/* Unread badge */}
      {hasUnread > 0 && (
        <span className="flex-shrink-0 mt-1 min-w-[18px] h-[18px] bg-violet-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
          {conv.unread}
        </span>
      )}
    </button>

    <button
      onClick={(e) => { e.stopPropagation(); onDelete?.(conv); }}
      title="Delete conversation"
      aria-label={`Delete conversation with ${conv.customerName}`}
      className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 group-hover:text-slate-500 hover:!text-white hover:!bg-red-500 transition-colors"
    >
      <Trash2 size={15} />
    </button>
    </div>
  );
}

// ── Lead sources report ───────────────────────────────────────────────────────
// Fills the pane that otherwise says "select a conversation". It is built from
// the leads already loaded for the list, so it costs no extra query.
const REPORT_PERIODS = [
  { id: '30',  label: '30 days',  days: 30 },
  { id: '90',  label: '90 days',  days: 90 },
  { id: '365', label: '12 months', days: 365 },
  { id: 'all', label: 'All time',  days: null },
];

function SourceBars({ rows, total, empty }) {
  if (!rows.length) return <p className="px-5 py-6 text-center text-sm text-slate-400">{empty}</p>;
  const max = Math.max(...rows.map(r => r.count));
  return (
    <div className="px-5 py-4 space-y-3">
      {rows.map(r => (
        <div key={r.key} className="flex items-center gap-3">
          <span className="flex-1 sm:flex-none sm:w-44 min-w-0 text-sm text-slate-600 truncate" title={r.path || r.label}>
            {r.label}
          </span>
          {/* The bar is squeezed to nothing once the label and figures have
              had their share of a phone's width, so it only appears where
              there is room for it to mean something. */}
          <div className="hidden sm:block flex-1 h-2 rounded-full bg-slate-100 overflow-hidden min-w-0">
            <div
              className={`h-full rounded-full ${r.bar || 'bg-teal-400'}`}
              style={{ width: `${(r.count / max) * 100}%` }}
            />
          </div>
          <span className="w-20 flex-shrink-0 text-right text-xs tabular-nums text-slate-500">
            {r.count}
            <span className="text-slate-300"> · </span>
            {Math.round((r.count / total) * 100)}%
          </span>
          <span
            className={`w-16 flex-shrink-0 text-right text-xs tabular-nums ${r.converted ? 'text-emerald-600' : 'text-slate-300'}`}
            title={`${r.converted} of ${r.count} became a customer`}
          >
            {r.converted} won
          </span>
        </div>
      ))}
    </div>
  );
}

function LeadSourceReport({ leads, onBack }) {
  const [period, setPeriod] = useState('90');
  // Captured once, so the period window is a pure function of state rather
  // than a clock read during render.
  const [now] = useState(() => Date.now());

  const { summary, cutoffLabel } = useMemo(() => {
    const days = REPORT_PERIODS.find(p => p.id === period)?.days ?? null;
    const cutoff = days ? now - days * 86400000 : null;
    const scoped = cutoff
      ? leads.filter(l => l.created_at && new Date(l.created_at).getTime() >= cutoff)
      : leads;
    return {
      summary: summariseLeadSources(scoped),
      cutoffLabel: REPORT_PERIODS.find(p => p.id === period)?.label ?? '',
    };
  }, [leads, period, now]);

  const sourceRows = summary.sources.map(r => ({ ...r, bar: sourceStyle(r.kind).bar }));
  const unknownPages = summary.entryPages.find(p => p.key === '__unknown__')?.count ?? 0;

  // Nothing to see in the entry-page view until the site has recorded some,
  // so start on the one that has every lead ever taken in it.
  const [pageMode, setPageMode] = useState(
    summary.firstTouchCount > 0 ? 'entry' : 'form',
  );

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50/50">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        <div>
          <button
            onClick={onBack}
            className="sm:hidden flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 mb-2 -ml-1"
          >
            <ArrowLeft size={14} /> Inbox
          </button>
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <BarChart3 size={17} className="text-teal-500" />
            Where your leads come from
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {summary.total} website lead{summary.total === 1 ? '' : 's'} in the last {cutoffLabel.toLowerCase()}.
            Pick a lead on the left to see its own trail.
          </p>
        </div>

        <div className="flex gap-1.5">
          {REPORT_PERIODS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors ${
                period === p.id
                  ? 'bg-teal-600 text-white border-teal-600'
                  : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200">
          <div className="px-5 py-3.5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-slate-800">
                {pageMode === 'entry' ? 'Pages that bring them in' : 'Pages they enquire from'}
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {pageMode === 'entry'
                  ? 'The page they first landed on that visit.'
                  : 'The page they were on when they sent the form.'}
              </p>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              {[
                { id: 'entry', label: 'Landed on' },
                { id: 'form',  label: 'Enquired from' },
              ].map(m => (
                <button
                  key={m.id}
                  onClick={() => setPageMode(m.id)}
                  className={`text-[11px] font-medium px-2 py-1 rounded-md border transition-colors ${
                    pageMode === m.id
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <SourceBars
            rows={pageMode === 'entry' ? summary.entryPages : summary.formPages}
            total={summary.total}
            empty="No leads in this period."
          />
          {pageMode === 'entry' && unknownPages > 0 && (
            <p className="px-5 pb-4 -mt-1 text-xs text-slate-400">
              {unknownPages === summary.total
                ? 'None of these recorded an entry page — the site only started tracking it from today, so this fills in as new leads arrive. Until then, “Enquired from” has the full history.'
                : `${unknownPages} of these came in before the site recorded an entry page.`}
            </p>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200">
          <div className="px-5 py-3.5 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-800">What sent them</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Search, AI assistants, social, campaigns, or straight to the site.
            </p>
          </div>
          <SourceBars
            rows={sourceRows}
            total={summary.total}
            empty="No leads in this period."
          />
        </div>
      </div>
    </div>
  );
}

// ── Where a lead came from ────────────────────────────────────────────────────
// Two separate facts, kept separate: the page that brought them to the site,
// and the page they were on when they filled the form in. They are the same
// most of the time, and when they are not, the difference is the interesting
// part.
function OriginRow({ label, children }) {
  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <span className="w-24 flex-shrink-0 text-xs text-slate-400 pt-px">{label}</span>
      <div className="min-w-0 flex-1 text-sm text-slate-700">{children}</div>
    </div>
  );
}

function LeadOrigin({ enquiry }) {
  const s = leadSource(enquiry);
  const style = sourceStyle(s.sourceKind);

  return (
    <div>
      <p className="text-[11px] font-semibold tracking-wide uppercase text-slate-400 mb-1.5">
        Where this lead came from
      </p>
      <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
        <OriginRow label="Source">
          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.pill}`}>
            {s.sourceLabel}
          </span>
          {s.campaign && s.campaign !== s.sourceLabel && (
            <span className="ml-2 text-xs text-slate-500">campaign {s.campaign}</span>
          )}
          {s.referrerUrl && (
            <p className="mt-1 text-xs text-slate-400 break-all">{s.referrerUrl}</p>
          )}
        </OriginRow>

        <OriginRow label="Landed on">
          {s.firstTouchKnown ? (
            <>
              <span className="font-medium">{s.entryLabel}</span>
              <span className="ml-1.5 text-xs text-slate-400">{s.entryPath}</span>
            </>
          ) : (
            <span className="text-slate-400">
              Not recorded — this lead came in before the site started tracking the entry page.
            </span>
          )}
        </OriginRow>

        <OriginRow label="Enquired from">
          {s.submitUrl ? (
            <a
              href={s.submitUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-teal-700 hover:underline"
            >
              <span className="font-medium">{s.submitLabel}</span>
              <ExternalLink size={12} className="text-slate-400" />
            </a>
          ) : (
            <span className="text-slate-400">Unknown</span>
          )}
          {s.browsed && (
            <p className="mt-1 text-xs text-slate-400">
              Different page to the one they arrived on
              {s.pagesSeen ? ` — ${s.pagesSeen} page${s.pagesSeen === 1 ? '' : 's'} that visit` : ''}.
            </p>
          )}
          {!s.browsed && s.pagesSeen > 1 && (
            <p className="mt-1 text-xs text-slate-400">
              {s.pagesSeen} pages that visit.
            </p>
          )}
        </OriginRow>
      </div>
    </div>
  );
}

// ── Web lead detail panel ─────────────────────────────────────────────────────
const PREF_LABEL = { call: 'Phone call', text: 'Text message', email: 'Email' };
const CHANNEL_LABEL = { sms: 'Text', email: 'Email', web: 'Website form' };

/**
 * A reply box that grows with what you type.
 *
 * Both composers were `rows={1}` with a max-height and nothing that ever
 * changed the height, so a six-line email was written through a one-line slot
 * that scrolled internally. The height is driven off scrollHeight on every
 * change: reset to auto first, or the box can only ever grow.
 */
function AutoTextarea({ value, className = '', ...rest }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const cs = getComputedStyle(el);

    // scrollHeight measures the content box; the height we set is the border
    // box. Without adding the borders back the element lands two pixels short
    // of its own content, so it is permanently scrollable by 2px and the
    // scrollbar is drawn over the rounded corner even on a one-line reply.
    const borders = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);

    // The ceiling lives in CSS as a share of the window rather than a fixed
    // 160px. A drafted email runs eight or nine lines, which at 160px meant
    // reading it five lines at a time through a scrolling box — you could not
    // see what you were about to send. Read the computed value back instead of
    // repeating the number here, so the CSS stays the single source of it.
    const cap = parseFloat(cs.maxHeight);
    const wanted = el.scrollHeight + borders;
    el.style.height = `${Number.isFinite(cap) ? Math.min(wanted, cap) : wanted}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      className={`resize-none overflow-y-auto max-h-[45vh] ${className}`}
      {...rest}
    />
  );
}

const TONE = {
  violet: { bubble: 'bg-violet-500 text-white', stamp: 'text-violet-200' },
  teal:   { bubble: 'bg-teal-600 text-white',   stamp: 'text-teal-100'  },
};

/**
 * The conversation itself — one implementation for both panels.
 *
 * These were two separate renderings of the same thing, which is why the date
 * format, the channel label and the delivery ticks all had to be fixed twice.
 */
function MessageList({ messages, tone = 'violet' }) {
  const t = TONE[tone] ?? TONE.violet;
  const rows = [];
  let lastDay = '';
  for (const m of messages) {
    const day = format(parseISO(m.created_at), 'yyyy-MM-dd');
    if (day !== lastDay) { rows.push({ divider: true, key: `d-${day}`, at: m.created_at }); lastDay = day; }
    rows.push({ key: m.id, m });
  }

  return (
    <div className="space-y-1">
      {rows.map(row => {
        if (row.divider) return (
          <div key={row.key} className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-[11px] font-medium text-slate-400 flex-shrink-0">
              {formatDateDivider(row.at)}
            </span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>
        );
        const m = row.m;
        const out = m.direction === 'outbound';
        return (
          <div key={row.key} className={`flex ${out ? 'justify-end' : 'justify-start'} mb-2`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
              out ? `${t.bubble} rounded-br-sm`
                  : 'bg-white text-slate-800 shadow-sm border border-slate-100 rounded-bl-sm'
            }`}>
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{m.body}</p>
              <p className={`text-[10px] mt-1 text-right ${out ? t.stamp : 'text-slate-400'}`}>
                {formatMessageStamp(m.created_at)}
                {m.channel !== 'sms' && <span className="ml-1">· {CHANNEL_LABEL[m.channel] ?? 'Email'}</span>}
              </p>
              {out && (
                <div className="flex justify-end mt-0.5">
                  <DeliveryStatus status={m.status} detail={m.status_detail} />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Reference detail, folded away until asked for.
 *
 * Where a lead came from took 209px of the 476px you can see at once — 44% of
 * the panel spent on something you read when deciding whether to chase the
 * lead and never again, sitting between the enquiry and the conversation and
 * pushing the conversation off the bottom of the screen. It opens by default
 * only when there is no conversation to push down.
 */
function Disclosure({ label, summary, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
      >
        <span className="text-[11px] font-semibold tracking-wide uppercase text-slate-400 flex-shrink-0">
          {label}
        </span>
        {!open && summary && (
          <span className="text-xs text-slate-500 truncate flex-1 min-w-0">{summary}</span>
        )}
        <ChevronDown
          size={15}
          className={`ml-auto flex-shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="px-4 pb-4 pt-1 space-y-4">{children}</div>}
    </div>
  );
}

function WebLeadView({ conv, onBack, onStatus, onConvert }) {
  const navigate = useNavigate();
  // `e` is the newest submission — freshest contact details, and the status
  // and actions that matter. `first` is where they came in, which is what the
  // enquiry header above the conversation describes. Usually they are the same
  // row; they differ for someone who filled the form more than once.
  const e = conv.enquiry;
  const first = conv.firstEnquiry ?? e;
  const enquiries = conv.enquiries ?? [e];
  const enquiryIds = enquiries.map(x => x.id);
  const enquiryKey = enquiryIds.join(',');
  const status = e.status || 'new';
  const meta = LEAD_STATUS[status] || LEAD_STATUS.new;
  // Re-entrancy guard for the lifecycle actions, which now live in the header
  // menu — and the menu is visibly inert while one runs, so a second click has
  // nothing to land on.
  const [busy, setBusy] = useState(false);
  const act = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  // Reply composer — Call (tel:), Text (SMS via Twilio) or Email (via Resend),
  // sent through the existing send-communication edge function. Defaults to the
  // method the customer picked on the form.
  const initialChannel = ['call', 'text', 'email'].includes(e.preferred_contact)
    ? e.preferred_contact
    : (e.phone ? 'call' : 'email');
  const [channel, setChannel] = useState(initialChannel);
  const [body, setBody]       = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [needs,      setNeeds]      = useState('');
  const [subject, setSubject] = useState('Your enquiry with Lusso');
  const [sending, setSending] = useState(false);
  const [error, setError]     = useState('');
  // The thread for this enquiry, read from `communications`. Was session-only
  // state, so sent replies vanished on reload and a lead's reply never appeared
  // at all. Now both directions persist and survive a refresh.
  const [thread, setThread]   = useState([]);
  // The scrolling detail pane. A reply sent from the composer lands at the
  // bottom of the conversation, which on a long lead is below the fold — so
  // the pane is scrolled to it rather than leaving staff wondering whether the
  // send worked.
  const bodyRef = useRef(null);

  const loadThread = useCallback(async () => {
    if (!supabase || !enquiryKey) return;
    const { data } = await supabase
      .from('communications')
      .select('id, channel, direction, body, created_at, status, status_detail')
      .in('enquiry_id', enquiryKey.split(','))
      .order('created_at', { ascending: true });
    setThread(data ?? []);
  }, [enquiryKey]);

  // Cancellable so a fast click through enquiries can't land an older
  // response on top of a newer one, or set state after unmount.
  //
  // Re-read on the same cadence as the inbox list rather than only on mount:
  // a lead's reply arriving while their thread is open should appear in it,
  // not wait for someone to click away and back.
  useEffect(() => {
    if (!supabase || !enquiryKey) return;
    let cancelled = false;
    const read = async () => {
      const { data } = await supabase
        .from('communications')
        .select('id, channel, direction, body, created_at, status, status_detail')
        .in('enquiry_id', enquiryKey.split(','))
        .order('created_at', { ascending: true });
      if (!cancelled) setThread(data ?? []);
    };
    // The first read is unconditional — a thread opened in a tab the browser
    // considers hidden still has to render. Only the repeat is gated, so a
    // backgrounded tab stops polling and catches up when it comes back.
    read();
    const tick = () => { if (document.visibilityState === 'visible') read(); };
    const t = setInterval(tick, 20000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [enquiryKey]);

  // Every form they sent after the first reads as a message in the thread —
  // which is what it is. Kelli Girard's "second enquiry" was her answering an
  // email with the measurements she'd been asked for.
  const items = useMemo(() => {
    const resubmissions = enquiries.slice(1).map(x => ({
      id: `enq-${x.id}`,
      channel: 'web',
      direction: 'inbound',
      body: x.message?.trim() || (x.interest ? `Enquiry about ${x.interest}` : 'New website enquiry'),
      created_at: x.created_at,
    }));
    return [...resubmissions, ...thread]
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }, [enquiryKey, thread]);   // eslint-disable-line react-hooks/exhaustive-deps

  const canSend   = channel === 'text' ? !!e.phone : channel === 'email' ? !!e.email : !!e.phone;
  const firstName = (e.name || '').trim().split(/\s+/)[0] || 'lead';

  // Draft a first reply to a website enquiry. The function reads the lead and
  // any earlier submissions itself, so the draft reflects the whole lead
  // rather than just what is on screen. It never sends.
  const suggestReply = async () => {
    if (suggesting) return;
    setSuggesting(true); setError(''); setNeeds('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Your session has expired — please refresh and sign in again.');
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/comms-suggest-reply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            enquiryId: e.id,
            channel,
            guidance: body.trim() || undefined,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Could not draft a reply');
      setBody(data.draft || '');
      if (data.needs) setNeeds(data.needs);
    } catch (err) {
      setError(err.message);
    } finally {
      setSuggesting(false);
    }
  };

  const sendReply = async () => {
    // Re-entrancy guard. The button is disabled while sending, but React state
    // is async — a fast double-click fires this twice before `sending` flips,
    // and a lead gets the same email twice.
    if (sending) return;
    if (!body.trim() || channel === 'call') return;
    const to = channel === 'text' ? e.phone : e.email;
    if (!to) { setError(`No ${channel === 'text' ? 'phone number' : 'email'} on file.`); return; }
    setSending(true); setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-communication`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          channel: channel === 'text' ? 'sms' : 'email',
          enquiryId: e.id,   // gives the reply token something to point at
          to,
          subject: channel === 'email' ? (subject.trim() || 'Your enquiry with Lusso') : undefined,
          body: body.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send');
      await loadThread();
      requestAnimationFrame(() => {
        const el = bodyRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
      setBody('');
      if (status === 'new') onStatus(e, 'contacted');
      toast(`${channel === 'text' ? 'Text' : 'Email'} sent to ${firstName}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  const origin = leadSource(first);
  const originSummary = [origin.sourceLabel, origin.submitLabel].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col h-full">
      {/* Header. The lifecycle actions live in the menu rather than below the
          composer: on a narrow window three stacked rows of chrome under the
          thread was most of the screen. */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-white flex-shrink-0">
        <button onClick={onBack} className="sm:hidden text-slate-400 hover:text-slate-700 -ml-1 p-1">
          <ArrowLeft size={18} />
        </button>
        <div className="relative">
          <Avatar name={conv.customerName} size="lg" />
          <ChannelBadge channel="web" />
        </div>
        <div className="flex-1 min-w-0">
          <CustomerNameLink conv={conv} navigate={navigate} />
          <p className="text-xs text-slate-400 truncate">Website enquiry · lusso.com.au</p>
        </div>
        {/* Hidden on a phone: with the call and menu buttons beside it the name
            truncated to "Kelli Gira…", and the status is a glance-level detail
            that the lead details line and the menu both carry anyway. */}
        <span className={`hidden sm:inline-flex items-center rounded-full font-medium text-xs px-2.5 py-1 ${meta.pill}`}>
          {meta.label}
        </span>
        {/* One tap to ring them, instead of a full-width button repeating a
            number that is already tappable in the details below. */}
        {e.phone && (
          <a
            href={`tel:${e.phone}`}
            title={`Call ${e.phone}`}
            aria-label={`Call ${e.phone}`}
            className="w-9 h-9 flex items-center justify-center rounded-full text-teal-700 bg-teal-50 hover:bg-teal-100 transition-colors flex-shrink-0"
          >
            <PhoneCall size={16} />
          </a>
        )}
        <div className={busy ? 'pointer-events-none opacity-50' : ''}>
        <OptionsMenu
          align="right"
          items={[
            ...(status !== 'converted'
              ? [{ label: 'Convert to customer', icon: UserPlus, onClick: () => act(() => onConvert(e)) }]
              : []),
            ...(status === 'new'
              ? [{ label: 'Mark contacted', icon: Check, onClick: () => act(() => onStatus(e, 'contacted')) }]
              : []),
            { divider: true },
            status !== 'archived'
              ? { label: 'Archive', icon: Archive, onClick: () => act(() => onStatus(e, 'archived')) }
              : { label: 'Restore', icon: ArchiveRestore, onClick: () => act(() => onStatus(e, 'new')) },
          ].filter(Boolean)}
        />
        </div>
      </div>

      {/* Body — the conversation leads, the reference detail folds away */}
      <div ref={bodyRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 bg-slate-50/50 space-y-4">
        <Disclosure
          label="Lead details"
          summary={[e.interest, originSummary].filter(Boolean).join(' · ')}
          defaultOpen={items.length === 0}
        >
          <div className="flex flex-wrap gap-2">
            {e.interest && (
              <span className="inline-flex items-center rounded-full bg-slate-50 border border-slate-200 text-slate-600 text-xs px-3 py-1">
                {e.interest}
              </span>
            )}
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 border border-slate-200 text-slate-500 text-xs px-3 py-1">
              <Clock size={12} />
              {first.created_at ? format(parseISO(first.created_at), 'd MMM yyyy, h:mm a') : ''}
            </span>
            {e.preferred_contact && (
              <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 border border-teal-200 text-teal-700 text-xs px-3 py-1 font-medium">
                Prefers {PREF_LABEL[e.preferred_contact] ?? e.preferred_contact}
              </span>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
            {e.phone && (
              <a href={`tel:${e.phone}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                <Phone size={15} className="text-slate-400" />
                <span className="text-sm text-slate-700">{e.phone}</span>
              </a>
            )}
            {e.email && (
              <a href={`mailto:${e.email}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50">
                <Mail size={15} className="text-slate-400" />
                <span className="text-sm text-slate-700">{e.email}</span>
              </a>
            )}
            {e.suburb && (
              <div className="flex items-center gap-3 px-3 py-2.5">
                <MapPin size={15} className="text-slate-400" />
                <span className="text-sm text-slate-700">{e.suburb}</span>
              </div>
            )}
            {!e.phone && !e.email && !e.suburb && (
              <div className="px-3 py-2.5 text-sm text-slate-400">No contact details provided.</div>
            )}
          </div>

          <LeadOrigin enquiry={first} />
        </Disclosure>

        {/* The enquiry they came in on, then everything since, in order. */}
        {first.message && (
          <div>
            <p className="text-[11px] font-semibold tracking-wide uppercase text-slate-400 mb-1.5">
              {enquiries.length > 1 ? 'First enquiry' : 'Their enquiry'}
            </p>
            <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3.5 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
              {first.message}
            </div>
          </div>
        )}

        {items.length > 0 && <MessageList messages={items} tone="teal" />}
      </div>

      {/* Reply composer */}
      <div className="flex-shrink-0 border-t border-slate-200 bg-white p-3 space-y-2">
        <div className="flex gap-1.5">
          {[{ k: 'text', l: 'Text' }, { k: 'email', l: 'Email' }].map(c => (
            <button key={c.k} onClick={() => { setChannel(c.k); setError(''); }}
              className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors ${
                channel === c.k ? 'bg-teal-600 text-white border-teal-600' : 'text-slate-500 border-slate-200 hover:border-slate-300'
              }`}>
              {c.l}{e.preferred_contact === c.k ? ' ★' : ''}
            </button>
          ))}
        </div>

        {error && <p className="text-xs text-red-500 px-1">{error}</p>}

        {channel === 'email' && (
          <input value={subject} onChange={ev => setSubject(ev.target.value)} placeholder="Subject"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
        )}
        {needs && (
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>Check before sending — {needs}</span>
          </div>
        )}
        {/* The box takes the full width and the actions sit under it. Beside a
            one-line reply the buttons were fine; beside a drafted email they
            left a tall empty column, and the draft was reading in a narrow
            gutter while half the row sat unused. */}
        <AutoTextarea
          value={body}
          onChange={ev => { setBody(ev.target.value); if (needs) setNeeds(''); }}
          onKeyDown={ev => { if (ev.key === 'Enter' && !ev.shiftKey && channel === 'text') { ev.preventDefault(); sendReply(); } }}
          placeholder={canSend ? `Write a${channel === 'text' ? ' text' : 'n email'} to ${firstName}…` : `No ${channel === 'text' ? 'phone number' : 'email'} on file`}
          disabled={!canSend}
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 disabled:bg-slate-50 disabled:text-slate-400"
        />
        <div className="flex justify-end gap-2">
          <button onClick={suggestReply} disabled={!canSend || suggesting || sending}
            title={body.trim() ? 'Draft a reply covering what you have typed' : 'Draft a reply'}
            aria-label="Suggest a reply"
            className="w-10 h-10 flex items-center justify-center border border-slate-200 text-slate-500 hover:text-teal-600 hover:border-teal-300 disabled:opacity-40 rounded-xl transition-colors flex-shrink-0">
            {suggesting ? <Loader size={16} className="animate-spin" /> : <Sparkles size={16} />}
          </button>
          <button onClick={sendReply} disabled={!body.trim() || !canSend || sending}
            className="w-10 h-10 flex items-center justify-center bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white rounded-xl transition-colors flex-shrink-0">
            {sending ? <Loader size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Thread View ───────────────────────────────────────────────────────────────
function ThreadView({ conv, onBack, onSend, onDeleteCustomer, onDeleteConversation }) {
  const [reply,   setReply]   = useState('');
  const [channel, setChannel] = useState(conv.last?.channel ?? 'sms');
  const [sending, setSending] = useState(false);
  const [error,   setError]   = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [needs,      setNeeds]      = useState('');
  const navigate = useNavigate();
  const bottomRef = useRef(null);

  // An email needs a subject line — it's the first thing the customer sees in
  // their inbox list, and the one a spam filter reads. This composer used to
  // send none at all, so every email arrived titled "(No subject)". Default it
  // to the thread it belongs to, and let staff rewrite it.
  const suggestedSubject = useMemo(() => {
    const lastTitled = [...conv.messages].reverse()
      .find(m => m.channel === 'email' && m.subject && m.subject !== '(No subject)');
    if (lastTitled) {
      return /^re:\s/i.test(lastTitled.subject) ? lastTitled.subject : `Re: ${lastTitled.subject}`;
    }
    return 'Your enquiry with Lusso';
  }, [conv.messages]);
  const [subject, setSubject] = useState(suggestedSubject);
  const [subjectEdited, setSubjectEdited] = useState(false);

  // Follow the thread when it changes, unless staff have typed their own.
  // Adjusted during render rather than in an effect, per the React docs and
  // the same pattern the Quotes list uses for its filters.
  const [prevSuggested, setPrevSuggested] = useState(suggestedSubject);
  if (prevSuggested !== suggestedSubject) {
    setPrevSuggested(suggestedSubject);
    if (!subjectEdited) setSubject(suggestedSubject);
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conv.messages.length]);

  const canSend = channel === 'sms' ? !!conv.customerPhone : !!conv.customerEmail;
  const canSuggest = !!(conv.customerId || conv.jobId);

  const handleSend = async () => {
    if (sending) return;   // same double-click race as sendReply
    if (!reply.trim() || !canSend) return;
    setSending(true); setError('');
    try {
      const to = channel === 'sms' ? conv.customerPhone : conv.customerEmail;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Your session has expired — please refresh and sign in again.');
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-communication`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            channel,
            customerId: conv.customerId,
            jobId:      conv.jobId,
            to,
            subject:    channel === 'email' ? (subject.trim() || suggestedSubject) : undefined,
            body:       reply.trim(),
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send');
      setReply('');
      if (onSend) onSend(data.communication);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  // Ask the assistant for a draft. It reads the thread from the database
  // rather than from this component's state, so what it answers is grounded in
  // what was actually sent. The draft lands in the composer and goes nowhere
  // until someone presses send.
  const suggestReply = async () => {
    if (suggesting) return;
    setSuggesting(true); setError(''); setNeeds('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Your session has expired — please refresh and sign in again.');
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/comms-suggest-reply`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            customerId: conv.customerId,
            jobId:      conv.jobId,
            channel,
            // Anything already typed is treated as a brief, not thrown away.
            guidance:   reply.trim() || undefined,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || 'Could not draft a reply');
      setReply(data.draft || '');
      if (data.needs) setNeeds(data.needs);
    } catch (err) {
      setError(err.message);
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-white flex-shrink-0">
        {/* Mobile back button */}
        <button onClick={onBack} className="sm:hidden text-slate-400 hover:text-slate-700 -ml-1 p-1">
          <ArrowLeft size={18} />
        </button>
        <Avatar name={conv.customerName} size="lg" />
        <div className="flex-1 min-w-0">
          <CustomerNameLink conv={conv} navigate={navigate} />
          <p className="text-xs text-slate-400 truncate">
            {conv.customerPhone || conv.customerEmail || 'Unknown'}
          </p>
        </div>
        <OptionsMenu
          align="right"
          items={[
            ...(conv.jobId ? [{ label: 'View Job', icon: Briefcase, onClick: () => navigate(`/jobs/${conv.jobId}`) }] : []),
            ...(conv.customerId ? [{ label: 'View Customer', icon: User, onClick: () => navigate(`/customers/${conv.customerId}`) }] : []),
            { divider: true },
            { label: 'Delete Conversation', icon: Trash2, danger: true, onClick: () => onDeleteConversation?.(conv) },
            ...(conv.customerId ? [
              { label: 'Delete Customer', icon: Trash2, danger: true, onClick: () => {
                const cid  = conv.customerId;
                const name = conv.customerName;
                deleteCustomer(cid);
                onDeleteCustomer?.();
                toast(`${name} deleted.`, 'info', {
                  duration: 8000,
                  onUndo: () => restoreCustomer(cid),
                });
              }},
            ] : []),
          ].filter(Boolean)}
        />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 bg-slate-50/50">
        <MessageList messages={conv.messages} tone="violet" />
        <div ref={bottomRef} />
      </div>

      {/* Reply box */}
      <div className="flex-shrink-0 border-t border-slate-200 bg-white p-3 space-y-2">
        {error && (
          <p className="text-xs text-red-500 px-1">{error}</p>
        )}
        {/* Channel toggle (only show if customer has both phone + email) */}
        {conv.customerPhone && conv.customerEmail && (
          <div className="flex gap-1.5">
            {['sms','email'].map(ch => (
              <button key={ch} onClick={() => setChannel(ch)}
                className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors ${
                  channel === ch ? 'bg-violet-500 text-white border-violet-500' : 'text-slate-500 border-slate-200 hover:border-slate-300'
                }`}>
                {ch === 'sms' ? 'SMS' : 'Email'}
              </button>
            ))}
          </div>
        )}
        {channel === 'email' && canSend && (
          <input
            value={subject}
            onChange={e => { setSubject(e.target.value); setSubjectEdited(true); }}
            placeholder="Subject"
            aria-label="Email subject"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
          />
        )}
        {needs && (
          <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
            <span>Check before sending — {needs}</span>
          </div>
        )}
        <AutoTextarea
          value={reply}
          onChange={e => { setReply(e.target.value); if (needs) setNeeds(''); }}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder={canSend ? `Reply via ${channel === 'sms' ? 'SMS' : 'email'}…` : 'No contact info available'}
          disabled={!canSend}
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 disabled:bg-slate-50 disabled:text-slate-400"
        />
        <div className="flex justify-end gap-2">
          <button onClick={suggestReply}
            disabled={!canSend || suggesting || sending || !canSuggest}
            title={!canSuggest
              ? 'This thread is not linked to a customer yet'
              : (reply.trim() ? 'Draft a reply covering what you have typed' : 'Draft a reply')}
            aria-label="Suggest a reply"
            className="w-10 h-10 flex items-center justify-center border border-slate-200 text-slate-500 hover:text-violet-500 hover:border-violet-300 disabled:opacity-40 rounded-xl transition-colors flex-shrink-0">
            {suggesting ? <Loader size={16} className="animate-spin" /> : <Sparkles size={16} />}
          </button>
          <button onClick={handleSend} disabled={!reply.trim() || !canSend || sending}
            className="w-10 h-10 flex items-center justify-center bg-violet-500 hover:bg-violet-400 disabled:opacity-40 text-white rounded-xl transition-colors flex-shrink-0">
            {sending ? <Loader size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Inbox Page ───────────────────────────────────────────────────────────
// New Message → searchable picker of existing customers.
function CustomerPickerModal({ onClose, onPick }) {
  const [q, setQ] = useState('');
  const customers = getCustomers();
  const term = q.trim().toLowerCase();
  const filtered = term
    ? customers.filter(c =>
        c.name?.toLowerCase().includes(term) ||
        c.phone?.toLowerCase().includes(term) ||
        c.email?.toLowerCase().includes(term))
    : customers;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900 text-sm">New message</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X size={18} /></button>
        </div>
        <div className="p-3 border-b border-slate-100">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Search customers…"
              className="w-full pl-8 pr-3 py-2 text-sm bg-slate-100 rounded-xl border-none focus:outline-none focus:ring-2 focus:ring-violet-400"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-center text-sm text-slate-400 py-10">
              {customers.length === 0 ? 'No customers yet.' : 'No customers found.'}
            </p>
          ) : filtered.map(c => (
            <button key={c.id} onClick={() => onPick(c)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left border-b border-slate-50 last:border-0">
              <Avatar name={c.name} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{c.name || 'Unnamed'}</p>
                <p className="text-xs text-slate-400 truncate">{c.phone || c.email || 'No contact info'}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Deleting a conversation wipes an entire message history at once and there is
// no soft-delete to undo from, so this one gets a real modal rather than the
// inline confirm a single message uses.
function ConfirmDeleteConvModal({ conv, busy, onCancel, onConfirm }) {
  const count = conv.isWebLead ? 1 : conv.messages.length;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={busy ? undefined : onCancel}>
      <div className="bg-white rounded-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
              <Trash2 size={16} className="text-red-500" />
            </div>
            <div className="min-w-0">
              <h2 className="font-semibold text-slate-900 text-sm">
                Delete this conversation?
              </h2>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                {conv.isWebLead ? (
                  <>The website enquiry from <span className="font-medium text-slate-700">{conv.customerName}</span> will be removed from the inbox.</>
                ) : (
                  <>The whole history with <span className="font-medium text-slate-700">{conv.customerName}</span>
                  {count ? <> — {count} message{count === 1 ? '' : 's'} and any older ones</> : null} will be removed from the CRM.</>
                )}
              </p>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                You'll get a few seconds to undo it. Messages already sent still sit in the customer's inbox, and their customer record is not affected.
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-2 justify-end px-5 py-3 bg-slate-50 border-t border-slate-100">
          <button onClick={onCancel} disabled={busy}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 px-3 py-2 rounded-lg transition-colors disabled:opacity-50">
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy}
            className="flex items-center gap-1.5 text-xs font-semibold text-white bg-red-500 hover:bg-red-400 disabled:opacity-60 px-3.5 py-2 rounded-lg transition-colors">
            {busy ? <Loader size={13} className="animate-spin" /> : <Trash2 size={13} />}
            {busy ? 'Deleting…' : 'Delete conversation'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Inbox() {
  const navigate = useNavigate();
  const { displayName = '' } = useProfile() || {};
  const [comms,    setComms]    = useState(null);
  const [leads,    setLeads]    = useState([]); // web_enquiries rows

  /**
   * Which website enquiries belong to someone who is already a customer.
   *
   * Two matching signals are required, because no single one is identity here.
   * A shared phone number is often a household or a trade contact —
   * `John Stewart` and `Judy Stewart` are a couple on one line, and one mobile
   * sits on three unrelated clients. A shared email is no better: 23 customer
   * records carry a @lusso.com.au address a staff member typed in, one of them
   * on 13 different people, and builders put a single office inbox on every
   * client they refer. The name alone fails too — `Jett Hopko` and
   * `Jett Hopkins` are one person.
   *
   * So: the email must match AND either the phone or the name must agree, our
   * own domain never counts, and an ambiguous match folds nothing. Attaching a
   * lead to the wrong customer puts a stranger's enquiry in their thread.
   */
  const customerByEnquiry = useMemo(() => {
    const byEmail = new Map();
    const byId    = new Map();
    for (const c of getCustomers()) {
      byId.set(String(c.id), c);
      const e = emailKey(c.email);
      if (!e) continue;
      const list = byEmail.get(e);
      if (list) list.push(c); else byEmail.set(e, [c]);
    }

    const out = new Map();

    // A customer the backend already resolved for this enquiry wins. An
    // inbound reply gets a customer_id from comms-inbound's sender match, and
    // picking a different record here — easy, when four of them share an email
    // — would split one conversation in two: the reply under the customer the
    // backend chose, our own message under the one we chose.
    for (const m of comms ?? []) {
      if (m.enquiry_id && m.customer_id && !out.has(m.enquiry_id)) {
        const c = byId.get(String(m.customer_id));
        if (c) out.set(m.enquiry_id, c);
      }
    }

    // Otherwise the lead's own details have to agree twice over.
    for (const l of leads) {
      if (out.has(l.id)) continue;
      const e = emailKey(l.email);
      if (!e) continue;
      const candidates = (byEmail.get(e) ?? []).filter(c =>
        (phoneKey(l.phone) && phoneKey(l.phone) === phoneKey(c.phone))
        || (nameKey(l.name) && nameKey(l.name) === nameKey(c.name)));
      // Exactly one, or none: two customers equally entitled to this enquiry
      // is the shared-inbox case, and picking one would be a coin toss.
      if (candidates.length === 1) out.set(l.id, candidates[0]);
    }
    return out;
  }, [leads, comms]);
  const [filter,   setFilter]   = useState('all');
  const [search,   setSearch]   = useState('');
  const [selectedKey, setSelected] = useState(null);
  const [mobileView, setMobile]   = useState('list'); // 'list' | 'thread'
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draftConv,  setDraftConv]  = useState(null); // un-persisted "new message" thread
  const [convToDelete, setConvToDelete] = useState(null); // conversation awaiting delete confirm
  const [deletingConv, setDeletingConv] = useState(false);

  // The newest created_at held, so a poll can ask only for what arrived after
  // it rather than re-reading the same 200 rows every 20 seconds.
  const newestCommAt = useRef(null);

  const loadComms = useCallback(async ({ incremental = false } = {}) => {
    if (!supabase) return;
    let q = supabase
      .from('communications')
      .select('*, jobs!left(job_number, status, deleted_at), customers!left(name, phone, email, deleted_at)')
      .order('created_at', { ascending: false })
      .limit(200);
    // A quiet poll returns nothing rather than re-reading the list — 8 shared
    // buffer hits, all cached, at today's volume. communications_created_at_idx
    // takes over once the table is big enough for the planner to prefer it.
    if (incremental && newestCommAt.current) q = q.gt('created_at', newestCommAt.current);

    const { data, error } = await q;
    if (error || !data) return;

    const fresh = data.filter(c => !c.customers?.deleted_at && !c.jobs?.deleted_at);
    if (data.length) newestCommAt.current = data[0].created_at;
    if (incremental && !fresh.length) return;

    setComms(prev => {
      if (!incremental || prev === null) return fresh;
      // Newest first, and never trust the poll not to overlap a row we hold.
      const seen = new Set(fresh.map(c => c.id));
      return [...fresh, ...prev.filter(c => !seen.has(c.id))];
    });
  }, []);

  useEffect(() => { loadComms(); }, [loadComms]);

  // Load website enquiries
  const loadLeads = useCallback(() => {
    if (!supabase) return;
    supabase
      .from('web_enquiries')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data }) => { if (data) setLeads(data); });
  }, []);

  useEffect(() => { loadLeads(); }, [loadLeads]);

  // Realtime — new messages
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase
      .channel('inbox-rt')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'communications' },
        (payload) => setComms(prev => prev ? [payload.new, ...prev] : [payload.new])
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'communications' },
        (payload) => setComms(prev => prev?.map(c => c.id === payload.new.id ? { ...c, ...payload.new } : c) ?? prev)
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'web_enquiries' },
        (payload) => setLeads(prev => [payload.new, ...prev.filter(l => l.id !== payload.new.id)])
      )
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'web_enquiries' },
        (payload) => setLeads(prev => {
          // A soft delete is an UPDATE, and so is the Undo that reverses it.
          if (payload.new.deleted_at) return prev.filter(l => l.id !== payload.new.id);
          const known = prev.some(l => l.id === payload.new.id);
          if (!known) return [payload.new, ...prev];
          return prev.map(l => l.id === payload.new.id ? { ...l, ...payload.new } : l);
        })
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  // Light poll for new messages and web enquiries. The realtime channel above
  // covers neither: `communications` and `web_enquiries` are both absent from
  // the supabase_realtime publication, so nothing new appeared in the inbox
  // until the page was reloaded. Only while the tab is visible, and messages
  // ask for the delta rather than the whole list.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      loadComms({ incremental: true });
      loadLeads();
    };
    const t = setInterval(tick, 20000);
    // A tab left in the background falls behind; catch up the moment it returns
    // rather than making the user wait out the rest of the interval.
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [loadComms, loadLeads]);

  // Mark inbound messages as read when thread is opened. A web lead's key is
  // `web:<enquiry id>`, which matches no address — its messages are the ones
  // carrying that enquiry_id.
  useEffect(() => {
    if (!selectedKey || !comms || !supabase) return;
    // A web lead's key identifies the person, so its messages are the ones on
    // any of that person's enquiries.
    const enquiryIds = selectedKey.startsWith?.('web:')
      ? new Set(leads.filter(l => leadIdentityKey(l) === selectedKey).map(l => l.id))
      : null;
    const unread = comms
      .filter(c => {
        if (c.direction !== 'inbound' || c.read_at) return false;
        if (enquiryIds) return c.enquiry_id && enquiryIds.has(c.enquiry_id);
        const key = c.customer_id || c.from_address;
        if (key === selectedKey) return true;
        // A reply on an enquiry folded into this customer carries the enquiry
        // id and no customer id, so it has to be matched the same way the
        // conversation list matched it.
        return !!c.enquiry_id && customerByEnquiry.get(c.enquiry_id)?.id === selectedKey;
      })
      .map(c => c.id);
    if (!unread.length) return;
    supabase.from('communications')
      .update({ read_at: new Date().toISOString() })
      .in('id', unread)
      .then(() => {
        setComms(prev => prev?.map(c =>
          unread.includes(c.id) ? { ...c, read_at: new Date().toISOString() } : c
        ));
      });
  }, [selectedKey]);

  // Every row id belonging to a conversation — not just the ones on screen. The
  // inbox only holds the latest 200 messages, so deleting what's loaded would
  // leave older ones behind to resurrect the thread on the next reload.
  // Whole rows, not just ids: Undo re-inserts them exactly as they were, ids
  // included, so a restored thread is the original and not a copy of it.
  const collectConversationRows = async (conv) => {
    if (conv.customerId) {
      const { data, error } = await supabase
        .from('communications').select('*').eq('customer_id', conv.customerId);
      if (error) throw error;
      return data ?? [];
    }
    // Address-keyed thread (no customer record yet). Two exact-match queries
    // rather than one PostgREST `or` string, whose value escaping is fragile
    // for email addresses and +61 numbers.
    const [from, to] = await Promise.all([
      supabase.from('communications').select('*').is('customer_id', null).eq('from_address', conv.key),
      supabase.from('communications').select('*').is('customer_id', null).eq('to_address', conv.key),
    ]);
    if (from.error) throw from.error;
    if (to.error)   throw to.error;
    const byId = new Map();
    for (const r of [...(from.data ?? []), ...(to.data ?? [])]) byId.set(r.id, r);
    return [...byId.values()];
  };

  /**
   * Delete a conversation — recoverably.
   *
   * This used to be a hard DELETE on both paths, which meant a lead removed by
   * accident was simply gone: no deleted_at to clear, no rows to restore, and
   * nothing in the database that remembered it had ever existed. A confirm
   * dialog is not enough on its own, because the mistake people actually make
   * is confirming the wrong row.
   *
   * So both paths are now reversible for as long as the Undo toast is up:
   *   · a web lead is soft-deleted, and Undo clears deleted_at;
   *   · a message thread is read in full before it goes, and Undo re-inserts
   *     the rows with their original ids.
   */
  const handleDeleteConversation = async (conv) => {
    if (deletingConv) return;
    setDeletingConv(true);
    const snapshot = comms;
    const leadSnapshot = leads;
    const name = conv.customerName || 'Conversation';
    try {
      let undo;

      // A web lead is one or more web_enquiries rows — every form this person
      // sent — not a message thread. Deleting the conversation takes all of
      // them, or the deleted chat reappears carrying their other enquiry.
      if (conv.isWebLead) {
        const leadIds = (conv.enquiries ?? [conv.enquiry]).map(l => l.id);
        const idSet = new Set(leadIds);
        setLeads(prev => prev.filter(l => !idSet.has(l.id)));
        const { error, count } = await supabase
          .from('web_enquiries')
          .update({ deleted_at: new Date().toISOString() }, { count: 'exact' })
          .in('id', leadIds)
          .is('deleted_at', null);
        if (error) throw error;
        if (count === 0) throw new Error('blocked');

        undo = async () => {
          const { data, error: undoErr } = await supabase
            .from('web_enquiries').update({ deleted_at: null }).in('id', leadIds).select();
          if (undoErr || !data?.length) { toast('Could not restore the lead.', 'error'); return; }
          setLeads(prev => {
            const known = new Set(prev.map(l => l.id));
            return [...data.filter(l => !known.has(l.id)), ...prev];
          });
          toast(`${name} restored.`, 'info');
        };
      } else {
        const rows = await collectConversationRows(conv);
        if (!rows.length) { toast('Nothing left to delete.', 'info'); return; }
        const idSet = new Set(rows.map(r => r.id));
        setComms(prev => (prev ?? []).filter(c => !idSet.has(c.id)));
        // Chunked so a long history doesn't blow the request URL length.
        const ids = [...idSet];
        let removed = 0;
        for (let i = 0; i < ids.length; i += 100) {
          const { error, count } = await supabase
            .from('communications').delete({ count: 'exact' }).in('id', ids.slice(i, i + 100));
          if (error) throw error;
          removed += count ?? 0;
        }
        if (removed === 0) throw new Error('blocked');

        undo = async () => {
          for (let i = 0; i < rows.length; i += 100) {
            const { error: undoErr } = await supabase
              .from('communications').insert(rows.slice(i, i + 100));
            if (undoErr) { toast('Could not restore the conversation.', 'error'); return; }
          }
          setComms(prev => [...(prev ?? []), ...rows]);
          toast(`Conversation with ${name} restored.`, 'info');
        };
      }

      if (selectedKey === conv.key) { setSelected(null); setMobile('list'); }
      setConvToDelete(null);
      toast(`Conversation with ${name} deleted.`, 'info', { duration: 10000, onUndo: undo });
    } catch (err) {
      setComms(snapshot);
      setLeads(leadSnapshot);
      toast(
        err?.message === 'blocked'
          ? 'Nothing was deleted — your account may not have permission.'
          : 'Could not delete the conversation.',
        'error',
      );
    } finally {
      setDeletingConv(false);
    }
  };

  // ── Web lead actions ──────────────────────────────────────────────────────
  const setLeadStatus = async (lead, status) => {
    const { error } = await supabase.from('web_enquiries').update({ status }).eq('id', lead.id);
    if (error) { toast('Could not update lead.', 'error'); return; }
    setLeads(prev => prev.map(l => (l.id === lead.id ? { ...l, status } : l)));
  };

  const convertLead = async (lead) => {
    const id = uuidv4();
    const now = new Date().toISOString();
    const notes = [
      'Web enquiry from lusso.com.au',
      lead.interest ? `Interested in: ${lead.interest}` : null,
      lead.suburb ? `Suburb: ${lead.suburb}` : null,
      lead.created_at ? `Submitted: ${format(parseISO(lead.created_at), 'd MMM yyyy, h:mm a')}` : null,
      '',
      lead.message || '',
    ].filter(l => l !== null).join('\n');
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
        notes,
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
    }
  };

  // Merge message conversations + web leads into one list, newest first.
  //
  // An enquiry from an existing customer folds into that customer's thread —
  // it is the same person, and a separate "web lead" row next to their chat is
  // the duplicate staff were seeing. Enquiries from people we don't know yet
  // keep their own lead row, where the lead actions live.
  const threadComms = [];
  const commsByEnquiry = new Map();
  for (const c of comms ?? []) {
    if (!c.enquiry_id) { threadComms.push(c); continue; }
    const cust = customerByEnquiry.get(c.enquiry_id);
    if (!cust) {
      const list = commsByEnquiry.get(c.enquiry_id);
      if (list) list.push(c); else commsByEnquiry.set(c.enquiry_id, [c]);
      continue;
    }
    // Replies on a folded enquiry carry no customer_id of their own — the
    // token only knew the enquiry — so give them their customer's.
    threadComms.push(c.customer_id ? c : {
      ...c,
      customer_id: cust.id,
      customers: c.customers ?? { name: cust.name, phone: cust.phone, email: cust.email },
    });
  }

  const standaloneLeads = [];
  for (const l of leads) {
    const cust = customerByEnquiry.get(l.id);
    if (cust) threadComms.push(enquiryMessage(l, cust));
    else standaloneLeads.push(l);
  }

  // One conversation per person, not per form submission — see leadIdentityKey.
  const leadGroups = new Map();
  for (const l of standaloneLeads) {
    const k = leadIdentityKey(l);
    const g = leadGroups.get(k);
    if (g) g.push(l); else leadGroups.set(k, [l]);
  }
  const leadConvs = [...leadGroups.values()].map(group =>
    enquiryToConv(group, group.flatMap(l => commsByEnquiry.get(l.id) ?? [])));
  const allConvs  = [...buildConversations(threadComms), ...leadConvs]
    .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  const unreadTotal = allConvs.reduce((s, c) => s + c.unread, 0);
  const webCount    = allConvs.filter(c => c.isWebLead || c.channels.includes('web')).length;

  // Apply filter + search to conversation list
  const conversations = allConvs.filter(conv => {
    if (filter === 'web')    return conv.isWebLead || conv.channels.includes('web');
    if (filter === 'sms')    return conv.channels.includes('sms');
    if (filter === 'email')  return conv.channels.includes('email');
    if (filter === 'unread') return conv.unread > 0;
    return true;
  }).filter(conv => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      conv.customerName?.toLowerCase().includes(q) ||
      conv.customerPhone?.toLowerCase().includes(q) ||
      conv.customerEmail?.toLowerCase().includes(q) ||
      conv.last?.body?.toLowerCase().includes(q) ||
      conv.messages.some(m => m.body?.toLowerCase().includes(q))
    );
  });

  const selectedConv = selectedKey
    ? conversations.find(c => c.key === selectedKey)
      ?? allConvs.find(c => c.key === selectedKey)
      ?? (draftConv && draftConv.key === selectedKey ? draftConv : null)
    : null;

  const handleSelect = (conv) => {
    setSelected(conv.key);
    setMobile('thread');
  };

  // New Message → open an existing thread for the customer, or a fresh draft.
  const handleNewMessage = (customer) => {
    setPickerOpen(false);
    const existing = allConvs.find(c => c.customerId && String(c.customerId) === String(customer.id));
    if (existing) {
      setDraftConv(null);
      setSelected(existing.key);
      setMobile('thread');
      return;
    }
    // No history yet — open an empty thread (not persisted until a message is sent).
    // Key matches the future customer_id-keyed conversation, so the first sent
    // message transitions seamlessly into the real thread with no duplicate.
    setDraftConv({
      key: customer.id,
      customerId: customer.id,
      customerName: customer.name || 'Customer',
      customerPhone: customer.phone || null,
      customerEmail: customer.email || null,
      jobId: null,
      messages: [],
      channels: [],
      last: { channel: customer.phone ? 'sms' : 'email' },
      lastAt: '',
      unread: 0,
    });
    setSelected(customer.id);
    setMobile('thread');
  };

  const handleBack = () => {
    setMobile('list');
  };

  const handleSent = (newComm) => {
    if (newComm) setComms(prev => prev ? [newComm, ...prev] : [newComm]);
  };

  if (comms === null) return (
    <div className="flex items-center justify-center h-64">
      <Loader size={20} className="animate-spin text-slate-400" />
    </div>
  );

  return (
    // h-full, not a viewport calculation. This used to be
    // h-[calc(100vh-64px)], subtracting the height of the mobile bottom nav —
    // which was wrong at both ends: on desktop that nav does not exist, so the
    // page stopped 64px short and left a dead strip along the bottom, and on
    // mobile it ignored the 55px header above it, so the list ran 55px UNDER
    // the nav and the last rows could not be reached. <main> already resolves
    // both cases (it is a flex child with pb-16 lg:pb-0), so filling it is both
    // correct and immune to either chrome changing height.
    <div className="app-pane flex flex-col h-full">

      {/* ── Two-pane layout ── */}
      <div className="flex flex-1 min-h-0">

        {/* ── LEFT: Conversation list ── */}
        <div className={`
          flex flex-col border-r border-slate-200 bg-white
          w-full sm:w-80 lg:w-96 flex-shrink-0
          ${mobileView === 'thread' ? 'hidden sm:flex' : 'flex'}
        `}>
          {/* Header */}
          <div className="px-4 pt-4 pb-3 border-b border-slate-100">
            <div className="flex items-center justify-between mb-3">
              <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <InboxIcon size={18} className="text-violet-500" />
                Inbox
                {unreadTotal > 0 && (
                  <span className="text-[11px] font-semibold bg-violet-500 text-white px-1.5 py-0.5 rounded-full leading-none">
                    {unreadTotal}
                  </span>
                )}
              </h1>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {leads.length > 0 && (
                  <button
                    onClick={() => { setSelected(null); setDraftConv(null); setMobile('thread'); }}
                    title="Where your leads come from"
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-teal-700 border border-slate-200 hover:border-teal-300 px-2.5 py-1.5 rounded-lg transition-colors">
                    <BarChart3 size={14} /> Sources
                  </button>
                )}
                <button
                  onClick={() => setPickerOpen(true)}
                  title="New message"
                  className="flex items-center gap-1.5 text-xs font-semibold bg-violet-500 hover:bg-violet-400 text-white px-3 py-1.5 rounded-lg transition-colors">
                  <MessageSquare size={14} /> New
                </button>
              </div>
            </div>

            {/* Search */}
            <div className="relative mb-2.5">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search messages…"
                className="w-full pl-8 pr-8 py-2 text-sm bg-slate-100 rounded-xl border-none focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Filters */}
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {[
                { id: 'all',    label: 'All' },
                { id: 'unread', label: 'Unread' },
                { id: 'web',    label: webCount > 0 ? `Web (${webCount})` : 'Web' },
                { id: 'sms',    label: 'SMS' },
                { id: 'email',  label: 'Email' },
              ].map(f => (
                <button key={f.id} onClick={() => setFilter(f.id)}
                  className={`text-xs font-medium px-3 py-1 rounded-full border whitespace-nowrap transition-colors flex-shrink-0 ${
                    filter === f.id
                      ? 'bg-violet-500 text-white border-violet-500'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                  }`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto">
            {conversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center px-6">
                <InboxIcon size={28} className="text-slate-300 mb-2" />
                <p className="text-sm font-medium text-slate-500">
                  {search ? 'No results found' : 'No conversations yet'}
                </p>
                {search && (
                  <button onClick={() => setSearch('')} className="text-xs text-violet-500 mt-1 hover:underline">
                    Clear search
                  </button>
                )}
              </div>
            ) : conversations.map(conv => (
              <ConvRow
                key={conv.key}
                conv={conv}
                selected={conv.key === selectedKey}
                onClick={() => handleSelect(conv)}
                onDelete={setConvToDelete}
              />
            ))}
          </div>
        </div>

        {/* ── RIGHT: Thread / lead view ── */}
        <div className={`
          flex-1 min-w-0 bg-white
          ${mobileView === 'list' ? 'hidden sm:flex sm:flex-col' : 'flex flex-col'}
        `}>
          {selectedConv ? (
            selectedConv.isWebLead ? (
              <WebLeadView
                key={selectedConv.key}
                conv={selectedConv}
                onBack={handleBack}
                onStatus={setLeadStatus}
                onConvert={convertLead}
              />
            ) : (
              <ThreadView
                key={selectedConv.key}
                conv={selectedConv}
                onBack={handleBack}
                onSend={handleSent}
                onDeleteCustomer={() => { setSelected(null); setMobile('list'); }}
                onDeleteConversation={setConvToDelete}
              />
            )
          ) : leads.length > 0 ? (
            <LeadSourceReport leads={leads} onBack={handleBack} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
              <div className="w-16 h-16 rounded-2xl bg-violet-50 flex items-center justify-center mb-4">
                <InboxIcon size={28} className="text-violet-400" />
              </div>
              <p className="text-slate-700 font-semibold mb-1">Select a conversation</p>
              <p className="text-sm text-slate-400">Choose a message or web lead from the left to view it</p>
            </div>
          )}
        </div>

      </div>

      {pickerOpen && (
        <CustomerPickerModal onClose={() => setPickerOpen(false)} onPick={handleNewMessage} />
      )}

      {convToDelete && (
        <ConfirmDeleteConvModal
          conv={convToDelete}
          busy={deletingConv}
          onCancel={() => setConvToDelete(null)}
          onConfirm={() => handleDeleteConversation(convToDelete)}
        />
      )}
    </div>
  );
}
