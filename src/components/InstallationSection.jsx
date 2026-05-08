import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { format, parseISO } from 'date-fns';
import {
  Wrench, Plus, Send, ChevronDown, ChevronUp, User,
  Calendar, Clock, Check, X, AlertTriangle, Edit3, Save,
  HardHat, MessageSquare, Eye, EyeOff, Package, MapPin, Trash2,
} from 'lucide-react';
import {
  getActiveInstallers, getInstallRequestsByJob, getMeasureSheetByJob,
  createInstallRequest, sendInstallRequest, saveInstallRequest,
  getInstaller, getJob,
  INSTALLER_SERVICES, ARRIVAL_TIMES, DURATION_OPTIONS, PICKUP_TYPES,
  INSTALL_REQUEST_STATUS_COLORS,
} from '../store/data';
import EmailPreviewModal from './EmailPreviewModal';
import Card from './Card';
import { sendInstallerEmail } from '../lib/email';

const STATUS_ICONS = {
  Draft:       { icon: Edit3,        color: 'text-slate-500' },
  Sent:        { icon: Send,         color: 'text-blue-500' },
  Accepted:    { icon: Check,        color: 'text-green-500' },
  Declined:    { icon: X,            color: 'text-red-500' },
  Cancelled:   { icon: X,            color: 'text-slate-400' },
  Expired:     { icon: AlertTriangle,color: 'text-orange-500' },
  Rescheduled: { icon: Calendar,     color: 'text-amber-500' },
  Completed:   { icon: Check,        color: 'text-teal-500' },
};

const PICKUP_NEEDS_LOCATIONS = (type) =>
  ['Pickup from Lusso warehouse', 'Pickup from one supplier', 'Pickup from multiple suppliers'].includes(type);

const emptyPickupLocation = () => ({
  id: uuidv4(),
  locationName: '',
  address: '',
  contactPerson: '',
  contactPhone: '',
  pickupDate: '',
  pickupTime: '',
  productsToCollect: '',
  orderReference: '',
  pickupNotes: '',
});

