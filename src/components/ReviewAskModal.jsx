import { useState } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { saveReviewRequest, buildReviewMessage } from '../store/data';
import { sendReviewSms } from '../lib/reviewSms';
import { toast } from './ToastContainer';

// One-tap Google-review ask: personal SMS logged to review_requests so
// nobody gets asked twice.

export default function ReviewAskModal({ customer, jobId, senderFirstName, onClose, onSent }) {
  const to = customer?.mobile || customer?.phone || '';
  const firstName = (customer?.name || '').trim().split(/\s+/)[0];
  const [message, setMessage] = useState(() => buildReviewMessage(firstName, senderFirstName));
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (sending || !message.trim()) return;
    setSending(true);
    try {
      await sendReviewSms(to, message.trim());
      saveReviewRequest({
        id: uuidv4(), jobId, customerId: customer.id,
        channel: 'sms', message: message.trim(), sentAt: new Date().toISOString(),
      });
      toast(`Review request sent to ${customer.name}.`);
      onSent?.();
      onClose();
    } catch (e) {
      toast(`Send failed: ${e.message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div>
          <h3 className="font-bold text-slate-900">Ask {customer?.name} for a Google review</h3>
          <p className="text-xs text-slate-400 mt-0.5">SMS to {to} — edit before sending if you like</p>
        </div>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          rows={5}
          className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <div className="flex gap-3">
          <button onClick={onClose}
            className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl transition-colors">
            Not now
          </button>
          <button onClick={send} disabled={sending || !message.trim()}
            className="flex-1 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send SMS
          </button>
        </div>
      </div>
    </div>
  );
}
