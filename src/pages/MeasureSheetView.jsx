import { useDataRefresh } from '../hooks/useDataRefresh';
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { Edit3, User, Briefcase, ClipboardList, Phone, Mail, MapPin, Trash2, AlertTriangle, Printer, Plus, Link } from 'lucide-react';
import { getMeasureSheet, getCustomer, getJob, getJobs, getQuotes, deleteMeasureSheet, saveMeasureSheet, createJobFromMeasureSheet } from '../store/data';
import Card from '../components/Card';
import StatusBadge from '../components/StatusBadge';
import BackButton from '../components/BackButton';

// ── Print-only installer document ────────────────────────────────────────────
function PrintView({ sheet, customer, job }) {
  const fmt = (dateStr) => {
    try { return format(parseISO(dateStr), 'd MMM yyyy'); } catch { return dateStr || ''; }
  };

  const ALL_SPECS = [
    ['Control',        v => v.control],
    ['Return',         v => v.returnSide],
    ['Motor Side',     v => v.motorSide],
    ['Fixing',         v => v.fixing],
    ['Heading',        v => v.heading],
    ['Hem',            v => v.hem],
    ['Track Colour',        v => v.trackColour || v.trackBaseBarColour],
    ['Bottom Rail Colour',  v => v.baseBarColour],
    ['Operation Type',      v => v.trackType],
    ['Bottom Rail Type',    v => v.baseBarType],
    ['Chain',          v => v.chainColour],
    ['Lining',         v => v.attachedLining ? (v.liningFabricColour ? `Yes — ${v.liningFabricColour}` : 'Yes') : null],
  ];

  return (
    <div className="print-only" style={{ fontFamily: 'Arial, sans-serif', color: '#000', background: '#fff', padding: '20px', fontSize: '11px', lineHeight: '1.4' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #174D4D', paddingBottom: '10px', marginBottom: '12px' }}>
        <div>
          <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#174D4D', letterSpacing: '-0.5px' }}>LUSSO</div>
          <div style={{ fontSize: '10px', color: '#666', marginTop: '1px' }}>Job Management Platform</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '16px', fontWeight: 'bold', color: '#174D4D' }}>MEASURE SHEET</div>
          <div style={{ fontSize: '10px', color: '#666', marginTop: '2px' }}>
            {job?.jobNumber && <span style={{ fontWeight: 'bold', marginRight: '10px' }}>Job: {job.jobNumber}</span>}
            Printed: {format(new Date(), 'd MMM yyyy')}
          </div>
          <div style={{ fontSize: '10px', color: job?.status === 'Completed' ? '#16a34a' : '#ca8a04', fontWeight: 'bold', marginTop: '2px' }}>
            Status: {sheet.status}
          </div>
        </div>
      </div>

      {/* ── Customer + Job details ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>

        {/* Customer */}
        <div style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '10px' }}>
          <div style={{ fontWeight: 'bold', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#174D4D', borderBottom: '1px solid #eee', paddingBottom: '4px', marginBottom: '6px' }}>
            Customer
          </div>
          <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '4px' }}>{customer?.name || '—'}</div>
          {customer?.company && <div style={{ marginBottom: '2px' }}>{customer.company}</div>}
          {(customer?.phone || sheet.phone) && (
            <div style={{ marginBottom: '2px' }}>📞 {customer?.phone || sheet.phone}</div>
          )}
          {(customer?.mobile) && (
            <div style={{ marginBottom: '2px' }}>📱 {customer.mobile}</div>
          )}
          {(customer?.email || sheet.email) && (
            <div style={{ marginBottom: '2px' }}>✉ {customer?.email || sheet.email}</div>
          )}
          {(sheet.siteAddress || customer?.address) && (
            <div style={{ marginTop: '4px', paddingTop: '4px', borderTop: '1px solid #eee' }}>
              <div style={{ fontWeight: 'bold', fontSize: '10px', color: '#666', marginBottom: '2px' }}>SITE ADDRESS</div>
              <div>{sheet.siteAddress || customer?.address}</div>
            </div>
          )}
          {sheet.billingAddress && sheet.billingAddress !== sheet.siteAddress && (
            <div style={{ marginTop: '4px', paddingTop: '4px', borderTop: '1px solid #eee' }}>
              <div style={{ fontWeight: 'bold', fontSize: '10px', color: '#666', marginBottom: '2px' }}>BILLING ADDRESS</div>
              <div>{sheet.billingAddress}</div>
            </div>
          )}
          {customer?.preferredContact && (
            <div style={{ marginTop: '4px', fontSize: '10px', color: '#666' }}>Preferred contact: {customer.preferredContact}</div>
          )}
        </div>

        {/* Job & measure info */}
        <div style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '10px' }}>
          <div style={{ fontWeight: 'bold', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#174D4D', borderBottom: '1px solid #eee', paddingBottom: '4px', marginBottom: '6px' }}>
            Job & Measure Details
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {job?.jobNumber    && <tr><td style={{ color: '#666', paddingBottom: '3px', width: '45%' }}>Job Number</td><td style={{ fontWeight: 'bold', paddingBottom: '3px' }}>{job.jobNumber}</td></tr>}
              {sheet.measurer   && <tr><td style={{ color: '#666', paddingBottom: '3px' }}>Measurer</td><td style={{ fontWeight: 'bold', paddingBottom: '3px' }}>{sheet.measurer}</td></tr>}
              {sheet.measureDate && <tr><td style={{ color: '#666', paddingBottom: '3px' }}>Measure Date</td><td style={{ fontWeight: 'bold', paddingBottom: '3px' }}>{fmt(sheet.measureDate)}</td></tr>}
              {sheet.createdAt  && <tr><td style={{ color: '#666', paddingBottom: '3px' }}>Sheet Created</td><td style={{ paddingBottom: '3px' }}>{fmt(sheet.createdAt)}</td></tr>}
              {job?.jobType     && <tr><td style={{ color: '#666', paddingBottom: '3px' }}>Job Type</td><td style={{ paddingBottom: '3px' }}>{job.jobType}</td></tr>}
              {sheet.urgency && sheet.urgency !== 'Normal' && <tr><td style={{ color: '#666', paddingBottom: '3px' }}>Urgency</td><td style={{ fontWeight: 'bold', color: '#dc2626', paddingBottom: '3px' }}>{sheet.urgency}</td></tr>}
              <tr><td style={{ color: '#666' }}>Items</td><td style={{ fontWeight: 'bold' }}>{sheet.lineItems?.length || 0}</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Site notes ── */}
      {(sheet.accessInstructions || sheet.parkingNotes || sheet.siteConditionNotes) && (
        <div style={{ border: '1px solid #f59e0b', borderRadius: '4px', padding: '10px', marginBottom: '12px', background: '#fffbeb' }}>
          <div style={{ fontWeight: 'bold', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#b45309', marginBottom: '6px' }}>
            ⚠ Site Notes
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
            {sheet.accessInstructions && (
              <div>
                <div style={{ fontWeight: 'bold', fontSize: '10px', color: '#666', marginBottom: '2px' }}>ACCESS</div>
                <div>{sheet.accessInstructions}</div>
              </div>
            )}
            {sheet.parkingNotes && (
              <div>
                <div style={{ fontWeight: 'bold', fontSize: '10px', color: '#666', marginBottom: '2px' }}>PARKING</div>
                <div>{sheet.parkingNotes}</div>
              </div>
            )}
            {sheet.siteConditionNotes && (
              <div>
                <div style={{ fontWeight: 'bold', fontSize: '10px', color: '#666', marginBottom: '2px' }}>SITE CONDITION</div>
                <div>{sheet.siteConditionNotes}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Line items ── */}
      <div style={{ fontWeight: 'bold', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.5px', color: '#174D4D', borderBottom: '2px solid #174D4D', paddingBottom: '4px', marginBottom: '8px' }}>
        Product / Opening Details ({sheet.lineItems?.length || 0} items)
      </div>

      {(sheet.lineItems || []).map((item, i) => {
        const product = item.productNameSnapshot || item.productType || '—';
        const width   = item.widthMm || item.width;
        const drop    = item.dropMm  || item.drop;
        const filledSpecs = ALL_SPECS.map(([label, fn]) => [label, fn(item)]).filter(([, v]) => v);

        return (
          <div key={item.id || i} style={{ border: '1px solid #ddd', borderRadius: '4px', marginBottom: '8px', breakInside: 'avoid', pageBreakInside: 'avoid' }}>
            {/* Item header bar */}
            <div style={{ background: '#f0f9f6', borderBottom: '1px solid #ddd', padding: '6px 10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ background: '#174D4D', color: '#fff', borderRadius: '50%', width: '20px', height: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 'bold', flexShrink: 0 }}>
                {i + 1}
              </span>
              <span style={{ fontWeight: 'bold', fontSize: '12px' }}>{item.location || 'Location not specified'}</span>
              <span style={{ color: '#555', marginLeft: '4px' }}>—</span>
              <span style={{ color: '#174D4D', fontWeight: 'bold', fontSize: '12px' }}>{product}</span>
              {item.quantity > 1 && <span style={{ marginLeft: 'auto', background: '#174D4D', color: '#fff', borderRadius: '3px', padding: '1px 6px', fontSize: '10px', fontWeight: 'bold' }}>×{item.quantity}</span>}
            </div>

            <div style={{ padding: '8px 10px' }}>
              {/* Core dimensions */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: filledSpecs.length > 0 || item.notes ? '8px' : '0', paddingBottom: filledSpecs.length > 0 || item.notes ? '8px' : '0', borderBottom: filledSpecs.length > 0 || item.notes ? '1px dashed #e5e7eb' : 'none' }}>
                <div>
                  <div style={{ fontSize: '9px', color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Width</div>
                  <div style={{ fontWeight: 'bold', fontSize: '13px', fontFamily: 'monospace' }}>{width ? `${width} mm` : '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Drop</div>
                  <div style={{ fontWeight: 'bold', fontSize: '13px', fontFamily: 'monospace' }}>{drop ? `${drop} mm` : '—'}</div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Qty</div>
                  <div style={{ fontWeight: 'bold', fontSize: '13px' }}>{item.quantity || 1}</div>
                </div>
                <div>
                  <div style={{ fontSize: '9px', color: '#666', fontWeight: 'bold', textTransform: 'uppercase' }}>Fabric / Colour</div>
                  <div style={{ fontWeight: 'bold' }}>{item.fabricColour || '—'}</div>
                </div>
              </div>

              {/* All specifications */}
              {filledSpecs.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: item.notes ? '6px' : '0' }}>
                  {filledSpecs.map(([label, val]) => (
                    <div key={label}>
                      <div style={{ fontSize: '9px', color: '#666', textTransform: 'uppercase', fontWeight: 'bold' }}>{label}</div>
                      <div style={{ fontSize: '11px' }}>{val}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Item notes */}
              {(item.notes || item.installationNotes) && (
                <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px dashed #e5e7eb', background: '#fafafa', padding: '4px 6px', borderRadius: '3px' }}>
                  <span style={{ fontWeight: 'bold', fontSize: '10px', color: '#666' }}>NOTES: </span>
                  <span>{item.notes || item.installationNotes}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* ── Internal notes ── */}
      {sheet.internalNotes && (
        <div style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '10px', marginTop: '8px' }}>
          <div style={{ fontWeight: 'bold', fontSize: '10px', textTransform: 'uppercase', color: '#666', marginBottom: '4px' }}>Internal Notes</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{sheet.internalNotes}</div>
        </div>
      )}

      {/* ── Customer notes ── */}
      {sheet.customerNotes && (
        <div style={{ border: '1px solid #ddd', borderRadius: '4px', padding: '10px', marginTop: '8px' }}>
          <div style={{ fontWeight: 'bold', fontSize: '10px', textTransform: 'uppercase', color: '#666', marginBottom: '4px' }}>Customer Notes</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{sheet.customerNotes}</div>
        </div>
      )}

      {/* ── Footer ── */}
      <div style={{ marginTop: '10px', textAlign: 'center', fontSize: '9px', color: '#999', borderTop: '1px solid #eee', paddingTop: '6px' }}>
        Lusso Job Management · Measure Sheet · Printed {format(new Date(), 'd MMM yyyy h:mm a')}
        {job?.jobNumber ? ` · ${job.jobNumber}` : ''} · {customer?.name || ''}
      </div>
    </div>
  );
}

export default function MeasureSheetView() {
  useDataRefresh();
  const { id } = useParams();
  const navigate = useNavigate();
  const [showDelete,   setShowDelete]   = useState(false);
  const [linkJobId,    setLinkJobId]    = useState('');
  const [showJobPanel, setShowJobPanel] = useState(false);
  const sheet    = getMeasureSheet(id);
  const customer = sheet ? getCustomer(sheet.customerId) : null;
  const job      = sheet?.jobId ? getJob(sheet.jobId) : null; // read directly
  const quotes   = getQuotes();
  const isLinked = quotes.some(q => q.measureSheetId === id) || Boolean(sheet?.jobId);

  const customerJobs = sheet?.customerId
    ? getJobs().filter(j => j.customerId === sheet.customerId && j.id !== sheet.jobId)
    : [];

  const handleCreateJob = () => {
    if (!sheet || !customer) return;
    const newJob = createJobFromMeasureSheet(sheet, customer);
    saveMeasureSheet({ ...sheet, jobId: newJob.id, status: 'Submitted' });
    setShowJobPanel(false);
    window.dispatchEvent(new CustomEvent('lusso:data-changed'));
  };

  const handleLinkJob = () => {
    if (!linkJobId || !sheet) return;
    saveMeasureSheet({ ...sheet, jobId: linkJobId, status: 'Submitted' });
    setLinkJobId('');
    setShowJobPanel(false);
    window.dispatchEvent(new CustomEvent('lusso:data-changed'));
  };

  // Print via a hidden iframe. This is reliable across a normal browser tab
  // and the installed PWA: it shows the print dialog for the iframe's own
  // document, with no popup window (so no popup-blocker / focus / premature
  // close issues that broke the earlier approaches). Falls back to
  // window.print() if the print document isn't available.
  const handlePrint = () => {
    const node = document.querySelector('.print-only');
    if (!node) { window.print(); return; }

    const prev = document.getElementById('__print_frame');
    if (prev) prev.remove();

    const iframe = document.createElement('iframe');
    iframe.id = '__print_frame';
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(iframe);

    const cw = iframe.contentWindow;
    cw.document.open();
    cw.document.write(
      '<!doctype html><html><head><meta charset="utf-8"><title>Measure Sheet</title>' +
      '<style>@page{margin:10mm} html,body{margin:0;padding:0} .print-only{display:block!important}</style>' +
      '</head><body>' + node.outerHTML + '</body></html>'
    );
    cw.document.close();

    const cleanup = () => { const f = document.getElementById('__print_frame'); if (f) f.remove(); };
    const run = () => {
      try { cw.focus(); cw.onafterprint = cleanup; cw.print(); }
      catch { window.print(); cleanup(); }
      setTimeout(cleanup, 60000); // safety net if onafterprint never fires
    };
    // Give the iframe document a tick to lay out before printing.
    if (cw.document.readyState === 'complete') setTimeout(run, 50);
    else iframe.onload = () => setTimeout(run, 50);
  };

  const handleDelete = () => {
    deleteMeasureSheet(id);
    navigate('/measure-sheets');
  };

  if (!sheet) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500">Measure sheet not found.</p>
        <BackButton fallback="/measure-sheets" className="mt-2" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">

      {/* Print-only installer document — hidden on screen, shown on print */}
      <PrintView sheet={sheet} customer={customer} job={job} />

      {/* Screen-only content — hidden on print */}
      <div className="screen-only">

      {/* Back */}
      <BackButton fallback={sheet?.jobId ? `/jobs/${sheet.jobId}` : '/measure-sheets'} />

      {/* Header */}
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-slate-900">{customer?.name || 'Measure Sheet'}</h1>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${sheet.status === 'Submitted' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                {sheet.status}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
              {customer?.phone && <span className="flex items-center gap-1.5"><Phone size={12} />{customer.phone}</span>}
              {customer?.email && <span className="flex items-center gap-1.5"><Mail size={12} />{customer.email}</span>}
              {sheet.siteAddress && <span className="flex items-center gap-1.5"><MapPin size={12} />{sheet.siteAddress}</span>}
            </div>
            <div className="flex flex-wrap gap-3 mt-3 text-xs text-slate-400">
              {sheet.measurer && <span>👤 {sheet.measurer}</span>}
              {sheet.measureDate && <span>📅 {format(parseISO(sheet.measureDate), 'd MMM yyyy')}</span>}
              {sheet.createdAt && <span>Created {format(parseISO(sheet.createdAt), 'd MMM yyyy')}</span>}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0 flex-wrap">
            {job && (
              <button onClick={() => navigate(`/jobs/${job.id}`)}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">
                <Briefcase size={13} /> View Job
              </button>
            )}
            <button onClick={() => navigate(`/measure-sheets/${id}/edit`)}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">
              <Edit3 size={13} /> Edit
            </button>
            {sheet.lineItems?.some(it => (it.productNameSnapshot || it.productType || '').toLowerCase().includes('curt')) && (
              <button onClick={() => navigate(`/measure-sheets/${id}/purchase-order`)}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 no-print">
                <ClipboardList size={13} /> Generate Purchase Order
              </button>
            )}
            <button onClick={handlePrint}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors no-print">
              <Printer size={13} /> Print
            </button>
            <button onClick={() => setShowDelete(true)}
              className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-red-200 text-red-500 hover:bg-red-50 transition-colors no-print">
              <Trash2 size={13} /> Delete
            </button>
          </div>
        </div>
      </Card>

      {/* ── No job linked — create or link ───────────────────────────────── */}
      {!job && (
        <Card className="p-4">
          {!showJobPanel ? (
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                <Briefcase size={16} className="text-amber-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800">No job linked</p>
                <p className="text-xs text-slate-400 mt-0.5">Create a new job or link to an existing one</p>
              </div>
              <button
                onClick={() => setShowJobPanel(true)}
                className="flex items-center gap-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-white px-3 py-2 rounded-lg transition-colors flex-shrink-0"
              >
                <Plus size={13} /> Link Job
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">Link to a Job</p>
                <button onClick={() => setShowJobPanel(false)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
              </div>

              {/* Create new job */}
              <button
                onClick={handleCreateJob}
                className="w-full flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-xl text-left transition-colors"
              >
                <div className="w-8 h-8 rounded-lg bg-amber-200 flex items-center justify-center flex-shrink-0">
                  <Plus size={14} className="text-amber-700" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-amber-800">Create new job from this sheet</p>
                  <p className="text-xs text-amber-600">Creates a job in "Measured" status and links it here</p>
                </div>
              </button>

              {/* Link to existing job */}
              {customerJobs.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-500">— or link to an existing job —</p>
                  <div className="flex gap-2">
                    <select
                      value={linkJobId}
                      onChange={e => setLinkJobId(e.target.value)}
                      className="flex-1 border border-slate-200 rounded-lg text-sm px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                    >
                      <option value="">Select a job…</option>
                      {customerJobs.map(j => (
                        <option key={j.id} value={j.id}>{j.jobNumber} — {j.jobType} ({j.status})</option>
                      ))}
                    </select>
                    <button
                      onClick={handleLinkJob}
                      disabled={!linkJobId}
                      className="flex items-center gap-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white px-4 py-2 rounded-lg transition-colors flex-shrink-0"
                    >
                      <Link size={12} /> Link
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Line items — full width so every column is visible */}
        <Card className="lg:col-span-3">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
              <ClipboardList size={15} /> Product / Opening Details ({sheet.lineItems.length} item{sheet.lineItems.length !== 1 ? 's' : ''})
            </h2>
          </div>
          <MeasureItemsTable items={sheet.lineItems} />
        </Card>

        {/* Customer */}
        <Card>
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><User size={15} /> Customer</h2>
          </div>
          <div className="p-5 space-y-2 text-sm">
            <p className="font-semibold text-slate-800">{customer?.name}</p>
            {customer?.phone && <p className="text-slate-500 flex items-center gap-1.5"><Phone size={12} />{customer.phone}</p>}
            {customer?.email && <p className="text-slate-500 flex items-center gap-1.5"><Mail size={12} />{customer.email}</p>}
            {(sheet.siteAddress || customer?.address) && (
              <p className="text-slate-500 flex items-center gap-1.5"><MapPin size={12} />{sheet.siteAddress || customer.address}</p>
            )}
            {customer?.preferredContact && (
              <p className="text-xs text-slate-400 mt-1">Preferred: {customer.preferredContact}</p>
            )}
          </div>
        </Card>

        {/* Job */}
        <Card>
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><Briefcase size={15} /> Job</h2>
          </div>
          <div className="p-5 space-y-2 text-sm">
            {job ? (
              <>
                <p className="text-slate-500 text-xs">{job.jobNumber}</p>
                <StatusBadge status={job.status} />
                <p className="text-slate-600">{job.jobType}</p>
                <button onClick={() => navigate(`/jobs/${job.id}`)} className="text-xs text-amber-600 hover:underline">View job →</button>
              </>
            ) : (
              <p className="text-slate-400 text-xs">Not linked to a job yet.</p>
            )}
          </div>
        </Card>

        {/* Site notes */}
        {(sheet.accessInstructions || sheet.parkingNotes || sheet.siteConditionNotes) && (
          <Card>
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><MapPin size={15} /> Site Notes</h2>
            </div>
            <div className="p-5 space-y-3 text-sm">
              {sheet.accessInstructions && (
                <div><dt className="text-xs text-slate-400 mb-1">Access</dt><dd className="text-slate-700">{sheet.accessInstructions}</dd></div>
              )}
              {sheet.parkingNotes && (
                <div><dt className="text-xs text-slate-400 mb-1">Parking</dt><dd className="text-slate-700">{sheet.parkingNotes}</dd></div>
              )}
              {sheet.siteConditionNotes && (
                <div><dt className="text-xs text-slate-400 mb-1">Site Condition</dt><dd className="text-slate-700">{sheet.siteConditionNotes}</dd></div>
              )}
            </div>
          </Card>
        )}

        {/* Internal notes */}
        {sheet.internalNotes && (
          <Card>
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm">Internal Notes</h2>
            </div>
            <div className="p-5">
              <p className="text-sm text-slate-600 whitespace-pre-wrap">{sheet.internalNotes}</p>
            </div>
          </Card>
        )}
      </div>

      </div>{/* end screen-only */}

      {/* Delete confirmation modal */}
      {showDelete && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Trash2 size={18} className="text-red-500" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Delete this measure sheet?</h3>
                <p className="text-sm text-slate-500 mt-1">
                  Are you sure you want to delete this measure sheet? This action cannot be undone.
                </p>
                {isLinked && (
                  <div className="mt-3 flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                    <AlertTriangle size={14} className="text-yellow-600 flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-yellow-700">
                      This measure sheet is linked to quotes, jobs, or installations. Deleting may affect historical records.
                    </p>
                  </div>
                )}
              </div>
            </div>
            <div className="flex gap-3 pt-1">
              <button onClick={() => setShowDelete(false)}
                className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl transition-colors">
                Cancel
              </button>
              <button onClick={handleDelete}
                className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
                Delete Measure Sheet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Full measure-sheet schedule. Every field is its own column (spec columns
// only appear when at least one item has a value), so all data is visible
// without expanding rows. Wide sheets scroll horizontally.
function MeasureItemsTable({ items = [] }) {
  if (!items.length) {
    return <p className="px-5 py-8 text-center text-sm text-slate-400">No items on this sheet.</p>;
  }

  // Always-present base columns.
  const baseCols = [
    { header: '#',        align: 'text-left',   tone: 'text-slate-400',            cell: (it, i) => i + 1 },
    { header: 'Location', align: 'text-left',   tone: 'font-medium text-slate-800', cell: it => it.location },
    { header: 'Product',  align: 'text-left',   tone: 'text-slate-600',            cell: it => it.productNameSnapshot || it.productType },
    { header: 'W',        align: 'text-right',  tone: 'text-slate-600', mono: true, cell: it => it.widthMm || it.width },
    { header: 'D',        align: 'text-right',  tone: 'text-slate-600', mono: true, cell: it => it.dropMm || it.drop },
    { header: 'Qty',      align: 'text-center', tone: 'text-slate-600',            cell: it => it.quantity || 1 },
  ];

  // Spec columns — included only when some item populates them.
  const specCols = [
    { header: 'Fabric',             cell: it => it.fabricColour },
    { header: 'Control',            cell: it => it.control },
    { header: 'Return',             cell: it => it.returnSide || it.controlSide },
    { header: 'Motor Side',         cell: it => it.motorSide },
    { header: 'Fixing',             cell: it => it.fixing || it.mountType },
    { header: 'Heading',            cell: it => it.heading },
    { header: 'Hem',                cell: it => it.hem },
    { header: 'Track Colour',       cell: it => it.trackColour || it.trackBaseBarColour },
    { header: 'Bottom Rail Colour', cell: it => it.baseBarColour },
    { header: 'Operation Type',     cell: it => it.trackType },
    { header: 'Bottom Rail Type',   cell: it => it.baseBarType },
    { header: 'Chain Colour',       cell: it => it.chainColour },
    { header: 'Lining',             cell: it => it.attachedLining ? (it.liningFabricColour ? `Yes — ${it.liningFabricColour}` : 'Yes') : null },
    { header: 'Notes', wrap: true,  cell: it => [it.notes || it.installationNotes, it.additionalNotes].filter(Boolean).join(' · ') },
  ].map(c => ({ align: 'text-left', tone: 'text-slate-600', ...c }))
   .filter(c => items.some(it => { const v = c.cell(it); return v != null && v !== ''; }));

  const cols = [...baseCols, ...specCols];

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-100">
            {cols.map((c, ci) => (
              <th key={ci} className={`px-3 py-2.5 font-medium text-slate-500 whitespace-nowrap ${c.align}`}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {items.map((item, i) => (
            <tr key={item.id || i} className="hover:bg-slate-50 transition-colors">
              {cols.map((c, ci) => {
                const v = c.cell(item, i);
                const display = (v === null || v === undefined || v === '') ? '—' : v;
                return (
                  <td
                    key={ci}
                    className={`px-3 py-2.5 align-top ${c.align} ${c.tone} ${c.mono ? 'font-mono' : ''} ${c.wrap ? 'whitespace-pre-wrap min-w-[180px] max-w-[280px]' : 'whitespace-nowrap'}`}
                  >
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
