import { useDataRefresh } from '../hooks/useDataRefresh';
import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { differenceInDays, parseISO, format } from 'date-fns';
import { Star, Send, CheckCircle2, Clock, X, Loader2, ExternalLink } from 'lucide-react';
import {
  getJobs, getCustomers, getReviewRequests, saveReviewRequest,
  GOOGLE_REVIEW_URL,
} from '../store/data';
import { sendReviewSms } from '../lib/reviewSms';
import ReviewAskModal from '../components/ReviewAskModal';
import { useProfile } from '../contexts/UserProfileContext';
import { toast } from '../components/ToastContainer';
import { v4 as uuidv4 } from 'uuid';
import Card from '../components/Card';

const phoneOf = (cust) => cust?.mobile || cust?.phone || '';

export default function Reviews() {
  useDataRefresh();
  const navigate = useNavigate();
  const { displayName = '' } = useProfile() || {};
  const [busyId, setBusyId] = useState(null);
  const [draft, setDraft]   = useState(null); // { jobId, customerId, to, message }

  const jobs      = getJobs().filter(j => !j.deletedAt);
  const customers = getCustomers();
  const requests  = getReviewRequests();
  const byJob     = new Map(requests.map(r => [r.jobId, r]));

  // Jobs finished in the last 60 days with a contactable customer and no ask yet.
  const eligible = useMemo(() => jobs
    // Key the 60-day window off the completion date (falls back to updatedAt for
    // older jobs), so an unrelated edit doesn't re-open the review ask.
    .map(j => ({ job: j, finishedAt: j.completedAt || j.updatedAt }))
    .filter(({ job: j, finishedAt }) => ['Completed', 'Installed'].includes(j.status) && finishedAt
      && differenceInDays(new Date(), parseISO(finishedAt)) <= 60
      && !byJob.has(j.id))
    .map(({ job: j }) => ({ job: j, customer: customers.find(c => c.id === j.customerId) }))
    .filter(e => e.customer && phoneOf(e.customer))
    .sort((a, b) => new Date(b.job.completedAt || b.job.updatedAt) - new Date(a.job.completedAt || a.job.updatedAt)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobs, customers, requests]);

  const awaiting = requests.filter(r => r.sentAt && !r.reviewedAt && !r.skippedAt);
  const done     = requests.filter(r => r.reviewedAt).slice(0, 10);

  const openDraft = (job, customer) => setDraft({ job, customer });

  const remind = async (req) => {
    const cust = customers.find(c => c.id === req.customerId);
    if (!cust || !phoneOf(cust)) { toast('No phone number on file.'); return; }
    setBusyId(req.id);
    try {
      const firstName = (cust.name || '').trim().split(/\s+/)[0];
      await sendReviewSms(phoneOf(cust),
        `Hi ${firstName}, ${displayName.split(' ')[0] || 'the team'} from Lusso again — just a gentle nudge in case it slipped by. A quick Google review helps us more than you'd think: ${GOOGLE_REVIEW_URL}`);
      saveReviewRequest({ ...req, remindedAt: new Date().toISOString() });
      toast(`Reminder sent to ${cust.name}.`);
    } catch (e) {
      toast(`Send failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  };

  const markReviewed = (req) => { saveReviewRequest({ ...req, reviewedAt: new Date().toISOString() }); toast('Marked as reviewed — nice one!'); };
  const skip         = (req) => saveReviewRequest({ ...req, skippedAt: new Date().toISOString() });
  const skipJob      = (job, customer) => {
    saveReviewRequest({ id: uuidv4(), jobId: job.id, customerId: customer.id, skippedAt: new Date().toISOString() });
  };

  const custName = (id) => customers.find(c => c.id === id)?.name || 'Customer';

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Google Reviews</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Ask happy customers at the right moment — one tap sends a personal SMS with your review link.
        </p>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Ready to ask', value: eligible.length, icon: Star },
          { label: 'Awaiting review', value: awaiting.length, icon: Clock },
          { label: 'Reviews received', value: requests.filter(r => r.reviewedAt).length, icon: CheckCircle2 },
        ].map(t => (
          <Card key={t.label} className="p-4">
            <t.icon size={15} className="text-amber-500" />
            <div className="text-xl font-bold text-slate-900 mt-1.5">{t.value}</div>
            <div className="text-xs text-slate-500 mt-0.5">{t.label}</div>
          </Card>
        ))}
      </div>

      {/* ── Ready to ask ── */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800 text-sm">Ready to ask</h2>
          <p className="text-xs text-slate-400 mt-0.5">Jobs finished in the last 60 days, customer has a phone number, not asked yet</p>
        </div>
        {eligible.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">No jobs waiting — finish an install and it'll appear here.</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {eligible.map(({ job, customer }) => (
              <div key={job.id} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => navigate(`/jobs/${job.id}`)}>
                  <p className="text-sm font-medium text-slate-800 truncate">{customer.name}</p>
                  <p className="text-xs text-slate-400 truncate">
                    {job.jobNumber} · {job.status} {format(parseISO(job.updatedAt), 'd MMM')} · {phoneOf(customer)}
                  </p>
                </div>
                <button onClick={() => skipJob(job, customer)}
                  className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1.5 flex-shrink-0">
                  Skip
                </button>
                <button onClick={() => openDraft(job, customer)}
                  className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 text-white text-xs font-semibold rounded-lg px-3 py-2 transition-colors flex-shrink-0">
                  <Send size={12} /> Ask for review
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ── Awaiting ── */}
      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800 text-sm">Awaiting review</h2>
          <p className="text-xs text-slate-400 mt-0.5">Asked but no review yet — remind once after ~6 days, then let it go</p>
        </div>
        {awaiting.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">Nothing outstanding.</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {awaiting.map(req => {
              const days = differenceInDays(new Date(), parseISO(req.sentAt));
              return (
                <div key={req.id} className="px-5 py-3 flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{custName(req.customerId)}</p>
                    <p className="text-xs text-slate-400">
                      asked {days === 0 ? 'today' : `${days}d ago`}{req.remindedAt ? ' · reminded' : ''}
                    </p>
                  </div>
                  {!req.remindedAt && days >= 6 && (
                    <button onClick={() => remind(req)} disabled={busyId === req.id}
                      className="flex items-center gap-1.5 text-xs font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-lg px-2.5 py-1.5 disabled:opacity-50 flex-shrink-0">
                      {busyId === req.id ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Remind
                    </button>
                  )}
                  <button onClick={() => markReviewed(req)}
                    className="flex items-center gap-1.5 text-xs font-medium bg-green-100 text-green-700 hover:bg-green-200 rounded-lg px-2.5 py-1.5 flex-shrink-0">
                    <CheckCircle2 size={12} /> Reviewed
                  </button>
                  <button onClick={() => skip(req)} title="Stop chasing"
                    className="text-slate-300 hover:text-slate-500 p-1 flex-shrink-0"><X size={14} /></button>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ── Recent wins ── */}
      {done.length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm">Reviews received</h2>
          </div>
          <div className="divide-y divide-slate-50">
            {done.map(req => (
              <div key={req.id} className="px-5 py-2.5 flex items-center gap-3">
                <Star size={14} className="text-amber-400 flex-shrink-0" fill="currentColor" />
                <p className="text-sm text-slate-700 flex-1 truncate">{custName(req.customerId)}</p>
                <span className="text-xs text-slate-400">{format(parseISO(req.reviewedAt), 'd MMM')}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <a href={GOOGLE_REVIEW_URL} target="_blank" rel="noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600">
        <ExternalLink size={12} /> Preview your Google review page
      </a>

      {draft && (
        <ReviewAskModal
          customer={draft.customer}
          jobId={draft.job.id}
          senderFirstName={displayName.split(' ')[0]}
          onClose={() => setDraft(null)}
        />
      )}
    </div>
  );
}
