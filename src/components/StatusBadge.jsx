import { STATUS_COLORS } from '../store/data';

export default function StatusBadge({ status, size = 'md' }) {
  const color = STATUS_COLORS[status] || 'bg-slate-100 text-slate-600';
  const sz = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-xs px-2.5 py-1';
  return (
    <span className={`inline-flex items-center rounded-full font-medium whitespace-nowrap ${color} ${sz}`}>
      {status}
    </span>
  );
}
