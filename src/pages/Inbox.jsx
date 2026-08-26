import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import {
  MessageSquare, Mail, Inbox as InboxIcon, Loader, Search, X,
  Send, ArrowLeft, User, Trash2, Briefcase,
  Globe, Phone, MapPin, Clock, UserPlus, Archive, ArchiveRestore, Check,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import OptionsMenu from '../components/OptionsMenu';
import DeliveryStatus from '../components/DeliveryStatus';
import { deleteCustomer, restoreCustomer, saveCustomer, getCustomers } from '../store/data';
import { useProfile } from '../contexts/UserProfileContext';
import { toast } from '../components/ToastContainer';
import { format, parseISO, isToday, isYesterday, isThisWeek } from 'date-fns';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = parseISO(dateStr);
  if (isToday(d))      return format(d, 'h:mm a');
  if (isYesterday(d))  return 'Yesterday';
  if (isThisWeek(d))   return format(d, 'EEE');
  return format(d, 'd MMM');
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

// Turn a web_enquiries row into a conversation-shaped object so it can live in
// the same list as message threads. Web leads are read-only inbound items.
function enquiryToConv(e) {
  const status = e.status || 'new';
  const preview = e.message?.trim()
    || (e.interest ? `Enquiry about ${e.interest}` : 'New website enquiry');
  return {
    key: `web:${e.id}`,
    isWebLead: true,
    enquiry: e,
    customerId: null,
    customerName: e.name || 'Website enquiry',
    customerPhone: e.phone || null,
    customerEmail: e.email || null,
    jobId: null,
    last: { channel: 'web', direction: 'inbound', body: preview, created_at: e.created_at },
    lastAt: e.created_at || '',
    unread: status === 'new' ? 1 : 0,
    channels: ['web'],
    messages: [],
  };
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
          {conv.isWebLead && (
            <span className="text-[10px] font-medium text-teal-600 flex-shrink-0">Web lead:</span>
          )}
          {!conv.isWebLead && conv.last?.direction === 'outbound' && (
            <span className="text-[10px] text-slate-400 flex-shrink-0">You:</span>
          )}
          <p className={`text-xs truncate ${hasUnread ? 'text-slate-700' : 'text-slate-400'}`}>
            {conv.last?.body ?? '—'}
          </p>
        </div>
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

// ── Web lead detail panel ─────────────────────────────────────────────────────
const PREF_LABEL = { call: 'Phone call', text: 'Text message', email: 'Email' };

function WebLeadView({ conv, onBack, onStatus, onConvert }) {
  const e = conv.enquiry;
  const status = e.status || 'new';
  const meta = LEAD_STATUS[status] || LEAD_STATUS.new;
  const [busy, setBusy] = useState(false);

  const act = async (fn) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  // Reply composer — Call (tel:), Text (SMS via Twilio) or Email (via Resend),
  // sent through the existing send-communication edge function. Defaults to the
  // method the customer picked on the form.
  const initialChannel = ['call', 'text', 'email'].includes(e.preferred_contact)
    ? e.preferred_contact
    : (e.phone ? 'call' : 'email');
  const [channel, setChannel] = useState(initialChannel);
  const [body, setBody]       = useState('');
  const [subject, setSubject] = useState('Your enquiry with Lusso');
  const [sending, setSending] = useState(false);
  const [error, setError]     = useState('');
  // The thread for this enquiry, read from `communications`. Was session-only
  // state, so sent replies vanished on reload and a lead's reply never appeared
  // at all. Now both directions persist and survive a refresh.
  const [thread, setThread]   = useState([]);

  const loadThread = useCallback(async () => {
    if (!supabase || !e.id) return;
    const { data } = await supabase
      .from('communications')
      .select('id, channel, direction, body, created_at, status, status_detail')
      .eq('enquiry_id', e.id)
      .order('created_at', { ascending: true });
    setThread(data ?? []);
  }, [e.id]);

  // Cancellable so a fast click through enquiries can't land an older
  // response on top of a newer one, or set state after unmount.
  useEffect(() => {
    if (!supabase || !e.id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('communications')
        .select('id, channel, direction, body, created_at, status, status_detail')
        .eq('enquiry_id', e.id)
        .order('created_at', { ascending: true });
      if (!cancelled) setThread(data ?? []);
    })();
    return () => { cancelled = true; };
  }, [e.id]);

  const canSend   = channel === 'text' ? !!e.phone : channel === 'email' ? !!e.email : !!e.phone;
  const firstName = (e.name || '').trim().split(/\s+/)[0] || 'lead';

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
      setBody('');
      if (status === 'new') onStatus(e, 'contacted');
      toast(`${channel === 'text' ? 'Text' : 'Email'} sent to ${firstName}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-white flex-shrink-0">
        <button onClick={onBack} className="sm:hidden text-slate-400 hover:text-slate-700 -ml-1 p-1">
          <ArrowLeft size={18} />
        </button>
        <div className="relative">
          <Avatar name={conv.customerName} size="lg" />
          <ChannelBadge channel="web" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-slate-900 text-sm">{conv.customerName}</p>
          <p className="text-xs text-slate-400 truncate">Website enquiry · lusso.com.au</p>
        </div>
        <span className={`inline-flex items-center rounded-full font-medium text-xs px-2.5 py-1 ${meta.pill}`}>
          {meta.label}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 bg-slate-50/50 space-y-5">
        {/* Meta chips */}
        <div className="flex flex-wrap gap-2">
          {e.interest && (
            <span className="inline-flex items-center rounded-full bg-white border border-slate-200 text-slate-600 text-xs px-3 py-1">
              {e.interest}
            </span>
          )}
          <span className="inline-flex items-center gap-1 rounded-full bg-white border border-slate-200 text-slate-500 text-xs px-3 py-1">
            <Clock size={12} />
            {e.created_at ? format(parseISO(e.created_at), 'd MMM yyyy, h:mm a') : ''}
          </span>
          {e.preferred_contact && (
            <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 border border-teal-200 text-teal-700 text-xs px-3 py-1 font-medium">
              Prefers {PREF_LABEL[e.preferred_contact] ?? e.preferred_contact}
            </span>
          )}
        </div>

        {/* Contact */}
        <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          {e.phone && (
            <a href={`tel:${e.phone}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
              <Phone size={15} className="text-slate-400" />
              <span className="text-sm text-slate-700">{e.phone}</span>
            </a>
          )}
          {e.email && (
            <a href={`mailto:${e.email}`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
              <Mail size={15} className="text-slate-400" />
              <span className="text-sm text-slate-700">{e.email}</span>
            </a>
          )}
          {e.suburb && (
            <div className="flex items-center gap-3 px-4 py-3">
              <MapPin size={15} className="text-slate-400" />
              <span className="text-sm text-slate-700">{e.suburb}</span>
            </div>
          )}
          {!e.phone && !e.email && !e.suburb && (
            <div className="px-4 py-3 text-sm text-slate-400">No contact details provided.</div>
          )}
        </div>

        {/* Message */}
        {e.message && (
          <div>
            <p className="text-[11px] font-semibold tracking-wide uppercase text-slate-400 mb-1.5">Message</p>
            <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3.5 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
              {e.message}
            </div>
          </div>
        )}
      </div>

      {/* Reply composer + lifecycle actions */}
      <div className="flex-shrink-0 border-t border-slate-200 bg-white p-3 space-y-2.5">
        {/* Conversation so far — outbound and the lead's replies */}
        {thread.length > 0 && (
          <div className="space-y-1.5 max-h-28 overflow-y-auto">
            {thread.map(m => {
              const out = m.direction === 'outbound';
              return (
                <div key={m.id} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${
                    out ? 'rounded-br-sm bg-teal-600 text-white'
                        : 'rounded-bl-sm bg-white border border-slate-200 text-slate-800'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                    <p className={`text-[10px] mt-0.5 ${out ? 'text-teal-100 text-right' : 'text-slate-400'}`}>
                      {m.channel === 'sms' ? 'Text' : 'Email'} · {format(parseISO(m.created_at), 'h:mm a')}
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
        )}

        {/* Channel toggle (defaults to the lead's preferred method, marked ★) */}
        <div className="flex gap-1.5">
          {[{ k: 'call', l: 'Call' }, { k: 'text', l: 'Text' }, { k: 'email', l: 'Email' }].map(c => (
            <button key={c.k} onClick={() => { setChannel(c.k); setError(''); }}
              className={`text-xs font-medium px-3 py-1 rounded-full border transition-colors ${
                channel === c.k ? 'bg-teal-600 text-white border-teal-600' : 'text-slate-500 border-slate-200 hover:border-slate-300'
              }`}>
              {c.l}{e.preferred_contact === c.k ? ' ★' : ''}
            </button>
          ))}
        </div>

        {error && <p className="text-xs text-red-500 px-1">{error}</p>}

        {channel === 'call' ? (
          e.phone ? (
            <a href={`tel:${e.phone}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full bg-teal-600 hover:bg-teal-700 text-white rounded-xl py-2.5 text-sm font-semibold transition-colors">
              <Phone size={15} /> Call {e.phone}
            </a>
          ) : (
            <p className="text-xs text-slate-400 px-1 py-1.5">No phone number provided for this lead.</p>
          )
        ) : (
          <>
            {channel === 'email' && (
              <input value={subject} onChange={ev => setSubject(ev.target.value)} placeholder="Subject"
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400" />
            )}
            <div className="flex gap-2 items-end">
              <textarea
                value={body}
                onChange={ev => setBody(ev.target.value)}
                onKeyDown={ev => { if (ev.key === 'Enter' && !ev.shiftKey && channel === 'text') { ev.preventDefault(); sendReply(); } }}
                placeholder={canSend ? `Write a${channel === 'text' ? ' text' : 'n email'} to ${firstName}…` : `No ${channel === 'text' ? 'phone number' : 'email'} on file`}
                disabled={!canSend}
                rows={1}
                className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none disabled:bg-slate-50 disabled:text-slate-400"
                style={{ maxHeight: '120px', overflowY: 'auto' }}
              />
              <button onClick={sendReply} disabled={!body.trim() || !canSend || sending}
                className="w-10 h-10 flex items-center justify-center bg-teal-600 hover:bg-teal-700 disabled:opacity-40 text-white rounded-xl transition-colors flex-shrink-0">
                {sending ? <Loader size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
          </>
        )}

        {/* Lifecycle actions */}
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          {status !== 'converted' ? (
            <button disabled={busy} onClick={() => act(() => onConvert(e))}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-teal-700 bg-teal-50 hover:bg-teal-100 transition-colors disabled:opacity-50">
              <UserPlus size={13} /> Convert to customer
            </button>
          ) : (
            <span className="flex items-center gap-1.5 px-1 text-xs font-medium text-emerald-600">
              <Check size={14} /> Added to customers
            </span>
          )}
          {status === 'new' && (
            <button disabled={busy} onClick={() => act(() => onStatus(e, 'contacted'))}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-50">
              <Check size={13} /> Mark contacted
            </button>
          )}
          {status !== 'archived' ? (
            <button disabled={busy} onClick={() => act(() => onStatus(e, 'archived'))}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-50 ml-auto">
              <Archive size={13} /> Archive
            </button>
          ) : (
            <button disabled={busy} onClick={() => act(() => onStatus(e, 'new'))}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 transition-colors disabled:opacity-50 ml-auto">
              <ArchiveRestore size={13} /> Restore
            </button>
          )}
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

  // Group messages by date for dividers
  const messagesWithDividers = [];
  let lastDateStr = '';
  for (const m of conv.messages) {
    const dateStr = format(parseISO(m.created_at), 'yyyy-MM-dd');
    if (dateStr !== lastDateStr) {
      messagesWithDividers.push({ type: 'divider', date: m.created_at, key: `div-${dateStr}` });
      lastDateStr = dateStr;
    }
    messagesWithDividers.push({ type: 'message', data: m, key: m.id });
  }

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
          <p className="font-semibold text-slate-900 text-sm">{conv.customerName}</p>
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
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1 bg-slate-50/50">
        {messagesWithDividers.map(item => {
          if (item.type === 'divider') return (
            <div key={item.key} className="flex items-center gap-3 my-4">
              <div className="flex-1 h-px bg-slate-200" />
              <span className="text-[11px] font-medium text-slate-400 flex-shrink-0">
                {formatDateDivider(item.date)}
              </span>
              <div className="flex-1 h-px bg-slate-200" />
            </div>
          );

          const m = item.data;
          const isOut = m.direction === 'outbound';
          return (
            <div key={item.key} className={`flex ${isOut ? 'justify-end' : 'justify-start'} mb-2`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
                isOut
                  ? 'bg-violet-500 text-white rounded-br-sm'
                  : 'bg-white text-slate-800 shadow-sm border border-slate-100 rounded-bl-sm'
              }`}>
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{m.body}</p>
                <p className={`text-[10px] mt-1 ${isOut ? 'text-violet-200' : 'text-slate-400'} text-right`}>
                  {format(parseISO(m.created_at), 'h:mm a')}
                  {m.channel === 'email' && <span className="ml-1">· Email</span>}
                </p>
                {isOut && (
                  <div className="flex justify-end mt-0.5">
                    <DeliveryStatus status={m.status} detail={m.status_detail} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
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
        <div className="flex gap-2 items-end">
          <textarea
            value={reply}
            onChange={e => setReply(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder={canSend ? `Reply via ${channel === 'sms' ? 'SMS' : 'email'}…` : 'No contact info available'}
            disabled={!canSend}
            rows={1}
            className="flex-1 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none disabled:bg-slate-50 disabled:text-slate-400"
            style={{ maxHeight: '120px', overflowY: 'auto' }}
          />
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

  // Mark inbound messages as read when thread is opened (web leads excluded —
  // their key is prefixed `web:` and never matches a communications row)
  useEffect(() => {
    if (!selectedKey || !comms || !supabase) return;
    if (selectedKey.startsWith?.('web:')) return;
    const unread = comms
      .filter(c => {
        const key = c.customer_id || (c.direction === 'inbound' ? c.from_address : c.to_address);
        return key === selectedKey && c.direction === 'inbound' && !c.read_at;
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

      // A web lead is a single web_enquiries row, not a message thread.
      if (conv.isWebLead) {
        const leadId = conv.enquiry.id;
        setLeads(prev => prev.filter(l => l.id !== leadId));
        const { error, count } = await supabase
          .from('web_enquiries')
          .update({ deleted_at: new Date().toISOString() }, { count: 'exact' })
          .eq('id', leadId)
          .is('deleted_at', null);
        if (error) throw error;
        if (count === 0) throw new Error('blocked');

        undo = async () => {
          const { data, error: undoErr } = await supabase
            .from('web_enquiries').update({ deleted_at: null }).eq('id', leadId).select().single();
          if (undoErr) { toast('Could not restore the lead.', 'error'); return; }
          setLeads(prev => prev.some(l => l.id === data.id) ? prev : [data, ...prev]);
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

  // Merge message conversations + web leads into one list, newest first
  const leadConvs = leads.map(enquiryToConv);
  const allConvs  = [...buildConversations(comms ?? []), ...leadConvs]
    .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));
  const unreadTotal = allConvs.reduce((s, c) => s + c.unread, 0);
  const webCount    = leadConvs.length;

  // Apply filter + search to conversation list
  const conversations = allConvs.filter(conv => {
    if (filter === 'web')    return conv.isWebLead;
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
    <div className="flex flex-col h-[calc(100vh-64px)]">

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
              <button
                onClick={() => setPickerOpen(true)}
                title="New message"
                className="flex items-center gap-1.5 text-xs font-semibold bg-violet-500 hover:bg-violet-400 text-white px-3 py-1.5 rounded-lg transition-colors flex-shrink-0">
                <MessageSquare size={14} /> New
              </button>
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
