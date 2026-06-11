import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useNavigate } from 'react-router-dom';
import {
  MessageSquare, Mail, Inbox as InboxIcon, Loader, Search, X,
  Send, ArrowLeft, ChevronRight, ExternalLink, User, Trash2, Briefcase,
  Globe, Phone, MapPin, Clock, UserPlus, Archive, ArchiveRestore, Check,
} from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import OptionsMenu from '../components/OptionsMenu';
import { deleteCustomer, restoreCustomer, saveCustomer } from '../store/data';
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
function ConvRow({ conv, selected, onClick }) {
  const hasUnread = conv.unread > 0;
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 flex items-start gap-3 transition-colors border-b border-slate-100 last:border-0 ${
        selected
          ? 'bg-violet-50 border-l-2 border-l-violet-500'
          : hasUnread
            ? 'bg-violet-50/30 hover:bg-slate-50'
            : 'hover:bg-slate-50'
      }`}
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
  const [sent, setSent]       = useState([]);

  const canSend   = channel === 'text' ? !!e.phone : channel === 'email' ? !!e.email : !!e.phone;
  const firstName = (e.name || '').trim().split(/\s+/)[0] || 'lead';

  const sendReply = async () => {
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
          to,
          subject: channel === 'email' ? subject : undefined,
          body: body.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to send');
      setSent(prev => [...prev, { channel, body: body.trim(), at: new Date().toISOString() }]);
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
            <a href={`tel:${e.phone}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
              <Phone size={15} className="text-slate-400" />
              <span className="text-sm text-slate-700">{e.phone}</span>
            </a>
          )}
          {e.email && (
            <a href={`mailto:${e.email}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
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
        {/* Replies sent this session */}
        {sent.length > 0 && (
          <div className="space-y-1.5 max-h-28 overflow-y-auto">
            {sent.map((s, i) => (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-teal-600 text-white px-3.5 py-2">
                  <p className="text-sm whitespace-pre-wrap break-words">{s.body}</p>
                  <p className="text-[10px] text-teal-100 text-right mt-0.5">
                    {s.channel === 'text' ? 'Text' : 'Email'} · {format(parseISO(s.at), 'h:mm a')}
                  </p>
                </div>
              </div>
            ))}
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
            <a href={`tel:${e.phone}`}
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
function ThreadView({ conv, onBack, onSend, onDeleteCustomer }) {
  const [reply,   setReply]   = useState('');
  const [channel, setChannel] = useState(conv.last?.channel ?? 'sms');
  const [sending, setSending] = useState(false);
  const [error,   setError]   = useState('');
  const navigate = useNavigate();
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conv.messages.length]);

  const canSend = channel === 'sms' ? !!conv.customerPhone : !!conv.customerEmail;

  const handleSend = async () => {
    if (!reply.trim() || !canSend) return;
    setSending(true); setError('');
    try {
      const to = channel === 'sms' ? conv.customerPhone : conv.customerEmail;
      const { data: { session } } = await supabase.auth.getSession();
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
            ...(conv.customerId ? [
              { divider: true },
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
export default function Inbox() {
  const navigate = useNavigate();
  const { displayName = '' } = useProfile() || {};
  const [comms,    setComms]    = useState(null);
  const [leads,    setLeads]    = useState([]); // web_enquiries rows
  const [filter,   setFilter]   = useState('all');
  const [search,   setSearch]   = useState('');
  const [selectedKey, setSelected] = useState(null);
  const [mobileView, setMobile]   = useState('list'); // 'list' | 'thread'

  // Load all comms
  useEffect(() => {
    if (!supabase) return;
    supabase
      .from('communications')
      .select('*, jobs!left(job_number, status, deleted_at), customers!left(name, phone, email, deleted_at)')
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data }) => {
        const filtered = (data ?? []).filter(c => {
          if (c.customers?.deleted_at) return false;
          if (c.jobs?.deleted_at)      return false;
          return true;
        });
        setComms(filtered);
      });
  }, []);

  // Load website enquiries
  const loadLeads = useCallback(() => {
    if (!supabase) return;
    supabase
      .from('web_enquiries')
      .select('*')
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
        (payload) => setLeads(prev => prev.map(l => l.id === payload.new.id ? { ...l, ...payload.new } : l))
      )
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  // Light poll for web enquiries (realtime isn't reliable in all environments)
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') loadLeads();
    }, 20000);
    return () => clearInterval(t);
  }, [loadLeads]);

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

  const selectedConv = selectedKey ? conversations.find(c => c.key === selectedKey) ?? allConvs.find(c => c.key === selectedKey) : null;

  const handleSelect = (conv) => {
    setSelected(conv.key);
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
    </div>
  );
}
