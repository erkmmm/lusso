import { useDataRefresh } from '../hooks/useDataRefresh';
import { toast } from '../components/ToastContainer';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { format, parseISO, formatDistanceToNow, isPast, differenceInSeconds } from 'date-fns';
import {
  Edit3, Copy, Send, Eye, CheckCircle2, XCircle,
  User, MapPin, FileText, Clock, MessageSquare, Lock,
  ChevronDown, ChevronUp, Briefcase, Phone, Mail, AlertCircle,
  Activity, Wifi, X, ExternalLink, RefreshCw, Loader,
} from 'lucide-react';
import {
  getQuote, getCustomer, getJob,
  QUOTE_STATUS_COLORS, computeQuoteTotals, calcItemPricing,
  sendQuote, duplicateQuote, acceptQuote, declineQuote,
  addQuoteComment, updateQuoteXeroInvoice, getMessagePresets,
} from '../store/data';
import Card from '../components/Card';
import { sendQuoteEmail } from '../lib/email';
import { supabase } from '../lib/supabase';
import { xeroCreateInvoice, xeroSyncInvoice, xeroInvoiceStatusBadge } from '../lib/xero';

// ── Live threshold: consider "viewing now" if heartbeat within 90s ────────────
const LIVE_THRESHOLD_S = 90;

