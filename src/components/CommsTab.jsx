import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Send, MessageSquare, Mail, Phone, PhoneOutgoing, PhoneIncoming, Loader, ChevronDown } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import Card from './Card';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const QUICK_SMS = [
  'Hi {name}, just confirming your measure appointment. Please let us know if you need to reschedule.',
  'Hi {name}, your quote is ready — we\'ll be in touch shortly.',
  'Hi {name}, we\'re confirming your installation for the date booked. We\'ll be in touch with a time closer to the day.',
  'Hi {name}, your installation is complete! Thanks for choosing Lusso.',
];

// Call outcomes stored in the `subject` column of a channel='call' row.
const CALL_OUTCOMES = ['Answered', 'No answer', 'Left voicemail', 'Busy', 'Wrong number'];

async function sendComm(channel, payload, session) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-communication`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Send failed');
  return data.communication;
}

export default function CommsTab({ jobId, customerId, customerName, customerPhone, customerEmail }) {
  const [messages, setMessages]   = useState(null);
  const [channel, setChannel]     = useState('sms');
  const [body, setBody]           = useState('');
  const [subject, setSubject]     = useState('');
  const [sending, setSending]     = useState(false);
  const [error, setError]         = useState(null);
  const [session, setSession]     = useState(null);
  const [showQuick, setShowQuick] = useState(false);

  // Call-logging state
  const [callDir, setCallDir]         = useState('outbound');
  const [callOutcome, setCallOutcome] = useState(CALL_OUTCOMES[0]);
  const [callMinutes, setCallMinutes] = useState('');
  const [callNotes, setCallNotes]     = useState('');
  const [logging, setLogging]         = useState(false);

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
  }, []);

  useEffect(() => {
    if (!supabase) { setMessages([]); return; }
    let query = supabase
      .from('communications')
      .select('*, jobs(job_number)')
      .order('created_at', { ascending: true });
    if (jobId) {
      query = query.eq('job_id', jobId);
    } else if (customerId) {
      query = query.eq('customer_id', customerId);
    } else {
      setMessages([]);
      return;
    }
    query.then(({ data }) => setMessages(data ?? []));
  }, [jobId, customerId]);

  // Realtime updates (dedupe by id so an optimistic/echoed row isn't doubled)
  useEffect(() => {
    if (!supabase) return;
    const filter = jobId
      ? `job_id=eq.${jobId}`
      : customerId ? `customer_id=eq.${customerId}` : null;
    if (!filter) return;
    const key = jobId ?? customerId;
    const channel_ = supabase
      .channel(`comms-${key}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'communications', filter },
        (payload) => setMessages(prev => {
          const list = prev ?? [];
          if (list.some(m => m.id === payload.new.id)) return list;
          return [...list, payload.new];
        })
      )
      .subscribe();
    return () => supabase.removeChannel(channel_);
  }, [jobId, customerId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const to = channel === 'email' ? customerEmail : customerPhone;

  const handleSend = async () => {
    if (!body.trim() || sending || !session || !to) return;
    setSending(true);
    setError(null);
    const optimistic = {
      id: 'opt-' + Date.now(), channel, direction: 'outbound',
      body: body.trim(), subject, to_address: to,
      status: 'sent', created_at: new Date().toISOString(),
    };
    setMessages(prev => [...(prev ?? []), optimistic]);
    const msgBody = body.trim();
    setBody('');
    try {
      await sendComm(channel, {
        channel, jobId, customerId,
        to, subject: subject || undefined,
        body: msgBody,
      }, session);
    } catch (err) {
      setError(err.message);
      setMessages(prev => (prev ?? []).filter(m => m.id !== optimistic.id));
      setBody(msgBody);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  // Log a phone call. This is a plain DB insert (no external send) — RLS lets an
  // active staff user write to `communications` directly.
  const handleLogCall = async () => {
    if (logging || !session) return;
    setLogging(true);
    setError(null);
    const mins = String(callMinutes).trim();
    const durationLabel = mins && Number(mins) > 0 ? `${mins} min` : null;
    const subjectLine = [callOutcome, durationLabel].filter(Boolean).join(' · ');
    const row = {
      job_id: jobId ?? null,
      customer_id: customerId ?? null,
      channel: 'call',
      direction: callDir,
      subject: subjectLine,
      body: callNotes.trim() || callOutcome,
      to_address: callDir === 'outbound' ? customerPhone : null,
      from_address: callDir === 'inbound' ? customerPhone : null,
      status: callDir === 'outbound' ? 'sent' : 'received',
      created_by: session.user?.id ?? null,
    };
    try {
      const { data, error: dbErr } = await supabase
        .from('communications')
        .insert(row)
        .select('*, jobs(job_number)')
        .single();
      if (dbErr) throw dbErr;
      setMessages(prev => {
        const list = prev ?? [];
        if (list.some(m => m.id === data.id)) return list;
        return [...list, data];
      });
      setCallNotes('');
      setCallMinutes('');
      setCallOutcome(CALL_OUTCOMES[0]);
    } catch (err) {
      setError(err.message || 'Could not log the call.');
    } finally {
      setLogging(false);
    }
  };

  const applyQuick = (tpl) => {
    const resolved = tpl.replaceAll('{name}', customerName?.split(' ')[0] ?? 'there');
    setBody(resolved);
    setShowQuick(false);
    inputRef.current?.focus();
  };

  const hasTo = !!to;
  const threadMessages = (messages ?? []).filter(m => m.channel === channel);

  const tabClass = (ch) =>
    `flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
      channel === ch ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
    }`;

  return (
    <div className="space-y-4">
      {/* Channel selector */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setChannel('sms')} className={tabClass('sms')}>
          <MessageSquare size={14} /> SMS
          {customerPhone && <span className="text-xs opacity-70">{customerPhone}</span>}
        </button>
        <button onClick={() => setChannel('email')} className={tabClass('email')}>
          <Mail size={14} /> Email
          {customerEmail && <span className="text-xs opacity-70">{customerEmail}</span>}
        </button>
        <button onClick={() => setChannel('call')} className={tabClass('call')}>
          <Phone size={14} /> Calls
        </button>
      </div>

      {!hasTo && channel !== 'call' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-700">
          No {channel === 'sms' ? 'phone number' : 'email address'} on file for this customer. Add one on the customer profile first.
        </div>
      )}

      {/* Message thread */}
      <Card className="overflow-hidden">
        <div className="h-96 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50/40">
          {messages === null && (
            <div className="flex items-center justify-center h-full">
              <Loader size={16} className="animate-spin text-slate-400" />
            </div>
          )}

          {messages !== null && threadMessages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center gap-2">
              {channel === 'sms'   && <MessageSquare size={28} className="text-slate-300" />}
              {channel === 'email' && <Mail size={28} className="text-slate-300" />}
              {channel === 'call'  && <Phone size={28} className="text-slate-300" />}
              <p className="text-sm text-slate-500 font-medium">
                No {channel === 'sms' ? 'SMS messages' : channel === 'email' ? 'emails' : 'calls logged'} yet
              </p>
              <p className="text-xs text-slate-400">
                {channel === 'call' ? 'Tap the number to call, then log the outcome below' : 'Use the quick messages below or write your own'}
              </p>
            </div>
          )}

          {/* Call log entries render as centered timeline cards */}
          {messages !== null && channel === 'call' && threadMessages.map((m, i) => (
            <div key={m.id ?? i} className="flex justify-center">
              <div className="w-full max-w-[90%] bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 shadow-sm">
                <div className="flex items-center gap-2">
                  {m.direction === 'inbound'
                    ? <PhoneIncoming size={14} className="text-emerald-500" />
                    : <PhoneOutgoing size={14} className="text-amber-600" />}
                  <span className="text-sm font-medium text-slate-700">
                    {m.direction === 'inbound' ? 'Incoming call' : 'Outgoing call'}
                  </span>
                  {m.subject && <span className="text-xs text-slate-400">· {m.subject}</span>}
                </div>
                {m.body && m.body !== (m.subject?.split(' · ')[0]) && (
                  <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{m.body}</p>
                )}
                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  <span className="text-[10px] text-slate-400">
                    {m.created_at ? format(parseISO(m.created_at), 'd MMM h:mm a') : ''}
                  </span>
                  {!jobId && m.jobs?.job_number && (
                    <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono">{m.jobs.job_number}</span>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* SMS / email bubbles */}
          {messages !== null && channel !== 'call' && threadMessages.map((m, i) => (
            <div key={m.id ?? i} className={`flex ${m.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] flex flex-col gap-0.5 ${m.direction === 'outbound' ? 'items-end' : 'items-start'}`}>
                {channel === 'email' && m.subject && (
                  <span className="text-xs text-slate-400 px-1">Re: {m.subject}</span>
                )}
                <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.direction === 'outbound'
                    ? 'bg-amber-500 text-white rounded-br-sm'
                    : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-sm'
                }`}>
                  {m.body}
                </div>
                <div className="flex items-center gap-1.5 px-1 flex-wrap">
                  <span className="text-[10px] text-slate-400">
                    {m.direction === 'outbound' ? 'You' : customerName} · {m.created_at ? format(parseISO(m.created_at), 'd MMM h:mm a') : ''}
                  </span>
                  {m.direction === 'outbound' && (
                    <span className={`text-[10px] ${m.status === 'failed' ? 'text-red-400' : 'text-slate-400'}`}>
                      {m.status === 'sent' ? '✓' : m.status === 'delivered' ? '✓✓' : m.status === 'failed' ? '✗' : ''}
                    </span>
                  )}
                  {!jobId && m.jobs?.job_number && (
                    <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono">{m.jobs.job_number}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 bg-red-50 border-t border-red-100 text-xs text-red-600">{error}</div>
        )}

        {/* ── Call compose: tap-to-dial + log form ─────────────────────────── */}
        {channel === 'call' && (
          <div className="border-t border-slate-100 bg-white px-4 py-3 space-y-3">
            {customerPhone ? (
              <a
                href={`tel:${customerPhone.replace(/[^\d+]/g, '')}`}
                className="flex items-center justify-center gap-2 w-full bg-amber-500 hover:bg-amber-400 text-white font-medium text-sm rounded-xl px-4 py-2.5 transition-colors"
              >
                <Phone size={15} /> Call {customerPhone}
              </a>
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 text-sm text-amber-700">
                No phone number on file — add one to call this customer.
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <select
                value={callDir}
                onChange={e => setCallDir(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
              >
                <option value="outbound">Outgoing</option>
                <option value="inbound">Incoming</option>
              </select>
              <select
                value={callOutcome}
                onChange={e => setCallOutcome(e.target.value)}
                className="text-sm border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
              >
                {CALL_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="number"
                min="0"
                value={callMinutes}
                onChange={e => setCallMinutes(e.target.value)}
                placeholder="Mins"
                className="w-20 text-sm border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <input
                value={callNotes}
                onChange={e => setCallNotes(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleLogCall(); } }}
                placeholder="Call notes (optional)"
                className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
              <button
                onClick={handleLogCall}
                disabled={logging || !session}
                className="flex-shrink-0 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-white text-sm font-medium rounded-lg px-4 py-2 transition-colors">
                {logging ? <Loader size={15} className="animate-spin" /> : 'Log'}
              </button>
            </div>
          </div>
        )}

        {/* Email subject */}
        {channel === 'email' && (
          <div className="px-4 pt-3 border-t border-slate-100">
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Subject"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
        )}

        {/* Compose (sms / email) */}
        {channel !== 'call' && (
          <div className="px-4 py-3 border-t border-slate-100 bg-white flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={body}
                onChange={e => setBody(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && channel === 'sms') { e.preventDefault(); handleSend(); }}}
                placeholder={channel === 'sms' ? 'Type an SMS… (Enter to send)' : 'Type your email…'}
                rows={1}
                disabled={sending || !session || !hasTo}
                className="w-full resize-none text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 min-h-[38px] max-h-32 disabled:opacity-60 pr-8"
                style={{ lineHeight: '1.4' }}
                onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px'; }}
              />
              {channel === 'sms' && (
                <button onClick={() => setShowQuick(v => !v)}
                  className="absolute right-2 bottom-2 text-slate-300 hover:text-amber-600 transition-colors"
                  title="Quick messages">
                  <ChevronDown size={14} />
                </button>
              )}
            </div>
            <button
              onClick={handleSend}
              disabled={!body.trim() || sending || !session || !hasTo}
              className="flex-shrink-0 w-9 h-9 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-white rounded-xl flex items-center justify-center transition-colors">
              {sending ? <Loader size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
        )}

        {/* Quick messages */}
        {showQuick && channel === 'sms' && (
          <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 space-y-1.5">
            <p className="text-xs font-medium text-slate-500 mb-2">Quick messages</p>
            {QUICK_SMS.map((tpl, i) => (
              <button key={i} onClick={() => applyQuick(tpl)}
                className="w-full text-left text-xs text-slate-600 bg-white border border-slate-200 hover:border-amber-300 hover:text-amber-700 px-3 py-2 rounded-lg transition-colors">
                {tpl.replaceAll('{name}', customerName?.split(' ')[0] ?? 'there')}
              </button>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