export default function InstallationSection({ jobId, customer }) {
  const [requests, setRequests]     = useState(() => getInstallRequestsByJob(jobId));
  const [creating, setCreating]     = useState(false);
  const [emailModal, setEmailModal] = useState(null); // holds { request, installer }
  const [expandedId, setExpandedId] = useState(requests[0]?.id || null);
  const installers = getActiveInstallers();
  const job        = getJob(jobId);
  const measureSheet = getMeasureSheetByJob(jobId);

  const autoProductSummary = measureSheet
    ? measureSheet.lineItems.map(li => {
        const name = li.productNameSnapshot || li.productType || 'Product';
        const w = li.widthMm || li.width;
        const d = li.dropMm || li.drop;
        const fixing = li.fixing || li.mountType || '';
        const control = li.control || li.controlSide || '';
        return `${li.location}: ${li.quantity}× ${name}${w ? ` (${w}×${d}mm` : ''}${fixing ? `, ${fixing}` : ''}${control ? `, ${control} ctrl` : ''}).`;
      }).join(' ')
    : '';

  const autoServiceRequired = measureSheet
    ? [...new Set(measureSheet.lineItems.map(li => li.productNameSnapshot || li.productType))].filter(Boolean).map(name => {
        const count = measureSheet.lineItems
          .filter(li => (li.productNameSnapshot || li.productType) === name)
          .reduce((s, li) => s + Number(li.quantity || 1), 0);
        return `Install ${count} × ${name}`;
      }).join(', ')
    : '';

  const [form, setForm] = useState({
    installerId: '',
    proposedDate: '',
    arrivalTime: '',
    expectedDuration: '',
    serviceRequired: autoServiceRequired,
    productSummary: autoProductSummary,
    siteNotes: job?.siteConditionNotes || '',
    parkingNotes: job?.parkingNotes || '',
    accessNotes: job?.accessInstructions || '',
    suburb: customer?.address?.split(',').slice(-2, -1)[0]?.trim() || '',
    pickupType: 'No pickup required',
    pickupLocations: [],
    installationNotes: '',
    revealFullDetails: false,
    createdBy: 'Admin',
    assignedSalesperson: job?.assignedStaff || '',
  });

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const refresh = () => setRequests(getInstallRequestsByJob(jobId));

  // ── Pickup location helpers ─────────────────────────────────────────────────
  const addPickupLocation = () => {
    const loc = emptyPickupLocation();
    if (form.pickupType === 'Pickup from Lusso warehouse' && form.pickupLocations.length === 0) {
      loc.locationName = 'Lusso Warehouse';
      loc.address = '12 Commerce Drive, Campbellfield VIC 3061';
      loc.contactPerson = 'Lusso Warehouse';
    }
    setField('pickupLocations', [...form.pickupLocations, loc]);
  };

  const updatePickupLocation = (locId, key, value) => {
    setField('pickupLocations', form.pickupLocations.map(l => l.id === locId ? { ...l, [key]: value } : l));
  };

  const removePickupLocation = (locId) => {
    setField('pickupLocations', form.pickupLocations.filter(l => l.id !== locId));
  };

  const handlePickupTypeChange = (type) => {
    setField('pickupType', type);
    if (!PICKUP_NEEDS_LOCATIONS(type)) {
      setField('pickupLocations', []);
    }
  };

  // ── CRUD ────────────────────────────────────────────────────────────────────
  const handleCreate = () => {
    if (!form.installerId || !form.proposedDate || !form.serviceRequired.trim()) return;
    const req = createInstallRequest({ ...form, jobId });
    setExpandedId(req.id);
    setCreating(false);
    refresh();
  };

  const handlePreviewEmail = (req) => {
    const installer = getInstaller(req.installerId);
    setEmailModal({ request: req, installer });
  };

  const [sendingEmail, setSendingEmail] = useState(false);
  const handleSendEmail = useCallback(async () => {
    if (!emailModal) return;
    const { request, installer } = emailModal;
    if (!installer?.email) {
      alert('This installer has no email address on file.');
      return;
    }
    setSendingEmail(true);
    try {
      const job = getJob(request.jobId);
      await sendInstallerEmail(request, installer, job);
      sendInstallRequest(request.id, 'Admin');
      setEmailModal(null);
      refresh();
      alert(`✅ Installation request sent to ${installer.email}`);
    } catch (err) {
      alert(`❌ Failed to send email: ${err.message}`);
    } finally {
      setSendingEmail(false);
    }
  }, [emailModal, refresh]);

  const handleToggleReveal = (req) => {
    saveInstallRequest({ ...req, revealFullDetails: !req.revealFullDetails });
    refresh();
  };

  return (
    <Card>
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
          <Wrench size={15} /> Installation ({requests.length})
        </h2>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 text-xs bg-amber-500 hover:bg-amber-400 text-white font-medium px-3 py-1.5 rounded-lg transition-colors"
        >
          <Plus size={13} /> New Request
        </button>
      </div>

      {/* New request form */}
      {creating && (
        <div className="border-b border-slate-100 p-5 bg-slate-50">
          <p className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2"><HardHat size={14} /> New Installation Request</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <FormField label="Installer *">
              <select value={form.installerId} onChange={e => setField('installerId', e.target.value)} className={inp()}>
                <option value="">Select installer…</option>
                {installers.map(i => (
                  <option key={i.id} value={i.id}>{i.name} — {i.businessName}</option>
                ))}
              </select>
            </FormField>
            <FormField label="Suburb / Area">
              <input value={form.suburb} onChange={e => setField('suburb', e.target.value)} placeholder="e.g. Brighton" className={inp()} />
            </FormField>
            <FormField label="Proposed Date *">
              <input type="date" value={form.proposedDate} onChange={e => setField('proposedDate', e.target.value)} className={inp()} />
            </FormField>
            <div className="grid grid-cols-2 gap-2">
              <FormField label="Arrival Time">
                <select value={form.arrivalTime} onChange={e => setField('arrivalTime', e.target.value)} className={inp()}>
                  <option value="">Select…</option>
                  {ARRIVAL_TIMES.map(t => <option key={t}>{t}</option>)}
                </select>
              </FormField>
              <FormField label="Expected Duration">
                <select value={form.expectedDuration} onChange={e => setField('expectedDuration', e.target.value)} className={inp()}>
                  <option value="">Select…</option>
                  {DURATION_OPTIONS.map(d => <option key={d}>{d}</option>)}
                </select>
              </FormField>
            </div>
            <FormField label="Service Required *" className="sm:col-span-2">
              <input value={form.serviceRequired} onChange={e => setField('serviceRequired', e.target.value)}
                placeholder="e.g. Install 2 × Roller Blind, Install 1 × Sheer Curtain" className={inp()} />
            </FormField>
            <FormField label="Product Summary" className="sm:col-span-2">
              <textarea value={form.productSummary} onChange={e => setField('productSummary', e.target.value)}
                rows={3} className={inp() + ' resize-none'} placeholder="Detailed product list auto-filled from measure sheet…" />
            </FormField>
            <FormField label="Access Instructions">
              <input value={form.accessNotes} onChange={e => setField('accessNotes', e.target.value)} className={inp()} placeholder="Key, gate code…" />
            </FormField>
            <FormField label="Parking Notes">
              <input value={form.parkingNotes} onChange={e => setField('parkingNotes', e.target.value)} className={inp()} placeholder="Parking details…" />
            </FormField>
            <FormField label="Site Notes" className="sm:col-span-2">
              <input value={form.siteNotes} onChange={e => setField('siteNotes', e.target.value)} className={inp()} placeholder="Site conditions, hazards…" />
            </FormField>
            <FormField label="Installation Notes" className="sm:col-span-2">
              <textarea value={form.installationNotes} onChange={e => setField('installationNotes', e.target.value)}
                rows={2} className={inp() + ' resize-none'} placeholder="Additional install instructions for the installer…" />
            </FormField>
          </div>

          {/* ── Pickup Section ── */}
          <div className="mt-4 border-t border-slate-200 pt-4">
            <p className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2"><Package size={14} /> Product Pickup</p>
            <FormField label="Pickup Type">
              <select value={form.pickupType} onChange={e => handlePickupTypeChange(e.target.value)} className={inp()}>
                {PICKUP_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </FormField>

            {PICKUP_NEEDS_LOCATIONS(form.pickupType) && (
              <div className="mt-3 space-y-4">
                {form.pickupLocations.map((loc, idx) => (
                  <div key={loc.id} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 relative">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                        <MapPin size={12} /> Pickup Location {form.pickupLocations.length > 1 ? idx + 1 : ''}
                      </p>
                      <button onClick={() => removePickupLocation(loc.id)}
                        className="text-slate-400 hover:text-red-500 transition-colors p-1 rounded">
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-2">
                      <PickupField label="Location / Supplier Name" value={loc.locationName}
                        onChange={v => updatePickupLocation(loc.id, 'locationName', v)} />
                      <PickupField label="Address" value={loc.address}
                        onChange={v => updatePickupLocation(loc.id, 'address', v)} />
                      <PickupField label="Contact Person" value={loc.contactPerson}
                        onChange={v => updatePickupLocation(loc.id, 'contactPerson', v)} />
                      <PickupField label="Contact Phone" value={loc.contactPhone}
                        onChange={v => updatePickupLocation(loc.id, 'contactPhone', v)} />
                      <PickupField label="Pickup Date" type="date" value={loc.pickupDate}
                        onChange={v => updatePickupLocation(loc.id, 'pickupDate', v)} />
                      <PickupField label="Pickup Time" value={loc.pickupTime}
                        onChange={v => updatePickupLocation(loc.id, 'pickupTime', v)}
                        placeholder="e.g. 8:30 AM" />
                      <PickupField label="Products to Collect" value={loc.productsToCollect}
                        onChange={v => updatePickupLocation(loc.id, 'productsToCollect', v)}
                        className="sm:col-span-2" />
                      <PickupField label="Order / Reference Number" value={loc.orderReference}
                        onChange={v => updatePickupLocation(loc.id, 'orderReference', v)} />
                      <PickupField label="Pickup Notes" value={loc.pickupNotes}
                        onChange={v => updatePickupLocation(loc.id, 'pickupNotes', v)} />
                    </div>
                  </div>
                ))}
                {(form.pickupType === 'Pickup from multiple suppliers' || form.pickupLocations.length === 0) && (
                  <button onClick={addPickupLocation}
                    className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg hover:bg-amber-100 transition-colors">
                    <Plus size={12} /> Add pickup location
                  </button>
                )}
                {form.pickupLocations.length === 0 && form.pickupType !== 'Pickup from multiple suppliers' && (
                  <button onClick={addPickupLocation}
                    className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded-lg hover:bg-amber-100 transition-colors">
                    <Plus size={12} /> Add pickup location
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-3 mt-4">
            <FormField label="Assigned Salesperson">
              <input value={form.assignedSalesperson} onChange={e => setField('assignedSalesperson', e.target.value)} className={inp()} />
            </FormField>
            <FormField label="Reveal Full Details to Installer?">
              <div className="flex items-center gap-2 mt-1">
                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-600">
                  <input type="checkbox" checked={form.revealFullDetails} onChange={e => setField('revealFullDetails', e.target.checked)}
                    className="w-4 h-4 accent-amber-500" />
                  Yes — share full address & customer phone in email
                </label>
              </div>
            </FormField>
          </div>

          <div className="flex gap-2 mt-4">
            <button onClick={handleCreate}
              className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
              <Save size={13} /> Save Request
            </button>
            <button onClick={() => setCreating(false)}
              className="text-sm text-slate-500 border border-slate-200 px-4 py-2 rounded-lg hover:bg-slate-100">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Request list */}
      {requests.length === 0 && !creating ? (
        <div className="p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
            <HardHat size={20} className="text-slate-400" />
          </div>
          <p className="text-slate-500 text-sm">No installation requests yet.</p>
          <button onClick={() => setCreating(true)}
            className="mt-3 text-xs text-amber-600 hover:underline">Create first request</button>
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {requests.map(req => {
            const installer = getInstaller(req.installerId);
            const isExpanded = expandedId === req.id;
            const { icon: StatusIcon, color: statusColor } = STATUS_ICONS[req.status] || STATUS_ICONS.Draft;
            const statusCls = INSTALL_REQUEST_STATUS_COLORS[req.status] || 'bg-slate-100 text-slate-600';
            const hasPickup = PICKUP_NEEDS_LOCATIONS(req.pickupType);

            return (
              <div key={req.id}>
                {/* Request summary row */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : req.id)}
                  className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0">
                    <StatusIcon size={14} className={statusColor} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm text-slate-800">{installer?.name || 'Unknown'}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusCls}`}>{req.status}</span>
                      {hasPickup && (
                        <span className="text-xs bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <Package size={10} /> {req.pickupLocations?.length > 1 ? `${req.pickupLocations.length} pickups` : 'Pickup req.'}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5 flex gap-3 flex-wrap">
                      {req.proposedDate && <span>📅 {format(parseISO(req.proposedDate), 'd MMM yyyy')}</span>}
                      {req.arrivalTime && <span>🕐 {req.arrivalTime}{req.expectedDuration ? ` · ${req.expectedDuration}` : ''}</span>}
                      {req.sentAt && <span>Sent {format(parseISO(req.sentAt), 'd MMM')}</span>}
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp size={14} className="text-slate-400 flex-shrink-0" /> : <ChevronDown size={14} className="text-slate-400 flex-shrink-0" />}
                </button>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="px-5 pb-5 bg-slate-50/50 border-t border-slate-100">
                    <div className="grid sm:grid-cols-2 gap-4 py-4 text-sm">
                      <Detail label="Installer" value={`${installer?.name} — ${installer?.businessName}`} />
                      <Detail label="Date" value={req.proposedDate ? format(parseISO(req.proposedDate), 'EEEE, d MMMM yyyy') : '—'} />
                      <Detail label="Arrival Time" value={req.arrivalTime || '—'} />
                      <Detail label="Expected Duration" value={req.expectedDuration || '—'} />
                      <Detail label="Suburb" value={req.suburb || '—'} />
                      <Detail label="Service Required" value={req.serviceRequired} className="sm:col-span-2" />
                      {req.productSummary && <Detail label="Product Summary" value={req.productSummary} className="sm:col-span-2" />}
                      {req.installationNotes && <Detail label="Installation Notes" value={req.installationNotes} className="sm:col-span-2" />}
                      {req.accessNotes && <Detail label="Access" value={req.accessNotes} />}
                      {req.parkingNotes && <Detail label="Parking" value={req.parkingNotes} />}
                      {req.siteNotes && <Detail label="Site Notes" value={req.siteNotes} className="sm:col-span-2" />}
                      {req.respondedAt && (
                        <Detail label="Responded" value={format(parseISO(req.respondedAt), 'd MMM yyyy h:mm a')} />
                      )}
                      {req.responseComment && (
                        <Detail label="Installer Comment" value={req.responseComment} className="sm:col-span-2" />
                      )}
                    </div>

                    {/* Pickup details */}
                    {req.pickupType && req.pickupType !== 'No pickup required' && (
                      <div className="border-t border-slate-100 pt-4 pb-2">
                        <p className="text-xs font-semibold text-slate-600 mb-3 flex items-center gap-1.5">
                          <Package size={13} /> Pickup: {req.pickupType}
                        </p>
                        {req.pickupLocations?.length > 0 ? (
                          <div className="space-y-3">
                            {req.pickupLocations.map((loc, idx) => (
                              <div key={loc.id} className="bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-600 space-y-1">
                                {req.pickupLocations.length > 1 && (
                                  <p className="font-semibold text-slate-700 mb-1">Location {idx + 1}</p>
                                )}
                                <p><span className="text-slate-400">Supplier:</span> <strong>{loc.locationName || '—'}</strong></p>
                                {loc.address && <p><span className="text-slate-400">Address:</span> {loc.address}</p>}
                                {(loc.contactPerson || loc.contactPhone) && (
                                  <p><span className="text-slate-400">Contact:</span> {loc.contactPerson}{loc.contactPhone ? ` · ${loc.contactPhone}` : ''}</p>
                                )}
                                {(loc.pickupDate || loc.pickupTime) && (
                                  <p><span className="text-slate-400">Pickup:</span> {loc.pickupDate ? format(parseISO(loc.pickupDate), 'd MMM yyyy') : ''}{loc.pickupTime ? ` at ${loc.pickupTime}` : ''}</p>
                                )}
                                {loc.productsToCollect && <p><span className="text-slate-400">Products:</span> {loc.productsToCollect}</p>}
                                {loc.orderReference && <p><span className="text-slate-400">Ref:</span> {loc.orderReference}</p>}
                                {loc.pickupNotes && <p><span className="text-slate-400">Notes:</span> {loc.pickupNotes}</p>}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400 italic">No pickup location details added.</p>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                      {req.status === 'Draft' && (
                        <button
                          onClick={() => handlePreviewEmail(req)}
                          className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white text-xs font-medium px-3 py-2 rounded-lg transition-colors"
                        >
                          <Send size={12} /> Preview & Send Email
                        </button>
                      )}
                      {req.status === 'Sent' && (
                        <>
                          <button
                            onClick={() => handlePreviewEmail(req)}
                            className="flex items-center gap-1.5 border border-slate-200 text-slate-600 text-xs font-medium px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors"
                          >
                            <Eye size={12} /> View Email
                          </button>
                          <span className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-lg">
                            <Clock size={12} /> Awaiting installer response…
                          </span>
                        </>
                      )}
                      {req.status === 'Accepted' && (
                        <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 px-3 py-2 rounded-lg font-medium">
                          <Check size={12} /> Installation confirmed
                          {req.revealFullDetails ? null : (
                            <button onClick={() => handleToggleReveal(req)} className="ml-2 text-green-600 underline flex items-center gap-0.5">
                              <Eye size={11} /> Reveal details
                            </button>
                          )}
                        </div>
                      )}
                      {req.status === 'Declined' && (
                        <div className="flex items-center gap-1.5 text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                          <X size={12} /> Declined — create a new request to try another installer
                        </div>
                      )}

                      {/* Cancel button */}
                      {(req.status === 'Draft' || req.status === 'Sent') && (
                        <button
                          onClick={() => {
                            saveInstallRequest({ ...req, status: 'Cancelled' });
                            refresh();
                          }}
                          className="flex items-center gap-1.5 border border-slate-200 text-slate-500 text-xs px-3 py-2 rounded-lg hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors"
                        >
                          <X size={12} /> Cancel Request
                        </button>
                      )}
                    </div>

                    {/* Reveal full details badge */}
                    {req.status === 'Accepted' && (
                      <div className={`mt-3 flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${req.revealFullDetails ? 'bg-green-50 border-green-200 text-green-700' : 'bg-slate-50 border-slate-200 text-slate-500'}`}>
                        {req.revealFullDetails ? <Eye size={12} /> : <EyeOff size={12} />}
                        {req.revealFullDetails ? 'Full site details shared with installer' : 'Full site details NOT yet shared'}
                        <button onClick={() => handleToggleReveal(req)} className="ml-auto underline">
                          {req.revealFullDetails ? 'Revoke' : 'Share now'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Email modal */}
      {emailModal && (
        <EmailPreviewModal
          request={emailModal.request}
          installer={emailModal.installer}
          job={job}
          customer={customer}
          onSend={handleSendEmail}
          sending={sendingEmail}
          onClose={() => setEmailModal(null)}
        />
      )}
    </Card>
  );
}

function FormField({ label, className = '', children }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  );
}

function PickupField({ label, value, onChange, className = '', type = 'text', placeholder = '' }) {
  return (
    <div className={className}>
      <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-slate-200 rounded-lg text-xs px-2.5 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400" />
    </div>
  );
}

function Detail({ label, value, className = '' }) {
  return (
    <div className={className}>
      <dt className="text-xs text-slate-400 mb-0.5">{label}</dt>
      <dd className="text-sm text-slate-700">{value || '—'}</dd>
    </div>
  );
}

const inp = () => 'w-full border border-slate-200 rounded-lg text-sm px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-amber-400';
