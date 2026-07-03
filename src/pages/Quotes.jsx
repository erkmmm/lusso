import { useDataRefresh } from '../hooks/useDataRefresh';
import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, FileText, Search, X, Eye, Edit3, Copy, Send,
  CheckCircle2, XCircle, MoreHorizontal, TrendingUp, Clock,
  DollarSign, ChevronRight, AlertCircle,
  Trash2, CheckSquare, Square, AlertTriangle,
} from 'lucide-react';
import { format, parseISO, isPast, differenceInSeconds } from 'date-fns';
import {
  getQuotes, getQuotesFiltered, getCustomers, QUOTE_STATUSES, QUOTE_STATUS_COLORS,
  computeQuoteTotals, sendQuote, duplicateQuote, deleteQuote, bulkDeleteQuotes,
} from '../store/data';
import { useProfile } from '../contexts/UserProfileContext';
import EmptyState from '../components/EmptyState';
import Card from '../components/Card';

const fmt = (n) => `$${Math.round(n).toLocaleString('en-AU')}`;

const STATUS_TABS = ['All', ...QUOTE_STATUSES];

// ── Toast ─────────────────────────────────────────────────────────────────────
function Toast({ message, onDone }) {
  useEffect(() => { const t = setTimeout(onDone, 3000); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-medium px-5 py-3 rounded-xl shadow-xl flex items-center gap-2">
      <CheckSquare size={15} className="text-green-400" /> {message}
    </div>
  );
}

// ── Delete confirmation modal ─────────────────────────────────────────────────
function DeleteModal({ count, onConfirm, onCancel }) {
  const isBulk = count > 1;
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Trash2 size={18} className="text-red-500" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 text-base">
              {isBulk ? `Delete ${count} quotes?` : 'Delete this quote?'}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              {isBulk
                ? `Are you sure you want to delete ${count} quotes? This action cannot be undone.`
                : 'Are you sure you want to delete this quote? This action cannot be undone.'}
            </p>
            <div className="mt-3 flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
              <AlertTriangle size={14} className="text-yellow-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-yellow-700">
                Deleting {isBulk ? 'these quotes' : 'this quote'} will remove them from the pipeline.
              </p>
            </div>
          </div>
        </div>
        <div className="flex gap-3 pt-1">
          <button onClick={onCancel}
            className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 text-sm font-medium py-2.5 rounded-xl transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors">
            {isBulk ? `Delete ${count} Quotes` : 'Delete Quote'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Quotes() {
  useDataRefresh();
  const navigate = useNavigate();
  const [search, setSearch]             = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [openMenuId, setOpenMenuId]     = useState(null);
  const [selectMode, setSelectMode]     = useState(false);
  const [selected, setSelected]         = useState(new Set());
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast]               = useState(null);
  const { isAM = true, displayName = '' } = useProfile() || {};
  const [quotes, setQuotes]             = useState(() => getQuotesFiltered(isAM, displayName));
  const customers                       = getCustomers();

  const refresh = () => setQuotes(getQuotesFiltered(isAM, displayName));

  const filtered = useMemo(() => {
    const term = search.toLowerCase();
    return quotes.filter(q => {
      const cust = customers.find(c => c.id === q.customerId);
      const matchSearch = !term || [q.quoteNumber, q.title, cust?.name, q.siteAddress, q.salesperson].join(' ').toLowerCase().includes(term);
      const matchStatus = statusFilter === 'All' || q.status === statusFilter;
      return matchSearch && matchStatus;
    }).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }, [quotes, customers, search, statusFilter]);

  const stats = useMemo(() => {
    const allTotal      = quotes.reduce((s, q) => s + computeQuoteTotals(q.lineItems, q.depositType, q.depositValue, q.gstRate, q.includesGST).total, 0);
    const accepted      = quotes.filter(q => q.status === 'Accepted');
    const acceptedTotal = accepted.reduce((s, q) => s + computeQuoteTotals(q.lineItems, q.depositType, q.depositValue, q.gstRate, q.includesGST).total, 0);
    const inProgress    = quotes.filter(q => ['Sent', 'Viewed', 'Waiting'].includes(q.status)).length;
    return { total: quotes.length, allTotal, accepted: accepted.length, acceptedTotal, inProgress };
  }, [quotes]);

  const statusCounts = useMemo(() => {
    const c = {};
    quotes.forEach(q => { c[q.status] = (c[q.status] || 0) + 1; });
    return c;
  }, [quotes]);

  // ── Select helpers ────────────────────────────────────────────────────────
  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()); };

  const toggleSelect = (id, e) => {
    e.stopPropagation();
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const allSelected = filtered.length > 0 && filtered.every(q => selected.has(q.id));
  const toggleAll   = () => setSelected(allSelected ? new Set() : new Set(filtered.map(q => q.id)));

  const targetIds = deleteTarget === 'bulk' ? [...selected] : deleteTarget ? [deleteTarget] : [];

  const handleConfirmDelete = () => {
    const count = targetIds.length;
    bulkDeleteQuotes(targetIds);
    setSelected(new Set());
    setDeleteTarget(null);
    setSelectMode(false);
    refresh();
    setToast(count === 1 ? 'Quote deleted.' : `${count} quotes deleted.`);
  };

  // ── Per-row actions ───────────────────────────────────────────────────────
  const handleSend = (q) => { sendQuote(q.id, 'Admin'); refresh(); };
  const handleDuplicate = (q) => { duplicateQuote(q.id); refresh(); };
  const handleDelete = (q) => {
    if (confirm(`Delete ${q.quoteNumber}? This cannot be undone.`)) {
      deleteQuote(q.id);
      refresh();
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5 pb-24" onClick={() => setOpenMenuId(null)}>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quotes</h1>
          <p className="text-slate-500 text-sm mt-0.5">{filtered.length} quote{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2 self-start">
          {quotes.length > 0 && (
            selectMode ? (
              <button onClick={exitSelectMode}
                className="text-sm font-medium px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                Cancel
              </button>
            ) : (
              <button onClick={() => setSelectMode(true)}
                className="text-sm font-medium px-4 py-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
                Select
              </button>
            )
          )}
          <button
            onClick={() => navigate('/quotes/new')}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors"
          >
            <Plus size={16} /> New Quote
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Pipeline',  value: fmt(stats.allTotal),     sub: `${stats.total} quotes`,  icon: DollarSign,   color: 'text-slate-600 bg-slate-100' },
          { label: 'In Progress',     value: stats.inProgress,         sub: 'sent / viewed',          icon: Clock,        color: 'text-blue-600 bg-blue-50' },
          { label: 'Accepted',        value: stats.accepted,           sub: 'quotes won',             icon: CheckCircle2, color: 'text-green-600 bg-green-50' },
          { label: 'Accepted Value',  value: fmt(stats.acceptedTotal), sub: 'total won',              icon: TrendingUp,   color: 'text-amber-600 bg-amber-50' },
        ].map(({ label, value, sub, icon: Icon, color }) => (
          <Card key={label} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs text-slate-500 mb-0.5">{label}</p>
                <p className="text-xl font-bold text-slate-900">{value}</p>
                <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
              </div>
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
                <Icon size={16} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by customer, quote number, address, salesperson…"
          className="w-full pl-9 pr-10 py-2.5 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Status tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {STATUS_TABS.map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              statusFilter === s
                ? 'bg-amber-500 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {s}
            {s !== 'All' && statusCounts[s] > 0 && (
              <span className={`min-w-[18px] text-center text-[10px] font-bold px-1 py-0.5 rounded-full ${statusFilter === s ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'}`}>
                {statusCounts[s]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Bulk action bar */}
      {selectMode && selected.size > 0 && (
        <div className="flex items-center gap-3 bg-slate-900 text-white px-4 py-3 rounded-xl shadow-lg">
          <span className="text-sm font-medium flex-1">
            {selected.size} quote{selected.size !== 1 ? 's' : ''} selected
          </span>
          <button onClick={() => setDeleteTarget('bulk')}
            className="flex items-center gap-1.5 bg-red-500 hover:bg-red-400 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors">
            <Trash2 size={13} /> Delete Selected
          </button>
          <button onClick={() => setSelected(new Set())}
            className="text-slate-400 hover:text-white text-xs px-2 py-1.5 rounded-lg transition-colors">
            Clear
          </button>
        </div>
      )}

      {/* Quote list */}
      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={FileText}
            title={search || statusFilter !== 'All' ? 'No quotes match your filters' : 'No quotes yet'}
            description={search || statusFilter !== 'All' ? 'Try adjusting your search or filter.' : 'Create your first quote from a measure sheet or from scratch.'}
            action={!search && statusFilter === 'All' ? (
              <button onClick={() => navigate('/quotes/new')} className="bg-amber-500 hover:bg-amber-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                New Quote
              </button>
            ) : null}
          />
        </Card>
      ) : (
        <div className="space-y-2">

          {/* Select all row */}
          {selectMode && filtered.length > 1 && (
            <div className="flex items-center gap-3 px-1 pb-1">
              <button onClick={toggleAll} className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-800 transition-colors">
                {allSelected
                  ? <CheckSquare size={15} className="text-amber-500" />
                  : <Square size={15} className="text-slate-300" />}
                {allSelected ? 'Deselect all' : 'Select all'}
              </button>
            </div>
          )}

          {filtered.map(quote => {
            const cust      = customers.find(c => c.id === quote.customerId);
            const { total } = computeQuoteTotals(quote.lineItems, quote.depositType, quote.depositValue, quote.gstRate, quote.includesGST);
            const colorClass = QUOTE_STATUS_COLORS[quote.status] || QUOTE_STATUS_COLORS.Draft;
            const isOverdue  = quote.expiryDate && isPast(new Date(quote.expiryDate)) && !['Accepted', 'Declined', 'Completed', 'Expired'].includes(quote.status);
            const reqCount   = quote.lineItems.filter(li => li.type === 'Required').length;
            const optCount   = quote.lineItems.filter(li => li.type !== 'Required').length;
            const isSelected = selected.has(quote.id);

            return (
              <div key={quote.id}
                className={`group bg-white rounded-xl border shadow-sm hover:shadow-md transition-all flex items-center ${
                  isSelected ? 'border-amber-400 bg-amber-50/30' : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                {/* Checkbox */}
                <button
                  onClick={e => selectMode && toggleSelect(quote.id, e)}
                  className="pl-4 py-4 flex-shrink-0"
                >
                  {selectMode
                    ? isSelected
                      ? <CheckSquare size={16} className="text-amber-500" />
                      : <Square size={16} className="text-slate-300 group-hover:text-slate-400 transition-colors" />
                    : <span className="w-4 block" />}
                </button>

                {/* Main content */}
                <div
                  className="flex-1 min-w-0 p-4 flex flex-col sm:flex-row sm:items-center gap-3 cursor-pointer"
                  onClick={() => selectMode ? toggleSelect(quote.id, { stopPropagation: () => {} }) : navigate(`/quotes/${quote.id}`)}
                >
                  {/* Icon */}
                  <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
                    <FileText size={18} className="text-amber-600" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className="font-semibold text-sm text-slate-800 group-hover:text-amber-600 transition-colors">
                        {cust?.name || 'Unknown Customer'}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">{quote.quoteNumber}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colorClass}`}>{quote.status}</span>
                      {/* Tracking badges */}
                      {(() => {
                        const isLive = quote.customerLastSeenAt &&
                          differenceInSeconds(new Date(), new Date(quote.customerLastSeenAt)) < 90;
                        if (isLive) return (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 animate-pulse">
                            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> Viewing now
                          </span>
                        );
                        if (quote.viewCount > 0) return (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 flex items-center gap-1">
                            <Eye size={10} /> Viewed {quote.viewCount}×
                          </span>
                        );
                        if (quote.firstOpenedAt) return (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-sky-50 text-sky-600 flex items-center gap-1">
                            <Eye size={10} /> Opened
                          </span>
                        );
                        if (quote.sentAt) return (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 flex items-center gap-1">
                            <Eye size={10} /> Not opened
                          </span>
                        );
                        return null;
                      })()}
                      {isOverdue && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-600 flex items-center gap-1">
                          <AlertCircle size={10} /> Overdue
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-600 font-medium truncate mb-1">{quote.title}</p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-400">
                      {quote.siteAddress && <span className="truncate max-w-[200px]">{quote.siteAddress}</span>}
                      <span>{reqCount} item{reqCount !== 1 ? 's' : ''}{optCount > 0 ? ` + ${optCount} optional` : ''}</span>
                      {quote.salesperson && <span>👤 {quote.salesperson}</span>}
                      {quote.sentAt && <span>Sent {format(parseISO(quote.sentAt), 'd MMM')}</span>}
                      {quote.firstOpenedAt && <span>Opened {format(parseISO(quote.firstOpenedAt), 'd MMM')}</span>}
                      {quote.expiryDate && <span>Exp. {format(new Date(quote.expiryDate), 'd MMM yyyy')}</span>}
                    </div>
                  </div>

                  {/* Total */}
                  {!selectMode && (
                    <div className="text-right flex-shrink-0">
                      <p className="text-lg font-bold text-slate-900">{fmt(total)}</p>
                      <p className="text-xs text-slate-400">inc. GST</p>
                    </div>
                  )}
                </div>

                {/* Quick actions — hidden in select mode */}
                {!selectMode && (
                  <div className="flex items-center gap-1 flex-shrink-0 pr-2" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => navigate(`/quotes/${quote.id}`)}
                      title="View"
                      className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    ><Eye size={15} /></button>
                    <button
                      onClick={() => navigate(`/quotes/${quote.id}/edit`)}
                      title="Edit"
                      className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                    ><Edit3 size={15} /></button>
                    <div className="relative">
                      <button
                        onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId === quote.id ? null : quote.id); }}
                        className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                      ><MoreHorizontal size={15} /></button>
                      {openMenuId === quote.id && (
                        <div
                          className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl border border-slate-200 shadow-xl z-20 py-1"
                          onClick={e => e.stopPropagation()}
                        >
                          {quote.status === 'Draft' && (
                            <button onClick={() => { handleSend(quote); setOpenMenuId(null); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-amber-50 hover:text-amber-700">
                              <Send size={13} /> Send Quote
                            </button>
                          )}
                          <button onClick={() => window.open(`/quotes/${quote.id}/preview?preview=1`, '_blank')}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">
                            <Eye size={13} /> Customer Preview
                          </button>
                          <button onClick={() => { handleDuplicate(quote); setOpenMenuId(null); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50">
                            <Copy size={13} /> Duplicate
                          </button>
                          <div className="border-t border-slate-100 my-1" />
                          <button onClick={() => { handleDelete(quote); setOpenMenuId(null); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50">
                            <XCircle size={13} /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Per-row delete in select mode */}
                {selectMode && (
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteTarget(quote.id); }}
                    className="pr-4 py-4 flex-shrink-0 text-slate-300 hover:text-red-500 transition-colors"
                    title="Delete quote"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation modal */}
      {deleteTarget && (
        <DeleteModal
          count={targetIds.length}
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {/* Toast */}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
