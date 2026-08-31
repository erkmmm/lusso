import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { format, parseISO, isPast } from 'date-fns';
import {
  getQuote, getCustomer, getQuoteSettings, fetchPublicQuoteSettings, googleReviewsLink,
  computeQuoteTotals, linePricing, markQuoteViewed, acceptQuote, declineQuote,
} from '../store/data';
import { supabase } from '../lib/supabase';
import { quoteSections, unansweredChoices } from '../lib/quoteSections';
import { useQuoteTracking } from '../hooks/useQuoteTracking';

/* ───────────────────────────────────────────────────────────────────────────
   Lusso customer quote page — implements the "Lusso Quote Page" design
   (claude.ai/design project 570d78a2). Cool near-monochrome palette, Manrope,
   bronze used only as a hairline/eyebrow accent. Wired to the real quote data,
   pricing (computeQuoteTotals / linePricing) and acceptance/tracking flow.
   ─────────────────────────────────────────────────────────────────────────── */

// Lusso design tokens — the canonical brand palette lives as fixed :root CSS
// vars in index.css (--lusso-*), shared with the app's Lusso theme so the two
// can't drift apart. These vars are never overridden by a theme/.dark class, so
// the page renders identically on every route and mode.
const T = {
  paper: 'var(--lusso-paper)', paperPure: 'var(--lusso-paper-pure)', mist: 'var(--lusso-mist)', stone: 'var(--lusso-stone)',
  graphite: 'var(--lusso-graphite)', ink: 'var(--lusso-ink)', bronze: 'var(--lusso-bronze)',
  onInverseMuted: 'var(--lusso-on-inverse-muted)', borderInverse: 'var(--lusso-border-inverse)',
  shadowCard: '0 1px 2px rgba(16,17,19,0.04), 0 8px 24px rgba(16,17,19,0.05)',
  ease: 'cubic-bezier(0.22,0.61,0.36,1)',
  font: "'Manrope', system-ui, -apple-system, sans-serif",
};

const money = (n) => '$' + Number(n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => { try { return format(d instanceof Date ? d : parseISO(d), 'd MMMM yyyy'); } catch { return ''; } };
// The signature bronze dash + uppercase eyebrow.
function Eyebrow({ children, color = T.stone, dash = T.bronze }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 18, height: 2, background: dash, display: 'block', flex: '0 0 auto' }} />
      <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color }}>{children}</span>
    </div>
  );
}

// The window reference inside a room — A, B, C. Only rendered where the room
// holds more than one window, which is exactly when the customer (and the
// installer reading the same letter off the purchase order) needs it.
function RefBadge({ children }) {
  if (!children) return null;
  return (
    <span style={{
      flex: '0 0 auto', width: 26, height: 26, marginTop: 2, borderRadius: 999,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      border: `0.5px solid ${T.mist}`, background: T.paperPure,
      fontSize: 12, fontWeight: 500, letterSpacing: '0.04em', color: T.graphite,
    }}>{children}</span>
  );
}

// Design-system Button (primary ink / secondary hairline outline; md / lg).
function Button({ children, variant = 'primary', size = 'md', disabled = false, onClick }) {
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState(false);
  const sizes = { md: { padding: '12px 26px', font: 15, gap: 9 }, lg: { padding: '16px 34px', font: 16, gap: 10 } };
  const s = sizes[size] || sizes.md;
  const variants = {
    primary: { background: hover && !disabled ? T.graphite : T.ink, color: T.paper, borderColor: 'transparent' },
    secondary: { background: 'transparent', color: hover && !disabled ? T.bronze : T.ink, borderColor: hover && !disabled ? T.bronze : T.stone },
  };
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => { setHover(false); setActive(false); }}
      onMouseDown={() => setActive(true)} onMouseUp={() => setActive(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: s.gap,
        padding: s.padding, fontFamily: T.font, fontSize: s.font, fontWeight: 500, letterSpacing: '0.01em',
        lineHeight: 1, borderRadius: 999, border: '0.5px solid transparent', whiteSpace: 'nowrap',
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.4 : 1,
        transform: active && !disabled ? 'scale(0.98)' : 'scale(1)',
        transition: `background 200ms ${T.ease}, color 200ms ${T.ease}, border-color 200ms ${T.ease}, transform 120ms ${T.ease}`,
        WebkitFontSmoothing: 'antialiased', ...variants[variant],
      }}>
      {children}
    </button>
  );
}

const card = { background: T.paperPure, border: `0.5px solid ${T.mist}`, borderRadius: 8, padding: 20 };
const fieldLabel = { fontSize: 9.5, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.stone };
const hairline = { height: '0.5px', background: T.mist, margin: '16px 0', border: 0 };

/**
 * The marked-up plan, as attached to this quote.
 *
 * Answers the question a price list can't: WHERE does each of these go. Every
 * covering is drawn on the plan where it runs, colour-matched to the list
 * below, so a customer can check their own house room by room before accepting.
 *
 * The images are a snapshot taken when the plan was attached — what the quote
 * was priced against — so nothing here moves under the customer's feet.
 */
