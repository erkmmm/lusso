import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Sparkles, Loader, CheckCircle2, AlertCircle, ArrowLeft, ExternalLink } from 'lucide-react';
import { getJob, getCustomer, getMeasureSheetsByJob } from '../store/data';
import { useDataRefresh } from '../hooks/useDataRefresh';
import { macQuoteAssistant } from '../lib/macQuoteAssistant';
import AssistantSheetGaps from '../components/AssistantSheetGaps';
import { supplierForLine } from '../lib/quoteAssistant';

const field = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-400';
const button = 'inline-flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50';
const labels = { running: 'Quoting in Chrome', starting: 'Starting', needs_input: 'Your answer is needed', completed: 'Draft ready to review', failed: 'Needs attention', cancelled: 'Stopped' };

export default function QuoteAssistant() {
  const { jobId } = useParams();
  useDataRefresh();
  const job = getJob(jobId);
  const customer = getCustomer(job?.customerId);
  const sheets = getMeasureSheetsByJob(jobId).filter(s => !s.deletedAt);
  const [sheetId, setSheetId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [connection, setConnection] = useState(null);
  const [runs, setRuns] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState('');
  const [sheetEditing, setSheetEditing] = useState(false);
  const [approvedSheet, setApprovedSheet] = useState(null);
  const [setup, setSetup] = useState(false);
  const selectedId = sheetId || (sheets.length === 1 ? sheets[0].id : '');
  const sheet = sheets.find(s => s.id === selectedId);
  const current = runs.find(r => r.jobId === jobId);
  const activeSheet = sheets.find(s => s.id === current?.sheetId) || sheet;
  const inProgress = current && ['running', 'starting', 'needs_input'].includes(current.status);

  const refresh = useCallback(async (background = false) => {
    try {
      const [status, list] = await Promise.all([macQuoteAssistant('/status'), macQuoteAssistant('/runs')]);
      setConnection(status); setRuns(list.runs); if (!background) setError('');
    } catch (e) { setConnection(null); setError(e.message); }
  }, []);
  // Only connect after an explicit click: Chrome may ask for local-network access.
  useEffect(() => {
    if (!connection) return;
    const id = setInterval(() => refresh(true), 8000);
    return () => clearInterval(id);
  }, [Boolean(connection), refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  async function action(path, body) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await macQuoteAssistant(path, { method: 'POST', body });
      setAnswer(''); await refresh();
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  if (!job) return <div className="p-6">Project not found.</div>;
  return <div className="mx-auto max-w-4xl space-y-5 p-4 pb-20 sm:p-6">
    <Link to={`/jobs/${jobId}`} className="inline-flex items-center gap-1 text-sm text-slate-500"><ArrowLeft size={15} /> Back to project</Link>
    <div className="flex items-start gap-3"><div className="rounded-xl bg-amber-100 p-3"><Sparkles className="text-amber-700" size={23} /></div><div><h1 className="text-2xl font-bold text-slate-900">Quote with AI</h1><p className="mt-1 text-sm text-slate-500">{customer?.name} · {job.jobNumber}</p></div></div>
    <p className="text-sm leading-6 text-slate-600">The assistant reads your measure sheet and uploaded project plans, prepares the supplier quotation in BUZ or FHA, and saves a Lusso draft for you to review. You handle sending and ordering.</p>

    <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-slate-900">This Mac’s browser</h2><p className="mt-1 text-sm text-slate-500">{connection ? connection.signedIn ? connection.busy ? 'Connected · Chrome is working on a quote' : 'Claude Code signed in · ready to request a quote' : 'Assistant connected · Claude Code needs sign-in' : 'Connect the assistant before starting.'}</p></div><button className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium" onClick={() => refresh()}>Check connection</button></div>
      <p className="text-xs leading-5 text-slate-500">Keep this Mac awake and Chrome signed in to Lusso and the supplier portals. The first run may need Chrome permission. One quote runs at a time.</p>
      <button onClick={() => setSetup(!setup)} className="text-sm font-medium text-amber-700">{setup ? 'Hide setup' : 'Set up this Mac'}</button>
      {setup && <ol className="list-decimal pl-5 space-y-2 text-sm leading-6 text-slate-600"><li>Open <strong>Start Lusso Quote Assistant.command</strong> on the Desktop. Keep its window open while quoting.</li><li>Open <strong>Connect Lusso AI Browser.command</strong> on the Desktop and sign in to your Claude account. Enter <code>/chrome</code> to connect the installed Chrome extension and allow the Lusso, BUZ and FHA sites.</li><li>Sign in to Lusso, BUZ and FHA in Chrome, then choose <strong>Check connection</strong> here.</li></ol>}
    </section>
    {error && <div role="alert" className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900"><AlertCircle size={18} className="mt-1 shrink-0" /><span>{error}</span></div>}

    {current && <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4" aria-live="polite">
      <div className="flex items-center gap-2">{current.status === 'running' ? <Loader size={18} className="animate-spin text-amber-600" /> : <CheckCircle2 size={18} className="text-amber-700" />}<h2 className="font-semibold text-slate-900">{labels[current.status] || current.status}</h2></div>
      {current.status === 'needs_input' && activeSheet && <AssistantSheetGaps key={activeSheet.id} sheet={activeSheet} onSaved={setApprovedSheet} onEditing={editing => { setSheetEditing(editing); if (editing) setApprovedSheet(null); }} />}
      {current.status === 'needs_input'
        ? <details className="rounded-lg border border-slate-100 p-3"><summary className="cursor-pointer text-sm font-medium text-slate-600">Plan findings and other decisions</summary><RequestNotes current={current} /></details>
        : <RequestNotes current={current} />}
      {current.supplierReference && <p className="text-sm text-slate-600">Supplier reference: <strong>{current.supplierReference}</strong></p>}
      {Number.isFinite(current.totalIncGst) && <p className="text-lg font-semibold">{new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD'}).format(current.totalIncGst)} including GST</p>}
      {current.draftQuoteUrl && <a href={current.draftQuoteUrl} className={button}>Review draft quote <ExternalLink size={15} /></a>}
      {current.status === 'needs_input' && <div className="space-y-3"><label className="block text-sm font-medium" htmlFor="quote-answer">Additional answers or instructions</label><textarea id="quote-answer" rows={4} value={answer} onChange={e=>setAnswer(e.target.value)} className={field} placeholder="Any decisions not covered by the fields above…" /><button className={button} disabled={busy||sheetEditing||(!answer.trim()&&!approvedSheet)} onClick={()=>action(`/runs/${current.id}/continue`,{answer:answer.trim() || 'Use the specifications I saved to the measure sheet. Recheck any remaining gaps before supplier entry.', approvedSheetUpdatedAt:approvedSheet?.updatedAt})}>Continue quoting</button></div>}
      {inProgress && <button disabled={busy} onClick={()=>action(`/runs/${current.id}/stop`,{})} className="ml-3 text-sm text-slate-500 underline">Stop this request</button>}
      {!!current.events?.length && <details className="border-t border-slate-100 pt-3"><summary className="cursor-pointer text-sm text-slate-500">Activity</summary><div className="mt-3 max-h-64 overflow-auto space-y-2">{current.events.map((event,i)=><p key={i} className="whitespace-pre-wrap text-xs leading-5 text-slate-600">{event.text}</p>)}</div></details>}
    </section>}

    {!inProgress && <section className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
      <h2 className="font-semibold text-slate-900">Prepare a supplier-priced draft</h2>
      <div><label htmlFor="quote-sheet" className="mb-1 block text-sm font-medium text-slate-600">Measure sheet</label><select id="quote-sheet" className={field} value={selectedId} onChange={e=>setSheetId(e.target.value)}><option value="">Choose the sheet to quote</option>{sheets.map(s=><option key={s.id} value={s.id}>{s.title || s.name || s.measureDate || 'Measure sheet'} · {(s.lineItems || []).length} items</option>)}</select></div>
      {sheet && <div className="overflow-x-auto rounded-lg border border-slate-100"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-3">Opening</th><th className="p-3">Product / fabric</th><th className="p-3">Size (mm)</th><th className="p-3">Supplier</th></tr></thead><tbody>{(sheet.lineItems||[]).map((line,i)=><tr key={line.id||i} className="border-t border-slate-100"><td className="p-3">{line.location||`Item ${i+1}`} · qty {line.quantity||1}</td><td className="p-3">{line.productNameSnapshot||line.productType}<span className="block text-slate-500">{line.fabricColour}</span></td><td className="p-3 whitespace-nowrap">{line.widthMm||'—'} × {line.dropMm||'—'}</td><td className="p-3">{supplierForLine(line)||'Confirm supplier'}</td></tr>)}</tbody></table></div>}
      <div><label htmlFor="quote-instructions" className="mb-1 block text-sm font-medium text-slate-600">Anything the assistant should know?</label><textarea id="quote-instructions" rows={4} value={instructions} onChange={e=>setInstructions(e.target.value)} className={field} placeholder="For example: use double brackets, include fabric warranties, or ask me about missing specifications." /></div>
      <p className="text-xs leading-5 text-slate-500">Plans are checked for missing heights before you are asked. Plan-based allowances keep their drawing references and require a check measure before ordering. Existing margins, curtain labour settings and automatic accessories are retained.</p>
      <button className={button} disabled={busy || !connection?.signedIn || connection?.busy || !sheet?.lineItems?.length} onClick={()=>action('/runs',{jobId,sheetId:selectedId,instructions})}>{busy?<Loader size={16} className="animate-spin" />:<Sparkles size={16}/>}Start quote</button>
      {!sheets.length && <p className="text-sm text-amber-800">Create a measure sheet for this project first.</p>}
    </section>}
  </div>;
}

function RequestNotes({ current }) {
  return <div className="space-y-3 pt-3">
    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{current.summary}</p>
    {!!current.questions?.length && <ul className="list-disc pl-5 space-y-2 text-sm text-slate-700">{current.questions.map((q,i)=><li key={i}>{q}</li>)}</ul>}
    {!!current.warnings?.length && <ul className="list-disc pl-5 space-y-2 text-sm text-amber-800">{current.warnings.map((q,i)=><li key={i}>{q}</li>)}</ul>}
  </div>;
}
