import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  CheckCircle2, XCircle, Calendar, Clock, Wrench, Package,
  MapPin, MessageSquare, Loader, Truck,
} from 'lucide-react';
import { getInstallRequestByToken, respondToInstallRequest, getInstaller, getJob, getCustomer } from '../store/data';

const PICKUP_NEEDS_LOCATIONS = (type) =>
  ['Pickup from Lusso warehouse', 'Pickup from one supplier', 'Pickup from multiple suppliers'].includes(type);

export default function InstallResponse() {
  const { token } = useParams();

  // The action is fixed by WHICH link (token) was used — accept vs decline —
  // not chosen on the page. (Legacy tok-accept-/tok-decline- links still work.)
  const isAcceptToken  = token?.startsWith('acc-') || token?.startsWith('tok-accept-');
  const isDeclineToken = token?.startsWith('dec-') || token?.startsWith('tok-decline-');
  const selectedAction = isAcceptToken ? 'accept' : isDeclineToken ? 'decline' : null;

  const [request, setRequest]   = useState(() => getInstallRequestByToken(token));
  const [comment, setComment]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]         = useState(false);
  const [expired, setExpired]   = useState(false);
  const [action, setAction]     = useState(null); // 'accept' | 'decline'

  const installer = request ? getInstaller(request.installerId) : null;
  const job       = request ? getJob(request.jobId) : null;
  const customer  = job ? getCustomer(job.customerId) : null;

  const alreadyResponded = request?.status === 'Accepted' || request?.status === 'Declined';
  const hasPickup = request && PICKUP_NEEDS_LOCATIONS(request.pickupType);

  const handleSubmit = () => {
    if (!selectedAction || !request) return;
    setSubmitting(true);
    setTimeout(() => {
      const updated = respondToInstallRequest(token, selectedAction, comment);
      if (updated?.expired) { setExpired(true); setSubmitting(false); return; }
      setRequest(updated);
      setAction(selectedAction);
      setDone(true);
      setSubmitting(false);
    }, 800);
  };

  // Token not found
  if (!request) {
    return (
      <ResponseShell>
        <div className="text-center py-12">
          <XCircle size={48} className="text-red-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-800 mb-2">Link Not Found</h2>
          <p className="text-slate-500 text-sm">This link is invalid or has already been used.</p>
        </div>
      </ResponseShell>
    );
  }

  // Link expired
  if (expired) {
    return (
      <ResponseShell>
        <div className="text-center py-12">
          <XCircle size={48} className="text-amber-400 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-800 mb-2">Link Expired</h2>
          <p className="text-slate-500 text-sm">This response link has expired. Please contact Lusso to confirm the installation.</p>
        </div>
      </ResponseShell>
    );
  }

  const formattedDate = request.proposedDate
    ? format(parseISO(request.proposedDate), 'EEEE, d MMMM yyyy')
    : 'TBC';

  // Already responded
  if (alreadyResponded && !done) {
    return (
      <ResponseShell>
        <div className="text-center py-8">
          {request.status === 'Accepted'
            ? <CheckCircle2 size={48} className="text-green-500 mx-auto mb-4" />
            : <XCircle size={48} className="text-red-400 mx-auto mb-4" />
          }
          <h2 className="text-xl font-bold text-slate-800 mb-2">Already Responded</h2>
          <p className="text-slate-500 text-sm">
            You have already <strong>{request.status === 'Accepted' ? 'accepted' : 'declined'}</strong> this installation request.
          </p>
          {request.responseComment && (
            <p className="mt-3 text-xs text-slate-400">Your comment: "{request.responseComment}"</p>
          )}
        </div>
      </ResponseShell>
    );
  }

  // Success state
  if (done) {
    const accepted = action === 'accept';
    return (
      <ResponseShell>
        <div className="text-center py-10">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5 ${accepted ? 'bg-green-100' : 'bg-red-100'}`}>
            {accepted
              ? <CheckCircle2 size={40} className="text-green-500" />
              : <XCircle size={40} className="text-red-400" />
            }
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">
            {accepted ? 'Installation Accepted!' : 'Installation Declined'}
          </h2>
          <p className="text-slate-600 text-sm max-w-sm mx-auto">
            {accepted
              ? 'Thank you! Lusso has been notified and will be in touch shortly with full site details and confirmation.'
              : 'No problem. Lusso has been notified and will make alternative arrangements.'}
          </p>
          {comment && (
            <div className="mt-5 bg-slate-50 border border-slate-200 rounded-xl px-5 py-3 text-sm text-slate-600 max-w-sm mx-auto text-left">
              <span className="text-xs text-slate-400 block mb-1">Your comment:</span>
              "{comment}"
            </div>
          )}
        </div>
      </ResponseShell>
    );
  }

  return (
    <ResponseShell>
      <div className="space-y-5">
        {/* Greeting */}
        <div>
          <h2 className="text-xl font-bold text-slate-900">Installation Request</h2>
          <p className="text-slate-500 text-sm mt-1">
            Hi {installer?.name?.split(' ')[0]}, Lusso has a job that may suit your schedule. Please review and respond below.
          </p>
        </div>

        {/* Job summary card */}
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-start gap-2.5">
              <MapPin size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-slate-500">Area</p>
                <p className="font-semibold text-slate-800">{request.suburb}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Calendar size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-slate-500">Date</p>
                <p className="font-semibold text-slate-800">{formattedDate}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Clock size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-slate-500">Arrival Time</p>
                <p className="font-semibold text-slate-800">{request.arrivalTime || 'TBC'}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <Clock size={15} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-slate-500">Expected Duration</p>
                <p className="font-semibold text-slate-800">{request.expectedDuration || 'TBC'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Service required */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Wrench size={14} className="text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-700">Service Required</h3>
            </div>
            <p className="text-sm text-slate-800 bg-slate-50 rounded-lg px-3 py-2.5">{request.serviceRequired}</p>
          </div>

          {request.productSummary && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Package size={14} className="text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-700">Product Summary</h3>
              </div>
              <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2.5">{request.productSummary}</p>
            </div>
          )}

          {request.installationNotes && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Wrench size={14} className="text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-700">Installation Notes</h3>
              </div>
              <p className="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2.5">{request.installationNotes}</p>
            </div>
          )}
        </div>

        {/* Pickup requirements */}
        {request.pickupType && request.pickupType !== 'No pickup required' && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <Truck size={14} className="text-purple-500" />
              <h3 className="text-sm font-semibold text-slate-700">Product Pickup Required</h3>
            </div>
            <p className="text-sm font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 mb-3">
              {request.pickupType}
            </p>
            {hasPickup && request.pickupLocations?.length > 0 && (
              <div className="space-y-3">
                {request.pickupLocations.map((loc, idx) => (
                  <div key={loc.id} className="border border-slate-200 rounded-xl p-4 text-sm text-slate-700 space-y-2">
                    {request.pickupLocations.length > 1 && (
                      <p className="font-semibold text-slate-800 text-sm">Pickup {idx + 1}</p>
                    )}
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                      {loc.locationName && (
                        <><span className="text-slate-500">Supplier / Location:</span><span className="font-medium">{loc.locationName}</span></>
                      )}
                      {loc.address && (
                        <><span className="text-slate-500">Address:</span><span>{loc.address}</span></>
                      )}
                      {(loc.contactPerson || loc.contactPhone) && (
                        <><span className="text-slate-500">Contact:</span>
                        <span>{loc.contactPerson}{loc.contactPhone ? ` · ${loc.contactPhone}` : ''}</span></>
                      )}
                      {(loc.pickupDate || loc.pickupTime) && (
                        <><span className="text-slate-500">Pickup date/time:</span>
                        <span className="font-medium">
                          {loc.pickupDate ? format(parseISO(loc.pickupDate), 'd MMMM yyyy') : ''}
                          {loc.pickupTime ? ` at ${loc.pickupTime}` : ''}
                        </span></>
                      )}
                      {loc.productsToCollect && (
                        <><span className="text-slate-500">Products to collect:</span><span>{loc.productsToCollect}</span></>
                      )}
                      {loc.orderReference && (
                        <><span className="text-slate-500">Order / Ref #:</span><span className="font-mono text-sm">{loc.orderReference}</span></>
                      )}
                    </div>
                    {loc.pickupNotes && (
                      <div className="mt-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-800">
                        ⚠️ {loc.pickupNotes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {hasPickup && (!request.pickupLocations || request.pickupLocations.length === 0) && (
              <p className="text-sm text-slate-400 italic">Pickup location details to be confirmed by Lusso.</p>
            )}
          </div>
        )}

        {/* Site notes */}
        {(request.accessNotes || request.parkingNotes || request.siteNotes) && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-3">
              <MapPin size={14} className="text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-700">Site Notes</h3>
            </div>
            <div className="space-y-2 text-sm text-slate-600">
              {request.accessNotes  && <p><span className="text-slate-400">Access:</span> {request.accessNotes}</p>}
              {request.parkingNotes && <p><span className="text-slate-400">Parking:</span> {request.parkingNotes}</p>}
              {request.siteNotes    && <p><span className="text-slate-400">Site:</span> {request.siteNotes}</p>}
            </div>
            <p className="text-xs text-slate-400 mt-3 bg-slate-50 rounded-lg px-3 py-2">
              🔒 Full site address and customer contact details will be provided after you accept.
            </p>
          </div>
        )}

        {/* Response selection */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">Your Response</h3>
          {/* The action is set by the link you followed. Use the other link in
              your email to choose the opposite. */}
          <div className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3.5 ${
            selectedAction === 'accept' ? 'border-green-500 bg-green-50' : 'border-red-400 bg-red-50'
          }`}>
            {selectedAction === 'accept'
              ? <CheckCircle2 size={24} className="text-green-500 flex-shrink-0" />
              : <XCircle size={24} className="text-red-400 flex-shrink-0" />}
            <div>
              <p className={`text-sm font-semibold ${selectedAction === 'accept' ? 'text-green-700' : 'text-red-600'}`}>
                {selectedAction === 'accept' ? 'Accepting this installation' : 'Declining this installation'}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">Wrong one? Use the other link in your email.</p>
            </div>
          </div>

          {/* Optional comment */}
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5 flex items-center gap-1.5">
              <MessageSquare size={12} /> Optional comment
            </label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              rows={3}
              placeholder={selectedAction === 'decline' ? 'Let Lusso know why you\'re declining…' : 'Any notes for Lusso (tools needed, questions, etc.)…'}
              className="w-full border border-slate-200 rounded-xl text-sm px-4 py-3 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={!selectedAction || submitting}
            className={`w-full py-3.5 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2 ${
              !selectedAction
                ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : selectedAction === 'accept'
                  ? 'bg-green-500 hover:bg-green-600 text-white'
                  : 'bg-red-500 hover:bg-red-600 text-white'
            }`}
          >
            {submitting
              ? <><Loader size={16} className="animate-spin" /> Submitting…</>
              : selectedAction === 'accept' ? '✅ Confirm — Accept Job'
              : selectedAction === 'decline' ? '❌ Confirm — Decline Job'
              : 'Select a response above'
            }
          </button>
        </div>
      </div>
    </ResponseShell>
  );
}

function ResponseShell({ children }) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Lusso header */}
      <div className="bg-sidebar px-6 py-4 flex items-center gap-3">
        <img src="/brand/lusso-white.png" alt="Lusso" className="h-5 w-auto" />
        <span className="text-slate-400 text-sm ml-1">Installer Portal</span>
      </div>
      <div className="flex-1 flex items-start justify-center px-4 py-8">
        <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          {children}
        </div>
      </div>
      <div className="text-center py-4 text-xs text-slate-400">
        © {new Date().getFullYear()} Lusso · jobs@lusso.com.au
      </div>
    </div>
  );
}
