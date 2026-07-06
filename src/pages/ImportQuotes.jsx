import { useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload, FileText, CheckCircle2, AlertTriangle, X, ArrowRight,
  Users, FileSpreadsheet, Loader2,
} from 'lucide-react';
import { getCustomers, getQuotes, runQuotientQuoteImport } from '../store/data';
import { parseCSV, rowsToObjects } from '../lib/csv';
import { classifyQuotientCsv, buildQuotientImportPlan } from '../lib/quotientQuotes';
import Card from '../components/Card';

const fmt$ = (n) => `$${Math.round(n).toLocaleString('en-AU')}`;

const KIND_LABEL = {
  summary: { label: 'Summary of Quotes', cls: 'bg-blue-100 text-blue-700' },
  items:   { label: 'Price Items',       cls: 'bg-teal-100 text-teal-700' },
  unknown: { label: 'Not a Quotient export', cls: 'bg-red-100 text-red-600' },
};

export default function ImportQuotes() {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [files, setFiles] = useState([]);        // { name, kind, rows }
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(null); // { phase, done, total }
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const addFiles = async (fileList) => {
    setError('');
    const loaded = [];
    for (const f of fileList) {
      try {
        const text = await f.text();
        const rows = rowsToObjects(parseCSV(text));
        const kind = rows.length ? classifyQuotientCsv(Object.keys(rows[0])) : 'unknown';
        loaded.push({ name: f.name, kind, rows });
      } catch {
        loaded.push({ name: f.name, kind: 'unknown', rows: [] });
      }
    }
    // Same filename replaces (re-drop of a corrected export)
    setFiles(prev => [...prev.filter(p => !loaded.some(l => l.name === p.name)), ...loaded]);
    setResult(null);
  };

  const removeFile = (name) => { setFiles(prev => prev.filter(f => f.name !== name)); setResult(null); };

  const summaries = files.filter(f => f.kind === 'summary');
  const itemFiles = files.filter(f => f.kind === 'items');

  // Rebuild the plan whenever the file set changes.
  const plan = useMemo(() => {
    if (!summaries.length || !itemFiles.length) return null;
    const summaryRows = summaries.flatMap(f => f.rows);
    const itemRows    = itemFiles.flatMap(f => f.rows);
    const existing = {
      customers: getCustomers().filter(c => !c.deletedAt),
      quoteNumbers: new Set(getQuotes().map(q => q.quoteNumber)),
    };
    const p = buildQuotientImportPlan(summaryRows, itemRows, existing);
    p.fileName = files.map(f => f.name).join(', ').slice(0, 200);
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  const handleImport = async () => {
    if (!plan || importing) return;
    setImporting(true); setError('');
    try {
      const res = await runQuotientQuoteImport(plan, (phase, done, total) => setProgress({ phase, done, total }));
      setResult(res);
    } catch (e) {
      setError(e.message || 'Import failed.');
    } finally {
      setImporting(false); setProgress(null);
    }
  };

  const years = plan ? Object.entries(plan.stats.byYear).sort(([a], [b]) => a.localeCompare(b)) : [];

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">

      <div>
        <h1 className="text-2xl font-bold text-slate-900">Import Quotient Quotes</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Upload your Quotient exports — both the <span className="font-medium">"Summary of Quotes"</span> and{' '}
          <span className="font-medium">"Price Items within Quotes"</span> CSVs. You can drop all years at once;
          quotes already imported are skipped automatically.
        </p>
      </div>

      {/* ── Dropzone ─────────────────────────────────────────────────────────── */}
      <div
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); addFiles([...e.dataTransfer.files].filter(f => f.name.toLowerCase().endsWith('.csv'))); }}
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-slate-300 hover:border-amber-400 rounded-2xl p-8 text-center cursor-pointer transition-colors bg-white"
      >
        <Upload size={28} className="mx-auto text-slate-400 mb-2" />
        <p className="text-sm font-medium text-slate-700">Drop CSV files here or tap to choose</p>
        <p className="text-xs text-slate-400 mt-1">Any number of files, in any order — they're recognised automatically.</p>
        <input ref={fileRef} type="file" accept=".csv,text/csv" multiple className="hidden"
          onChange={e => { addFiles([...e.target.files]); e.target.value = ''; }} />
      </div>

      {/* ── Loaded files ─────────────────────────────────────────────────────── */}
      {files.length > 0 && (
        <Card>
          <div className="px-5 py-3 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm">Files ({files.length})</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {files.map(f => {
              const k = KIND_LABEL[f.kind];
              return (
                <div key={f.name} className="flex items-center gap-3 px-5 py-2.5">
                  <FileSpreadsheet size={16} className="text-slate-400 flex-shrink-0" />
                  <span className="text-sm text-slate-700 truncate flex-1">{f.name}</span>
                  <span className="text-xs text-slate-400 tabular-nums flex-shrink-0">{f.rows.length} rows</span>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${k.cls}`}>{k.label}</span>
                  <button onClick={() => removeFile(f.name)} className="text-slate-300 hover:text-red-500 p-1 flex-shrink-0"><X size={14} /></button>
                </div>
              );
            })}
          </div>
          {(!summaries.length || !itemFiles.length) && (
            <div className="px-5 py-3 bg-amber-50 border-t border-amber-100 text-xs text-amber-700 flex items-center gap-2">
              <AlertTriangle size={13} className="flex-shrink-0" />
              {!summaries.length ? 'Add at least one "Summary of Quotes" export to continue.' : 'Add at least one "Price Items within Quotes" export to continue.'}
            </div>
          )}
        </Card>
      )}

      {/* ── Preview ──────────────────────────────────────────────────────────── */}
      {plan && !result && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: 'Quotes to import', value: plan.stats.toImport, icon: FileText },
              { label: 'Already imported', value: plan.stats.skippedExisting, icon: CheckCircle2 },
              { label: 'New customers', value: plan.stats.newCustomers, icon: Users },
              { label: 'Total quoted (ex GST)', value: fmt$(plan.stats.totalValue), icon: FileSpreadsheet },
            ].map(t => (
              <Card key={t.label} className="p-4">
                <t.icon size={15} className="text-slate-400" />
                <div className="text-xl font-bold text-slate-900 mt-1.5 truncate">{t.value}</div>
                <div className="text-xs text-slate-500 mt-0.5">{t.label}</div>
              </Card>
            ))}
          </div>

          <Card>
            <div className="px-5 py-3 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm">Breakdown</h2>
            </div>
            <div className="p-5 grid sm:grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">By year</p>
                <div className="flex flex-wrap gap-1.5">
                  {years.map(([y, n]) => (
                    <span key={y} className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-lg tabular-nums">{y}: <b>{n}</b></span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">By status</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(plan.stats.byStatus).map(([s, n]) => (
                    <span key={s} className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-lg">{s}: <b>{n}</b></span>
                  ))}
                </div>
                <p className="text-xs text-slate-400 mt-2">
                  "Awaiting Acceptance" imports as Waiting; Withdrawn imports as Declined. The dashboard's pipeline only counts recent open quotes, so old Waiting quotes won't inflate it.
                </p>
              </div>
            </div>
          </Card>

          {plan.warnings.length > 0 && (
            <Card>
              <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-500" />
                <h2 className="font-semibold text-slate-800 text-sm">Warnings ({plan.warnings.length})</h2>
              </div>
              <ul className="px-5 py-3 space-y-1.5 max-h-48 overflow-y-auto">
                {plan.warnings.map((w, i) => <li key={i} className="text-xs text-slate-600">{w}</li>)}
              </ul>
              <p className="px-5 pb-3 text-xs text-slate-400">Warnings don't block the import — flagged quotes import exactly as exported.</p>
            </Card>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>
          )}

          <button
            onClick={handleImport}
            disabled={importing || plan.stats.toImport === 0}
            className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white text-sm font-semibold rounded-xl px-4 py-3.5 transition-colors"
          >
            {importing ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {progress
                  ? `Syncing ${progress.phase} ${progress.done}/${progress.total}…`
                  : 'Importing…'}
              </>
            ) : plan.stats.toImport === 0 ? (
              'Nothing new to import'
            ) : (
              <>Import {plan.stats.toImport} quote{plan.stats.toImport !== 1 ? 's' : ''} & {plan.stats.newCustomers} customer{plan.stats.newCustomers !== 1 ? 's' : ''}</>
            )}
          </button>
          {importing && progress && (
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden -mt-2">
              <div className="h-full bg-amber-500 rounded-full transition-all duration-300"
                style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
            </div>
          )}
        </>
      )}

      {/* ── Result ───────────────────────────────────────────────────────────── */}
      {result && (
        <Card className="p-6 text-center">
          <CheckCircle2 size={32} className="text-green-500 mx-auto mb-2" />
          <h2 className="font-bold text-slate-900">Import complete</h2>
          <p className="text-sm text-slate-500 mt-1">
            {result.imported} quotes imported · {result.customersCreated} customers created
            {result.skipped > 0 && ` · ${result.skipped} already existed`}
            {result.errors > 0 && ` · ${result.errors} failed to sync (saved locally, will retry)`}
          </p>
          <div className="flex justify-center gap-3 mt-4">
            <button onClick={() => { setFiles([]); setResult(null); }}
              className="text-sm font-medium px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
              Import more files
            </button>
            <button onClick={() => navigate('/quotes')}
              className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors">
              View quotes <ArrowRight size={14} />
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}
