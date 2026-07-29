import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { format, parseISO, isPast } from 'date-fns';
import {
  getQuote, getCustomer, getQuoteSettings,
  computeQuoteTotals, linePricing, markQuoteViewed, acceptQuote, declineQuote,
} from '../store/data';
import { supabase } from '../lib/supabase';
import { fromDb } from '../store/db';
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
const prettyGroup = (id) => (!id || id === '__default__') ? '' : String(id).replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

// The signature bronze dash + uppercase eyebrow.
function Eyebrow({ children, color = T.stone, dash = T.bronze }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ width: 18, height: 2, background: dash, display: 'block', flex: '0 0 auto' }} />
      <span style={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color }}>{children}</span>
    </div>
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

export default function CustomerQuotePage() {
  const { id }         = useParams();
  const [searchParams] = useSearchParams();
  const isStaffPreview = searchParams.get('preview') === '1';
  const settings = getQuoteSettings();

  const [quote, setQuote] = useState(() => {
    const q = getQuote(id);
    if (!isStaffPreview && q && ['Sent', 'Viewed'].includes(q.status)) markQuoteViewed(id);
    return getQuote(id);
  });
  const [selectedOptionals, setSelectedOptionals] = useState([]);
  const [localStatus, setLocalStatus] = useState(null); // 'accepted' | 'declined'
  const [expanded, setExpanded] = useState(false);
  const tailRef = useRef(null);

  useEffect(() => {
    if (quote || !supabase || !id) return;
    supabase.rpc('get_public_quote', { p_id: id }).maybeSingle().then(({ data, error }) => {
      if (!error && data) {
        // fromDb applies the acronym-tail special cases (includes_gst → includesGST)
        // that a plain snake→camel regex would mangle to includesGst.
        setQuote(fromDb(data));
      }
    });
  }, [id, quote]);

  const isFirstOpen = !quote?.firstOpenedAt;
  const { trackAccept, trackDecline } = useQuoteTracking((!isStaffPreview && quote) ? id : null, isFirstOpen);

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

  const customer  = getCustomer(quote.customerId);
  const isExpired = quote.expiryDate && isPast(new Date(quote.expiryDate));
  const accepted  = localStatus === 'accepted' || quote.status === 'Accepted';
  const declined  = localStatus === 'declined' || quote.status === 'Declined';
  const locked    = isExpired || accepted || declined;

  const gstRate = quote.gstRate || 10;
  const totals = computeQuoteTotals(
    quote.lineItems, quote.depositType, quote.depositValue, gstRate, quote.includesGST,
    selectedOptionals, quote.discountType, quote.discountValue,
  );

  // ── Build room-grouped option sections from the real line items ──────────
  const items = quote.lineItems || [];
  const requiredItems = items.filter(li => li.type === 'Required' || li.type === 'Part');
  const optionalItems = items.filter(li => li.type === 'Optional');
  const choiceItems   = items.filter(li => li.type === 'Multiple Choice');
  const roomOf = (li) => li.location || 'General';
  const rooms = [...new Set(items.map(roomOf))];

  const isSelected = (li) => li.type === 'Required' || li.type === 'Part' || selectedOptionals.includes(li.id);

  const groups = [];
  rooms.forEach(room => {
    const req = requiredItems.filter(li => roomOf(li) === room);
    if (req.length) groups.push({ key: `req-${room}`, kind: 'included', title: room, countLabel: 'Included', eyebrow: 'Included in your quotation', items: req });

    const choiceInRoom = choiceItems.filter(li => roomOf(li) === room);
    const byGroup = {};
    choiceInRoom.forEach(li => { const g = li.choiceGroupId || '__default__'; (byGroup[g] = byGroup[g] || []).push(li); });
    Object.entries(byGroup).forEach(([gid, gItems]) => {
      const name = prettyGroup(gid);
      groups.push({
        key: `choice-${room}-${gid}`, kind: 'choice', groupId: gid,
        title: name ? `${room} — ${name}` : `${room} options`, countLabel: 'Choose one',
        eyebrow: name ? `Choose one — ${name.toLowerCase()}` : `Choose one — ${room.toLowerCase()}`,
        clearText: 'Prefer none of these for now', items: gItems,
      });
    });

    const opt = optionalItems.filter(li => roomOf(li) === room);
    if (opt.length) groups.push({ key: `opt-${room}`, kind: 'optional', title: `${room} additions`, countLabel: 'Optional', eyebrow: 'Optional — add if you want it', items: opt });
  });

  const selectableIds = [...optionalItems, ...choiceItems].map(li => li.id);
  const selectedCount = selectableIds.filter(sid => selectedOptionals.includes(sid)).length;
  const selectedLabel = `${selectedCount} of ${selectableIds.length}`;

  // Summary rows — reconcile per-line + quote-level discounts.
  const activeItems = items.filter(isSelected);
  const lineDiscountTotal = activeItems.reduce((s, li) => s + (linePricing(li).discountTotal || 0), 0);
  const grossBefore = totals.grossSubtotal + lineDiscountTotal;

  const rowLabel = { fontSize: 13.5, color: T.graphite };
  const rowValue = { fontSize: 13.5, fontWeight: 500, color: T.ink, whiteSpace: 'nowrap' };
  const summaryRows = [{ label: 'Subtotal', value: money(grossBefore), lStyle: rowLabel, vStyle: rowValue }];
  if (lineDiscountTotal > 0) summaryRows.push({ label: 'Package discount', value: '−' + money(lineDiscountTotal), lStyle: rowLabel, vStyle: { ...rowValue, color: T.bronze } });
  if (totals.discount > 0) summaryRows.push({ label: quote.discountLabel || (quote.discountType === 'Percentage' ? `Discount (${quote.discountValue}%)` : 'Discount'), value: '−' + money(totals.discount), lStyle: rowLabel, vStyle: { ...rowValue, color: T.bronze } });
  if (quote.includesGST) summaryRows.push({ label: `GST ${gstRate}%`, value: money(totals.gst), lStyle: rowLabel, vStyle: rowValue });

  // ── Actions ──────────────────────────────────────────────────────────────
  const acceptable = !locked && selectedCount + requiredItems.length > 0;
  const scrollToTail = () => requestAnimationFrame(() => tailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  const handleAccept = async () => {
    if (locked) return;
    // Staff preview (?preview=1) must never record tracking or mutate status —
    // show the confirmation locally only.
    if (!isStaffPreview) {
      await trackAccept(customer?.name || '', customer?.email || '');
      acceptQuote(quote.id, { name: customer?.name || 'Customer', email: customer?.email || '' }, selectedOptionals);
    }
    setLocalStatus('accepted'); setExpanded(false); scrollToTail();
  };
  const handleDecline = async () => {
    if (locked) return;
    if (!isStaffPreview) {
      await trackDecline('');
      declineQuote(quote.id, '');
    }
    setLocalStatus('declined'); setExpanded(false); scrollToTail();
  };
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
    return (
      <div
        onClick={clickable ? () => (choice ? selectChoice(item._group, item.id) : toggleOptional(item.id)) : undefined}
        style={{
          display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap', padding: 18, borderRadius: 8,
          background: fixed ? 'transparent' : T.paperPure,
          border: `0.5px solid ${on ? T.ink : T.mist}`,
          borderLeft: `2px solid ${on && !fixed ? T.bronze : (fixed ? T.mist : 'transparent')}`,
          boxShadow: on && !fixed ? T.shadowCard : 'none',
          cursor: fixed ? 'default' : (locked ? 'default' : 'pointer'),
          transition: `border-color 200ms ${T.ease}, box-shadow 200ms ${T.ease}`,
        }}>
        <div style={{
          flex: '0 0 auto', width: 24, height: 24, marginTop: 1, borderRadius: round,
          display: 'flex', alignItems: 'center', justifyContent: 'center', transition: `all 200ms ${T.ease}`,
          background: on ? T.ink : T.paperPure, border: `1px solid ${on ? T.ink : T.stone}`,
        }}>
          {choice && on
            ? <span style={{ width: 8, height: 8, borderRadius: 999, background: T.paper, display: 'block' }} />
            : (on ? <span style={{ fontSize: 12, lineHeight: 1, color: T.paper }}>✓</span> : null)}
        </div>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.4, fontWeight: 500, color: on || fixed ? T.ink : T.graphite, textWrap: 'pretty' }}>{item.productNameSnapshot || 'Window treatment'}</p>
          {desc && <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.7, color: T.stone, textWrap: 'pretty' }}>{desc}</p>}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, marginTop: 12, padding: '5px 10px 5px 8px', borderRadius: 999,
            fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase',
            background: on && !fixed ? T.ink : 'transparent', border: on && !fixed ? 'none' : `0.5px solid ${T.mist}`, color: on && !fixed ? T.paper : T.stone,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: 999, display: 'block', background: on && !fixed ? T.bronze : T.mist }} />
            <span>{fixed ? 'Included' : (on ? 'Selected' : 'Not selected')}</span>
          </div>
        </div>
        <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
          {discountTotal > 0 && <div style={{ fontSize: 13, color: T.stone, textDecoration: 'line-through' }}>{money(preDiscountSell * qty)}</div>}
          <div style={{ fontSize: 18, fontWeight: on ? 500 : 400, letterSpacing: '-0.2px', whiteSpace: 'nowrap', color: on ? T.ink : T.stone }}>{money(lineTotal)}</div>
          <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.stone, marginTop: 4 }}>
            {quote.includesGST ? 'ex GST' : ''}{qty > 1 ? `${quote.includesGST ? ' · ' : ''}${money(finalSell)} × ${qty}` : ''}
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
      {isStaffPreview && (
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
              Lusso Fashion for Windows quotation for {customer?.name || 'you'}
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
                {settings.businessPhone && <div><div style={fieldLabel}>Phone</div><p style={{ margin: '4px 0 0', fontSize: 13.5 }}>{settings.businessPhone}</p></div>}
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

        {/* ── Options ────────────────────────────────────────────────────── */}
        <div style={{ ...container, padding: '34px 22px 0' }}>
          <div style={{ borderTop: `2px solid ${T.bronze}`, paddingTop: 16, maxWidth: '60ch' }}>
            <h2 style={{ margin: 0, fontWeight: 300, fontSize: 21, letterSpacing: '-0.3px', color: T.ink }}>Your options</h2>
            <p style={{ margin: '10px 0 0', fontSize: 14, lineHeight: 1.7, color: T.graphite }}>
              Everything below is quoted for your rooms. Toggle the pieces you want, or choose between treatments where we have offered alternatives — your total updates as you go.{quote.includesGST ? ' Prices exclude GST.' : ''}
            </p>
          </div>

          {groups.map(group => {
            const isChoice = group.kind === 'choice';
            const anyPicked = group.items.some(i => selectedOptionals.includes(i.id));
            return (
              <section key={group.key} style={{ marginTop: 38 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
                  <h3 style={h3}>{group.title}</h3>
                  <span style={{ fontSize: 11, color: T.stone }}>{group.countLabel}</span>
                </div>
                <hr style={{ ...hairline, margin: '12px 0 16px' }} />
                <div style={isChoice
                  ? { display: 'flex', flexDirection: 'column', gap: 10, background: '#EFEFEE', border: `0.5px solid ${T.mist}`, borderRadius: 12, padding: 16 }
                  : { display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Eyebrow color={isChoice ? T.bronze : T.stone} dash={isChoice ? T.bronze : T.stone}>{group.eyebrow}</Eyebrow>
                  {group.items.map(item => <OptionCard key={item.id} item={{ ...item, _group: group.items }} kind={group.kind} />)}
                  {isChoice && (
                    <button type="button" onClick={() => clearChoice(group.items)} disabled={locked}
                      style={{ alignSelf: 'flex-start', background: 'none', border: 'none', padding: '6px 0 2px', fontFamily: 'inherit', fontSize: 12.5, color: !anyPicked ? T.ink : T.stone, cursor: locked ? 'default' : 'pointer', textDecoration: 'underline', textDecorationColor: T.mist, textUnderlineOffset: 4 }}>
                      {group.clearText}
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>

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
                  <p style={{ margin: '10px 0 0', fontSize: 13.5, lineHeight: 1.7 }}>{depoLabel} deposit on acceptance, balance on booking of installation. Orders for custom-built product cannot be cancelled.</p>
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
                {settings.googleReviewUrl && <a href={settings.googleReviewUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: T.bronze, textDecoration: 'none' }}>See all reviews ↗</a>}
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
                  {acceptable ? `Accepting confirms your selection at ${money(totals.total)}${quote.includesGST ? ' including GST' : ''}.` : 'Select at least one option above to accept this quotation.'}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
                  <Button size="lg" variant="primary" disabled={!acceptable} onClick={handleAccept}>Accept quotation</Button>
                  <Button size="lg" variant="secondary" onClick={handleDecline}>Decline quotation</Button>
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
                    <span style={{ fontSize: 11, color: T.stone, whiteSpace: 'nowrap' }}>{selectedLabel} options{quote.includesGST ? ' · incl. GST' : ''}</span>
                    <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.bronze, whiteSpace: 'nowrap' }}>{expanded ? 'Hide ▲' : 'Breakdown ▼'}</span>
                  </div>
                </div>
              </button>
              <div style={{ flex: '0 0 auto' }}>
                <Button size="md" variant="primary" disabled={!acceptable || accepted || declined}
                  onClick={accepted || declined ? undefined : handleAccept}>
                  {accepted ? 'Accepted' : isExpired ? 'Expired' : 'Accept'}
                </Button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
