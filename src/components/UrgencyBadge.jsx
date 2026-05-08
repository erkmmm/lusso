const COLORS = {
  Low:    'bg-slate-100 text-slate-500',
  Normal: 'bg-blue-50 text-blue-600',
  High:   'bg-orange-100 text-orange-600',
  Urgent: 'bg-red-100 text-red-600',
};

export default function UrgencyBadge({ urgency }) {
  return (
    <span className={`inline-flex items-center rounded-full text-xs font-medium px-2.5 py-1 ${COLORS[urgency] || COLORS.Normal}`}>
      {urgency === 'Urgent' && <span className="mr-1">⚡</span>}
      {urgency}
    </span>
  );
}
