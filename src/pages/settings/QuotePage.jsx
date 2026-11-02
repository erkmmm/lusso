// ─── Customer-facing quote defaults (business details, payment, testimonials) ──
// These populate the public quote page ([customer]/quotes/:id/preview). Values
// live in quote settings and fall back to DEFAULT_QUOTE_SETTINGS, so a customer
// on any device sees them even without local data.
//
// ── Why this saves card-by-card ─────────────────────────────────────────────
// There used to be one save() here, wired to five buttons, and it built its
// payload from the WHOLE editor state every time — so pressing Save on Reviews
// submitted whatever was sitting in the business-details and payment fields
// too. This now sends only the keys you actually edited, and only the ones
// belonging to the card whose Save you pressed.
//
// What that does and does not fix, precisely, because the history here matters:
// on 2026-08-31 a tab holding a stale `lusso_quote_settings` saved Settings and
// mirrored its stale copy to the public `business_settings` row, and customers
// cold-loaded a placeholder phone number for two months. The protection against
// THAT lives in db.vetBusinessSettings() — it refuses retired placeholder values
// and merges over the existing row rather than replacing it.
//
// Note that the mirror still sends the full merged blob, and deliberately so:
// the guard refuses any write that omits a REQUIRED_SETTINGS_KEYS field the row
// already holds, so a patch-only mirror would be rejected outright rather than
// being safer. Narrowing the write happens here, in what the editor contributes
// to the merge — not on the wire. Do not "optimise" saveQuoteSettings into
// sending partials without reading that guard first.
import { useState } from 'react';
import { Building2, Save, Check, Plus, Trash2, CalendarClock, ShieldCheck, CreditCard, Star } from 'lucide-react';
import { getQuoteSettings, saveQuoteSettings } from '../../store/data';
import { toast } from '../../components/ToastContainer';
import SettingsCard from './SettingsCard';

// Which keys each card owns. A card's Save may only ever write from its own
// list, so pressing Save on Reviews cannot touch a payment detail.
const CARD_KEYS = {
  business: ['businessName', 'businessABN', 'businessPhone', 'businessPhoneSms', 'businessEmail', 'businessWebsite', 'businessAddress'],
  next:     ['leadTimeWeeks', 'expiryReason'],
  trust:    ['warrantyText', 'trustPoints'],
  payment:  ['orderTerms', 'termsOfTrade', 'paymentDetails', 'termsAttachmentUrl', 'termsAttachmentLabel', 'termsUrl', 'privacyUrl'],
  reviews:  ['googleRating', 'googleReviewCount', 'googleReviewUrl', 'googleReviewsUrl', 'testimonials'],
};

// Per-key normalisation, lifted straight out of the old monolithic save() so
// each rule still runs — but now only when its own key is being written.
const NORMALISE = {
  paymentDetails: (v) => ({ ...v, amexSurchargePercent: Number(v?.amexSurchargePercent) || 0 }),
  googleRating: (v) => Number(v) || undefined,
  googleReviewCount: (v) => Number(v) || undefined,
  // Kept as '' rather than 0 when cleared: the customer page treats blank as
  // "say nothing", and 0 would render "~0 weeks".
  leadTimeWeeks: (v) => (String(v ?? '').trim() === '' ? '' : (Number(v) || '')),
  expiryReason: (v) => String(v ?? '').trim(),
  // Blank rows are dropped rather than saved — an empty trust point would
  // render as a stray bullet on every quote.
  trustPoints: (v) => (v || []).map(t => String(t || '').trim()).filter(Boolean),
  warrantyText: (v) => String(v ?? '').trim(),
};

