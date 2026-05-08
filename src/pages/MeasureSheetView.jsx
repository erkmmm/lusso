import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, Edit3, User, Briefcase, ClipboardList, Phone, Mail, MapPin, Trash2, AlertTriangle, Printer } from 'lucide-react';
import { getMeasureSheet, getCustomer, getJob, getQuotes, deleteMeasureSheet } from '../store/data';
import Card from '../components/Card';
import StatusBadge from '../components/StatusBadge';

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
    ['Track Colour',   v => v.trackBaseBarColour],
    ['Track Type',     v => v.trackType],
    ['Base Bar',       v => v.baseBarType],
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

      {/* ── Installer sign-off ── */}
      <div style={{ marginTop: '16px', borderTop: '1px solid #ddd', paddingTop: '12px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        {['Installer Name', 'Date', 'Signature'].map(label => (
          <div key={label}>
            <div style={{ fontSize: '10px', color: '#666', marginBottom: '4px' }}>{label}</div>
            <div style={{ borderBottom: '1px solid #999', height: '24px' }} />
          </div>
        ))}
      </div>

      {/* ── Footer ── */}
      <div style={{ marginTop: '10px', textAlign: 'center', fontSize: '9px', color: '#999', borderTop: '1px solid #eee', paddingTop: '6px' }}>
        Lusso Job Management · Measure Sheet · Printed {format(new Date(), 'd MMM yyyy h:mm a')}
        {job?.jobNumber ? ` · ${job.jobNumber}` : ''} · {customer?.name || ''}
      </div>
    </div>
  );
}

export default function MeasureSheetView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [showDelete, setShowDelete] = useState(false);
  const sheet    = getMeasureSheet(id);
  const customer = sheet ? getCustomer(sheet.customerId) : null;
  const job      = sheet ? getJob(sheet.jobId) : null;
  const quotes   = getQuotes();
  const isLinked = quotes.some(q => q.measureSheetId === id) || Boolean(sheet?.jobId);

  const handleDelete = () => {
    deleteMeasureSheet(id);
    navigate('/measure-sheets');
  };

  if (!sheet) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500">Measure sheet not found.</p>
        <button onClick={() => navigate('/measure-sheets')} className="text-amber-600 hover:underline mt-2 text-sm">
          Back to measure sheets
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">

      {/* Print-only installer document — hidden on screen, shown on print */}
      <PrintView sheet={sheet} customer={customer} job={job} />

      {/* Screen-only content — hidden on print */}
      <div className="screen-only">

      {/* Back */}
      <button onClick={() => navigate('/measure-sheets')} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft size={15} /> Back to Measure Sheets
      </button>

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
            <button onClick={() => window.print()}
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

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {/* Line items */}
          <Card>
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                <ClipboardList size={15} /> Product / Opening Details ({sheet.lineItems.length} item{sheet.lineItems.length !== 1 ? 's' : ''})
              </h2>
            </div>
            <div className="divide-y divide-slate-100">
              {sheet.lineItems.map((item, i) => {
                const productName = item.productNameSnapshot || item.productType || '—';
                const width = item.widthMm || item.width;
                const drop = item.dropMm || item.drop;
                return (
                  <div key={item.id || i} className="p-5">
                    {/* Item header */}
                    <div className="flex items-center gap-3 mb-3">
                      <span className="w-7 h-7 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                        {i + 1}
                      </span>
                      <div>
                        <span className="font-semibold text-slate-800 text-sm">{item.location || '—'}</span>
                        <span className="mx-2 text-slate-300">·</span>
                        <span className="text-slate-600 text-sm">{productName}</span>
                        {item.quantity > 1 && <span className="ml-2 text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">×{item.quantity}</span>}
                      </div>
                    </div>
                    {/* Core specs */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm mb-3">
                      <ViewField label="Width" value={width ? `${width} mm` : '—'} />
                      <ViewField label="Drop" value={drop ? `${drop} mm` : '—'} />
                      <ViewField label="Qty" value={item.quantity} />
                      {item.fabricColour && <ViewField label="Fabric / Colour" value={item.fabricColour} className="sm:col-span-1" />}
                    </div>
                    {/* Spec fields — only show non-empty ones */}
                    {(() => {
                      const specs = [
                        ['Control', item.control],
                        ['Return', item.returnSide || item.controlSide],
                        ['Motor Side', item.motorSide],
                        ['Fixing', item.fixing || item.mountType],
                        ['Heading', item.heading],
                        ['Hem', item.hem],
                        ['Track / Base Bar', item.trackBaseBarColour || item.trackColour],
                        ['Track Type', item.trackType],
                        ['Base Bar Type', item.baseBarType],
                        ['Chain Colour', item.chainColour],
                        ['Attached Lining', item.attachedLining ? 'Yes' : null],
                        ['Lining Fabric', item.attachedLining && item.liningFabricColour ? item.liningFabricColour : null],
                      ].filter(([, v]) => v);
                      if (specs.length === 0) return null;
                      return (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 rounded-xl px-3 py-2.5 mb-2">
                          {specs.map(([label, val]) => (
                            <ViewField key={label} label={label} value={val} />
                          ))}
                        </div>
                      );
                    })()}
                    {/* Notes */}
                    {(item.notes || item.installationNotes || item.additionalNotes) && (
                      <p className="text-xs text-slate-500 mt-1">
                        <span className="font-medium">Notes:</span> {item.notes || item.installationNotes}{item.additionalNotes ? ` · ${item.additionalNotes}` : ''}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Site notes */}
          {(sheet.accessInstructions || sheet.parkingNotes || sheet.siteConditionNotes) && (
            <Card>
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><MapPin size={15} /> Site Notes</h2>
              </div>
              <div className="p-5 grid sm:grid-cols-3 gap-4 text-sm">
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
        </div>

        {/* Right sidebar */}
        <div className="space-y-5">
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

function ViewField({ label, value, className = '' }) {
  return (
    <div className={className}>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-700 font-medium">{value || '—'}</dd>
    </div>
  );
}