function PlanSection({ snapshot }) {
  // The page's `h3` is scoped inside the main component; this section lives
  // outside it, so it carries its own copy of the same style.
  const h3 = { margin: 0, fontWeight: 300, fontSize: 20, letterSpacing: '-0.3px', color: T.ink };
  const [zoomed, setZoomed] = useState(null);
  const showSizes = snapshot.showSizes !== false;
  const schedule = snapshot.schedule || [];
  const measured = schedule.filter(e => e.measured).length;
  const byPage = new Map();
  for (const e of schedule) {
    if (!byPage.has(e.pageNumber)) byPage.set(e.pageNumber, []);
    byPage.get(e.pageNumber).push(e);
  }

  return (
    <section style={{ ...card, padding: 22 }}>
      <Eyebrow>Your plan</Eyebrow>
      <h3 style={{ ...h3, marginTop: 14 }}>Where everything goes</h3>
      <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.7, color: T.graphite, maxWidth: '60ch' }}>
        Each covering is marked on the plan where it runs, and numbered to match the list below.
        Please check every room you expect is here before accepting — it&rsquo;s far easier to change now
        than after anything is made.
      </p>

      {snapshot.pages.map(pg => (
        <figure key={pg.path} style={{ margin: '20px 0 0' }}>
          <button
            type="button" onClick={() => setZoomed(pg)}
            style={{ display: 'block', width: '100%', padding: 0, border: `0.5px solid ${T.mist}`, borderRadius: 12, overflow: 'hidden', background: T.paperPure, cursor: 'zoom-in' }}
          >
            <img src={pg.url} alt={`Plan page ${pg.pageNumber}`} style={{ display: 'block', width: '100%', height: 'auto' }} />
          </button>
          {snapshot.pages.length > 1 && (
            <figcaption style={{ ...fieldLabel, marginTop: 8 }}>Page {pg.pageNumber}</figcaption>
          )}
        </figure>
      ))}

      {[...byPage.entries()].map(([pageNumber, entries]) => (
        <div key={pageNumber} style={{ marginTop: 24 }}>
          {byPage.size > 1 && <div style={{ ...fieldLabel, marginBottom: 10 }}>Page {pageNumber}</div>}
          <div style={{ display: 'grid', gap: 10 }}>
            {entries.map(e => (
              <div key={`${e.pageNumber}-${e.number}`}
                   style={{ display: 'flex', alignItems: 'flex-start', gap: 12, paddingBottom: 10, borderBottom: `0.5px solid ${T.mist}` }}>
                <span style={{
                  flex: '0 0 auto', width: 24, height: 24, borderRadius: '50%', background: e.colour || T.stone,
                  color: '#fff', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                }}>{e.number}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14.5, color: T.ink }}>{e.label}</div>
                  <div style={{ fontSize: 12.5, color: T.stone, marginTop: 2 }}>
                    {e.product || 'Product to be confirmed'}
                    {e.quantity > 1 ? ` · ${e.quantity} of them` : ''}
                    {e.shape ? ` · ${e.shape}` : ''}
                    {showSizes && e.widthMm ? ` · ${e.widthMm} × ${e.dropMm || '—'} mm` : ''}
                  </div>
                </div>
                <span style={{ flex: '0 0 auto', fontSize: 11, color: e.measured ? '#15803d' : T.stone }}>
                  {e.measured ? 'Measured on site' : 'From plan'}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Being straight about which sizes are provisional is what keeps this
          useful rather than a thing to argue about later. */}
      <p style={{ margin: '16px 0 0', fontSize: 12.5, lineHeight: 1.7, color: T.stone }}>
        {measured === schedule.length
          ? 'All sizes shown have been confirmed on site.'
          : `${measured} of ${schedule.length} sizes have been confirmed on site. The rest are taken from the plan and will be checked before anything is ordered.`}
      </p>

      {zoomed && (
        <div
          onClick={() => setZoomed(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(16,17,19,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, cursor: 'zoom-out' }}
        >
          <img src={zoomed.url} alt={`Plan page ${zoomed.pageNumber}`}
               style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8, background: '#fff' }} />
        </div>
      )}
    </section>
  );
}

/**
 * @param {Object}  props
 * @param {Object}  props.previewQuote  render this quote object instead of
 *   loading one by route id. Used by the quote builder to show unsaved edits
 *   exactly as the customer will read them, without saving or sending first.
 * @param {Node}    props.footer  rendered after the whole quote, below the
 *   customer's sticky summary bar — so it is only reachable by scrolling past
 *   the end of what the customer sees.
 */
