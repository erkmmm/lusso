// ─── AI Knowledge Base Section ────────────────────────────────────────────────
// Documents the Job Assistant can read on every job. Stored in Supabase, so
// what one person uploads is what everybody's assistant reads — it used to be
// filed under "Sync & Data", next to force-push, which is a different kind of
// thing entirely.
import { useState, useEffect, useRef } from 'react';
import { Bot, Upload, Trash2, Loader } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { toast } from '../../components/ToastContainer';
import Card from '../../components/Card';
import { ScopeBadge } from './SettingsCard';

export default function AIKnowledge() {
  const [docs, setDocs]               = useState([]);
  const [loading, setLoading]         = useState(true);
  const [uploading, setUploading]     = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [editingId, setEditingId]     = useState(null);
  const [editDesc, setEditDesc]       = useState('');
  const [session, setSession]         = useState(null);
  const [dragOver, setDragOver]       = useState(false);
  const fileRef = useRef(null);

  const ACCEPT_EXTS = ['txt', 'md', 'csv', 'json', 'html', 'xml', 'pdf', 'xlsx', 'xls', 'xlsm', 'ods'];
  const SHEET_EXTS  = ['xlsx', 'xls', 'xlsm', 'ods'];

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    supabase
      .from('ai_global_knowledge')
      .select('id, filename, file_type, description, created_at')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setDocs(data ?? []); setLoading(false); });
  }, []);

  const fileTypeIcon = (ft) => {
    if (ft === 'pdf') return '📄';
    if (['csv', 'xlsx', 'xls', 'xlsm', 'ods'].includes(ft)) return '📊';
    if (['md', 'txt'].includes(ft)) return '📝';
    return '📎';
  };

  // Upload a single file (extract text → insert row). Throws on failure.
  const uploadOne = async (file) => {
    let text = '';
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'pdf') {
      const { extractPdfText } = await import('../../lib/pdfExtract');
      text = await extractPdfText(file);
      if (!text.trim()) throw new Error('Could not extract text from this PDF. It may be a scanned image — try a text-based PDF.');
    } else if (SHEET_EXTS.includes(ext)) {
      const { extractSheetText } = await import('../../lib/sheetExtract');
      text = await extractSheetText(file);
      if (!text.trim()) throw new Error('This spreadsheet appears to be empty — no cell data to read.');
    } else {
      try { text = await file.text(); } catch { text = `[Binary file: ${file.name}]`; }
    }
    if (!text.trim()) throw new Error('Could not read any text from this file.');
    const { data, error: dbErr } = await supabase
      .from('ai_global_knowledge')
      .insert({
        filename: file.name,
        // Stored whole. An 80k cap silently guillotined the back half of every
        // supplier price list — including the fabric/colour-code tables that
        // live at the end — so the assistant genuinely could not look them up.
        // The prompt builder does its own budgeting when it loads these.
        content: text,
        file_type: ext,
        created_by: session.user.id,
      })
      .select('id, filename, file_type, description, created_at')
      .single();
    if (dbErr) throw new Error(dbErr.message);
    setDocs(prev => [data, ...prev]);
  };

  // Handle one or more files (from the picker OR a drag-drop), sequentially.
  const uploadFiles = async (fileList) => {
    if (!session) return;
    const files = [...(fileList || [])];
    const accepted = files.filter(f => ACCEPT_EXTS.includes(f.name.split('.').pop().toLowerCase()));
    const rejected = files.length - accepted.length;
    if (!accepted.length) {
      setUploadError('Unsupported file type. Use PDF, XLSX, XLS, CSV, TXT, MD, JSON, HTML or XML.');
      return;
    }
    setUploading(true);
    setUploadError(null);
    let ok = 0;
    const errors = [];
    for (const file of accepted) {
      try { await uploadOne(file); ok++; }
      catch (err) { errors.push(`"${file.name}": ${err.message}`); }
    }
    setUploading(false);
    if (errors.length) setUploadError(errors.join(' · '));
    if (ok) toast(ok === 1 ? 'Added to knowledge base.' : `${ok} documents added to knowledge base.`);
    if (rejected && !errors.length) setUploadError(`${rejected} file${rejected !== 1 ? 's' : ''} skipped (unsupported type).`);
  };

  const handleFileChange = async (e) => {
    const files = e.target.files;
    if (files?.length) await uploadFiles(files);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (uploading) return;
    const files = e.dataTransfer?.files;
    if (files?.length) uploadFiles(files);
  };
  const handleDragOver = (e) => { e.preventDefault(); if (!dragOver) setDragOver(true); };
  const handleDragLeave = (e) => { if (e.currentTarget.contains(e.relatedTarget)) return; setDragOver(false); };

  const handleDelete = async (id, filename) => {
    if (!window.confirm(`Remove "${filename}" from the knowledge base?`)) return;
    setDocs(prev => prev.filter(d => d.id !== id));
    await supabase.from('ai_global_knowledge').delete().eq('id', id);
    toast('Document removed.');
  };

  const handleSaveDesc = async (id) => {
    await supabase.from('ai_global_knowledge').update({ description: editDesc }).eq('id', id);
    setDocs(prev => prev.map(d => d.id === id ? { ...d, description: editDesc } : d));
    setEditingId(null);
    toast('Description saved.');
  };

  return (
    <div className="relative"
      onDragEnter={handleDragOver} onDragOver={handleDragOver}
      onDragLeave={handleDragLeave} onDrop={handleDrop}>
    <Card id="ai-knowledge" data-settings-card="ai-knowledge" className="scroll-mt-24">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2 flex-wrap">
            <Bot size={15} className="text-violet-500" /> <span>AI Knowledge Base</span>
            <ScopeBadge scope="team" />
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Documents here are available to the Job Assistant across every job — product catalogues, pricing guides, policies.
          </p>
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 text-xs font-medium bg-violet-500 hover:bg-violet-400 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
        >
          {uploading ? <Loader size={12} className="animate-spin" /> : <Upload size={12} />}
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
        <input ref={fileRef} type="file" multiple className="hidden"
          accept=".txt,.md,.csv,.json,.html,.xml,.pdf,.xlsx,.xls,.xlsm,.ods"
          onChange={handleFileChange} />
      </div>

      {uploadError && (
        <div className="px-5 py-2 bg-red-50 border-b border-red-100 text-xs text-red-600">{uploadError}</div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader size={16} className="animate-spin text-slate-400" />
        </div>
      ) : docs.length === 0 ? (
        <div className="px-5 py-8">
          <button type="button" onClick={() => fileRef.current?.click()}
            className="w-full flex flex-col items-center text-center rounded-xl border-2 border-dashed border-slate-200 hover:border-violet-300 hover:bg-violet-50/40 transition-colors py-8 px-4">
            <Upload size={26} className="mb-3 text-slate-300" />
            <p className="text-sm font-medium text-slate-600">Drag &amp; drop files here, or click to browse</p>
            <p className="text-xs text-slate-400 mt-1 max-w-xs">Your product catalogue, pricing sheet, or any reference material every job assistant should know about.</p>
            <p className="text-[11px] text-slate-300 mt-2">PDF, XLSX, XLS, CSV, TXT, MD, JSON, HTML, XML</p>
          </button>
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {docs.map(doc => (
            <div key={doc.id} className="px-5 py-4">
              <div className="flex items-start gap-3">
                <span className="text-xl mt-0.5">{fileTypeIcon(doc.file_type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{doc.filename}</p>
                  {editingId === doc.id ? (
                    <div className="flex items-center gap-2 mt-1.5">
                      <input
                        autoFocus
                        value={editDesc}
                        onChange={e => setEditDesc(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveDesc(doc.id); if (e.key === 'Escape') setEditingId(null); }}
                        placeholder="Short description e.g. 'Product catalogue 2025'"
                        className="flex-1 text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-400"
                      />
                      <button onClick={() => handleSaveDesc(doc.id)} className="text-xs text-violet-600 font-medium hover:underline relative before:absolute before:content-[''] before:-inset-[14px]">Save</button>
                      <button onClick={() => setEditingId(null)} className="text-xs text-slate-400 hover:text-slate-600 relative before:absolute before:content-[''] before:-inset-[14px]">Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => { setEditingId(doc.id); setEditDesc(doc.description ?? ''); }}
                      className="text-xs text-slate-400 hover:text-slate-600 mt-0.5 text-left"
                    >
                      {doc.description ? doc.description : <span className="italic">Add a description…</span>}
                    </button>
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">
                    Added {doc.created_at ? new Date(doc.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(doc.id, doc.filename)}
                  className="text-slate-300 hover:text-red-400 transition-colors flex-shrink-0 p-1 rounded relative before:absolute before:content-[''] before:-inset-[11px]"
                  title="Remove">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>

    {/* Drag-over overlay — covers the whole card while a file is being dragged in */}
    {dragOver && (
      <div className="absolute inset-0 z-10 rounded-xl border-2 border-dashed border-violet-400 bg-violet-50/90 backdrop-blur-[1px] flex flex-col items-center justify-center pointer-events-none">
        <Upload size={30} className="text-violet-500 mb-2" />
        <p className="text-sm font-semibold text-violet-700">Drop to add to the knowledge base</p>
        <p className="text-xs text-violet-500 mt-0.5">PDF, XLSX, XLS, CSV, TXT, MD, JSON, HTML, XML</p>
      </div>
    )}
    </div>
  );
}
