import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Bot, Send, Trash2, Loader, Sparkles, ChevronDown, ChevronUp, Paperclip, X, FileText, Upload } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import Card from './Card';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const QUICK_PROMPTS = [
  'Summarise this job for me',
  'Draft a follow-up email to the customer',
  'What are the next steps for this job?',
  'Write an internal note about where this job is at',
  'What did we last say to the customer?',
];

async function callJobAI(jobId, message, session) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/job-ai-chat`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jobId, message }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data.reply;
}

async function clearJobAI(jobId, session) {
  await fetch(`${SUPABASE_URL}/functions/v1/job-ai-chat`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jobId, clearHistory: true }),
  });
}

export default function JobAIChat({ jobId }) {
  const [messages, setMessages]         = useState(null);
  const [input, setInput]               = useState('');
  const [sending, setSending]           = useState(false);
  const [error, setError]               = useState(null);
  const [collapsed, setCollapsed]       = useState(false);
  const [session, setSession]           = useState(null);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [knowledge, setKnowledge]       = useState([]);
  const [uploading, setUploading]       = useState(false);
  const [uploadError, setUploadError]   = useState(null);
  const listRef   = useRef(null);
  const inputRef  = useRef(null);
  const fileRef   = useRef(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
  }, []);

  useEffect(() => {
    if (!supabase || !jobId) { setMessages([]); return; }
    supabase
      .from('job_ai_messages')
      .select('id, role, content, created_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true })
      .limit(60)
      .then(({ data }) => setMessages(data ?? []));
  }, [jobId]);

  useEffect(() => {
    if (!supabase || !jobId) return;
    supabase
      .from('job_ai_knowledge')
      .select('id, filename, file_type, created_at')
      .eq('job_id', jobId)
      .order('created_at', { ascending: true })
      .then(({ data }) => setKnowledge(data ?? []));
  }, [jobId]);

  // Keep the conversation scrolled to the latest message — but only the chat
  // container, not the whole page (scrollIntoView would scroll the page too).
  useEffect(() => {
    const el = listRef.current;
    if (el && messages?.length) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleSend = async (text) => {
    const msg = (text ?? input).trim();
    if (!msg || sending || !session) return;
    setInput('');
    setError(null);
    setSending(true);
    const optimisticUser = { id: 'opt-user', role: 'user', content: msg, created_at: new Date().toISOString() };
    setMessages(prev => [...(prev ?? []), optimisticUser]);
    try {
      const reply = await callJobAI(jobId, msg, session);
      const optimisticAI = { id: 'opt-ai', role: 'assistant', content: reply, created_at: new Date().toISOString() };
      setMessages(prev => [...(prev ?? []), optimisticAI]);
    } catch (err) {
      setError(err.message === 'NO_API_KEY'
        ? 'Anthropic API key not configured. Add ANTHROPIC_API_KEY to Supabase Edge Function secrets.'
        : err.message);
      setMessages(prev => (prev ?? []).filter(m => m.id !== 'opt-user'));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const handleClear = async () => {
    if (!window.confirm('Clear the entire conversation for this job?')) return;
    if (!session) return;
    setMessages([]);
    await clearJobAI(jobId, session);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  // ── Knowledge upload ─────────────────────────────────────────────────────

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !session) return;
    fileRef.current.value = '';
    setUploading(true);
    setUploadError(null);

    try {
      let text = '';
      const ext = file.name.split('.').pop().toLowerCase();

      if (ext === 'pdf') {
        const { extractPdfText } = await import('../lib/pdfExtract');
        text = await extractPdfText(file);
        if (!text.trim()) throw new Error('Could not extract text from this PDF. It may be a scanned image — try a text-based PDF.');
      } else {
        try { text = await file.text(); } catch { text = `[Binary file: ${file.name}]`; }
      }

      if (!text.trim()) throw new Error('Could not read any text from this file.');

      const { data, error: dbErr } = await supabase
        .from('job_ai_knowledge')
        .insert({
          job_id: jobId,
          filename: file.name,
          content: text.slice(0, 50000),
          file_type: ext,
          created_by: session.user.id,
        })
        .select('id, filename, file_type, created_at')
        .single();

      if (dbErr) throw new Error(dbErr.message);
      setKnowledge(prev => [...prev, data]);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteKnowledge = async (id) => {
    if (!supabase) return;
    setKnowledge(prev => prev.filter(k => k.id !== id));
    await supabase.from('job_ai_knowledge').delete().eq('id', id);
  };

  const fileTypeIcon = (ft) => {
    if (ft === 'pdf') return '📄';
    if (ft === 'csv') return '📊';
    if (['md', 'txt'].includes(ft)) return '📝';
    return '📎';
  };

  return (
    <Card className="overflow-hidden">
      {/* Header — use div not button to avoid nesting <button> inside <button> */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed(v => !v)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setCollapsed(v => !v); }}
        className="w-full flex items-center justify-between px-5 py-4 border-b border-slate-100 hover:bg-slate-50 transition-colors text-left cursor-pointer select-none"
      >
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <Bot size={15} className="text-violet-500" />
          Job Assistant
          {messages && messages.length > 0 && (
            <span className="text-xs font-normal text-slate-400">({messages.length} message{messages.length !== 1 ? 's' : ''})</span>
          )}
          {knowledge.length > 0 && (
            <span className="text-xs font-normal text-violet-400">· {knowledge.length} doc{knowledge.length !== 1 ? 's' : ''}</span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {messages && messages.length > 0 && !collapsed && (
            <button onClick={e => { e.stopPropagation(); handleClear(); }}
              className="p-1 text-slate-300 hover:text-red-400 transition-colors rounded" title="Clear conversation">
              <Trash2 size={13} />
            </button>
          )}
          {collapsed ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronUp size={14} className="text-slate-400" />}
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Messages area */}
          <div ref={listRef} className="h-80 overflow-y-auto px-5 py-4 space-y-4 bg-slate-50/40">
            {messages === null && (
              <div className="flex items-center justify-center h-full">
                <Loader size={16} className="animate-spin text-slate-400" />
              </div>
            )}

            {messages !== null && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-violet-100 flex items-center justify-center">
                  <Sparkles size={20} className="text-violet-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">Ask anything about this job</p>
                  <p className="text-xs text-slate-400 mt-0.5">Knows the customer, quotes, measures, comms history, and any uploaded docs.</p>
                </div>
                <div className="flex flex-wrap gap-1.5 justify-center mt-1">
                  {QUICK_PROMPTS.map(p => (
                    <button key={p} onClick={() => handleSend(p)} disabled={sending || !session}
                      className="text-xs bg-white border border-slate-200 hover:border-violet-300 hover:text-violet-700 text-slate-600 px-2.5 py-1 rounded-full transition-colors disabled:opacity-50">
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages !== null && messages.length > 0 && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_PROMPTS.map(p => (
                    <button key={p} onClick={() => handleSend(p)} disabled={sending || !session}
                      className="text-xs bg-white border border-slate-200 hover:border-violet-300 hover:text-violet-700 text-slate-500 px-2 py-0.5 rounded-full transition-colors disabled:opacity-50">
                      {p}
                    </button>
                  ))}
                </div>

                {messages.map((m, i) => (
                  <div key={m.id ?? i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {m.role === 'assistant' && (
                      <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0 mt-0.5 mr-2">
                        <Bot size={12} className="text-violet-600" />
                      </div>
                    )}
                    <div className={`max-w-[82%] ${m.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-0.5`}>
                      <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                        m.role === 'user'
                          ? 'bg-violet-500 text-white rounded-br-sm'
                          : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm shadow-sm'
                      }`}>
                        {m.content}
                      </div>
                      <span className="text-[10px] text-slate-400 px-1">
                        {m.created_at ? format(parseISO(m.created_at), 'h:mm a') : ''}
                      </span>
                    </div>
                  </div>
                ))}

                {sending && (
                  <div className="flex items-start gap-2">
                    <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot size={12} className="text-violet-600" />
                    </div>
                    <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-sm px-3.5 py-2.5 shadow-sm">
                      <div className="flex gap-1 items-center">
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="px-5 py-2 bg-red-50 border-t border-red-100 text-xs text-red-600">{error}</div>
          )}

          {/* Knowledge panel */}
          {showKnowledge && (
            <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                  <FileText size={12} /> Knowledge Documents
                </p>
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-500 font-medium disabled:opacity-50">
                  {uploading ? <Loader size={11} className="animate-spin" /> : <Upload size={11} />}
                  {uploading ? 'Uploading…' : 'Upload file'}
                </button>
              </div>
              <input ref={fileRef} type="file" className="hidden"
                accept=".txt,.md,.csv,.json,.html,.xml,.pdf"
                onChange={handleFileChange} />
              {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
              {knowledge.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-2">
                  No documents yet. Upload spec sheets, product info, or any relevant notes — the assistant will read them.
                </p>
              ) : (
                <div className="space-y-1">
                  {knowledge.map(k => (
                    <div key={k.id} className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm">{fileTypeIcon(k.file_type)}</span>
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-700 truncate">{k.filename}</p>
                          <p className="text-[10px] text-slate-400">{format(parseISO(k.created_at), 'd MMM yyyy')}</p>
                        </div>
                      </div>
                      <button onClick={() => handleDeleteKnowledge(k.id)}
                        className="text-slate-300 hover:text-red-400 transition-colors ml-2 flex-shrink-0">
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Input */}
          <div className="px-4 py-3 border-t border-slate-100 bg-white flex items-end gap-2">
            <div className="relative">
              <button
                onClick={() => setShowKnowledge(v => !v)}
                className={`flex-shrink-0 w-9 h-9 rounded-xl border flex items-center justify-center transition-colors ${
                  showKnowledge ? 'border-violet-400 bg-violet-50 text-violet-500' : 'border-slate-200 text-slate-400 hover:text-violet-500 hover:border-violet-300'
                }`}
                title="Knowledge documents">
                <Paperclip size={15} />
              </button>
              {knowledge.length > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-violet-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center pointer-events-none">
                  {knowledge.length}
                </span>
              )}
            </div>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask anything about this job… (Enter to send)"
              rows={1}
              disabled={sending || !session}
              className="flex-1 resize-none text-sm border border-slate-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400 min-h-[38px] max-h-24 disabled:opacity-60"
              style={{ lineHeight: '1.4' }}
              onInput={e => {
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 96) + 'px';
              }}
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || sending || !session}
              className="flex-shrink-0 w-9 h-9 bg-violet-500 hover:bg-violet-400 disabled:opacity-40 text-white rounded-xl flex items-center justify-center transition-colors">
              {sending ? <Loader size={15} className="animate-spin" /> : <Send size={15} />}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
