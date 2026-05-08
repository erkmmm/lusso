import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { ArrowLeft, Edit3, User, Briefcase, ClipboardList, Phone, Mail, MapPin } from 'lucide-react';
import { getMeasureSheet, getCustomer, getJob } from '../store/data';
import Card from '../components/Card';
import StatusBadge from '../components/StatusBadge';

export default function MeasureSheetView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const sheet    = getMeasureSheet(id);
  const customer = sheet ? getCustomer(sheet.customerId) : null;
  const job      = sheet ? getJob(sheet.jobId) : null;

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
          <div className="flex gap-2 flex-shrink-0">
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
