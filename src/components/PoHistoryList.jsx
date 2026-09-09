/**
 * Purchase orders that have already gone out — the record of what was ordered,
 * from where, and on which piece of paper.
 */
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { FileText, Send, Printer, Download, ChevronRight } from 'lucide-react';

const STATUS = {
  sent:       { label: 'Sent',       icon: Send,     cls: 'bg-emerald-100 text-emerald-700' },
  printed:    { label: 'Printed',    icon: Printer,  cls: 'bg-slate-100 text-slate-600' },
  downloaded: { label: 'Downloaded', icon: FileText, cls: 'bg-slate-100 text-slate-600' },
  exported:   { label: 'Exported',   icon: Download, cls: 'bg-slate-100 text-slate-600' },
};

const when = (iso) => {
  if (!iso) return '';
  try { return format(parseISO(iso), 'd MMM yyyy, h:mma'); } catch { return ''; }
};

export default function PoHistoryList({
  orders = [],
  currentId = null,
  // The business-wide list needs to say WHOSE order each one is; inside a job
  // or a sheet that's already on the screen, so it stays off.
  showContext = false,
  emptyText = 'No purchase orders have been sent yet.',
}) {
  if (!orders.length) {
    return <p className="px-5 py-4 text-sm text-slate-400">{emptyText}</p>;
  }
  return (
    <div className="divide-y divide-slate-50">
      {orders.map(po => {
        const meta = STATUS[po.status] || STATUS.exported;
        const Icon = meta.icon;
        const isCurrent = po.id === currentId;
        return (
          <Link key={po.id} to={`/purchase-orders/${po.id}`}
            className={`flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors ${isCurrent ? 'bg-amber-50/60' : ''}`}>
            <span className={`flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-full flex-shrink-0 ${meta.cls}`}>
              <Icon size={11} /> {meta.label}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-medium text-slate-800 truncate">
                {po.poNumber || 'Purchase order'}
                {showContext && (po.customerName || po.snapshot?.customerName) && (
                  <span className="text-slate-500 font-normal"> · {po.customerName || po.snapshot?.customerName}</span>
                )}
                {showContext && po.jobNumber && <span className="text-slate-400 font-normal"> · {po.jobNumber}</span>}
                <span className="text-slate-400 font-normal"> · {po.itemCount || po.snapshot?.rows?.length || 0} curtain{(po.itemCount || 0) === 1 ? '' : 's'}</span>
                {(po.revision || 1) > 1 && <span className="text-slate-400 font-normal"> · rev {po.revision}</span>}
                {isCurrent && <span className="ml-2 text-[11px] font-semibold text-amber-600">editing</span>}
              </span>
              <span className="block text-xs text-slate-400 truncate">
                {[po.recipient, when(po.sentAt || po.updatedAt || po.createdAt), po.createdBy].filter(Boolean).join(' · ')}
              </span>
            </span>
            <ChevronRight size={15} className="text-slate-300 flex-shrink-0" />
          </Link>
        );
      })}
    </div>
  );
}