export default function CustomerQuotePage({ previewQuote = null, footer = null }) {
  const routeParams    = useParams();
  const id             = previewQuote?.id || routeParams.id;
  const [searchParams] = useSearchParams();
  // An embedded preview is a staff preview by definition: no tracking, no
  // status change, and drafts still render.
  const isStaffPreview = !!previewQuote || searchParams.get('preview') === '1';
  // The capability token that makes this link a link rather than a guess. Quote
  // ids are sequential, so without it the id space could simply be walked.
  const token          = searchParams.get('t') || '';

  // Business/payment details come from the shared Supabase row, not just
  // localStorage: a customer opens this page on their own device, where the
  // local copy doesn't exist and the defaults would show placeholder details.
  const [settings, setSettings] = useState(getQuoteSettings);
  useEffect(() => {
    let cancelled = false;
    fetchPublicQuoteSettings()
      .then(s => { if (!cancelled && s) setSettings(s); })
      .catch(() => { /* keep the local fallback */ });
    return () => { cancelled = true; };
  }, []);

  const [quote, setQuote] = useState(() => {
    if (previewQuote) return previewQuote;
    const q = getQuote(id);
    if (!isStaffPreview && q && ['Sent', 'Viewed'].includes(q.status)) markQuoteViewed(id);
    return getQuote(id);
  });
  // The builder can hand over a fresh snapshot while the preview is open.
  const [previewRev, setPreviewRev] = useState(previewQuote);
  if (previewQuote && previewQuote !== previewRev) {
    setPreviewRev(previewQuote);
    setQuote(previewQuote);
  }
  const [selectedOptionals, setSelectedOptionals] = useState([]);
  const [localStatus, setLocalStatus] = useState(null); // 'accepted' | 'declined'
  const [expanded, setExpanded] = useState(false);
  // Accepting is irreversible from the customer's side — it flips the quote's
  // status, recomputes the totals and advances the job to Approved. It used to
  // happen on a single tap of a button that sits in the sticky bar from the
  // moment the page opens, so a mis-tap while scrolling ordered the house.
  const [sheet, setSheet] = useState(null);          // 'accept' | 'decline'
  const [declineReason, setDeclineReason] = useState('');
  const [busy, setBusy] = useState(false);
  const tailRef = useRef(null);

  useEffect(() => {
    if (quote || !supabase || !id || !token) return;
    // Returns a hand-picked, already-camelCase projection: sell prices only,
    // with unitCostPrice / labourCost / marginPercent / supplier left behind on
    // the server. It used to hand the browser the whole quotes row, so anyone
    // with the link — or with a guess at an id — could read our cost base and
    // margin on every line.
    supabase.rpc('get_public_quote', { p_id: id, p_token: token }).then(({ data, error }) => {
      if (!error && data) setQuote(data);
    });
  }, [id, token, quote]);

  // The customer's own device has no localStorage copy of the customer record,
  // and `customers` isn't readable with the anon key — so without this every
  // real customer was greeted as "Valued customer", saw "quotation for you" as
  // the heading, and had an empty name/email attached to their acceptance.
  // Only staff previewing the page ever saw their own data. This RPC returns
  // just the name/email/phone for the customer this quote belongs to.
  const [remoteCustomer, setRemoteCustomer] = useState(null);
  useEffect(() => {
    if (!supabase || !id || getCustomer(quote?.customerId)) return;
    let cancelled = false;

    if (!token) return;
    supabase.rpc('get_public_quote_customer', { p_id: id, p_token: token })
      .then(({ data, error }) => { if (!cancelled && !error && data) setRemoteCustomer(data); });
    return () => { cancelled = true; };
  }, [id, token, quote?.customerId]);

  // A quote that has already been accepted must come back with the customer's
  // own choices ticked. Starting from an empty array showed someone revisiting
  // their accepted quote "0 of 8 options" and a total that didn't match what
  // they'd agreed to. Adjusted during render rather than in an effect (React's
  // "reset state when a prop changes" pattern) so the first paint is already
  // correct instead of flashing the wrong total.
  const [seededFor, setSeededFor] = useState(null);
  if (quote?.id && seededFor !== quote.id) {
    setSeededFor(quote.id);
    const saved = quote.selectedLineItemIds;
    if (Array.isArray(saved) && saved.length) setSelectedOptionals(saved);
  }

  const isFirstOpen = !quote?.firstOpenedAt;
  const { trackAccept, trackDecline } = useQuoteTracking((!isStaffPreview && quote) ? id : null, isFirstOpen, token);

  if (!quote) {
    return (
      <div style={{ minHeight: '100vh', background: T.paper, fontFamily: T.font, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 40, fontWeight: 300, color: T.mist, margin: 0 }}>404</p>
          <p style={{ color: T.stone, marginTop: 8 }}>Quote not found or has been removed.</p>
        </div>
      </div>
    );
  }

  // Offline / not-yet-sent quotes must not be visible on the public link.
  if (!isStaffPreview && (quote.status === 'Draft' || quote.status === 'Expired')) {
    return (
      <div style={{ minHeight: '100vh', background: T.paper, fontFamily: T.font, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <p style={{ fontSize: 40, fontWeight: 300, color: T.mist, margin: 0 }}>Unavailable</p>
          <p style={{ color: T.stone, marginTop: 8 }}>This quote isn’t currently available to view. Please contact us and we’ll send you an up-to-date version.</p>
        </div>
      </div>
    );
  }

  const customer  = getCustomer(quote.customerId) || remoteCustomer;
  const isExpired = quote.expiryDate && isPast(new Date(quote.expiryDate));
  const accepted  = localStatus === 'accepted' || quote.status === 'Accepted';
  const declined  = localStatus === 'declined' || quote.status === 'Declined';
  const locked    = isExpired || accepted || declined;

  const gstRate = quote.gstRate || 10;
  const totals = computeQuoteTotals(
    quote.lineItems, quote.depositType, quote.depositValue, gstRate, quote.includesGST,
    selectedOptionals, quote.discountType, quote.discountValue,
  );

  // ── Build room sections from the real line items ─────────────────────────
  // One heading per room, with the windows in it lettered A / B / C beneath.
  // Those letters are not invented here: the plan takeoff writes them into the
  // location itself ("Bed 5 A"), and that string travels through the measure
  // sheet and onto the purchase order — so the letter the customer reads is the
  // same one the installer is standing in front of. groupByRoom takes the
  // room and the letter back apart for display and never renumbers them.
  const items = quote.lineItems || [];
  const requiredItems = items.filter(li => li.type === 'Required' || li.type === 'Part');
  const optionalItems = items.filter(li => li.type === 'Optional');
  const choiceItems   = items.filter(li => li.type === 'Multiple Choice');

  const isSelected = (li) => li.type === 'Required' || li.type === 'Part' || selectedOptionals.includes(li.id);

  // quoteSections is shared with the quote builder, so what a staff member
  // assembled is laid out here exactly as they saw it.
  const rooms = quoteSections(items);

  // Blocks the customer has to answer before they can accept. Without this a
  // quote offering "manual / battery motor / hardwired" could be accepted with
  // none of them picked, and the order that came out the other side was
  // missing a decision nobody had made.
  const unansweredRequired = unansweredChoices(rooms, selectedOptionals);

  const selectableIds = [...optionalItems, ...choiceItems].map(li => li.id);
  const selectedCount = selectableIds.filter(sid => selectedOptionals.includes(sid)).length;
  const selectedLabel = `${selectedCount} of ${selectableIds.length}`;

  // Summary rows — reconcile per-line + quote-level discounts.
  const activeItems = items.filter(isSelected);
  // GST-free lines are excluded from the GST base, which made the summary look
  // like it was charging the wrong rate — 10% of the subtotal didn't match the
  // GST line and nothing on the page said why.
  const gstFreeTotal = activeItems
    .filter(li => li.taxable === false)
    .reduce((sum, li) => sum + linePricing(li).lineTotal, 0);
  const lineDiscountTotal = activeItems.reduce((s, li) => s + (linePricing(li).discountTotal || 0), 0);
  const grossBefore = totals.grossSubtotal + lineDiscountTotal;

  const rowLabel = { fontSize: 13.5, color: T.graphite };
  const rowValue = { fontSize: 13.5, fontWeight: 500, color: T.ink, whiteSpace: 'nowrap' };
  const summaryRows = [{ label: 'Subtotal', value: money(grossBefore), lStyle: rowLabel, vStyle: rowValue }];
  if (lineDiscountTotal > 0) summaryRows.push({ label: 'Package discount', value: '−' + money(lineDiscountTotal), lStyle: rowLabel, vStyle: { ...rowValue, color: T.bronze } });
  if (totals.discount > 0) summaryRows.push({ label: quote.discountLabel || (quote.discountType === 'Percentage' ? `Discount (${quote.discountValue}%)` : 'Discount'), value: '−' + money(totals.discount), lStyle: rowLabel, vStyle: { ...rowValue, color: T.bronze } });
  if (quote.includesGST) summaryRows.push({ label: `GST ${gstRate}%`, value: money(totals.gst), lStyle: rowLabel, vStyle: rowValue });

  // ── Actions ──────────────────────────────────────────────────────────────
  const acceptable = !locked && selectedCount + requiredItems.length > 0 && unansweredRequired.length === 0;
  const listAnd = (parts) => parts.length < 2 ? (parts[0] || '')
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const scrollToTail = () => requestAnimationFrame(() => tailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  const handleAccept = async () => {
    if (locked || busy) return;
    setBusy(true);
    // Staff preview (?preview=1) must never record tracking or mutate status —
    // show the confirmation locally only.
    if (!isStaffPreview) {
      // The RPC is authoritative — it saves the selections, recomputes the
      // totals and advances the job server-side. acceptQuote() only updates a
      // localStorage copy, so it does nothing on a customer's device and is
      // kept purely to keep a staff member's own browser in step.
      await trackAccept(customer?.name || '', customer?.email || '', selectedOptionals);
      acceptQuote(quote.id, { name: customer?.name || 'Customer', email: customer?.email || '' }, selectedOptionals);
    }
    setBusy(false); setSheet(null); setLocalStatus('accepted'); setExpanded(false); scrollToTail();
  };
  const handleDecline = async () => {
    if (locked || busy) return;
    setBusy(true);
    const reason = declineReason.trim();
    if (!isStaffPreview) {
      // The reason travels with the event and lands on the quote + the staff
      // email. The page never used to ask for one, so decline_reason was always
      // blank and nobody knew whether it was the price, the fabric or the wait.
      await trackDecline(reason);
      declineQuote(quote.id, reason);
    }
    setBusy(false); setSheet(null); setLocalStatus('declined'); setExpanded(false); scrollToTail();
  };
  const askAccept  = () => { if (!acceptable) return; setSheet('accept'); };
  const askDecline = () => { if (locked) return; setDeclineReason(''); setSheet('decline'); };
  const reopen = () => setLocalStatus(null);

  const toggleOptional = (itemId) => { if (locked) return; setSelectedOptionals(p => p.includes(itemId) ? p.filter(x => x !== itemId) : [...p, itemId]); };
  const selectChoice = (gItems, itemId) => {
    if (locked) return;
    const otherIds = gItems.map(i => i.id).filter(x => x !== itemId);
    setSelectedOptionals(p => {
      const without = p.filter(x => !otherIds.includes(x));
      return without.includes(itemId) ? without.filter(x => x !== itemId) : [...without, itemId];
    });
  };
  const clearChoice = (gItems) => { if (locked) return; const ids = gItems.map(i => i.id); setSelectedOptionals(p => p.filter(x => !ids.includes(x))); };

  const pay = settings.paymentDetails || {};
  const reviewsUrl = googleReviewsLink(settings);
  const testimonials = settings.testimonials || [];
  const termsText = quote.termsAndConditions || settings.defaultTerms;
  const depoLabel = quote.depositType === 'Percentage' ? `${quote.depositValue}%`
    : quote.depositType === 'Fixed Amount' ? money(quote.depositValue) : null;

  const container = { maxWidth: 880, margin: '0 auto', width: '100%', boxSizing: 'border-box' };
  const h3 = { margin: 0, fontWeight: 300, fontSize: 20, letterSpacing: '-0.3px', color: T.ink };

  // ── Option card ────────────────────────────────────────────────────────
  const OptionCard = ({ item, kind }) => {
    const on = isSelected(item);
    const fixed = kind === 'included';
    const choice = kind === 'choice';
    const { finalSell, lineTotal, preDiscountSell, discountTotal } = linePricing(item);
    const qty = Number(item.quantity) || 1;
    const round = choice || fixed ? 999 : 4;
    const clickable = !fixed && !locked;
    const desc = [item.description, item.customerNotes].filter(Boolean).join(' · ');
    const toggle = () => (choice ? selectChoice(item._group, item.id) : toggleOptional(item.id));
    // Sizes are opt-in per quote (Settings → "Show dimensions to client"). Until
    // now that checkbox wrote a field nothing read, so ticking it changed
    // nothing the customer could see.
    const sizeText = quote.showSizesToClient && Number(item.widthMm)
      ? `${item.widthMm} × ${item.dropMm || '—'} mm`
      : '';
    const meta = [sizeText, qty > 1 ? `${qty} of them` : ''].filter(Boolean).join(' · ');
    // A GST-free line must say so. Labelling it "ex GST" like everything else is
    // what made the summary look like it had the wrong GST on it.
    const gstNote = item.taxable === false ? 'GST free' : (quote.includesGST ? 'ex GST' : '');
    return (
      <div
        onClick={clickable ? toggle : undefined}
        // Keyboard support: these are the page's real controls, and they were
        // unreachable without a mouse — plain divs with an onClick, no role and
        // no tab stop, so nobody on a keyboard or screen reader could choose
        // anything at all.
        role={fixed ? undefined : (choice ? 'radio' : 'checkbox')}
        aria-checked={fixed ? undefined : on}
        aria-disabled={locked || undefined}
        tabIndex={clickable ? 0 : undefined}
        onKeyDown={clickable ? (e) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); toggle(); }
        } : undefined}
        style={{
          display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap', padding: 18, borderRadius: 8,
          background: fixed ? 'transparent' : T.paperPure,
          border: `0.5px solid ${on ? T.ink : T.mist}`,
          borderLeft: `2px solid ${on && !fixed ? T.bronze : (fixed ? T.mist : 'transparent')}`,
          boxShadow: on && !fixed ? T.shadowCard : 'none',
          cursor: fixed ? 'default' : (locked ? 'default' : 'pointer'),
          transition: `border-color 200ms ${T.ease}, box-shadow 200ms ${T.ease}`,
        }}>
        {/* Selection control — only for togglable items. Non-optional (included)
            lines have nothing to toggle, so no checkbox/tick is shown. */}
        {!fixed && (
          <div style={{
            flex: '0 0 auto', width: 24, height: 24, marginTop: 1, borderRadius: round,
            display: 'flex', alignItems: 'center', justifyContent: 'center', transition: `all 200ms ${T.ease}`,
            background: on ? T.ink : T.paperPure, border: `1px solid ${on ? T.ink : T.stone}`,
          }}>
            {choice && on
              ? <span style={{ width: 8, height: 8, borderRadius: 999, background: T.paper, display: 'block' }} />
              : (on ? <span style={{ fontSize: 12, lineHeight: 1, color: T.paper }}>✓</span> : null)}
          </div>
        )}
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          {/* displayName is composed and stamped by the builder on save — the
              product type alone reads "Curtain", which tells the customer
              nothing about what they are buying. Older quotes saved before it
              existed fall back to the raw snapshot. */}
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.4, fontWeight: 500, color: on || fixed ? T.ink : T.graphite, textWrap: 'pretty' }}>{item.displayName || item.productNameSnapshot || 'Window treatment'}</p>
          {desc && <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.7, color: T.stone, textWrap: 'pretty' }}>{desc}</p>}
          {meta && <p style={{ margin: '4px 0 0', fontSize: 12, lineHeight: 1.6, color: T.stone }}>{meta}</p>}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 12, padding: '5px 10px 5px 8px', borderRadius: 999,
            fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase',
            background: on && !fixed ? T.ink : 'transparent', border: on && !fixed ? 'none' : `0.5px solid ${T.mist}`, color: on && !fixed ? T.paper : T.stone,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: 999, display: 'block', background: on && !fixed ? T.bronze : T.mist }} />
            <span>{fixed ? 'Included' : (on ? 'Selected' : 'Not selected')}</span>
          </div>
        </div>
        {/* marginLeft:auto keeps the price hard right both inline on desktop and
            on its own wrapped line on a phone, where it used to float mid-card
            so no two prices lined up down the page. */}
        <div style={{ textAlign: 'right', flex: '0 0 auto', marginLeft: 'auto' }}>
          {discountTotal > 0 && <div style={{ fontSize: 13, color: T.stone, textDecoration: 'line-through' }}>{money(preDiscountSell * qty)}</div>}
          <div style={{ fontSize: 18, fontWeight: on ? 500 : 400, letterSpacing: '-0.2px', whiteSpace: 'nowrap', color: on ? T.ink : T.stone }}>{money(lineTotal)}</div>
          <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.stone, marginTop: 4 }}>
            {gstNote}{qty > 1 ? `${gstNote ? ' · ' : ''}${money(finalSell)} × ${qty}` : ''}
          </div>
          {discountTotal > 0 && (
            <div style={{ marginTop: 8, fontSize: 10.5, fontWeight: 500, letterSpacing: '0.06em', color: T.bronze }}>Discount −{money(discountTotal)}</div>
          )}
        </div>
      </div>
    );
  };

  const validityText = isExpired
    ? `Expired ${quote.expiryDate ? fmtDate(new Date(quote.expiryDate)) : ''}`
    : quote.expiryDate ? `Valid until ${fmtDate(new Date(quote.expiryDate))}` : 'No expiry';

  return (
    <div style={{ minHeight: '100vh', background: T.mist }}>
      {isStaffPreview && !previewQuote && (
        <div style={{ position: 'sticky', top: 0, zIndex: 50, background: T.ink, color: T.paper, fontSize: 11, fontWeight: 500, letterSpacing: '0.06em', textAlign: 'center', padding: '8px 16px' }}>
          Staff preview — this is how the customer sees the quote. No tracking or status changes are recorded.
        </div>
      )}

      <div style={{ fontFamily: T.font, background: T.paper, color: T.graphite, WebkitFontSmoothing: 'antialiased', minHeight: '100%', display: 'flex', flexDirection: 'column', fontSize: 15 }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <header style={{ background: T.ink, color: T.paper, padding: '24px 22px 30px' }}>
          <div style={container}>
            <img src="/brand/lusso-white.png" alt="Lusso" style={{ width: 124, height: 'auto', display: 'block' }} />
            <div style={{ marginTop: 26 }}><Eyebrow color={T.bronze}>Quotation {quote.quoteNumber}</Eyebrow></div>
            <h1 style={{ margin: '10px 0 0', fontWeight: 300, fontSize: 29, lineHeight: 1.2, letterSpacing: '-0.5px', color: T.paper, textWrap: 'pretty' }}>
              {settings.businessName} quotation for {customer?.name || 'you'}
            </h1>
            {quote.siteAddress && <p style={{ margin: '12px 0 0', fontSize: 13.5, lineHeight: 1.7, color: T.onInverseMuted }}>{quote.siteAddress}</p>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 20 }}>
              <span style={{ fontSize: 11, letterSpacing: '0.06em', padding: '6px 12px', border: `0.5px solid ${T.borderInverse}`, borderRadius: 999, color: T.onInverseMuted }}>Issued {fmtDate(quote.createdAt)}</span>
              <span style={{ fontSize: 11, letterSpacing: '0.06em', padding: '6px 12px', borderRadius: 999, border: `0.5px solid ${isExpired ? T.bronze : T.borderInverse}`, color: isExpired ? T.bronze : T.onInverseMuted }}>{validityText}</span>
            </div>
          </div>
        </header>

        {/* ── From / For ─────────────────────────────────────────────────── */}
        <div style={{ ...container, padding: '32px 22px 0' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            <div style={{ ...card, flex: '1 1 250px' }}>
              <Eyebrow>From</Eyebrow>
              <p style={{ margin: '14px 0 0', fontSize: 16, fontWeight: 500, color: T.ink }}>{settings.businessName}</p>
              {quote.salesperson && <p style={{ margin: '2px 0 0', fontSize: 13.5, color: T.stone }}>{quote.salesperson}</p>}
              <hr style={hairline} />
              <div style={{ display: 'grid', gap: 12 }}>
                {settings.businessAddress && <div><div style={fieldLabel}>Postal address</div><p style={{ margin: '4px 0 0', fontSize: 13.5, lineHeight: 1.6 }}>{settings.businessAddress}</p></div>}
                {settings.businessPhone && (
                  <div>
                    <div style={fieldLabel}>Phone</div>
                    <p style={{ margin: '4px 0 0', fontSize: 13.5 }}>{settings.businessPhone}</p>
                    {settings.businessPhoneSms && (
                      <p style={{ margin: '2px 0 0', fontSize: 12.5, color: T.stone }}>or text {settings.businessPhoneSms}</p>
                    )}
                  </div>
                )}
                {settings.businessEmail && <div><div style={fieldLabel}>Email</div><p style={{ margin: '4px 0 0', fontSize: 13.5 }}><a href={`mailto:${settings.businessEmail}`} style={{ color: T.bronze, textDecoration: 'none' }}>{settings.businessEmail}</a></p></div>}
                {settings.businessWebsite && <div><div style={fieldLabel}>Website</div><p style={{ margin: '4px 0 0', fontSize: 13.5 }}><a href={`https://${String(settings.businessWebsite).replace(/^https?:\/\//, '')}`} target="_blank" rel="noreferrer" style={{ color: T.bronze, textDecoration: 'none' }}>{settings.businessWebsite}</a></p></div>}
                {settings.businessABN && <div><div style={fieldLabel}>ABN</div><p style={{ margin: '4px 0 0', fontSize: 13.5, letterSpacing: '0.04em' }}>{settings.businessABN}</p></div>}
              </div>
            </div>

            <div style={{ ...card, flex: '1 1 250px' }}>
              <Eyebrow>For</Eyebrow>
              <p style={{ margin: '14px 0 0', fontSize: 16, fontWeight: 500, color: T.ink }}>{customer?.name || 'Valued customer'}</p>
              {customer?.email && <p style={{ margin: '2px 0 0', fontSize: 13.5, color: T.stone }}>{customer.email}</p>}
              <hr style={hairline} />
              <div style={{ display: 'grid', gap: 12 }}>
                {quote.siteAddress && <div><div style={fieldLabel}>Site address</div><p style={{ margin: '4px 0 0', fontSize: 13.5, lineHeight: 1.6 }}>{quote.siteAddress}</p></div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px' }}>
                  <div><div style={fieldLabel}>Quote number</div><p style={{ margin: '4px 0 0', fontSize: 13.5 }}>{quote.quoteNumber}</p></div>
                  <div><div style={fieldLabel}>Date</div><p style={{ margin: '4px 0 0', fontSize: 13.5 }}>{fmtDate(quote.createdAt)}</p></div>
                </div>
                {quote.expiryDate && <div><div style={fieldLabel}>Expiry date</div><p style={{ margin: '4px 0 0', fontSize: 13.5 }}>{fmtDate(new Date(quote.expiryDate))}</p></div>}
              </div>
            </div>
          </div>
        </div>

        {/* ── Intro message ──────────────────────────────────────────────── */}
        {/* Written per quote in the builder under a field literally labelled
            "Introduction Message (customer-facing)" — and rendered, until now,
            only on the internal staff view. */}
        {quote.introMessage && (
          <div style={{ ...container, padding: '28px 22px 0' }}>
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.75, color: T.graphite, maxWidth: '62ch', whiteSpace: 'pre-wrap' }}>
              {quote.introMessage}
            </p>
          </div>
        )}

        {/* ── Options ────────────────────────────────────────────────────── */}
        <div style={{ ...container, padding: '34px 22px 0' }}>
          <div style={{ borderTop: `2px solid ${T.bronze}`, paddingTop: 16, maxWidth: '60ch' }}>
            <h2 style={{ margin: 0, fontWeight: 300, fontSize: 21, letterSpacing: '-0.3px', color: T.ink }}>Your options</h2>
            <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.7, color: T.graphite }}>
              Everything below is quoted for your rooms. Toggle the pieces you want, or choose between treatments where we have offered alternatives — your total updates as you go.{quote.includesGST ? ' Prices exclude GST.' : ''}
            </p>
          </div>

          {rooms.map(({ room, entries }) => (
            <section key={room} style={{ marginTop: 38 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <h3 style={h3}>{room}</h3>
                <span style={{ fontSize: 11, color: T.stone }}>{entries.length} {entries.length === 1 ? 'item' : 'items'}</span>
              </div>
              <hr style={{ ...hairline, margin: '12px 0 18px' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                {entries.map(entry => (
                  <div key={entry.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                    <RefBadge>{entry.ref}</RefBadge>
                    <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
                      {entry.blocks.map(block => {
                        const isChoice = block.kind === 'choice';
                        const anyPicked = block.items.some(i => selectedOptionals.includes(i.id));
                        return (
                          <div key={block.key} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {block.eyebrow && (
                              <Eyebrow color={isChoice ? T.bronze : T.stone} dash={isChoice ? T.bronze : T.stone}>{block.eyebrow}</Eyebrow>
                            )}
                            <div style={isChoice
                              ? { display: 'flex', flexDirection: 'column', gap: 10, background: '#EFEFEE', border: `0.5px solid ${T.mist}`, borderRadius: 12, padding: 16 }
                              : { display: 'flex', flexDirection: 'column', gap: 10 }}>
                              {block.items.map(item => <OptionCard key={item.id} item={{ ...item, _group: block.items }} kind={block.kind} />)}
                              {isChoice && !block.required && (
                                <button type="button" onClick={() => clearChoice(block.items)} disabled={locked}
                                  style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: '6px 0 2px', fontFamily: 'inherit', fontSize: 12.5, color: !anyPicked ? T.ink : T.stone, cursor: locked ? 'default' : 'pointer', textDecoration: 'underline', textDecorationColor: T.mist, textUnderlineOffset: 4 }}>
                                  Prefer none of these for now
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {quote.planSnapshot?.pages?.length > 0 && (
          <div style={{ ...container, padding: '40px 22px 0' }}>
            <PlanSection snapshot={quote.planSnapshot} />
          </div>
        )}

        {/* ── Summary + terms + payment + reviews + CTA ──────────────────── */}
        <div style={{ ...container, padding: '40px 22px 0' }} ref={tailRef}>
          <section style={{ ...card, padding: 22 }}>
            <Eyebrow>Summary</Eyebrow>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, marginTop: 16 }}>
              <span style={{ fontSize: 14 }}>Options selected</span>
              <span style={{ fontSize: 14, fontWeight: 500, color: T.ink }}>{selectedLabel}</span>
            </div>
            <hr style={hairline} />
            <div style={{ display: 'grid', gap: 12 }}>
              {summaryRows.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
                  <span style={r.lStyle}>{r.label}</span><span style={r.vStyle}>{r.value}</span>
                </div>
              ))}
            </div>
            {quote.includesGST && gstFreeTotal > 0 && (
              <p style={{ margin: '12px 0 0', fontSize: 11.5, lineHeight: 1.6, color: T.stone }}>
                {money(gstFreeTotal)} of the items above are GST free and are left out of the GST calculation.
              </p>
            )}
            <hr style={{ ...hairline, margin: '18px 0' }} />
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
              <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: T.stone }}>Total AUD</span>
              <span style={{ fontSize: 28, fontWeight: 300, letterSpacing: '-0.5px', color: T.ink }}>{money(totals.total)}</span>
            </div>
            {depoLabel && <p style={{ margin: '10px 0 0', fontSize: 11.5, lineHeight: 1.6, color: T.stone }}>A {depoLabel} deposit ({money(totals.deposit)}) confirms your order.</p>}
          </section>

          {/* Terms & Conditions */}
          {(termsText || settings.termsAttachmentUrl) && (
            <section style={{ marginTop: 34 }}>
              <Eyebrow>Terms and conditions</Eyebrow>
              {termsText && <p style={{ margin: '14px 0 0', fontSize: 14, lineHeight: 1.7, maxWidth: '60ch', whiteSpace: 'pre-wrap' }}>{termsText}</p>}
              {settings.termsAttachmentUrl && (
                <a href={settings.termsAttachmentUrl} target="_blank" rel="noreferrer"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 14, padding: '12px 16px', border: `0.5px solid ${T.mist}`, borderRadius: 6, background: T.paperPure, fontSize: 13.5, color: T.ink, textDecoration: 'none' }}>
                  {settings.termsAttachmentLabel || 'Download full Terms & Conditions'} <span aria-hidden="true">↗</span>
                </a>
              )}
            </section>
          )}

          {/* To place your order */}
          <section style={{ marginTop: 34, borderTop: `0.5px solid ${T.mist}`, paddingTop: 28 }}>
            <h3 style={h3}>To place your order</h3>
            {settings.orderTerms && <p style={{ margin: '12px 0 0', fontSize: 14, lineHeight: 1.7, maxWidth: '60ch' }}>{settings.orderTerms}</p>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 20 }}>
              {depoLabel && (
                <div style={{ ...card, flex: '1 1 240px' }}>
                  <div style={fieldLabel}>Terms of trade</div>
                  <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.7 }}>
                    {depoLabel} deposit on acceptance. {settings.termsOfTrade || ''}
                  </p>
                </div>
              )}
              {(pay.bsb || pay.accountNumber) && (
                <div style={{ ...card, flex: '1 1 240px' }}>
                  <div style={fieldLabel}>Direct deposit</div>
                  <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                    {pay.bsb && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5 }}><span style={{ color: T.stone }}>BSB</span><span style={{ letterSpacing: '0.06em', color: T.ink }}>{pay.bsb}</span></div>}
                    {pay.accountNumber && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5 }}><span style={{ color: T.stone }}>Account</span><span style={{ letterSpacing: '0.06em', color: T.ink }}>{pay.accountNumber}</span></div>}
                    {pay.accountName && <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13.5 }}><span style={{ color: T.stone }}>Name</span><span style={{ color: T.ink, textAlign: 'right' }}>{pay.accountName}</span></div>}
                  </div>
                </div>
              )}
              {(pay.creditCardNote || pay.amexSurchargePercent) && (
                <div style={{ ...card, flex: '1 1 240px' }}>
                  <div style={fieldLabel}>Credit card</div>
                  <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.7 }}>{pay.creditCardNote || 'Please call to pay by card.'}{pay.amexSurchargePercent ? ` Amex attracts a ${pay.amexSurchargePercent}% surcharge.` : ''}</p>
                </div>
              )}
            </div>
          </section>

          {/* Reviews */}
          {testimonials.length > 0 && (
            <section style={{ marginTop: 34, borderTop: `0.5px solid ${T.mist}`, paddingTop: 28 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                <div>
                  <Eyebrow>Reviews</Eyebrow>
                  {settings.googleRating && (
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 12 }}>
                      <span style={{ fontSize: 15, letterSpacing: '0.18em', color: T.bronze }}>★★★★★</span>
                      <span style={{ fontSize: 13.5, color: T.graphite }}>{settings.googleRating} from {settings.googleReviewCount || 'many'} reviews</span>
                    </div>
                  )}
                </div>
                {reviewsUrl && <a href={reviewsUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: T.bronze, textDecoration: 'none' }}>See all reviews ↗</a>}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 20 }}>
                {testimonials.map((t, i) => (
                  <blockquote key={i} style={{ flex: '1 1 230px', margin: 0, ...card }}>
                    <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.75, color: T.graphite }}>{t.quote}</p>
                    <footer style={{ marginTop: 14, fontSize: 11, letterSpacing: '0.06em', color: T.stone }}>{t.name}{t.location ? ` · ${t.location}` : ''}</footer>
                  </blockquote>
                ))}
              </div>
            </section>
          )}

          {/* CTA / terminal states */}
          <section style={{ marginTop: 34, borderTop: `0.5px solid ${T.mist}`, paddingTop: 28, paddingBottom: 8 }}>
            {!accepted && !declined && !isExpired && (
              <div>
                <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, maxWidth: '60ch', color: T.graphite }}>
                  {acceptable
                    ? `Accepting confirms your selection at ${money(totals.total)}${quote.includesGST ? ' including GST' : ''}.`
                    : unansweredRequired.length
                      ? `Please choose an option under ${listAnd(unansweredRequired.map(g => g.title))} before accepting.`
                      : 'Select at least one option above to accept this quotation.'}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
                  <Button size="lg" variant="primary" disabled={!acceptable} onClick={askAccept}>Accept quotation</Button>
                  <Button size="lg" variant="secondary" onClick={askDecline}>Decline quotation</Button>
                </div>
              </div>
            )}
            {!accepted && !declined && isExpired && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', background: T.mist, borderRadius: 8, padding: 18 }}>
                <span style={{ width: 18, height: 2, background: T.bronze, display: 'block', marginTop: 9, flex: '0 0 auto' }} />
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7, color: T.graphite }}>
                  This quotation expired on {fmtDate(new Date(quote.expiryDate))}, so it can no longer be accepted online. Call us on {settings.businessPhone} and we will refresh the pricing on the same selections.
                </p>
              </div>
            )}
            {accepted && (
              <div style={{ background: T.ink, borderRadius: 8, padding: 26 }}>
                <Eyebrow color={T.bronze}>Accepted</Eyebrow>
                <h3 style={{ margin: '14px 0 0', fontWeight: 300, fontSize: 23, letterSpacing: '-0.4px', color: T.paper }}>Thank you — your quotation is accepted.</h3>
                <p style={{ margin: '12px 0 0', fontSize: 13.5, lineHeight: 1.75, color: T.onInverseMuted, maxWidth: '52ch' }}>
                  We have your selections and will call within one business day to arrange your deposit and book the install.{customer?.email ? ` A copy has been emailed to ${customer.email}.` : ''}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 22, paddingTop: 20, borderTop: `0.5px solid ${T.borderInverse}` }}>
                  <div><div style={{ ...fieldLabel, color: T.onInverseMuted }}>Accepted total</div><p style={{ margin: '6px 0 0', fontSize: 19, fontWeight: 300, color: T.paper }}>{money(totals.total)}</p></div>
                  <div><div style={{ ...fieldLabel, color: T.onInverseMuted }}>Options</div><p style={{ margin: '6px 0 0', fontSize: 19, fontWeight: 300, color: T.paper }}>{selectedLabel}</p></div>
                  <div><div style={{ ...fieldLabel, color: T.onInverseMuted }}>Accepted</div><p style={{ margin: '6px 0 0', fontSize: 19, fontWeight: 300, color: T.paper }}>{fmtDate(new Date())}</p></div>
                </div>
              </div>
            )}
            {declined && !accepted && (
              <div style={{ ...card, border: `0.5px solid ${T.stone}`, padding: 24 }}>
                <p style={{ margin: 0, fontSize: 16, color: T.ink, fontWeight: 500 }}>Quotation declined</p>
                <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.75, color: T.graphite, maxWidth: '52ch' }}>
                  Thank you for letting us know. If anything about the fabrics or the price needs another look, call us on {settings.businessPhone} — we are happy to re-quote.
                </p>
                {!isExpired && <button type="button" onClick={reopen} style={{ marginTop: 16, background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', fontSize: 13, color: T.bronze, cursor: 'pointer' }}>Reopen this quotation</button>}
              </div>
            )}
          </section>

          <div style={{ height: 8 }} />
        </div>

        {/* ── Confirm sheet ──────────────────────────────────────────────── */}
        {sheet && (
          <div
            onClick={() => !busy && setSheet(null)}
            style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(16,17,19,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', padding: 16 }}
          >
            <div
              role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 460, background: T.paperPure, borderRadius: 14, padding: 24, boxShadow: T.shadowCard, maxHeight: '88vh', overflowY: 'auto' }}
            >
              {sheet === 'accept' ? (
                <>
                  <Eyebrow>Confirm</Eyebrow>
                  <h3 style={{ ...h3, marginTop: 14 }}>Accept this quotation?</h3>
                  <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.7, color: T.graphite }}>
                    This confirms your order at the total below and we&rsquo;ll call to arrange your deposit.
                    Once accepted, changes need to go through us.
                  </p>
                  <div style={{ marginTop: 18, borderTop: `0.5px solid ${T.mist}`, paddingTop: 14, display: 'grid', gap: 8 }}>
                    {activeItems.map(li => (
                      <div key={li.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 14, fontSize: 13 }}>
                        <span style={{ color: T.graphite, minWidth: 0 }}>
                          {li.productNameSnapshot || 'Window treatment'}
                          {li.location ? <span style={{ color: T.stone }}> · {li.location}</span> : null}
                        </span>
                        <span style={{ color: T.ink, whiteSpace: 'nowrap' }}>{money(linePricing(li).lineTotal)}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 14, borderTop: `0.5px solid ${T.mist}`, paddingTop: 14, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
                    <span style={{ ...fieldLabel }}>Total AUD</span>
                    <span style={{ fontSize: 22, fontWeight: 300, letterSpacing: '-0.4px', color: T.ink }}>{money(totals.total)}</span>
                  </div>
                  {depoLabel && (
                    <p style={{ margin: '8px 0 0', fontSize: 12, lineHeight: 1.6, color: T.stone }}>
                      A {depoLabel} deposit ({money(totals.deposit)}) will be arranged with you by phone.
                    </p>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 22 }}>
                    <Button size="lg" variant="primary" disabled={busy} onClick={handleAccept}>
                      {busy ? 'Accepting…' : 'Yes, accept'}
                    </Button>
                    <Button size="lg" variant="secondary" disabled={busy} onClick={() => setSheet(null)}>Back</Button>
                  </div>
                </>
              ) : (
                <>
                  <Eyebrow>Before you go</Eyebrow>
                  <h3 style={{ ...h3, marginTop: 14 }}>Decline this quotation?</h3>
                  <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.7, color: T.graphite }}>
                    If anything is close but not quite right, telling us why is usually enough for us to
                    fix it — it costs you nothing and we&rsquo;ll re-quote.
                  </p>
                  <label style={{ ...fieldLabel, display: 'block', marginTop: 18 }}>Reason (optional)</label>
                  <textarea
                    value={declineReason} onChange={e => setDeclineReason(e.target.value)} rows={3}
                    placeholder="Too expensive, going with someone else, timing isn't right…"
                    style={{ width: '100%', boxSizing: 'border-box', marginTop: 8, padding: '10px 12px', fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.6, color: T.ink, background: T.paper, border: `0.5px solid ${T.mist}`, borderRadius: 8, resize: 'vertical' }}
                  />
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
                    <Button size="lg" variant="secondary" disabled={busy} onClick={handleDecline}>
                      {busy ? 'Sending…' : 'Decline quotation'}
                    </Button>
                    <Button size="lg" variant="primary" disabled={busy} onClick={() => setSheet(null)}>Keep looking</Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Sticky summary bar ─────────────────────────────────────────── */}
        <div style={{ position: 'sticky', bottom: 0, marginTop: 'auto', background: 'rgba(247,247,246,0.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderTop: `0.5px solid ${T.mist}`, zIndex: 5 }}>
          <div style={{ ...container, padding: '0 22px' }}>
            {expanded && (
              <div style={{ padding: '18px 0 4px', borderBottom: `0.5px solid ${T.mist}` }}>
                <div style={{ display: 'grid', gap: 11, paddingBottom: 16 }}>
                  {summaryRows.concat([{ label: 'Total AUD', value: money(totals.total), lStyle: { ...rowLabel, fontWeight: 500, color: T.ink }, vStyle: { ...rowValue, fontSize: 15 } }]).map((r, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16 }}>
                      <span style={r.lStyle}>{r.label}</span><span style={r.vStyle}>{r.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 0 16px' }}>
              <button type="button" onClick={() => setExpanded(e => !e)} style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: 0, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer', minWidth: 0 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 22, fontWeight: 300, letterSpacing: '-0.4px', color: T.ink, whiteSpace: 'nowrap' }}>{money(totals.total)}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3 }}>
                    <span style={{ fontSize: 11, color: unansweredRequired.length ? T.bronze : T.stone, whiteSpace: 'nowrap' }}>
                      {unansweredRequired.length
                        ? `${unansweredRequired.length} choice${unansweredRequired.length > 1 ? 's' : ''} still to make`
                        : `${selectedLabel} options${quote.includesGST ? ' · incl. GST' : ''}`}
                    </span>
                    <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.bronze, whiteSpace: 'nowrap' }}>{expanded ? 'Hide ▲' : 'Breakdown ▼'}</span>
                  </div>
                </div>
              </button>
              <div style={{ flex: '0 0 auto' }}>
                <Button size="md" variant="primary" disabled={!acceptable || accepted || declined}
                  onClick={accepted || declined ? undefined : askAccept}>
                  {accepted ? 'Accepted' : isExpired ? 'Expired' : 'Accept'}
                </Button>
              </div>
            </div>
          </div>
        </div>

      </div>

      {/* Anything the embedder puts here sits BELOW the quote's own sticky
          summary bar, so it can only be reached by scrolling past the end of
          what the customer sees. That is the point: the send control in the
          builder is deliberately behind the whole quote. */}
      {footer}
    </div>
  );
}
