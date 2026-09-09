/**
 * Every purchase order the business has issued, newest first.
 *
 * The per-job and per-sheet lists answer "what did we order for this customer";
 * this one answers "what did we order last week" — across every job, with the
 * suppliers it went to.
 */
import { useDataRefresh } from '../hooks/useDataRefresh';
import { useState, useMemo } from 'react';
import { Search, X, History, PackageCheck } from 'lucide-react';
import { format, parseISO, isAfter, subDays } from 'date-fns';
import { getPurchaseOrders, searchMatch } from '../store/data';
import PoHistoryList from '../components/PoHistoryList';
import EmptyState from '../components/EmptyState';
import Card from '../components/Card';

// An order is "sent" or it isn't. Printed / downloaded / exported all mean the
// same thing in practice: it left the building some other way.
const STATUS_FILTERS = [
  { key: 'all',  label: 'All' },
  { key: 'sent', label: 'Emailed' },
  { key: 'other', label: 'Printed or downloaded' },
];

const PERIODS = [
  { key: '30',  label: 'Last 30 days', days: 30 },
  { key: '90',  label: 'Last 90 days', days: 90 },
  { key: 'all', label: 'All time',     days: null },
];

// Orders are grouped under the month they were placed — the way you'd look for
// one ("that job we ordered in July").
const monthKey = (iso) => {
  try { return format(parseISO(iso), 'MMMM yyyy'); } catch { return 'Undated'; }
};

const orderDate = (po) => po.sentAt || po.createdAt || po.updatedAt;

export default function PurchaseOrders() {
  useDataRefresh();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [period, setPeriod] = useState('90');

  const orders = getPurchaseOrders();

  const filtered = useMemo(() => {
    const days = PERIODS.find(p => p.key === period)?.days;
    const cutoff = days ? subDays(new Date(), days) : null;
    return orders.filter(po => {
      if (status === 'sent'  && po.status !== 'sent') return false;
      if (status === 'other' && po.status === 'sent') return false;
      if (cutoff) {
        const d = orderDate(po);
        if (!d) return false;
        try { if (!isAfter(parseISO(d), cutoff)) return false; } catch { /* keep undated */ }
      }
      return searchMatch(
        [po.poNumber, po.customerName, po.jobNumber, po.recipient, po.createdBy, po.extraNotes],
        search,
      );
    });
  }, [orders, search, status, period]);

  // Curtains ordered, not orders placed — that's the number worth knowing.
  const curtainCount = filtered.reduce((n, po) => n + (po.itemCount || po.snapshot?.rows?.length || 0), 0);

  const grouped = useMemo(() => {
    const out = [];
    for (const po of filtered) {
      const key = monthKey(orderDate(po));
      const last = out[out.length - 1];
      if (last && last.key === key) last.orders.push(po);
      else out.push({ key, orders: [po] });
    }
    return out;
  }, [filtered]);

  const chip = (active) =>
    `text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
      active ? 'bg-amber-500 border-amber-500 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
    }`;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">

      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <PackageCheck size={22} /> Purchase Orders
        </h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {orders.length === 0
            ? 'Every order sent to a workroom or supplier lands here.'
            : [
                filtered.length === orders.length
                  ? `${orders.length} order${orders.length !== 1 ? 's' : ''}`
                  : `${filtered.length} of ${orders.length} orders`,
                curtainCount ? `${curtainCount} curtain${curtainCount !== 1 ? 's' : ''}` : '',
              ].filter(Boolean).join(' · ')}
        </p>
      </div>

      {orders.length > 0 && (
        <>
          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by PO number, customer, job, supplier…"
              className="w-full pl-9 pr-10 py-2.5 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X size={14} />
              </button>
            )}
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            {STATUS_FILTERS.map(f => (
              <button key={f.key} onClick={() => setStatus(f.key)} className={chip(status === f.key)}>{f.label}</button>
            ))}
            <span className="w-px h-5 bg-slate-200 mx-1" />
            {PERIODS.map(p => (
              <button key={p.key} onClick={() => setPeriod(p.key)} className={chip(period === p.key)}>{p.label}</button>
            ))}
          </div>
        </>
      )}

      {/* List */}
      {orders.length === 0 ? (
        <Card>
          <EmptyState
            icon={PackageCheck}
            title="No purchase orders yet"
            description="Open a measure sheet with curtains on it and generate a purchase order — every one you send, print or download is kept here."
          />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <p className="p-8 text-center text-sm text-slate-400">
            No orders match {search.trim() ? `“${search.trim()}”` : 'these filters'}.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(group => (
            <Card key={group.key}>
              <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
                <h2 className="font-semibold text-slate-700 text-sm flex items-center gap-2">
                  <History size={14} className="text-slate-400" /> {group.key}
                </h2>
                <span className="text-xs text-slate-400">
                  {group.orders.length} order{group.orders.length !== 1 ? 's' : ''}
                </span>
              </div>
              <PoHistoryList orders={group.orders} showContext />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
