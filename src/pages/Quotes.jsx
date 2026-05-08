import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FileText, Search, X, Eye, Edit3, Copy, Send, CheckCircle2, XCircle, MoreHorizontal, TrendingUp, Clock, DollarSign, ChevronRight, AlertCircle } from 'lucide-react';
import { format, parseISO, isPast } from 'date-fns';
import {
  getQuotes, getCustomers, QUOTE_STATUSES, QUOTE_STATUS_COLORS,
  computeQuoteTotals, sendQuote, duplicateQuote, deleteQuote,
} from '../store/data';
import EmptyState from '../components/EmptyState';
import Card from '../components/Card';

const fmt = (n) => `$${Math.round(n).toLocaleString('en-AU')}`;

const STATUS_TABS = ['All', ...QUOTE_STATUSES];

export default function Quotes() {
  const navigate = useNavigate();
  const [search, setSearch]           = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [openMenuId, setOpenMenuId]   = useState(null);
  const [quotes, setQuotes]           = useState(getQuotes);
  const customers                     = getCustomers();

  const refresh = () => setQuotes(getQuotes());

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

  const handleSend = (q) => {
    sendQuote(q.id, 'Admin');
    refresh();
  };
  const handleDuplicate = (q) => {
    duplicateQuote(q.id);
    refresh();
  };
  const handleDelete = (q) => {
    if (confirm(`Delete ${q.quoteNumber}? This cannot be undone.`)) {
      deleteQuote(q.id);
      refresh();
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5" onClick={() => setOpenMenuId(null)}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Quotes</h1>
          <p className="text-slate-500 text-sm mt-0.5">{filtered.length} quote{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button
          onClick={() => navigate('/quotes/new')}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors self-start"
        >
          <Plus size={16} /> New Quote
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Pipeline',   value: fmt(stats.allTotal),      sub: `${stats.total} quotes`,       icon: DollarSign,   color: 'text-slate-600 bg-slate-100' },
          { label: 'In Progress',      value: stats.inProgress,          sub: 'sent / viewed',               icon: Clock,        color: 'text-blue-600 bg-blue-50' },
          { label: 'Accepted',         value: stats.accepted,            sub: 'quotes won',                  icon: CheckCircle2, color: 'text-green-600 bg-green-50' },
          { label: 'Accepted Value',   value: fmt(stats.acceptedTotal),  sub: 'total won',                   icon: TrendingUp,   color: 'text-amber-600 bg-amber-50' },
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
          {filtered.map(quote => {
            const cust     = customers.find(c => c.id === quote.customerId);
            const { total } = computeQuoteTotals(quote.lineItems, quote.depositType, quote.depositValue, quote.gstRate, quote.includesGST);
            const colorClass = QUOTE_STATUS_COLORS[quote.status] || QUOTE_STATUS_COLORS.Draft;
            const isOverdue  = quote.expiryDate && isPast(new Date(quote.expiryDate)) && !['Accepted', 'Declined', 'Completed', 'Expired'].includes(quote.status);
            const reqCount   = quote.lineItems.filter(li => li.type === 'Required').length;
            const optCount   = quote.lineItems.filter(li => li.type !== 'Required').length;

            return (
              <div key={quote.id} className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all group">
                <div className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                  {/* Icon */}
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-50 to-amber-100 flex items-center justify-center flex-shrink-0">
                    <FileText size={18} className="text-amber-600" />
                  </div>

                  {/* Main info — clickable */}
                  <button
                    className="flex-1 min-w-0 text-left"
                    onClick={() => navigate(`/quotes/${quote.id}`)}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-0.5">
                      <span className="font-semibold text-sm text-slate-800 group-hover:text-amber-600 transition-colors">
                        {cust?.name || 'Unknown Customer'}
                      </span>
                      <span className="text-xs text-slate-400 font-mono">{quote.quoteNumber}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${colorClass}`}>{quote.status}</span>
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
                      {quote.viewedAt && <span>Viewed {format(parseISO(quote.viewedAt), 'd MMM')}</span>}
                      {quote.expiryDate && <span>Exp. {format(new Date(quote.expiryDate), 'd MMM yyyy')}</span>}
                    </div>
                  </button>

                  {/* Total */}
                  <div className="text-right flex-shrink-0">
                    <p className="text-lg font-bold text-slate-900">{fmt(total)}</p>
                    <p className="text-xs text-slate-400">inc. GST</p>
                  </div>

                  {/* Quick actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
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
                    {/* More menu */}
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
                          <button onClick={() => navigate(`/quotes/${quote.id}/preview`)}
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
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}