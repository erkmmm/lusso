import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { format, parseISO, isPast } from 'date-fns';
import { CheckCircle2, XCircle, MapPin, Phone, Mail, AlertCircle, ShieldCheck } from 'lucide-react';
import {
  getQuote, getCustomer, getQuoteSettings,
  computeQuoteTotals, calcItemPricing, markQuoteViewed, acceptQuote, declineQuote,
} from '../store/data';

const fmt = (n) => `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CustomerQuotePage() {
  const { id }  = useParams();
  const settings = getQuoteSettings();

  const [quote, setQuote] = useState(() => {
    const q = getQuote(id);
    if (q && ['Sent', 'Viewed'].includes(q.status)) markQuoteViewed(id);
    return getQuote(id);
  });
  const [selectedOptionals, setSelectedOptionals] = useState([]);
  const [showAcceptModal, setShowAcceptModal]     = useState(false);
  const [showDeclineModal, setShowDeclineModal]   = useState(false);
  const [acceptForm, setAcceptForm]               = useState({ name: '', email: '', agreed: false });
  const [declineReason, setDeclineReason]         = useState('');
  const [done, setDone]                           = useState(null);

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
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={32} className="text-green-500" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Quote Accepted!</h1>
          <p className="text-slate-600 mb-1">Thank you, {acceptForm.name || 'valued customer'}.</p>
          <p className="text-slate-500 text-sm">We'll be in touch shortly to arrange next steps.</p>
          <div className="mt-5 p-4 bg-slate-50 rounded-xl text-left text-sm text-slate-600 space-y-1">
            <p><span className="font-medium">Quote:</span> {quote.quoteNumber}</p>
            <p><span className="font-medium">Accepted by:</span> {acceptForm.name}</p>
            <p><span className="font-medium">Date:</span> {format(new Date(), "d MMM yyyy 'at' h:mm a")}</p>
          </div>
          <p className="text-xs text-slate-400 mt-4">You can close this page. Our team will contact you soon.</p>
          <div className="mt-4 text-sm text-slate-500">
            <p>{settings.businessPhone}</p>
            <p>{settings.businessEmail}</p>
          </div>
        </div>
      </div>
    );
  }

  if (done === 'declined') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <XCircle size={32} className="text-slate-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Quote Declined</h1>
          <p className="text-slate-500 text-sm">We're sorry this quote wasn't the right fit. Please reach out if you'd like to discuss further.</p>
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

  const handleAccept = () => {
    if (!acceptForm.agreed || !acceptForm.name.trim()) return;
    acceptQuote(quote.id, { name: acceptForm.name, email: acceptForm.email });
    setDone('accepted');
    setShowAcceptModal(false);
  };
  const handleDecline = () => {
    declineQuote(quote.id, declineReason);
    setDone('declined');
    setShowDeclineModal(false);
  };

  const locations     = [...new Set(quote.lineItems.map(li => li.location || 'Other'))];
  const optionalItems = quote.lineItems.filter(li => li.type === 'Optional');
  const choiceGroups  = {};
  quote.lineItems.filter(li => li.type === 'Multiple Choice').forEach(li => {
    const grp = li.choiceGroupId || '__default__';
    if (!choiceGroups[grp]) choiceGroups[grp] = [];
    choiceGroups[grp].push(li);
  });

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
              <span className="text-white font-bold text-sm">L</span>
            </div>
            <div>
              <p className="font-semibold text-slate-900 text-sm leading-tight">{settings.businessName}</p>
              <p className="text-xs text-slate-400">{settings.businessPhone}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-400">Quote</p>
            <p className="font-semibold text-slate-800 text-sm">{quote.quoteNumber}</p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-5">
        {/* Status banners */}
        {isExpired && !['Accepted','Declined'].includes(quote.status) && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-center gap-3">
            <AlertCircle size={18} className="text-orange-600 flex-shrink-0" />
            <p className="text-sm text-orange-800">This quote has expired. Please contact us to discuss updated pricing.</p>
          </div>
        )}
        {quote.status === 'Accepted' && (
          <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
            <CheckCircle2 size={18} className="text-green-600 flex-shrink-0" />
            <p className="text-sm text-green-800 font-medium">This quote has been accepted. Thank you!</p>
          </div>
        )}
        {quote.status === 'Declined' && (
          <div className="bg-slate-100 border border-slate-200 rounded-xl p-4 flex items-center gap-3">
            <XCircle size={18} className="text-slate-500 flex-shrink-0" />
            <p className="text-sm text-slate-600">This quote has been declined.</p>
          </div>
        )}

        {/* Quote header */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900 mb-1">{quote.title}</h1>
              <p className="text-slate-600 text-sm font-medium">{customer?.name || 'Valued Customer'}</p>
              {quote.siteAddress && (
                <p className="text-slate-500 text-sm flex items-center gap-1.5 mt-1">
                  <MapPin size={13} />{quote.siteAddress}
                </p>
              )}
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-3xl font-bold text-slate-900">{fmt(totals.total)}</p>
              <p className="text-xs text-slate-400">Total inc. GST</p>
              {totals.deposit > 0 && (
                <p className="text-sm text-amber-600 font-medium mt-1">Deposit: {fmt(totals.deposit)}</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-slate-400 border-t border-slate-100 pt-4">
            <span>Quote Date: {format(parseISO(quote.createdAt), 'd MMM yyyy')}</span>
            {quote.expiryDate && <span>Valid Until: {format(new Date(quote.expiryDate), 'd MMM yyyy')}</span>}
            {quote.salesperson && <span>Prepared by: {quote.salesperson}</span>}
          </div>
        </div>

        {/* Intro */}
        {quote.introMessage && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <p className="text-slate-700 text-sm leading-relaxed">{quote.introMessage}</p>
          </div>
        )}

        {/* Required line items by location */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Your Quote Items</h2>
          </div>
          {locations.map(loc => {
            const items = quote.lineItems.filter(li => (li.location || 'Other') === loc && li.type === 'Required');
            if (!items.length) return null;
            return (
              <div key={loc}>
                <div className="px-6 py-3 bg-slate-50 border-b border-slate-100">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{loc}</p>
                </div>
                {items.map(item => {
                  const { finalSell, lineTotal } = calcItemPricing(item.unitCostPrice, item.labourCost, item.marginPercent, item.manualSellPrice, item.quantity);
                  return (
                    <div key={item.id} className="px-6 py-5 border-b border-slate-100 last:border-b-0">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <p className="font-semibold text-slate-800 mb-0.5">{item.productNameSnapshot || 'Window Treatment'}</p>
                          {item.description && <p className="text-sm text-slate-600 mb-2">{item.description}</p>}
                          <div className="flex flex-wrap gap-x-3 text-xs text-slate-400">
                            {quote.showSizesToClient && item.widthMm && <span>{item.widthMm} × {item.dropMm}mm</span>}
                            {item.fabricColour && <span>{item.fabricColour}</span>}
                            {item.quantity > 1 && <span>Qty: {item.quantity}</span>}
                          </div>
                          {item.customerNotes && (
                            <p className="mt-2 text-xs text-slate-500 italic">{item.customerNotes}</p>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-bold text-slate-900">{fmt(lineTotal)}</p>
                          {item.quantity > 1 && (
                            <p className="text-xs text-slate-400">{fmt(finalSell)} × {item.quantity}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Optional add-ons */}
        {optionalItems.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-amber-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-amber-100 bg-amber-50">
              <h2 className="font-semibold text-amber-800">Optional Add-Ons</h2>
              <p className="text-xs text-amber-600 mt-0.5">Select any extras you'd like to include</p>
            </div>
            <div className="divide-y divide-slate-100">
              {optionalItems.map(item => {
                const { lineTotal } = calcItemPricing(item.unitCostPrice, item.labourCost, item.marginPercent, item.manualSellPrice, item.quantity);
                const selected  = selectedOptionals.includes(item.id);
                return (
                  <label key={item.id}
                    className={`flex items-start gap-4 px-6 py-5 cursor-pointer transition-colors ${selected ? 'bg-amber-50/50' : 'hover:bg-slate-50'} ${isLocked ? 'pointer-events-none opacity-60' : ''}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleOptional(item.id)} disabled={isLocked}
                      className="mt-1 w-4 h-4 accent-amber-500 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="font-semibold text-slate-800">{item.productNameSnapshot || item.description}</p>
                      {item.description && item.productNameSnapshot && <p className="text-sm text-slate-600 mt-0.5">{item.description}</p>}
                      {item.location && <p className="text-xs text-slate-400 mt-0.5">{item.location}</p>}
                      {item.customerNotes && <p className="text-xs text-slate-500 italic mt-1">{item.customerNotes}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`font-bold ${selected ? 'text-amber-600' : 'text-slate-700'}`}>+ {fmt(lineTotal)}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Multiple choice groups */}
        {Object.entries(choiceGroups).map(([groupId, items]) => (
          <div key={groupId} className="bg-white rounded-2xl shadow-sm border border-purple-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-purple-100 bg-purple-50">
              <h2 className="font-semibold text-purple-800">Choose One Option</h2>
              <p className="text-xs text-purple-600 mt-0.5">Select the option that suits you best</p>
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
                    className={`flex items-start gap-4 px-6 py-5 cursor-pointer transition-colors ${isSelected ? 'bg-purple-50/50' : 'hover:bg-slate-50'} ${isLocked ? 'pointer-events-none opacity-60' : ''}`}>
                    <input type="radio" name={`choice-${groupId}`} checked={isSelected} onChange={handleChoice}
                      className="mt-1 w-4 h-4 accent-purple-500 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="font-semibold text-slate-800">{item.productNameSnapshot || item.description}</p>
                      {item.description && item.productNameSnapshot && <p className="text-sm text-slate-600 mt-0.5">{item.description}</p>}
                      {item.customerNotes && <p className="text-xs text-slate-500 italic mt-1">{item.customerNotes}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`font-bold ${isSelected ? 'text-purple-600' : 'text-slate-700'}`}>{fmt(lineTotal)}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ))}

        {/* Summary totals */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-800 mb-4">Quote Summary</h2>
          <div className="space-y-2">
            <div className="flex justify-between text-sm text-slate-600">
              <span>Subtotal (excl. GST)</span><span>{fmt(totals.subtotal)}</span>
            </div>
            {quote.includesGST && (
              <div className="flex justify-between text-sm text-slate-600">
                <span>GST ({quote.gstRate}%)</span><span>{fmt(totals.gst)}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold text-slate-900 pt-2 border-t border-slate-200">
              <span>Total</span><span>{fmt(totals.total)}</span>
            </div>
            {totals.deposit > 0 && (
              <div className="flex justify-between text-sm font-medium text-amber-700 bg-amber-50 rounded-xl px-4 py-3 mt-2">
                <span>Deposit Required ({quote.depositType === 'Percentage' ? `${quote.depositValue}%` : 'Fixed'})</span>
                <span>{fmt(totals.deposit)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Terms */}
        {quote.termsAndConditions && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="font-semibold text-slate-800 mb-3">Terms & Conditions</h2>
            <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{quote.termsAndConditions}</p>
          </div>
        )}

        {/* Accept / Decline */}
        {!isLocked && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <p className="text-sm text-slate-600 mb-4 text-center">Ready to proceed? Accept or decline this quote below.</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <button onClick={() => setShowAcceptModal(true)}
                className="flex-1 flex items-center justify-center gap-2 bg-green-500 hover:bg-green-400 text-white font-semibold py-3 px-6 rounded-xl transition-colors">
                <CheckCircle2 size={18} /> Accept Quote
              </button>
              <button onClick={() => setShowDeclineModal(true)}
                className="flex items-center justify-center gap-2 border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium py-3 px-6 rounded-xl transition-colors">
                <XCircle size={18} /> Decline
              </button>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-sm text-slate-400 pb-6">
          <p className="font-medium text-slate-600 mb-1">{settings.businessName}</p>
          <div className="flex items-center justify-center gap-4">
            {settings.businessPhone && <span className="flex items-center gap-1"><Phone size={12} />{settings.businessPhone}</span>}
            {settings.businessEmail && <span className="flex items-center gap-1"><Mail size={12} />{settings.businessEmail}</span>}
          </div>
        </div>
      </main>

      {/* Accept Modal */}
      {showAcceptModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle2 size={20} className="text-green-600" />
              </div>
              <div>
                <h2 className="font-bold text-slate-900">Accept Quote</h2>
                <p className="text-xs text-slate-500">{quote.quoteNumber} · {fmt(totals.total)}</p>
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Your Full Name *</label>
                <input
                  value={acceptForm.name}
                  onChange={e => setAcceptForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Enter your full name"
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Email Address</label>
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
                <span className="text-xs text-slate-600">
                  I have read and agree to the terms and conditions. I understand a deposit of{' '}
                  {quote.depositType === 'Percentage' ? `${quote.depositValue}%` : fmt(quote.depositValue)} is required to proceed.
                </span>
              </label>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <ShieldCheck size={12} className="text-green-500" />
                <span>Your acceptance is recorded with date, time, and name.</span>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowAcceptModal(false)}
                className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 py-2.5 rounded-xl text-sm font-medium transition-colors">
                Cancel
              </button>
              <button onClick={handleAccept} disabled={!acceptForm.agreed || !acceptForm.name.trim()}
                className="flex-1 bg-green-500 hover:bg-green-400 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
                Confirm Acceptance
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Decline Modal */}
      {showDeclineModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="font-bold text-slate-900 mb-1">Decline Quote</h2>
            <p className="text-sm text-slate-500 mb-4">We're sorry this quote wasn't right. Please let us know if you'd like to share a reason.</p>
            <textarea
              value={declineReason}
              onChange={e => setDeclineReason(e.target.value)}
              placeholder="Optional: reason for declining…"
              rows={3}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 resize-none mb-4"
            />
            <div className="flex gap-3">
              <button onClick={() => setShowDeclineModal(false)}
                className="flex-1 border border-slate-200 text-slate-600 hover:bg-slate-50 py-2.5 rounded-xl text-sm font-medium transition-colors">
                Cancel
              </button>
              <button onClick={handleDecline}
                className="flex-1 bg-amber-600 hover:bg-amber-500 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
                Decline Quote
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