const fmt = (n) => `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ACTIVITY_META = {
  created:           { emoji: '📄', label: 'Created' },
  edited:            { emoji: '✏️',  label: 'Edited' },
  sent:              { emoji: '📨', label: 'Sent' },
  viewed:            { emoji: '👁️', label: 'Viewed' },
  accepted:          { emoji: '✅', label: 'Accepted' },
  declined:          { emoji: '❌', label: 'Declined' },
  expired:           { emoji: '⏰', label: 'Expired' },
  commented:         { emoji: '💬', label: 'Comment' },
  followed_up:       { emoji: '📞', label: 'Follow-up' },
  deposit_requested: { emoji: '💰', label: 'Deposit' },
};

const TABS = ['Details', 'Activity', 'Comments'];

export default function QuoteView() {
  const { id }   = useParams();
  const navigate = useNavigate();

  // ── MUST be before any conditional return — React hooks must always run ───────
  useDataRefresh();
  const refresh = () => window.dispatchEvent(new CustomEvent('lusso:data-changed'));

  const quote = getQuote(id); // read directly so re-renders always get fresh data
  const [tab, setTab]             = useState('Details');
  const [commentText, setComment] = useState('');
  const [commentType, setCommentType] = useState('internal');
  const [expandedItems, setExpandedItems] = useState(new Set());

  // ── Live tracking state (from Supabase, fresher than localStorage) ──────────
  const [liveData, setLiveData]   = useState(null); // { firstOpenedAt, lastViewedAt, viewCount, customerLastSeenAt }
  const [activities, setActivities] = useState([]);
  const liveTimerRef              = useRef(null);
  const [, forceRender]           = useState(0);    // re-render ticker for live badge

  // Fetch fresh tracking data + subscribe to realtime
  useEffect(() => {
    if (!supabase || !id) return;

    const fetchTracking = async () => {
      const [{ data: qData }, { data: evData }] = await Promise.all([
        supabase.from('quotes').select('first_opened_at,last_viewed_at,view_count,customer_last_seen_at,decline_reason').eq('id', id).single(),
        supabase.from('quote_activity_events').select('*').eq('quote_id', id).order('created_at', { ascending: false }).limit(50),
      ]);
      if (qData) setLiveData(qData);
      if (evData) setActivities(evData);
    };
    fetchTracking();

    // Re-render every 10s so the "X seconds ago" live badge stays accurate
    liveTimerRef.current = setInterval(() => forceRender(n => n + 1), 10_000);

    // Realtime: watch this specific quote row for tracking updates
    const channel = supabase
      .channel(`quote-tracking-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'quotes', filter: `id=eq.${id}` },
        (payload) => {
          const d = payload.new;
          setLiveData({
            first_opened_at:      d.first_opened_at,
            last_viewed_at:       d.last_viewed_at,
            view_count:           d.view_count,
            customer_last_seen_at: d.customer_last_seen_at,
            decline_reason:       d.decline_reason,
          });
          // Fire data-changed so the quote is re-read on next render
          window.dispatchEvent(new CustomEvent('lusso:data-changed'));
        })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'quote_activity_events', filter: `quote_id=eq.${id}` },
        (payload) => {
          setActivities(prev => [payload.new, ...prev]);
        })
      .subscribe();

    return () => {
      clearInterval(liveTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [id]);

  if (!quote) {
    return (
      <div className="p-6 text-center">
        <p className="text-slate-500">Quote not found.</p>
      </div>
    );
  }

  // ── Derived tracking values ───────────────────────────────────────────────
  const tracking = liveData || {};
  const isLiveNow = tracking.customer_last_seen_at &&
    differenceInSeconds(new Date(), new Date(tracking.customer_last_seen_at)) < LIVE_THRESHOLD_S;

  const customer   = getCustomer(quote.customerId);
  const job        = quote.jobId ? getJob(quote.jobId) : null;
  const totals     = computeQuoteTotals(quote.lineItems, quote.depositType, quote.depositValue, quote.gstRate, quote.includesGST);
  const colorClass = QUOTE_STATUS_COLORS[quote.status] || QUOTE_STATUS_COLORS.Draft;
  const isOverdue  = quote.expiryDate && isPast(new Date(quote.expiryDate)) && !['Accepted','Declined','Completed','Expired'].includes(quote.status);

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);
  const handleSend = useCallback(async () => {
    if (!customer?.email) {
      setSendError('This customer has no email address on file. Please add an email to the customer record first.');
      return;
    }
    if (!window.confirm(`Send quote ${quote.quoteNumber || ''} to ${customer.email}?`)) return;
    setSending(true);
    setSendError(null);
    try {
      await sendQuoteEmail(quote, customer, getMessagePresets().quoteEmailIntro);
      sendQuote(quote.id, 'Admin');
      refresh();
      toast(`Quote ${quote.quoteNumber || ''} sent to ${customer.email}.`);
    } catch (err) {
      console.error('[QuoteView] Send quote error:', err);
      setSendError(err.message || 'Failed to send quote email. Please try again.');
    } finally {
      setSending(false);
    }
  }, [quote, customer, refresh]);
  const handleDuplicate = () => {
    const dupe = duplicateQuote(quote.id);
    navigate(`/quotes/${dupe.id}/edit`);
  };
  const handleAccept = () => {
    if (window.confirm('Mark this quote as Accepted?')) {
      acceptQuote(quote.id, { name: customer?.name, email: customer?.email }); refresh();
    }
  };
  const handleDecline = () => {
    if (window.confirm('Mark this quote as Declined?')) {
      declineQuote(quote.id, ''); refresh();
    }
  };
  const handleAddComment = () => {
    if (!commentText.trim()) return;
    addQuoteComment(quote.id, commentType, commentType === 'internal' ? 'Admin' : (customer?.name || 'Customer'), commentText.trim());
    setComment(''); refresh();
  };

  const toggleItem = (itemId) => setExpandedItems(prev => {
    const next = new Set(prev);
    if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
    return next;
  });

  // ── Xero invoice ─────────────────────────────────────────────────────────────
  const [xeroWorking, setXeroWorking] = useState(false);
  const [xeroError, setXeroError]     = useState(null);

  const handleCreateXeroInvoice = async () => {
    if (!window.confirm('Create a Xero invoice for this quote?')) return;
    setXeroWorking(true);
    setXeroError(null);
    try {
      const result = await xeroCreateInvoice(quote.id);
      updateQuoteXeroInvoice(quote.id, {
        xeroInvoiceId:        result.xeroInvoiceId,
        xeroInvoiceNumber:    result.xeroInvoiceNumber,
        xeroInvoiceStatus:    result.xeroInvoiceStatus,
        xeroInvoiceUrl:       result.xeroInvoiceUrl,
        xeroInvoiceCreatedAt: new Date().toISOString(),
      });
      refresh();
      toast(`Xero invoice ${result.xeroInvoiceNumber} created.`);
    } catch (err) {
      setXeroError(err.message);
      toast(err.message, 'error');
    } finally {
      setXeroWorking(false);
    }
  };

  const handleSyncXeroInvoice = async () => {
    setXeroWorking(true);
    setXeroError(null);
    try {
      const result = await xeroSyncInvoice(quote.id);
      updateQuoteXeroInvoice(quote.id, { xeroInvoiceStatus: result.xeroInvoiceStatus });
      refresh();
      toast('Invoice status synced from Xero.');
    } catch (err) {
      setXeroError(err.message);
    } finally {
      setXeroWorking(false);
    }
  };

  const locations = [...new Set(quote.lineItems.map(li => li.location || 'Unspecified'))];

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5 overflow-x-hidden">
      {/* Back */}

      {/* Send error / success banner */}
      {sendError && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertCircle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-700">Failed to send email</p>
            <p className="text-xs text-red-600 mt-0.5">{sendError}</p>
          </div>
          <button onClick={() => setSendError(null)} className="text-red-400 hover:text-red-600 flex-shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Header card */}
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h1 className="text-xl font-bold text-slate-900">{customer?.name || 'Unknown Customer'}</h1>
              <span className="text-sm text-slate-400 font-mono">{quote.quoteNumber}</span>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${colorClass}`}>{quote.status}</span>
              {isLiveNow && (
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-700 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                  Viewing now
                </span>
              )}
              {isOverdue && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-600 flex items-center gap-1">
                  <AlertCircle size={10} /> Overdue
                </span>
              )}
            </div>
            <p className="text-slate-700 font-medium mb-1">{quote.title}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
              {quote.siteAddress && <span className="flex items-center gap-1.5"><MapPin size={12} />{quote.siteAddress}</span>}
              {quote.salesperson && <span className="flex items-center gap-1.5"><User size={12} />{quote.salesperson}</span>}
            </div>
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-400">
              <span>Created {format(parseISO(quote.createdAt), 'd MMM yyyy')}</span>
              {quote.sentAt && <span>Sent {format(parseISO(quote.sentAt), 'd MMM yyyy')}</span>}
              {quote.viewedAt && <span>Viewed {format(parseISO(quote.viewedAt), 'd MMM yyyy')}</span>}
              {quote.expiryDate && <span>Expires {format(new Date(quote.expiryDate), 'd MMM yyyy')}</span>}
            </div>
          </div>

          <div className="flex flex-col items-start sm:items-end gap-3 sm:flex-shrink-0">
            <div className="sm:text-right">
              <p className="text-2xl sm:text-3xl font-bold text-slate-900">{fmt(totals.total)}</p>
              <p className="text-xs text-slate-400">Total inc. GST</p>
              {totals.deposit > 0 && (
                <p className="text-xs text-amber-600 mt-0.5 font-medium">Deposit: {fmt(totals.deposit)}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2 justify-start sm:justify-end">
              {quote.status === 'Draft' && (
                <button onClick={handleSend} disabled={sending}
                  className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-60 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors">
                  <Send size={13} /> {sending ? 'Sending…' : 'Send Quote'}
                </button>
              )}
              <button onClick={() => navigate(`/quotes/${quote.id}/edit`)}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">
                <Edit3 size={13} /> Edit
              </button>
              <button onClick={() => window.open(`/quotes/${quote.id}/preview?preview=1`, '_blank')}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">
                <Eye size={13} /> Preview
              </button>
              <button onClick={handleDuplicate}
                className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50">
                <Copy size={13} /> Duplicate
              </button>
            </div>
            {!['Accepted','Declined','Completed'].includes(quote.status) && (
              <div className="flex flex-wrap gap-2">
                <button onClick={handleAccept}
                  className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-green-200 text-green-700 hover:bg-green-50">
                  <CheckCircle2 size={12} /> Mark Accepted
                </button>
                <button onClick={handleDecline}
                  className="flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50">
                  <XCircle size={12} /> Mark Declined
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Accepted banner */}
        {quote.status === 'Accepted' && quote.acceptedBy && (
          <div className="mt-4 p-3 bg-green-50 rounded-xl border border-green-100 flex items-center gap-3">
            <CheckCircle2 size={18} className="text-green-600 flex-shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium text-green-800">
                Accepted by {quote.acceptedBy.name}
                {quote.acceptedBy.email && ` (${quote.acceptedBy.email})`}
              </p>
              {quote.acceptedAt && (
                <p className="text-xs text-green-600">{format(parseISO(quote.acceptedAt), "d MMM yyyy 'at' h:mm a")}</p>
              )}
            </div>
            <Lock size={14} className="text-green-500 flex-shrink-0" />
          </div>
        )}

        {/* ── Xero invoice panel (shown for Accepted quotes) ─────────────── */}
        {quote.status === 'Accepted' && (
          <div className={`mt-4 rounded-xl border px-4 py-3 ${quote.xeroInvoiceId ? 'bg-[#13B5EA]/5 border-[#13B5EA]/20' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-md bg-[#13B5EA]/15 flex items-center justify-center flex-shrink-0">
                  <span className="text-[#13B5EA] font-black text-xs">X</span>
                </span>
                {quote.xeroInvoiceId ? (
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-800">
                        Xero Invoice {quote.xeroInvoiceNumber}
                      </span>
                      {quote.xeroInvoiceStatus && (() => {
                        const badge = xeroInvoiceStatusBadge(quote.xeroInvoiceStatus);
                        return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${badge.color}`}>{badge.label}</span>;
                      })()}
                    </div>
                    {quote.xeroInvoiceCreatedAt && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        Created {format(parseISO(quote.xeroInvoiceCreatedAt), 'd MMM yyyy')}
                        {quote.xeroInvoiceCreatedBy && ` by ${quote.xeroInvoiceCreatedBy}`}
                        {quote.xeroLastSyncedAt && ` · Synced ${format(parseISO(quote.xeroLastSyncedAt), 'd MMM h:mm a')}`}
                      </p>
                    )}
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-medium text-slate-700">No Xero invoice yet</p>
                    <p className="text-xs text-slate-400">Create an invoice in Xero from this accepted quote.</p>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                {xeroError && (
                  <p className="text-xs text-red-500 max-w-[200px] truncate" title={xeroError}>{xeroError}</p>
                )}
                {quote.xeroInvoiceId ? (
                  <>
                    {quote.xeroInvoiceUrl && (
                      <a
                        href={quote.xeroInvoiceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-xs font-medium text-[#13B5EA] hover:underline"
                      >
                        Open in Xero <ExternalLink size={11} />
                      </a>
                    )}
                    <button
                      onClick={handleSyncXeroInvoice}
                      disabled={xeroWorking}
                      className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700 border border-slate-200 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg transition-colors"
                    >
                      {xeroWorking ? <Loader size={11} className="animate-spin" /> : <RefreshCw size={11} />} Sync
                    </button>
                  </>
                ) : (
                  <button
                    onClick={handleCreateXeroInvoice}
                    disabled={xeroWorking}
                    className="flex items-center gap-1.5 text-xs font-semibold bg-[#13B5EA] hover:bg-[#0ea5d9] disabled:opacity-60 text-white px-3 py-1.5 rounded-lg transition-colors"
                  >
                    {xeroWorking ? <Loader size={11} className="animate-spin" /> : <span className="font-black">X</span>}
                    {xeroWorking ? 'Creating…' : 'Create Invoice'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t ? 'border-amber-500 text-amber-600' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}>
            {t}
            {t === 'Comments' && (quote.comments?.length || 0) > 0 && (
              <span className="ml-1.5 text-xs bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full">{quote.comments.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab: Details ─────────────────────────────────────────────── */}
      {tab === 'Details' && (
        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            {/* Line items */}
            <Card>
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                  <FileText size={15} /> Line Items ({quote.lineItems.length})
                </h2>
              </div>
              <div className="divide-y divide-slate-100">
                {locations.map(loc => {
                  const items = quote.lineItems.filter(li => (li.location || 'Unspecified') === loc);
                  return (
                    <div key={loc}>
                      <div className="px-5 py-2.5 bg-slate-50">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{loc}</p>
                      </div>
                      {items.map(item => {
                        const { finalSell, lineTotal, totalCost, grossProfit, gpPercent } = calcItemPricing(
                          item.unitCostPrice, item.labourCost, item.marginPercent, item.manualSellPrice, item.quantity
                        );
                        const isExp = expandedItems.has(item.id);
                        return (
                          <div key={item.id} className="px-5 py-4">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                                  <span className="font-medium text-slate-800 text-sm">{item.productNameSnapshot || '—'}</span>
                                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                    item.type === 'Required' ? 'bg-slate-100 text-slate-600'
                                    : item.type === 'Optional' ? 'bg-amber-100 text-amber-700'
                                    : 'bg-purple-100 text-purple-700'
                                  }`}>{item.type}</span>
                                </div>
                                {item.description && <p className="text-xs text-slate-500 mb-1">{item.description}</p>}
                                <div className="flex flex-wrap gap-x-3 text-xs text-slate-400">
                                  {item.widthMm && <span>{item.widthMm}×{item.dropMm}mm</span>}
                                  {item.fabricColour && <span>{item.fabricColour}</span>}
                                  {item.quantity > 1 && <span>Qty: {item.quantity}</span>}
                                  {item.fixing && <span>{item.fixing} fix</span>}
                                  {item.heading && <span>{item.heading}</span>}
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <p className="font-semibold text-slate-800">{fmt(lineTotal)}</p>
                                {item.quantity > 1 && <p className="text-xs text-slate-400">{fmt(finalSell)} ea</p>}
                                <p className="text-xs text-green-600 font-medium">GP {gpPercent.toFixed(0)}%</p>
                              </div>
                            </div>
                            <button onClick={() => toggleItem(item.id)}
                              className="mt-2 text-xs text-slate-400 hover:text-amber-600 flex items-center gap-1">
                              {isExp ? <><ChevronUp size={12}/>Hide specs</> : <><ChevronDown size={12}/>Show specs</>}
                            </button>
                            {isExp && (
                              <div className="mt-2 space-y-2">
                                {/* Specs grid */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-slate-50 rounded-xl px-3 py-2.5 text-xs">
                                  {[
                                    ['Width × Drop', item.widthMm ? `${item.widthMm}×${item.dropMm}mm` : null],
                                    ['Control', item.control], ['Return', item.returnSide],
                                    ['Motor Side', item.motorSide], ['Fixing', item.fixing],
                                    ['Heading', item.heading], ['Hem', item.hem],
                                    ['Track Colour', item.trackColour || item.trackBaseBarColour], ['Bottom Rail Colour', item.baseBarColour], ['Bottom Rail Type', item.baseBarType],
                                    ['Chain Colour', item.chainColour], ['Supplier', item.supplier],
                                  ].filter(([,v]) => v).map(([lbl, val]) => (
                                    <div key={lbl}><dt className="text-slate-400">{lbl}</dt><dd className="font-medium text-slate-700">{val}</dd></div>
                                  ))}
                                  {item.customerNotes && (
                                    <div className="col-span-2 sm:col-span-4">
                                      <dt className="text-slate-400">Customer Notes</dt>
                                      <dd className="font-medium text-slate-700">{item.customerNotes}</dd>
                                    </div>
                                  )}
                                  {item.internalNotes && (
                                    <div className="col-span-2 sm:col-span-4 bg-yellow-50 rounded-lg px-2 py-1">
                                      <dt className="text-yellow-600">🔒 Internal Note</dt>
                                      <dd className="font-medium text-yellow-800">{item.internalNotes}</dd>
                                    </div>
                                  )}
                                </div>
                                {/* Internal pricing breakdown */}
                                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 bg-sidebar rounded-xl px-3 py-2.5 text-xs text-slate-300">
                                  <div><dt className="text-slate-500">Material Cost</dt><dd className="font-medium text-white">{fmt(Number(item.unitCostPrice)||0)}</dd></div>
                                  <div><dt className="text-slate-500">Labour Cost</dt><dd className="font-medium text-white">{fmt(Number(item.labourCost)||0)}</dd></div>
                                  <div><dt className="text-slate-500">Total Cost (ea)</dt><dd className="font-medium text-white">{fmt(totalCost)}</dd></div>
                                  <div><dt className="text-slate-500">Sell Price (ea)</dt><dd className="font-medium text-amber-300">{fmt(finalSell)}</dd></div>
                                  <div><dt className="text-slate-500">GP 🔒</dt><dd className={`font-semibold ${grossProfit >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmt(grossProfit)} ({gpPercent.toFixed(0)}%)</dd></div>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              {/* Totals footer */}
              <div className="px-5 py-4 border-t border-slate-100 bg-slate-50 space-y-1.5">
                <div className="flex justify-between text-sm text-slate-600">
                  <span>Subtotal (excl. GST)</span><span>{fmt(totals.subtotal)}</span>
                </div>
                {quote.includesGST && (
                  <div className="flex justify-between text-sm text-slate-600">
                    <span>GST ({quote.gstRate}%)</span><span>{fmt(totals.gst)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold text-slate-900 pt-1 border-t border-slate-200">
                  <span>Total</span><span>{fmt(totals.total)}</span>
                </div>
                {totals.deposit > 0 && (
                  <div className="flex justify-between text-sm text-amber-700 font-medium">
                    <span>Deposit ({quote.depositType === 'Percentage' ? `${quote.depositValue}%` : 'Fixed'})</span>
                    <span>{fmt(totals.deposit)}</span>
                  </div>
                )}
              </div>
            </Card>

            {/* Intro */}
            {quote.introMessage && (
              <Card>
                <div className="px-5 py-4 border-b border-slate-100">
                  <h2 className="font-semibold text-slate-800 text-sm">Introduction Message</h2>
                </div>
                <div className="p-5">
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{quote.introMessage}</p>
                </div>
              </Card>
            )}

            {/* Terms */}
            {quote.termsAndConditions && (
              <Card>
                <div className="px-5 py-4 border-b border-slate-100">
                  <h2 className="font-semibold text-slate-800 text-sm">Terms & Conditions</h2>
                </div>
                <div className="p-5">
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{quote.termsAndConditions}</p>
                </div>
              </Card>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-5">

            {/* ── Customer Activity card ── */}
            <Card>
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                  <Activity size={15} className="text-amber-500" /> Customer Activity
                </h2>
              </div>
              <div className="p-5 space-y-3">
                {/* Live now */}
                {isLiveNow && (
                  <div className="flex items-center gap-2 p-2.5 bg-green-50 rounded-xl border border-green-100">
                    <Wifi size={14} className="text-green-600 flex-shrink-0 animate-pulse" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-green-700">Viewing now</p>
                      <p className="text-xs text-green-500">
                        Active {formatDistanceToNow(new Date(tracking.customer_last_seen_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                )}

                {/* Stats grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-50 rounded-lg p-2.5">
                    <p className="text-slate-400 mb-0.5">First opened</p>
                    <p className="font-medium text-slate-700">
                      {tracking.first_opened_at
                        ? format(parseISO(tracking.first_opened_at), 'd MMM, h:mm a')
                        : quote.firstOpenedAt
                          ? format(parseISO(quote.firstOpenedAt), 'd MMM, h:mm a')
                          : <span className="text-slate-400 italic">Not yet</span>}
                    </p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2.5">
                    <p className="text-slate-400 mb-0.5">Last viewed</p>
                    <p className="font-medium text-slate-700">
                      {tracking.last_viewed_at
                        ? formatDistanceToNow(parseISO(tracking.last_viewed_at), { addSuffix: true })
                        : <span className="text-slate-400 italic">—</span>}
                    </p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2.5 col-span-2">
                    <p className="text-slate-400 mb-0.5">View count</p>
                    <p className="font-semibold text-slate-800 text-base">
                      {tracking.view_count ?? quote.viewCount ?? 0}
                      <span className="text-xs text-slate-400 font-normal ml-1">times</span>
                    </p>
                  </div>
                </div>

                {/* Decline reason */}
                {(tracking.decline_reason || quote.declineReason) && (
                  <div className="p-2.5 bg-red-50 rounded-xl border border-red-100">
                    <p className="text-xs font-semibold text-red-600 mb-1">Decline reason</p>
                    <p className="text-xs text-red-700">{tracking.decline_reason || quote.declineReason}</p>
                  </div>
                )}

                {!tracking.first_opened_at && !quote.firstOpenedAt && !quote.sentAt && (
                  <p className="text-xs text-slate-400 italic text-center py-1">Quote not yet sent to customer.</p>
                )}
              </div>
            </Card>

            <Card>
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><User size={15} /> Customer</h2>
              </div>
              <div className="p-5 space-y-2 text-sm">
                <p className="font-semibold text-slate-800">{customer?.name || '—'}</p>
                {customer?.phone && <p className="text-slate-500 flex items-center gap-1.5"><Phone size={12} />{customer.phone}</p>}
                {customer?.email && <p className="text-slate-500 flex items-center gap-1.5"><Mail size={12} />{customer.email}</p>}
                {quote.siteAddress && <p className="text-slate-500 flex items-center gap-1.5"><MapPin size={12} />{quote.siteAddress}</p>}
                {customer && (
                  <button onClick={() => navigate(`/customers/${customer.id}`)} className="text-xs text-amber-600 hover:underline">View customer →</button>
                )}
              </div>
            </Card>

            <Card>
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><Briefcase size={15} /> Job</h2>
              </div>
              <div className="p-5 text-sm">
                {job ? (
                  <div className="space-y-1">
                    <p className="text-xs text-slate-400">{job.jobNumber}</p>
                    <p className="font-medium text-slate-700">{job.title}</p>
                    <button onClick={() => navigate(`/jobs/${job.id}`)} className="text-xs text-amber-600 hover:underline">View job →</button>
                  </div>
                ) : (
                  <p className="text-slate-400 text-xs">Not linked to a job.</p>
                )}
              </div>
            </Card>

            {quote.internalNotes && (
              <Card>
                <div className="px-5 py-4 border-b border-slate-100">
                  <h2 className="font-semibold text-slate-800 text-sm">Internal Notes</h2>
                </div>
                <div className="p-5">
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{quote.internalNotes}</p>
                </div>
              </Card>
            )}

            {quote.status === 'Accepted' && (
              <Card>
                <div className="px-5 py-4 border-b border-slate-100">
                  <h2 className="font-semibold text-slate-800 text-sm">Next Steps</h2>
                </div>
                <div className="p-5 space-y-2">
                  {[
                    { label: '📩 Request Deposit', to: null },
                    { label: '📦 Order Products', to: job ? `/jobs/${job.id}` : '/jobs' },
                    { label: '📅 Book Installation', to: '/calendar' },
                  ].map(({ label, to }) => (
                    <button key={label} onClick={() => to && navigate(to)}
                      className="w-full text-left text-sm px-3 py-2 rounded-lg border border-slate-200 hover:border-amber-300 hover:bg-amber-50 transition-colors text-slate-700">
                      {label}
                    </button>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* ── Tab: Activity ─────────────────────────────────────────────── */}
      {tab === 'Activity' && (
        <div className="space-y-5">
          {/* Customer tracking events */}
          {activities.length > 0 && (
            <Card>
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
                  <Activity size={15} className="text-amber-500" /> Customer Activity
                </h2>
              </div>
              <div className="p-5">
                <div className="space-y-3">
                  {activities.map((ev) => {
                    const icons = {
                      quote_first_opened: '👁️',
                      quote_viewed:       '🔄',
                      quote_accepted:     '✅',
                      quote_declined:     '❌',
                    };
                    const labels = {
                      quote_first_opened: 'Opened for the first time',
                      quote_viewed:       'Viewed again',
                      quote_accepted:     `Accepted${ev.metadata?.name ? ` by ${ev.metadata.name}` : ''}`,
                      quote_declined:     `Declined${ev.metadata?.reason ? `: ${ev.metadata.reason}` : ''}`,
                    };
                    return (
                      <div key={ev.id} className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 text-sm">
                          {icons[ev.event_type] || '📋'}
                        </div>
                        <div className="flex-1 pt-0.5">
                          <p className="text-sm text-slate-700">{labels[ev.event_type] || ev.event_type}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {formatDistanceToNow(parseISO(ev.created_at), { addSuffix: true })}
                            {' · '}{format(parseISO(ev.created_at), 'd MMM yyyy, h:mm a')}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Card>
          )}

          {/* Internal activity log */}
          <Card>
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><Clock size={15} /> Internal Log</h2>
            </div>
            <div className="p-5">
              {!quote.activity?.length ? (
                <p className="text-sm text-slate-400 text-center py-4">No internal activity recorded.</p>
              ) : (
                <div className="space-y-4">
                  {quote.activity.map((act, i) => {
                    const meta = ACTIVITY_META[act.type] || { emoji: '📋' };
                    return (
                      <div key={act.id || i} className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0 text-sm">{meta.emoji}</div>
                        <div className="flex-1 pt-0.5">
                          <p className="text-sm text-slate-700">{act.note}</p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {act.user} · {formatDistanceToNow(parseISO(act.createdAt), { addSuffix: true })}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>

          {activities.length === 0 && !quote.activity?.length && (
            <p className="text-sm text-slate-400 text-center py-4">No activity recorded yet.</p>
          )}
        </div>
      )}

      {/* ── Tab: Comments ─────────────────────────────────────────────── */}
      {tab === 'Comments' && (
        <Card>
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2"><MessageSquare size={15} /> Comments & Notes</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {!quote.comments?.length ? (
              <p className="text-sm text-slate-400 text-center py-8">No comments yet.</p>
            ) : (
              quote.comments.map(c => (
                <div key={c.id} className={`p-5 ${c.type === 'internal' ? 'bg-yellow-50/40' : ''}`}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                      c.type === 'internal' ? 'bg-yellow-200 text-yellow-800' : 'bg-blue-100 text-blue-700'
                    }`}>{c.author?.[0]?.toUpperCase() || '?'}</div>
                    <span className="text-sm font-medium text-slate-800">{c.author}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      c.type === 'internal' ? 'bg-yellow-100 text-yellow-700' : 'bg-blue-100 text-blue-700'
                    }`}>{c.type === 'internal' ? '🔒 Internal' : '💬 Customer'}</span>
                    <span className="text-xs text-slate-400 ml-auto">
                      {formatDistanceToNow(parseISO(c.createdAt), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 ml-8">{c.message}</p>
                </div>
              ))
            )}
          </div>
          <div className="p-5 border-t border-slate-100 space-y-3">
            <div className="flex gap-2">
              {['internal', 'customer'].map(t => (
                <button key={t} onClick={() => setCommentType(t)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    commentType === t ? 'bg-amber-500 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}>
                  {t === 'internal' ? '🔒 Internal note' : '💬 Customer visible'}
                </button>
              ))}
            </div>
            <textarea
              value={commentText}
              onChange={e => setComment(e.target.value)}
              placeholder={commentType === 'internal' ? 'Add an internal note (not visible to customer)…' : 'Add a message visible to the customer…'}
              rows={3}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
            />
            <div className="flex justify-end">
              <button onClick={handleAddComment} disabled={!commentText.trim()}
                className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
                Add Note
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
