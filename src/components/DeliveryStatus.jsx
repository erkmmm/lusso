/**
 * What actually happened to an outbound message.
 *
 * Every send used to read "sent", because that's all we recorded — the moment
 * Twilio or Resend accepted the request. Now the providers report back (see
 * supabase/functions/comms-inbound/delivery.ts) and this is where staff see it.
 *
 * The quiet states stay quiet: a tick for accepted, a double tick for
 * delivered, nothing that competes with the message itself. The states that
 * need acting on — a bounce, a spam complaint, a carrier failure — get a
 * labelled pill, because a grey cross next to a quote nobody received is not
 * a warning anybody notices.
 */

const QUIET = {
  queued:    { mark: '✓',  label: 'Accepted by the provider, not yet sent on' },
  sent:      { mark: '✓',  label: 'Sent — delivery not confirmed yet' },
  delivered: { mark: '✓✓', label: 'Delivered' },
};

const LOUD = {
  delayed:    { text: 'Delayed',   className: 'bg-amber-50 text-amber-700 border-amber-200' },
  bounced:    { text: 'Bounced',   className: 'bg-red-50 text-red-700 border-red-200' },
  failed:     { text: 'Failed',    className: 'bg-red-50 text-red-700 border-red-200' },
  complained: { text: 'Marked as spam', className: 'bg-orange-50 text-orange-700 border-orange-200' },
};

export default function DeliveryStatus({ status, detail, className = '' }) {
  const loud = LOUD[status];
  if (loud) {
    return (
      <span
        title={detail || undefined}
        className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border ${loud.className} ${className}`}
      >
        {loud.text}
        {detail && <span className="font-normal opacity-70 max-w-[16rem] truncate">· {detail}</span>}
      </span>
    );
  }

  const quiet = QUIET[status];
  if (!quiet) return null;
  return (
    <span title={quiet.label} className={`text-[10px] text-slate-400 ${className}`}>
      {quiet.mark}
    </span>
  );
}
