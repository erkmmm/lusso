import { X, Send, Copy, CheckCircle2, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { format, parseISO, addDays } from 'date-fns';

const PICKUP_NEEDS_LOCATIONS = (type) =>
  ['Pickup from Lusso warehouse', 'Pickup from one supplier', 'Pickup from multiple suppliers'].includes(type);

export default function EmailPreviewModal({ request, installer, job, customer, onSend, onClose, sending = false }) {
  const [copied, setCopied] = useState(null);

  const deadline = format(addDays(new Date(), 3), 'EEEE d MMMM yyyy');
  const acceptUrl  = `${window.location.origin}/install-response/${request.secureAcceptToken}`;
  const declineUrl = `${window.location.origin}/install-response/${request.secureDeclineToken}`;

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const formattedDate = request.proposedDate
    ? format(parseISO(request.proposedDate), 'EEEE, d MMMM yyyy')
    : 'TBC';

  const hasPickup = PICKUP_NEEDS_LOCATIONS(request.pickupType);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="font-bold text-slate-900">Email Preview</h2>
            <p className="text-xs text-slate-500 mt-0.5">Review before sending to {installer?.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        {/* Email preview */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Email meta */}
          <div className="bg-slate-50 rounded-xl border border-slate-200 mb-4 text-sm">
            <div className="px-4 py-2.5 flex gap-3 border-b border-slate-200">
              <span className="text-slate-400 w-10 flex-shrink-0">To:</span>
              <span className="text-slate-800 font-medium">{installer?.name} &lt;{installer?.email}&gt;</span>
            </div>
            <div className="px-4 py-2.5 flex gap-3 border-b border-slate-200">
              <span className="text-slate-400 w-10 flex-shrink-0">From:</span>
              <span className="text-slate-800">Lusso &lt;jobs@lusso.com.au&gt;</span>
            </div>
            <div className="px-4 py-2.5 flex gap-3">
              <span className="text-slate-400 w-10 flex-shrink-0">Re:</span>
              <span className="text-slate-800 font-medium">Installation Request – {request.suburb} – {formattedDate}</span>
            </div>
          </div>

          {/* Email body */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            {/* Lusso header */}
            <div className="bg-sidebar px-6 py-4 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center">
                <span className="text-white font-bold text-sm">L</span>
              </div>
              <span className="text-white font-semibold">Lusso</span>
            </div>

            <div className="p-6 space-y-5 text-sm text-slate-700">
              <p>Hi <strong>{installer?.name?.split(' ')[0]}</strong>,</p>
              <p>Lusso has an installation job that may suit your schedule. Please review the details below and let us know if you can take it on.</p>

              {/* Job details block */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
                <p className="font-semibold text-slate-800 text-base">📋 Job Details</p>
                <div className="grid grid-cols-2 gap-y-1.5 text-sm">
                  <span className="text-slate-500">Area:</span>
                  <span className="font-medium">{request.suburb}, VIC</span>
                  <span className="text-slate-500">Date:</span>
                  <span className="font-medium">{formattedDate}</span>
                  <span className="text-slate-500">Arrival Time:</span>
                  <span className="font-medium">{request.arrivalTime || 'TBC'}</span>
                  <span className="text-slate-500">Expected Duration:</span>
                  <span className="font-medium">{request.expectedDuration || 'TBC'}</span>
                  <span className="text-slate-500">Job Ref:</span>
                  <span className="font-medium">{job?.jobNumber}</span>
                </div>
              </div>

              {/* Service required */}
              <div>
                <p className="font-semibold text-slate-800 mb-1.5">🔧 Service Required</p>
                <p className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">{request.serviceRequired}</p>
              </div>

              {/* Product summary */}
              {request.productSummary && (
                <div>
                  <p className="font-semibold text-slate-800 mb-1.5">📦 Product Summary</p>
                  <p className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-100 text-slate-600">{request.productSummary}</p>
                </div>
              )}

              {/* Pickup requirements */}
              {request.pickupType && request.pickupType !== 'No pickup required' && (
                <div>
                  <p className="font-semibold text-slate-800 mb-1.5">🚐 Product Pickup</p>
                  <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 space-y-3">
                    <p className="text-sm font-medium text-purple-800">{request.pickupType}</p>
                    {hasPickup && request.pickupLocations?.length > 0 ? (
                      <div className="space-y-3">
                        {request.pickupLocations.map((loc, idx) => (
                          <div key={loc.id} className="bg-white border border-purple-100 rounded-lg p-3 text-xs text-slate-700 space-y-1">
                            {request.pickupLocations.length > 1 && (
                              <p className="font-semibold text-purple-700 mb-1">Pickup {idx + 1}</p>
                            )}
                            {loc.locationName && (
                              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                                <span className="text-slate-500">Supplier:</span>
                                <span className="font-medium">{loc.locationName}</span>
                                {loc.address && <><span className="text-slate-500">Address:</span><span>{loc.address}</span></>}
                                {(loc.contactPerson || loc.contactPhone) && (
                                  <><span className="text-slate-500">Contact:</span>
                                  <span>{loc.contactPerson}{loc.contactPhone ? ` · ${loc.contactPhone}` : ''}</span></>
                                )}
                                {(loc.pickupDate || loc.pickupTime) && (
                                  <><span className="text-slate-500">Pickup date:</span>
                                  <span>{loc.pickupDate ? format(parseISO(loc.pickupDate), 'd MMM yyyy') : ''}{loc.pickupTime ? ` at ${loc.pickupTime}` : ''}</span></>
                                )}
                                {loc.productsToCollect && <><span className="text-slate-500">Products:</span><span>{loc.productsToCollect}</span></>}
                                {loc.orderReference && <><span className="text-slate-500">Ref #:</span><span>{loc.orderReference}</span></>}
                                {loc.pickupNotes && <><span className="text-slate-500">Notes:</span><span>{loc.pickupNotes}</span></>}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : hasPickup ? (
                      <p className="text-xs text-purple-600 italic">Pickup location details to be confirmed.</p>
                    ) : null}
                  </div>
                </div>
              )}

              {/* Installation notes */}
              {request.installationNotes && (
                <div>
                  <p className="font-semibold text-slate-800 mb-1.5">📝 Installation Notes</p>
                  <p className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-100 text-slate-600">{request.installationNotes}</p>
                </div>
              )}

              {/* Site notes */}
              {(request.accessNotes || request.parkingNotes || request.siteNotes) && (
                <div>
                  <p className="font-semibold text-slate-800 mb-1.5">📍 Site Notes</p>
                  <div className="space-y-1.5 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                    {request.accessNotes && <p><span className="text-slate-500">Access:</span> {request.accessNotes}</p>}
                    {request.parkingNotes && <p><span className="text-slate-500">Parking:</span> {request.parkingNotes}</p>}
                    {request.siteNotes && <p><span className="text-slate-500">Site:</span> {request.siteNotes}</p>}
                  </div>
                </div>
              )}

              <div className="bg-slate-100 rounded-lg px-3 py-2 text-xs text-slate-500">
                🔒 Full site address and customer contact details will be shared once you accept the job.
              </div>

              {/* CTA buttons */}
              <div>
                <p className="text-slate-600 mb-3">Please respond by <strong>{deadline}</strong>:</p>
                <div className="flex gap-3">
                  <a href={acceptUrl} target="_blank" rel="noreferrer"
                    className="flex-1 bg-green-500 hover:bg-green-600 text-white text-center font-semibold py-3 px-4 rounded-xl transition-colors text-sm">
                    ✅ Accept Job
                  </a>
                  <a href={declineUrl} target="_blank" rel="noreferrer"
                    className="flex-1 bg-red-100 hover:bg-red-200 text-red-700 text-center font-semibold py-3 px-4 rounded-xl transition-colors text-sm">
                    ❌ Decline Job
                  </a>
                </div>
              </div>

              <p className="text-slate-500 text-xs border-t border-slate-100 pt-4">
                If you have any questions before responding, contact us at jobs@lusso.com.au or call 1300 LUSSO AU. <br /><br />
                Thank you,<br /><strong>The Lusso Team</strong>
              </p>
            </div>
          </div>

          {/* Response links for testing */}
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-blue-700">🔗 Response Links (for testing — these would be in the email)</p>
            <div className="space-y-2">
              {[
                { label: 'Accept Link', url: acceptUrl, key: 'accept' },
                { label: 'Decline Link', url: declineUrl, key: 'decline' },
              ].map(({ label, url, key }) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-20">{label}:</span>
                  <code className="text-xs bg-white border border-slate-200 rounded px-2 py-1 flex-1 truncate">{url}</code>
                  <button onClick={() => copyToClipboard(url, key)} className="text-blue-600 hover:text-blue-800 flex-shrink-0">
                    {copied === key ? <CheckCircle2 size={14} className="text-green-500" /> : <Copy size={14} />}
                  </button>
                  <a href={url} target="_blank" rel="noreferrer" className="text-blue-600 hover:text-blue-800 flex-shrink-0">
                    <ExternalLink size={14} />
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3 flex-shrink-0">
          <button onClick={onClose} className="text-sm text-slate-600 border border-slate-200 rounded-lg px-4 py-2.5 hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={onSend}
            disabled={sending}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white text-sm font-semibold rounded-lg px-5 py-2.5 transition-colors"
          >
            <Send size={15} />
            {sending ? 'Sending…' : `Send to ${installer?.name?.split(' ')[0]}`}
          </button>
        </div>
      </div>
    </div>
  );
}