export default function QuotePage() {
  const [s, setS] = useState(() => {
    const q = getQuoteSettings();
    return {
      ...q,
      paymentDetails: { ...(q.paymentDetails || {}) },
      testimonials: [...(q.testimonials || [])],
      trustPoints: [...(q.trustPoints || [])],
    };
  });
  // Top-level keys the user has edited in this session. The write set, not a
  // display flag — see the note at the top of the file.
  const [touched, setTouched] = useState(() => new Set());
  const [savedAt, setSavedAt] = useState({});

  const touch = (k) => setTouched(prev => (prev.has(k) ? prev : new Set(prev).add(k)));

  const set = (k, v) => { setS(prev => ({ ...prev, [k]: v })); touch(k); };
  const setPay = (k, v) => {
    setS(prev => ({ ...prev, paymentDetails: { ...prev.paymentDetails, [k]: v } }));
    touch('paymentDetails');
  };
  const setTesti = (i, k, v) => {
    setS(prev => { const t = [...prev.testimonials]; t[i] = { ...t[i], [k]: v }; return { ...prev, testimonials: t }; });
    touch('testimonials');
  };
  const addTesti = () => {
    setS(prev => ({ ...prev, testimonials: [...prev.testimonials, { name: '', location: '', rating: 5, quote: '' }] }));
    touch('testimonials');
  };
  const removeTesti = (i) => {
    setS(prev => ({ ...prev, testimonials: prev.testimonials.filter((_, idx) => idx !== i) }));
    touch('testimonials');
  };
  const setTrust = (i, v) => {
    setS(prev => { const t = [...(prev.trustPoints || [])]; t[i] = v; return { ...prev, trustPoints: t }; });
    touch('trustPoints');
  };
  const addTrust = () => {
    setS(prev => ({ ...prev, trustPoints: [...(prev.trustPoints || []), ''] }));
    touch('trustPoints');
  };
  const removeTrust = (i) => {
    setS(prev => ({ ...prev, trustPoints: (prev.trustPoints || []).filter((_, idx) => idx !== i) }));
    touch('trustPoints');
  };

  const dirtyIn = (card) => CARD_KEYS[card].some(k => touched.has(k));

  /**
   * Save one card: the intersection of "keys this card owns" and "keys you
   * edited". Everything else on the row is left exactly as it is.
   *
   * saveQuoteSettings() merges the patch over a FRESH read of the saved
   * settings, so a partial patch is the safe shape here — not a lossy one.
   */
  const saveCard = (card, label) => {
    const keys = CARD_KEYS[card].filter(k => touched.has(k));
    if (!keys.length) { toast('Nothing to save — no changes on this card.'); return; }

    const patch = {};
    for (const k of keys) patch[k] = NORMALISE[k] ? NORMALISE[k](s[k]) : s[k];
    saveQuoteSettings(patch);

    // Re-read so the editor reflects what actually landed (defaults filled in,
    // normalisation applied) rather than the draft that produced it.
    const fresh = getQuoteSettings();
    setS(prev => {
      const next = { ...prev };
      for (const k of keys) next[k] = k === 'paymentDetails' ? { ...(fresh.paymentDetails || {}) } : fresh[k];
      return next;
    });
    setTouched(prev => { const n = new Set(prev); keys.forEach(k => n.delete(k)); return n; });
    setSavedAt(prev => ({ ...prev, [card]: Date.now() }));
    toast(`${label} saved`);
  };

  // Three states, not two: "Save" while there is something to save, "Saved"
  // only once this card has actually written something, and a quiet disabled
  // "Save" before you have touched anything — the old button said "Saved" on a
  // card nobody had edited yet, which claims something that never happened.
  const saveBtn = (card, label) => {
    const dirty = dirtyIn(card);
    const done = !dirty && Boolean(savedAt[card]);
    return (
      <button onClick={() => saveCard(card, label)} disabled={!dirty}
        className={`flex items-center gap-1.5 text-xs font-semibold px-3 min-h-[36px] rounded-lg transition-colors ${
          dirty ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-slate-100 text-slate-400 cursor-not-allowed'
        }`}>
        {done ? <><Check size={13} /> Saved</> : <><Save size={13} /> Save</>}
      </button>
    );
  };

  const saveState = (card) => ({ kind: 'manual', dirty: dirtyIn(card), savedAt: savedAt[card] });

  const field = (label, k, placeholder) => (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      <input value={s[k] ?? ''} onChange={e => set(k, e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
    </div>
  );

  return (
    <>
      <SettingsCard
        id="business-details"
        icon={Building2}
        title="Business details"
        description="These appear in the FROM panel and footer of the customer-facing quote — and they are what a customer sees on their own phone, where the app has no other copy of them. Anything left blank here falls back to the built-in defaults."
        scope="customers"
        save={saveState('business')}
        actions={saveBtn('business', 'Business details')}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {field('Business name', 'businessName', 'Lusso Fashion for Windows')}
          {field('ABN', 'businessABN', '72 388 582 539')}
          {field('Phone', 'businessPhone', '07 5528 4006')}
          {field('Text / SMS number (optional)', 'businessPhoneSms', '0485 075 111')}
          {field('Email', 'businessEmail', 'jobs@lusso.com.au')}
          {field('Website', 'businessWebsite', 'www.lusso.com.au')}
          {field('Postal address', 'businessAddress', '3 Crinum Crescent, Southport QLD 4215')}
        </div>
      </SettingsCard>

      {/* What the customer is told happens after they accept, and why the
          price has a date on it. Both render nothing when blank — a timeline
          step with an invented lead time is a promise nobody agreed to, and an
          unexplained expiry reads as a sales tactic. */}
      <SettingsCard
        id="what-happens-next"
        icon={CalendarClock}
        title="What happens next"
        description="The lead time and expiry note on the customer's quote."
        scope="customers"
        save={saveState('next')}
        actions={saveBtn('next', 'What happens next')}
      >
        <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Lead time (weeks)</label>
            <input type="number" min="1" max="52" value={s.leadTimeWeeks ?? ''} onChange={e => set('leadTimeWeeks', e.target.value)} placeholder="e.g. 5"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            <p className="text-[11px] text-slate-400 mt-1">Leave blank to show the step without a number.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Why the quote expires (optional)</label>
            <input value={s.expiryReason ?? ''} onChange={e => set('expiryReason', e.target.value)} placeholder="e.g. Supplier pricing is reviewed quarterly"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            <p className="text-[11px] text-slate-400 mt-1">Shown in small text under the expiry date. Blank shows nothing at all.</p>
          </div>
        </div>
      </SettingsCard>

      {/* Shown as a quiet row beside the total on the customer quote. Ships
          empty on purpose: every line here is a claim about the business that
          a customer can check, so they have to be yours, not ours. */}
      <SettingsCard
        id="trust-points"
        icon={ShieldCheck}
        title="Trust points & warranty"
        description="A quiet row beside the total on the customer's quote."
        scope="customers"
        save={saveState('trust')}
        actions={<>
          <button onClick={addTrust} className="flex items-center gap-1 text-xs font-medium text-amber-600 hover:text-amber-700 px-2 min-h-[36px]"><Plus size={13} /> Add</button>
          {saveBtn('trust', 'Trust points')}
        </>}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Warranty, in one line (optional)</label>
            <input value={s.warrantyText ?? ''} onChange={e => set('warrantyText', e.target.value)} placeholder="e.g. 5-year warranty on all motors and components"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-500">Trust points</label>
            {(s.trustPoints || []).length === 0 && (
              <p className="text-[11px] text-slate-400">
                None set, so nothing is shown. Short and checkable works best — &ldquo;Family-owned since 1964&rdquo;,
                &ldquo;Installed by our own team&rdquo;, &ldquo;Fully insured&rdquo;.
              </p>
            )}
            {(s.trustPoints || []).map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <input value={t ?? ''} onChange={e => setTrust(i, e.target.value)} placeholder="e.g. Third-generation family business"
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                <button onClick={() => removeTrust(i)} className="text-slate-400 hover:text-red-500 p-2 relative before:absolute before:content-[''] before:-inset-[7px]"><Trash2 size={15} /></button>
              </div>
            ))}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        id="order-payment"
        icon={CreditCard}
        title="Order & payment"
        description="Bank details, order wording and the terms links on every quote."
        scope="customers"
        save={saveState('payment')}
        actions={saveBtn('payment', 'Order & payment')}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">&quot;To place your order&quot; text</label>
            <textarea value={s.orderTerms ?? ''} onChange={e => set('orderTerms', e.target.value)} rows={3}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">&quot;Terms of trade&quot; card</label>
            <textarea value={s.termsOfTrade ?? ''} onChange={e => set('termsOfTrade', e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
            <p className="text-[11px] text-slate-400 mt-1">Shown beside the payment details. The deposit sentence is added automatically from the quote&rsquo;s own deposit terms — keep this to what happens after the deposit, and make sure it agrees with your T&amp;Cs.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Account name</label>
              <input value={s.paymentDetails.accountName ?? ''} onChange={e => setPay('accountName', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">BSB</label>
              <input value={s.paymentDetails.bsb ?? ''} onChange={e => setPay('bsb', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Account number</label>
              <input value={s.paymentDetails.accountNumber ?? ''} onChange={e => setPay('accountNumber', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Credit-card note</label>
              <input value={s.paymentDetails.creditCardNote ?? ''} onChange={e => setPay('creditCardNote', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Amex surcharge %</label>
              <input type="number" value={s.paymentDetails.amexSurchargePercent ?? ''} onChange={e => setPay('amexSurchargePercent', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">T&C attachment URL (optional)</label>
              <input value={s.termsAttachmentUrl ?? ''} onChange={e => set('termsAttachmentUrl', e.target.value)} placeholder="https://…"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Attachment link label</label>
              <input value={s.termsAttachmentLabel ?? ''} onChange={e => set('termsAttachmentLabel', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            {/* Linked from the bottom of every customer quote, next to Accept.
                Clear one to drop that link rather than publish a dead one. */}
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Terms &amp; Conditions page</label>
              <input value={s.termsUrl ?? ''} onChange={e => set('termsUrl', e.target.value)} placeholder="https://lusso.com.au/terms.html"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Privacy Policy page</label>
              <input value={s.privacyUrl ?? ''} onChange={e => set('privacyUrl', e.target.value)} placeholder="https://lusso.com.au/privacy.html"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
          </div>
          <p className="text-[11px] text-slate-400">
            Both appear under Terms and conditions on the customer&apos;s quote, as
            &ldquo;By accepting you agree to our Terms &amp; Conditions, and to our Privacy Policy&rdquo;.
          </p>
        </div>
      </SettingsCard>

      <SettingsCard
        id="reviews-testimonials"
        icon={Star}
        title="Reviews & testimonials"
        description="The rating, review links and quotes shown on the customer's quote."
        scope="customers"
        save={saveState('reviews')}
        actions={<>
          <button onClick={addTesti} className="flex items-center gap-1 text-xs font-medium text-amber-600 hover:text-amber-700 px-2 min-h-[36px]"><Plus size={13} /> Add</button>
          {saveBtn('reviews', 'Reviews')}
        </>}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Google rating</label>
              <input type="number" step="0.1" value={s.googleRating ?? ''} onChange={e => set('googleRating', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Review count</label>
              <input type="number" value={s.googleReviewCount ?? ''} onChange={e => set('googleReviewCount', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Write-a-review URL</label>
              <input value={s.googleReviewUrl ?? ''} onChange={e => set('googleReviewUrl', e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <p className="text-[11px] text-slate-400 mt-1">Where review requests send people to leave a rating.</p>
            </div>
            <div className="sm:col-span-3">
              <label className="block text-xs font-medium text-slate-500 mb-1">Read-reviews URL (optional)</label>
              <input value={s.googleReviewsUrl ?? ''} onChange={e => set('googleReviewsUrl', e.target.value)} placeholder="Leave blank to derive it from the write-a-review link"
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
              <p className="text-[11px] text-slate-400 mt-1">Where the quote&rsquo;s &ldquo;See all reviews&rdquo; link goes. This used to point at the write-a-review form, so a customer wanting to read reviews was asked to leave one.</p>
            </div>
          </div>
          {(s.testimonials || []).map((t, i) => (
            <div key={i} className="rounded-xl border border-slate-200 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <input value={t.name ?? ''} onChange={e => setTesti(i, 'name', e.target.value)} placeholder="Customer name"
                  className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                <input value={t.location ?? ''} onChange={e => setTesti(i, 'location', e.target.value)} placeholder="Suburb"
                  className="w-28 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                <input type="number" min="1" max="5" value={t.rating ?? 5} onChange={e => setTesti(i, 'rating', Number(e.target.value))}
                  className="w-16 px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                <button onClick={() => removeTesti(i)} className="text-slate-400 hover:text-red-500 p-2 relative before:absolute before:content-[''] before:-inset-[7px]"><Trash2 size={15} /></button>
              </div>
              <textarea value={t.quote ?? ''} onChange={e => setTesti(i, 'quote', e.target.value)} placeholder="Their review…" rows={2}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
            </div>
          ))}
        </div>
      </SettingsCard>
    </>
  );
}
