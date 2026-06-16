import { useDataRefresh } from '../hooks/useDataRefresh';
import { toast } from '../components/ToastContainer';
import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  Edit3, Save, X, Phone, Mail, MapPin,
  CheckCircle2, XCircle, HardHat, Briefcase, Clock,
} from 'lucide-react';
import {
  getInstaller, saveInstaller, getInstallRequestsByInstaller,
  getJob, getCustomer, INSTALLER_SERVICES, INSTALL_REQUEST_STATUS_COLORS,
} from '../store/data';
import Card from '../components/Card';
import BackButton from '../components/BackButton';
import StatusBadge from '../components/StatusBadge';

export default function InstallerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const installer = getInstaller(id); // read directly — re-renders pick up fresh data
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState({});
  useDataRefresh();

  if (!installer) return (
    <div className="p-6 text-center">
      <p className="text-slate-500">Installer not found.</p>
      <button onClick={() => navigate('/installers')} className="text-amber-600 hover:underline mt-2 text-sm">Back</button>
    </div>
  );

  const requests = getInstallRequestsByInstaller(id);
  const accepted = requests.filter(r => r.status === 'Accepted').length;
  const declined = requests.filter(r => r.status === 'Declined').length;
  const pending  = requests.filter(r => r.status === 'Sent').length;

  const handleSave = () => {
    const updated = { ...installer, ...edits };
    saveInstaller(updated);
    setEditing(false);
    setEdits({});
    toast('Installer saved.');
  };

  const toggleService = (svc) => {
    const current = edits.servicesOffered ?? installer.servicesOffered ?? [];
    setEdits(e => ({
      ...e,
      servicesOffered: current.includes(svc) ? current.filter(s => s !== svc) : [...current, svc],
    }));
  };

  const f  = (key) => edits[key] ?? installer[key] ?? '';
  const sf = (key) => (e) => setEdits(p => ({ ...p, [key]: e.target.value }));

  const selectedServices = edits.servicesOffered ?? installer.servicesOffered ?? [];

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <BackButton fallback="/installers" />

      {/* Header */}
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0 ${installer.isActive ? 'bg-amber-100' : 'bg-slate-100'}`}>
            <HardHat size={28} className={installer.isActive ? 'text-amber-700' : 'text-slate-400'} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-slate-900">{installer.name}</h1>
              <span className={`flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${installer.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                {installer.isActive ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                {installer.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            <p className="text-slate-500 text-sm">{installer.businessName}</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-2 text-sm text-slate-500">
              {installer.phone && <span className="flex items-center gap-1.5"><Phone size={13} />{installer.phone}</span>}
              {installer.email && <span className="flex items-center gap-1.5"><Mail size={13} />{installer.email}</span>}
              {installer.serviceAreas && <span className="flex items-center gap-1.5"><MapPin size={13} />{installer.serviceAreas}</span>}
            </div>
          </div>
          <button onClick={() => setEditing(!editing)}
            className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 flex-shrink-0">
            {editing ? <><X size={13} /> Cancel</> : <><Edit3 size={13} /> Edit</>}
          </button>
        </div>
      </Card>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-5">
          {/* Edit form */}
          {editing && (
            <Card>
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 text-sm">Edit Installer Details</h2>
              </div>
              <div className="p-5 space-y-4">
                <div className="grid sm:grid-cols-2 gap-3">
                  {[['name','Name'],['businessName','Business Name'],['email','Email'],['phone','Phone'],['serviceAreas','Service Areas']].map(([key,label]) => (
                    <div key={key} className={key === 'serviceAreas' ? 'sm:col-span-2' : ''}>
                      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
                      <input value={f(key)} onChange={sf(key)}
                        className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    </div>
                  ))}
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
                    <div className="flex gap-2">
                      {[[true,'Active'],[false,'Inactive']].map(([val, label]) => (
                        <button key={String(val)} onClick={() => setEdits(e => ({...e, isActive: val}))}
                          className={`flex-1 text-sm py-2 rounded-lg border transition-colors ${(edits.isActive ?? installer.isActive) === val ? 'bg-amber-500 text-white border-amber-500' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-2">Services Offered</label>
                  <div className="flex flex-wrap gap-1.5">
                    {INSTALLER_SERVICES.map(svc => (
                      <button key={svc} onClick={() => toggleService(svc)}
                        className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selectedServices.includes(svc) ? 'bg-amber-500 text-white border-amber-500' : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
                        {svc}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  {[['availabilityNotes','Availability Notes'],['internalNotes','Internal Notes']].map(([key,label]) => (
                    <div key={key}>
                      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
                      <textarea value={f(key)} onChange={sf(key)} rows={3}
                        className="w-full border border-slate-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
                    </div>
                  ))}
                </div>

                <button onClick={handleSave}
                  className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                  <Save size={13} /> Save Changes
                </button>
              </div>
            </Card>
          )}

          {/* Installation history */}
          <Card>
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                <Briefcase size={15} /> Installation History ({requests.length})
              </h2>
            </div>
            {requests.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">No installation requests yet.</div>
            ) : (
              <div className="divide-y divide-slate-50">
                {[...requests].sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).map(req => {
                  const job = getJob(req.jobId);
                  const customer = job ? getCustomer(job.customerId) : null;
                  const statusCls = INSTALL_REQUEST_STATUS_COLORS[req.status] || 'bg-slate-100 text-slate-600';
                  return (
                    <button key={req.id} onClick={() => navigate(`/jobs/${req.jobId}`)}
                      className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors text-left">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-sm text-slate-800">{customer?.name || '—'}</span>
                          <span className="text-xs text-slate-400">{job?.jobNumber}</span>
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusCls}`}>{req.status}</span>
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap gap-3">
                          {req.proposedDate && <span>📅 {format(parseISO(req.proposedDate), 'd MMM yyyy')}</span>}
                          {req.serviceRequired && <span className="truncate max-w-[200px]">{req.serviceRequired}</span>}
                        </div>
                      </div>
                      <span className="text-slate-300 text-xs">→</span>
                    </button>
                  );
                })}
              </div>
            )}
          </Card>
        </div>

        {/* Right */}
        <div className="space-y-5">
          {/* Stats */}
          <Card className="p-5">
            <h2 className="font-semibold text-slate-800 text-sm mb-3">Performance</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Total Requests</span><span className="font-semibold text-slate-800">{requests.length}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Accepted</span><span className="font-semibold text-green-600">{accepted}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Declined</span><span className="font-semibold text-red-500">{declined}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Pending</span><span className="font-semibold text-blue-600">{pending}</span></div>
              {requests.length > 0 && (
                <div className="flex justify-between pt-2 border-t border-slate-100">
                  <span className="text-slate-500">Accept Rate</span>
                  <span className="font-semibold text-slate-800">
                    {Math.round((accepted / (accepted + declined || 1)) * 100)}%
                  </span>
                </div>
              )}
            </div>
          </Card>

          {/* Services */}
          <Card className="p-5">
            <h2 className="font-semibold text-slate-800 text-sm mb-3">Services</h2>
            <div className="flex flex-wrap gap-1.5">
              {(installer.servicesOffered || []).map(s => (
                <span key={s} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full">{s}</span>
              ))}
              {(!installer.servicesOffered || installer.servicesOffered.length === 0) && (
                <span className="text-xs text-slate-400">No services listed</span>
              )}
            </div>
          </Card>

          {/* Availability */}
          {installer.availabilityNotes && (
            <Card className="p-5">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2 mb-3"><Clock size={13} /> Availability</h2>
              <p className="text-sm text-slate-600">{installer.availabilityNotes}</p>
            </Card>
          )}

          {/* Internal notes */}
          {installer.internalNotes && (
            <Card className="p-5">
              <h2 className="font-semibold text-slate-800 text-sm mb-3">Internal Notes</h2>
              <p className="text-sm text-slate-600">{installer.internalNotes}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
