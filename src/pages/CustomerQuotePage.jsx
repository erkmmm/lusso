import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { format, parseISO, isPast } from 'date-fns';
import { CheckCircle2, XCircle, MapPin, Phone, Mail, AlertCircle, ShieldCheck, Printer } from 'lucide-react';
import {
  getQuote, getCustomer, getQuoteSettings,
  computeQuoteTotals, calcItemPricing, markQuoteViewed, acceptQuote, declineQuote,
} from '../store/data';
import { supabase } from '../lib/supabase';
import { useQuoteTracking } from '../hooks/useQuoteTracking';

const fmt = (n) => `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (d) => { try { return format(d instanceof Date ? d : parseISO(d), 'd MMMM yyyy'); } catch { return ''; } };

// ─── Print-only document layout ───────────────────────────────────────────────
function PrintDocument({ quote, customer, settings, totals }) {
  const termsText = quote.termsAndConditions || settings.defaultTerms || '';

  const requiredItems = quote.lineItems.filter(li => li.type === 'Required');
  const locations = [...new Set(requiredItems.map(li => li.location || 'General'))];

  const docStyle = {
    fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
    color: '#1a2332',
    fontSize: '11pt',
    lineHeight: '1.5',
    background: '#fff',
  };
  const tealBox = {
    background: '#e8f4f8',
    borderRadius: '6px',
    padding: '14px 18px',
  };
  const label = { fontSize: '8pt', fontWeight: '600', color: '#6b7c93', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' };
  const value = { fontSize: '10.5pt', color: '#1a2332', fontWeight: '400' };

  return (
    <div className="print-only" style={docStyle}>

      {/* ── Document header ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', borderBottom: '2px solid #c8d8e8', paddingBottom: '16px' }}>
        {/* Brand */}
        <div>
          <img src={`${window.location.origin}/brand/lusso-black.png`} alt="Lusso" style={{ height: '38px', width: 'auto', display: 'block', marginBottom: '4px' }} />
          <div style={{ fontSize: '9pt', color: '#c68a2a', fontWeight: '600', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Fashion for Windows</div>
        </div>
        {/* Quote meta */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '14pt', fontWeight: '700', color: '#1a2332' }}>QUOTATION</div>
          <div style={{ marginTop: '6px', color: '#4a5568', fontSize: '9.5pt', lineHeight: '1.8' }}>
            <div><span style={{ color: '#6b7c93', fontWeight: '600' }}>Quote No. </span>{quote.quoteNumber}</div>
            <div><span style={{ color: '#6b7c93', fontWeight: '600' }}>Date: </span>{fmtDate(quote.createdAt)}</div>
            {quote.expiryDate && <div><span style={{ color: '#6b7c93', fontWeight: '600' }}>Expires: </span>{fmtDate(new Date(quote.expiryDate))}</div>}
            {quote.salesperson && <div><span style={{ color: '#6b7c93', fontWeight: '600' }}>Prepared by: </span>{quote.salesperson}</div>}
          </div>
        </div>
      </div>

      {/* ── From / To ────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '20px' }}>
        {/* Business details */}
        <div style={tealBox}>
          <div style={label}>From</div>
          <div style={{ fontWeight: '700', fontSize: '11pt', marginBottom: '4px' }}>{settings.businessName}</div>
          {settings.businessPhone && <div style={value}><span style={{ color: '#6b7c93' }}>Phone: </span>{settings.businessPhone}</div>}
          {settings.businessEmail && <div style={value}><span style={{ color: '#6b7c93' }}>Email: </span>{settings.businessEmail}</div>}
        </div>
        {/* Customer details */}
        <div style={tealBox}>
          <div style={label}>Prepared for</div>
          <div style={{ fontWeight: '700', fontSize: '11pt', marginBottom: '4px' }}>{customer?.name || 'Valued Customer'}</div>
          {customer?.address  && <div style={value}>{customer.address}</div>}
          {customer?.email    && <div style={value}><span style={{ color: '#6b7c93' }}>Email: </span>{customer.email}</div>}
          {customer?.phone    && <div style={value}><span style={{ color: '#6b7c93' }}>Phone: </span>{customer.phone}</div>}
          {quote.siteAddress  && customer?.address !== quote.siteAddress && (
            <div style={{ marginTop: '4px', ...value }}><span style={{ color: '#6b7c93' }}>Site: </span>{quote.siteAddress}</div>
          )}
        </div>
      </div>

      {/* ── Quote title / project ────────────────────────────────────────── */}
      {(quote.title || quote.introMessage) && (
        <div style={{ marginBottom: '18px', background: '#f7fafc', border: '1px solid #c8d8e8', borderRadius: '6px', padding: '12px 16px' }}>
          {quote.title && <div style={{ fontWeight: '700', fontSize: '11.5pt', color: '#1a2332', marginBottom: quote.introMessage ? '6px' : '0' }}>{quote.title}</div>}
          {quote.introMessage && <div style={{ fontSize: '10pt', color: '#4a5568', lineHeight: '1.6' }}>{quote.introMessage}</div>}
        </div>
      )}

      {/* ── Line items ───────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '20px' }}>
        {/* Table header */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 60pt 70pt 70pt', gap: '8px', background: '#1a2332', color: '#fff', padding: '7px 12px', borderRadius: '5px 5px 0 0', fontSize: '8.5pt', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          <div>Product / Description</div>
          <div style={{ textAlign: 'center' }}>Qty</div>
          <div style={{ textAlign: 'right' }}>Unit Price</div>
          <div style={{ textAlign: 'right' }}>Total</div>
        </div>

        {locations.map((loc, li) => {
          const locItems = requiredItems.filter(item => (item.location || 'General') === loc);
          return (
            <div key={loc} style={{ breakInside: 'avoid' }}>
              {/* Location row */}
              <div style={{ background: '#e8f4f8', padding: '6px 12px', fontSize: '8.5pt', fontWeight: '700', color: '#1a5c7a', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #c8d8e8', borderTop: li === 0 ? 'none' : '1px solid #c8d8e8' }}>
                {loc}
              </div>
              {locItems.map((item, idx) => {
                const { finalSell, lineTotal } = calcItemPricing(item.unitCostPrice, item.labourCost, item.marginPercent, item.manualSellPrice, item.quantity);
                const isLast = idx === locItems.length - 1;
                return (
                  <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '1fr 60pt 70pt 70pt', gap: '8px', padding: '8px 12px', borderBottom: isLast ? '1px solid #c8d8e8' : '1px solid #eef2f7', alignItems: 'start', breakInside: 'avoid' }}>
                    <div>
                      <div style={{ fontWeight: '600', fontSize: '10pt', color: '#1a2332', marginBottom: '2px' }}>
                        {item.productNameSnapshot || 'Window Treatment'}
                      </div>
                      {item.type === 'Part' && item.description && (
                        <div style={{ fontSize: '9pt', color: '#5a6a7a', lineHeight: '1.4', marginBottom: '2px' }}>{item.description}</div>
                      )}
                      <div style={{ fontSize: '8.5pt', color: '#8a9aaa', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                        {quote.showSizesToClient && item.widthMm && <span>{item.widthMm} × {item.dropMm}mm</span>}
                        {item.fabricColour      && <span><strong style={{color:'#6b7280'}}>Fabric:</strong> {item.fabricColour}</span>}
                        {item.control          && <span><strong style={{color:'#6b7280'}}>Control:</strong> {item.control}</span>}
                        {item.returnSide       && <span><strong style={{color:'#6b7280'}}>Operation side:</strong> {item.returnSide}</span>}
                        {item.fixing           && <span><strong style={{color:'#6b7280'}}>Fixing:</strong> {item.fixing}</span>}
                        {item.heading          && <span><strong style={{color:'#6b7280'}}>Heading:</strong> {item.heading}</span>}
                        {item.hem              && <span><strong style={{color:'#6b7280'}}>Hem:</strong> {item.hem}</span>}
                        {item.chainColour      && <span><strong style={{color:'#6b7280'}}>Chain:</strong> {item.chainColour}</span>}
                        {item.trackColour        && <span><strong style={{color:'#6b7280'}}>Track colour:</strong> {item.trackColour}</span>}
                        {item.baseBarColour      && <span><strong style={{color:'#6b7280'}}>Bottom rail colour:</strong> {item.baseBarColour}</span>}
                        {item.baseBarType        && <span><strong style={{color:'#6b7280'}}>Bottom rail type:</strong> {item.baseBarType}</span>}
                        {item.motorSide        && <span><strong style={{color:'#6b7280'}}>Motor side:</strong> {item.motorSide}</span>}
                        {item.customerNotes    && <span style={{ fontStyle: 'italic' }}>{item.customerNotes}</span>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'center', fontSize: '10pt', color: '#4a5568', paddingTop: '1px' }}>{item.quantity}</div>
                    <div style={{ textAlign: 'right', fontSize: '10pt', color: '#4a5568', paddingTop: '1px' }}>{fmt(finalSell)}</div>
                    <div style={{ textAlign: 'right', fontSize: '10.5pt', fontWeight: '600', color: '#1a2332', paddingTop: '1px' }}>{fmt(lineTotal)}</div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* ── Totals ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '20px' }}>
        <div style={{ ...tealBox, minWidth: '220pt' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '10pt', color: '#4a5568' }}>
            <span>Subtotal (excl. GST)</span>
            <span style={{ fontWeight: '600' }}>{fmt(totals.subtotal)}</span>
          </div>
          {quote.includesGST && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '10pt', color: '#4a5568' }}>
              <span>GST ({quote.gstRate || 10}%)</span>
              <span style={{ fontWeight: '600' }}>{fmt(totals.gst)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '2px solid #c8d8e8', paddingTop: '8px', fontSize: '13pt', fontWeight: '800', color: '#1a2332' }}>
            <span>Total AUD</span>
            <span>{fmt(totals.total)}</span>
          </div>
          {totals.deposit > 0 && (
            <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #c8d8e8', fontSize: '9.5pt', color: '#c68a2a', fontWeight: '600', display: 'flex', justifyContent: 'space-between' }}>
              <span>Deposit Required ({quote.depositType === 'Percentage' ? `${quote.depositValue}%` : 'Fixed'})</span>
              <span>{fmt(totals.deposit)}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── To place your order ──────────────────────────────────────────── */}
      <div style={{ marginBottom: '16px', background: '#f7fafc', border: '1px solid #c8d8e8', borderRadius: '6px', padding: '14px 16px' }}>
        <div style={{ fontWeight: '700', fontSize: '11pt', color: '#1a2332', marginBottom: '8px' }}>To Place Your Order</div>
        <div style={{ fontSize: '10pt', color: '#4a5568', lineHeight: '1.6' }}>
          To accept this quote, please contact us by phone or email, or visit the online link provided.
          {totals.deposit > 0 && <span> A deposit of {quote.depositType === 'Percentage' ? `${quote.depositValue}%` : fmt(totals.deposit)} ({fmt(totals.deposit)}) is required to confirm your order.</span>}
        </div>
        <div style={{ marginTop: '8px', fontSize: '10pt', color: '#4a5568', lineHeight: '1.6' }}>
          <span style={{ fontWeight: '600' }}>Terms of Trade: </span>Orders for custom-built products cannot be cancelled once placed.
        </div>
      </div>

      {/* ── Terms ────────────────────────────────────────────────────────── */}
      {termsText && (
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontWeight: '700', fontSize: '10pt', color: '#1a2332', marginBottom: '6px' }}>Terms &amp; Conditions</div>
          <div style={{ fontSize: '9pt', color: '#5a6a7a', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>{termsText}</div>
        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div style={{ borderTop: '1px solid #c8d8e8', paddingTop: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '8.5pt', color: '#8a9aaa' }}>
        <div>
          <span style={{ fontWeight: '700', color: '#4a5568' }}>{settings.businessName}</span>
          {settings.businessPhone && <span>  ·  {settings.businessPhone}</span>}
          {settings.businessEmail && <span>  ·  {settings.businessEmail}</span>}
        </div>
        <div>Quote {quote.quoteNumber}  ·  Valid until {quote.expiryDate ? fmtDate(new Date(quote.expiryDate)) : 'further notice'}</div>
      </div>
    </div>
  );
}

// ─── Main customer-facing page ────────────────────────────────────────────────
export default function CustomerQuotePage() {
  const { id }          = useParams();
  const [searchParams]  = useSearchParams();
  // ?preview=1 is appended by all internal staff links — skip tracking & status changes
  const isStaffPreview  = searchParams.get('preview') === '1';
  const settings = getQuoteSettings();

  const [quote, setQuote] = useState(() => {
    const q = getQuote(id);
    // Only mark as viewed if a real customer is opening it, not a staff preview
    if (!isStaffPreview && q && ['Sent', 'Viewed'].includes(q.status)) markQuoteViewed(id);
    return getQuote(id);
  });
  const [selectedOptionals, setSelectedOptionals] = useState([]);
  const [showAcceptModal, setShowAcceptModal]     = useState(false);
  const [showDeclineModal, setShowDeclineModal]   = useState(false);
  const [acceptForm, setAcceptForm]               = useState({ name: '', email: '', agreed: false });
  const [declineReason, setDeclineReason]         = useState('');
  const [done, setDone]                           = useState(null);

  // ── Fetch from Supabase if not in localStorage (customer on a different device) ──
  useEffect(() => {
    if (quote || !supabase || !id) return;
    // Read via SECURITY DEFINER RPC (anon has no direct table access — this
    // returns only the single quote for this id, so quotes can't be enumerated).
    supabase.rpc('get_public_quote', { p_id: id }).maybeSingle()
      .then(({ data, error }) => {
        if (!error && data) {
          // Convert snake_case keys to camelCase for local use
          const camel = Object.fromEntries(
            Object.entries(data).map(([k, v]) => [
              k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v
            ])
          );
          setQuote(camel);
        }
      });
  }, [id, quote]);

  // ── Quote tracking (open, heartbeat) ───────────────────────────────────────
  // Completely disabled for staff preview — pass null so no RPC is called
  const isFirstOpen = !quote?.firstOpenedAt;
  const { trackAccept, trackDecline } = useQuoteTracking(
    (!isStaffPreview && quote) ? id : null,
    isFirstOpen
  );

  if (!quote) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-4xl font-bold text-slate-200 mb-3">404</p>
          <p className="text-slate-500">Quote not found or has been removed.</p>
        </div>
      </div>
    );
  }

  if (done === 'accepted') {
    return (
      <div className="min-h-screen bg-emerald-50 flex items-center justify-center p-6 screen-only">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={32} className="text-green-500" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">You're all confirmed!</h1>
          <p className="text-slate-700 font-medium mb-1">Thanks, {acceptForm.name || 'valued customer'} — we're thrilled you chose us.</p>
          <p className="text-slate-500 text-sm">Our team will be in touch within one business day to arrange your deposit and confirm your order.</p>
          <div className="mt-5 p-4 bg-slate-50 rounded-xl text-left text-sm text-slate-600 space-y-1">
            <p><span className="font-medium">Quote:</span> {quote.quoteNumber}</p>
            <p><span className="font-medium">Confirmed by:</span> {acceptForm.name}</p>
            <p><span className="font-medium">Date:</span> {format(new Date(), "d MMM yyyy 'at' h:mm a")}</p>
          </div>
          <p className="text-xs text-slate-400 mt-4">Keep this page as a reference until you hear from us.</p>
          <div className="mt-4 text-sm text-slate-500 space-y-0.5">
            <p>{settings.businessPhone}</p>
            <p>{settings.businessEmail}</p>
          </div>
        </div>
      </div>
    );
  }

  if (done === 'declined') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 screen-only">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <XCircle size={32} className="text-slate-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Thanks for letting us know.</h1>
          <p className="text-slate-500 text-sm">We appreciate you taking the time to consider us. If you'd like to revisit the quote or discuss any changes, we're always happy to chat.</p>
          <div className="mt-4 text-sm text-slate-500 space-y-0.5">
            <p>{settings.businessPhone}</p>
            <p>{settings.businessEmail}</p>
          </div>
        </div>
      </div>
    );
  }

  const customer  = getCustomer(quote.customerId);
  const isExpired = quote.expiryDate && isPast(new Date(quote.expiryDate));
  const isLocked  = ['Accepted', 'Declined', 'Expired'].includes(quote.status) || isExpired;

  const totals = computeQuoteTotals(
    quote.lineItems, quote.depositType, quote.depositValue, quote.gstRate, quote.includesGST, selectedOptionals
  );

  const toggleOptional = (itemId) => {
    setSelectedOptionals(prev => prev.includes(itemId) ? prev.filter(x => x !== itemId) : [...prev, itemId]);
  };

  const handleAccept = async () => {
    if (!acceptForm.agreed || !acceptForm.name.trim()) return;
    // Write to Supabase via tracking function (creates notification + updates status)
    await trackAccept(acceptForm.name, acceptForm.email);
    // Also update localStorage so internal app sees it immediately
    acceptQuote(quote.id, { name: acceptForm.name, email: acceptForm.email });
    setDone('accepted');
    setShowAcceptModal(false);
  };
  const handleDecline = async () => {
    await trackDecline(declineReason);
    declineQuote(quote.id, declineReason);
    setDone('declined');
    setShowDeclineModal(false);
  };

  const locations     = [...new Set(quote.lineItems.map(li => li.location || 'General'))];
  const optionalItems = quote.lineItems.filter(li => li.type === 'Optional');
  const choiceGroups  = {};
  quote.lineItems.filter(li => li.type === 'Multiple Choice').forEach(li => {
    const grp = li.choiceGroupId || '__default__';
    if (!choiceGroups[grp]) choiceGroups[grp] = [];
    choiceGroups[grp].push(li);
  });

  return (
    <div className="min-h-screen bg-slate-100">

      {/* ── Staff preview banner ─────────────────────────────────────────── */}
      {isStaffPreview && (
        <div className="sticky top-0 z-50 w-full bg-amber-500 text-white text-xs font-semibold text-center py-2 px-4 flex items-center justify-center gap-2 no-print">
          <ShieldCheck size={13} />
          Staff preview — this is how the customer will see this quote. No tracking or status changes are recorded.
        </div>
      )}

      {/* ── Print document (hidden on screen) ───────────────────────────── */}
      <PrintDocument quote={quote} customer={customer} settings={settings} totals={totals} />

      {/* ── Screen view ─────────────────────────────────────────────────── */}
      <div className="screen-only">

      {/* Sticky header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 no-print">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-sm">L</span>
            </div>
            <div>
              <p className="font-bold text-slate-900 text-sm leading-tight">{settings.businessName}</p>
              {settings.businessPhone && <p className="text-xs text-slate-400">{settings.businessPhone}</p>}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-xs text-slate-400">Quote No.</p>
              <p className="font-bold text-slate-800 text-sm">{quote.quoteNumber}</p>
            </div>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 text-xs font-medium text-slate-600 border border-slate-200 hover:bg-slate-50 px-3 py-2 rounded-lg transition-colors"
            >
              <Printer size={13} /> Save PDF
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-4">

        {/* Status banners */}
        {isExpired && !['Accepted','Declined'].includes(quote.status) && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle size={16} className="text-orange-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-orange-800">This quote has expired</p>
              <p className="text-xs text-orange-700 mt-0.5">Prices may have changed — get in touch and we'll put together an updated quote for you.</p>
            </div>
          </div>
        )}
        {quote.status === 'Accepted' && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-start gap-3">
            <CheckCircle2 size={16} className="text-green-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-green-800">Order confirmed — you're all set!</p>
              <p className="text-xs text-green-700 mt-0.5">We've received your acceptance and our team will be in touch shortly.</p>
            </div>
          </div>
        )}
        {quote.status === 'Declined' && (
          <div className="bg-slate-100 border border-slate-200 rounded-xl p-4 flex items-start gap-3">
            <XCircle size={16} className="text-slate-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-slate-600">You've passed on this one — no worries at all.</p>
              <p className="text-xs text-slate-500 mt-0.5">If anything changes or you'd like to revisit, we're always happy to chat.</p>
            </div>
          </div>
        )}

        {/* ── Quote hero card ──────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {/* Top bar */}
          <div className="flex items-center justify-between px-6 pt-6 pb-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h1 className="text-xl font-bold text-slate-900">{quote.title || 'Window Treatment Quote'}</h1>
              </div>
              {quote.siteAddress && (
                <p className="text-slate-500 text-sm flex items-center gap-1.5">
                  <MapPin size={12} className="flex-shrink-0" />{quote.siteAddress}
                </p>
              )}
            </div>
            <div className="text-right flex-shrink-0 ml-4">
              <p className="text-3xl font-bold text-slate-900">{fmt(totals.total)}</p>
              <p className="text-xs text-slate-400 mt-0.5">Total inc. GST</p>
              {totals.deposit > 0 && (
                <p className="text-sm text-amber-600 font-semibold mt-1">Deposit: {fmt(totals.deposit)}</p>
              )}
            </div>
          </div>

          {/* From / To grid */}
          <div className="grid sm:grid-cols-2 gap-3 px-6 pb-4">
            {/* Business details */}
            <div className="bg-sky-50 border border-sky-100 rounded-xl p-4">
              <p className="text-[10px] font-bold text-sky-500 uppercase tracking-widest mb-2">From</p>
              <p className="font-bold text-slate-800 text-sm">{settings.businessName}</p>
              {settings.businessPhone && (
                <p className="text-slate-500 text-xs mt-1 flex items-center gap-1.5"><Phone size={10} />{settings.businessPhone}</p>
              )}
              {settings.businessEmail && (
                <p className="text-slate-500 text-xs flex items-center gap-1.5 mt-0.5"><Mail size={10} />{settings.businessEmail}</p>
              )}
            </div>
            {/* Customer details */}
            <div className="bg-sky-50 border border-sky-100 rounded-xl p-4">
              <p className="text-[10px] font-bold text-sky-500 uppercase tracking-widest mb-2">Prepared For</p>
              <p className="font-bold text-slate-800 text-sm">{customer?.name || 'Valued Customer'}</p>
              {customer?.address && <p className="text-slate-500 text-xs mt-1 flex items-start gap-1.5"><MapPin size={10} className="mt-0.5 flex-shrink-0" />{customer.address}</p>}
              {customer?.phone && <p className="text-slate-500 text-xs flex items-center gap-1.5 mt-0.5"><Phone size={10} />{customer.phone}</p>}
              {customer?.email && <p className="text-slate-500 text-xs flex items-center gap-1.5 mt-0.5"><Mail size={10} />{customer.email}</p>}
            </div>
          </div>

          {/* Quote meta strip */}
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-400 border-t border-slate-100 px-6 py-3 bg-slate-50">
            <span>Date: <span className="text-slate-600 font-medium">{fmtDate(quote.createdAt)}</span></span>
            {quote.expiryDate && <span>Valid until: <span className="text-slate-600 font-medium">{fmtDate(new Date(quote.expiryDate))}</span></span>}
            {quote.salesperson && <span>Prepared by: <span className="text-slate-600 font-medium">{quote.salesperson}</span></span>}
            <span>Quote: <span className="text-slate-600 font-medium">{quote.quoteNumber}</span></span>
          </div>
        </div>

        {/* ── Intro ────────────────────────────────────────────────────── */}
        {quote.introMessage && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-6 py-5">
            <p className="text-slate-700 text-sm leading-relaxed">{quote.introMessage}</p>
          </div>
        )}

        {/* ── Required line items ──────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-bold text-slate-800">What's Included</h2>
            <p className="text-xs text-slate-400">{quote.lineItems.filter(li => li.type === 'Required').length} item{quote.lineItems.filter(li => li.type === 'Required').length !== 1 ? 's' : ''}</p>
          </div>

          {/* Table header */}
          <div className="hidden sm:grid grid-cols-[1fr_52px_80px_80px] gap-3 px-6 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
            <div>Product / Description</div>
            <div className="text-center">Qty</div>
            <div className="text-right">Unit</div>
            <div className="text-right">Total</div>
          </div>

          {locations.map(loc => {
            const items = quote.lineItems.filter(li => (li.location || 'General') === loc && li.type === 'Required');
            if (!items.length) return null;
            return (
              <div key={loc}>
                {/* Location header */}
                <div className="px-6 py-2.5 bg-sky-50 border-y border-sky-100">
                  <p className="text-[10px] font-bold text-sky-600 uppercase tracking-widest">{loc}</p>
                </div>
                {items.map(item => {
                  const { finalSell, lineTotal } = calcItemPricing(item.unitCostPrice, item.labourCost, item.marginPercent, item.manualSellPrice, item.quantity);
                  return (
                    <div key={item.id} className="border-b border-slate-100 last:border-b-0">
                      {/* Desktop row */}
                      <div className="hidden sm:grid grid-cols-[1fr_52px_80px_80px] gap-3 px-6 py-4 items-start hover:bg-slate-50 transition-colors">
                        <div>
                          <p className="font-semibold text-slate-800 text-sm mb-0.5">{item.productNameSnapshot || 'Window Treatment'}</p>
                          {item.type === 'Part' && item.description && <p className="text-xs text-slate-500 leading-relaxed mb-1">{item.description}</p>}
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                            {quote.showSizesToClient && item.widthMm && <span>{item.widthMm} × {item.dropMm}mm</span>}
                            {item.fabricColour       && <span><span className="font-medium text-slate-500">Fabric:</span> {item.fabricColour}</span>}
                            {item.control            && <span><span className="font-medium text-slate-500">Control:</span> {item.control}</span>}
                            {item.returnSide         && <span><span className="font-medium text-slate-500">Operation side:</span> {item.returnSide}</span>}
                            {item.fixing             && <span><span className="font-medium text-slate-500">Fixing:</span> {item.fixing}</span>}
                            {item.heading            && <span><span className="font-medium text-slate-500">Heading:</span> {item.heading}</span>}
                            {item.hem                && <span><span className="font-medium text-slate-500">Hem:</span> {item.hem}</span>}
                            {item.chainColour        && <span><span className="font-medium text-slate-500">Chain:</span> {item.chainColour}</span>}
                            {item.trackColour        && <span><span className="font-medium text-slate-500">Track colour:</span> {item.trackColour}</span>}
                            {item.baseBarColour      && <span><span className="font-medium text-slate-500">Bottom rail colour:</span> {item.baseBarColour}</span>}
                            {item.baseBarType        && <span><span className="font-medium text-slate-500">Bottom rail type:</span> {item.baseBarType}</span>}
                            {item.motorSide          && <span><span className="font-medium text-slate-500">Motor side:</span> {item.motorSide}</span>}
                            {item.customerNotes      && <span className="italic">{item.customerNotes}</span>}
                          </div>
                        </div>
                        <div className="text-center text-sm text-slate-600 pt-0.5">{item.quantity}</div>
                        <div className="text-right text-sm text-slate-600 pt-0.5">{fmt(finalSell)}</div>
                        <div className="text-right font-bold text-slate-900">{fmt(lineTotal)}</div>
                      </div>
                      {/* Mobile row */}
                      <div className="sm:hidden px-4 py-4 flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-800 text-sm mb-0.5">{item.productNameSnapshot || 'Window Treatment'}</p>
                          {item.type === 'Part' && item.description && <p className="text-xs text-slate-500 leading-relaxed">{item.description}</p>}
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400 mt-1">
                            {quote.showSizesToClient && item.widthMm && <span>{item.widthMm} × {item.dropMm}mm</span>}
                            {item.fabricColour       && <span><span className="font-medium text-slate-500">Fabric:</span> {item.fabricColour}</span>}
                            {item.control            && <span><span className="font-medium text-slate-500">Control:</span> {item.control}</span>}
                            {item.returnSide         && <span><span className="font-medium text-slate-500">Operation side:</span> {item.returnSide}</span>}
                            {item.fixing             && <span><span className="font-medium text-slate-500">Fixing:</span> {item.fixing}</span>}
                            {item.heading            && <span><span className="font-medium text-slate-500">Heading:</span> {item.heading}</span>}
                            {item.hem                && <span><span className="font-medium text-slate-500">Hem:</span> {item.hem}</span>}
                            {item.quantity > 1       && <span>Qty: {item.quantity}</span>}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-bold text-slate-900 text-sm">{fmt(lineTotal)}</p>
                          {item.quantity > 1 && <p className="text-[11px] text-slate-400">{fmt(finalSell)} × {item.quantity}</p>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* ── Optional add-ons ─────────────────────────────────────────── */}
        {optionalItems.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-amber-100 bg-amber-50">
              <h2 className="font-bold text-amber-800 text-sm">Optional Extras</h2>
              <p className="text-xs text-amber-600 mt-0.5">A few finishing touches worth considering — tick anything you'd like added to your order</p>
            </div>
            <div className="divide-y divide-slate-100">
              {optionalItems.map(item => {
                const { finalSell, lineTotal } = calcItemPricing(item.unitCostPrice, item.labourCost, item.marginPercent, item.manualSellPrice, item.quantity);
                const selected = selectedOptionals.includes(item.id);
                return (
                  <label key={item.id}
                    className={`flex items-start gap-4 px-6 py-4 cursor-pointer transition-colors ${selected ? 'bg-amber-50/50' : 'hover:bg-slate-50'} ${isLocked ? 'pointer-events-none opacity-60' : ''}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleOptional(item.id)} disabled={isLocked}
                      className="mt-0.5 w-4 h-4 accent-amber-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-800 text-sm">{item.productNameSnapshot}</p>
                      {item.type === 'Part' && item.description && item.productNameSnapshot && <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>}
                      {item.location && <p className="text-xs text-slate-400 mt-0.5">{item.location}</p>}
                      {item.customerNotes && <p className="text-xs text-slate-500 italic mt-1">{item.customerNotes}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`font-bold text-sm ${selected ? 'text-amber-600' : 'text-slate-700'}`}>+ {fmt(lineTotal)}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Multiple choice groups ───────────────────────────────────── */}
        {Object.entries(choiceGroups).map(([groupId, items]) => (
          <div key={groupId} className="bg-white rounded-2xl shadow-sm border border-purple-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-purple-100 bg-purple-50">
              <h2 className="font-bold text-purple-800 text-sm">Pick Your Preference</h2>
              <p className="text-xs text-purple-600 mt-0.5">Choose the option that works best for your space — only one applies to your total</p>
            </div>
            <div className="divide-y divide-slate-100">
              {items.map(item => {
                const { lineTotal } = calcItemPricing(item.unitCostPrice, item.labourCost, item.marginPercent, item.manualSellPrice, item.quantity);
                const isSelected = selectedOptionals.includes(item.id);
                const handleChoice = () => {
                  const otherIds = items.filter(i => i.id !== item.id).map(i => i.id);
                  setSelectedOptionals(prev => {
                    const without = prev.filter(xid => !otherIds.includes(xid));
                    return isSelected ? without.filter(xid => xid !== item.id) : [...without, item.id];
                  });
                };
                return (
                  <label key={item.id}
                    className={`flex items-start gap-4 px-6 py-4 cursor-pointer transition-colors ${isSelected ? 'bg-purple-50/50' : 'hover:bg-slate-50'} ${isLocked ? 'pointer-events-none opacity-60' : ''}`}>
                    <input type="radio" name={`choice-${groupId}`} checked={isSelected} onChange={handleChoice}
                      className="mt-0.5 w-4 h-4 accent-purple-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-800 text-sm">{item.productNameSnapshot}</p>
                      {item.type === 'Part' && item.description && item.productNameSnapshot && <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>}
                      {item.customerNotes && <p className="text-xs text-slate-500 italic mt-1">{item.customerNotes}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`font-bold text-sm ${isSelected ? 'text-purple-600' : 'text-slate-700'}`}>{fmt(lineTotal)}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ))}

        {/* ── Totals ───────────────────────────────────────────────────── */}
        <div className="flex justify-end">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden w-full sm:w-80">
            <div className="bg-sky-50 border-b border-sky-100 px-5 py-3">
              <h2 className="font-bold text-slate-700 text-sm">Your Investment</h2>
            </div>
            <div className="px-5 py-4 space-y-2.5">
              <div className="flex justify-between text-sm text-slate-600">
                <span>Subtotal (excl. GST)</span>
                <span className="font-medium">{fmt(totals.subtotal)}</span>
              </div>
              {quote.includesGST && (
                <div className="flex justify-between text-sm text-slate-600">
                  <span>GST ({quote.gstRate || 10}%)</span>
                  <span className="font-medium">{fmt(totals.gst)}</span>
                </div>
              )}
              <div className="flex justify-between text-lg font-bold text-slate-900 pt-2.5 border-t border-slate-200">
                <span>Total inc. GST</span>
                <span>{fmt(totals.total)}</span>
              </div>
              {totals.deposit > 0 && (
                <div className="mt-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex justify-between text-sm font-semibold text-amber-700">
                  <span>Deposit to Confirm</span>
                  <span>{fmt(totals.deposit)}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Terms ────────────────────────────────────────────────────── */}
        {(quote.termsAndConditions || settings.defaultTerms) && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 px-6 py-5">
            <h2 className="font-bold text-slate-800 text-sm mb-3">Terms &amp; Conditions</h2>
            <p className="text-xs text-slate-500 whitespace-pre-wrap leading-relaxed">
              {quote.termsAndConditions || settings.defaultTerms}
            </p>
          </div>
        )}

        {/* ── Accept / Decline ─────────────────────────────────────────── */}
        {!isLocked && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <p className="text-sm text-slate-600 font-medium text-center mb-1">Happy with what you see?</p>
            <p className="text-xs text-slate-400 text-center mb-4">Let us know below and we'll take it from here.</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button onClick={() => setShowAcceptModal(true)}
                className="flex-1 flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 text-white font-bold py-3.5 px-6 rounded-xl transition-colors text-sm">
                <CheckCircle2 size={17} /> Yes, Let's Go Ahead
              </button>
              <button onClick={() => setShowDeclineModal(true)}
                className="flex items-center justify-center gap-2 border border-slate-200 text-slate-500 hover:bg-slate-50 font-medium py-3.5 px-6 rounded-xl transition-colors text-sm">
                <XCircle size={16} /> Not This Time
              </button>
            </div>
          </div>
        )}

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div className="text-center text-sm text-slate-400 pb-6 pt-2">
          <p className="font-semibold text-slate-600 mb-1">{settings.businessName}</p>
          <div className="flex items-center justify-center gap-5 text-xs">
            {settings.businessPhone && <span className="flex items-center gap-1.5"><Phone size={11} />{settings.businessPhone}</span>}
            {settings.businessEmail && <span className="flex items-center gap-1.5"><Mail size={11} />{settings.businessEmail}</span>}
          </div>
          <p className="text-[11px] mt-2 text-slate-300">Quote {quote.quoteNumber}</p>
        </div>
      </main>

      {/* ── Accept Modal ─────────────────────────────────────────────────── */}
      {showAcceptModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                <CheckCircle2 size={20} className="text-green-600" />
              </div>
              <div>
                <h2 className="font-bold text-slate-900">Confirm Your Order</h2>
                <p className="text-xs text-slate-500">{quote.quoteNumber} · {fmt(totals.total)}</p>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Your Full Name *</label>
                <input
                  value={acceptForm.name}
                  onChange={e => setAcceptForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Enter your full name"
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Email Address <span className="font-normal text-slate-400">(optional — for your confirmation copy)</span></label>
                <input
                  value={acceptForm.email}
                  onChange={e => setAcceptForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="your@email.com"
                  type="email"
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                />
              </div>
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" checked={acceptForm.agreed}
                  onChange={e => setAcceptForm(f => ({ ...f, agreed: e.target.checked }))}
                  className="mt-0.5 w-4 h-4 accent-green-500 flex-shrink-0" />
                <span className="text-xs text-slate-600 leading-relaxed">
                  I've reviewed this quote and agree to proceed on these terms.{totals.deposit > 0 && <> I understand a deposit of{' '}
                  {quote.depositType === 'Percentage' ? `${quote.depositValue}%` : fmt(quote.depositValue)} ({fmt(totals.deposit)}) will be required to get things moving.</>}
                </span>
              </label>
              <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2">
                <ShieldCheck size={13} className="text-green-500 flex-shrink-0" />
                <span>Your confirmation is securely recorded with your name, date, and time.</span>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAcceptModal(false)}
                className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 py-2.5 rounded-xl text-sm font-medium transition-colors">
                Go Back
              </button>
              <button onClick={handleAccept} disabled={!acceptForm.agreed || !acceptForm.name.trim()}
                className="flex-1 bg-green-500 hover:bg-green-400 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-bold transition-colors">
                Confirm Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Decline Modal ────────────────────────────────────────────────── */}
      {showDeclineModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="font-bold text-slate-900 mb-1">No worries — thanks for letting us know</h2>
            <p className="text-sm text-slate-500 mb-4">If anything wasn't quite right, we'd love to hear it. Your feedback helps us put together better quotes in future.</p>
            <textarea
              value={declineReason}
              onChange={e => setDeclineReason(e.target.value)}
              placeholder="Optional: anything you'd like to share? (pricing, timing, product, other)"
              rows={3}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => setShowDeclineModal(false)}
                className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 py-2.5 rounded-xl text-sm font-medium transition-colors">
                Go Back
              </button>
              <button onClick={handleDecline}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2.5 rounded-xl text-sm font-bold transition-colors">
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

      </div>{/* end screen-only */}
    </div>
  );
}
