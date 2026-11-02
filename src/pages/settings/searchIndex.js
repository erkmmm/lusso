// ─── Settings search index ────────────────────────────────────────────────────
// A settings page is only navigable if you can ask it a question. There are
// ~25 cards and well over a hundred fields here, and knowing that the SMS a
// customer gets when their quote is ready lives under "Message templates →
// SMS" is not something anyone should have to know.
//
// The index is written by hand rather than scraped off the rendered DOM: the
// cards render one section at a time, so there is nothing to scrape until you
// are already on the right page — which is the problem, not the solution.
//
// Each entry resolves to { section, card }. Settings.jsx opens the section and
// flashes the card. Keep `terms` to the words someone would actually type,
// including the ones NOT in the label ("dark mode" for light & dark, "BSB" for
// order & payment).

export const SEARCH_ENTRIES = [
  // ── Appearance ──
  { section: 'appearance', card: 'light-dark', label: 'Light & dark mode',
    terms: 'theme dark mode light night appearance system schedule automatic' },
  { section: 'appearance', card: 'colour-theme', label: 'Colour theme',
    terms: 'colour color palette accent glass lusso apex taupe green cyberpunk matrix mono neon magenta twitter brand' },
  { section: 'appearance', card: 'wallpaper', label: 'Wallpaper (Glass theme)',
    terms: 'wallpaper background photo image dim glass room picture upload' },
  { section: 'appearance', card: 'animated-background', label: 'Animated background',
    terms: 'animated background motion gradient mesh plasma moving reduced motion' },

  // ── Notifications ──
  { section: 'notifications', card: 'push-device', label: 'Push on this device',
    terms: 'push notification alert phone desktop lock screen subscribe device test blocked home screen iphone' },
  { section: 'notifications', card: 'notification-types', label: 'What you’re notified about',
    terms: 'notification mute silence quote opened accepted declined installer customer reply task due morning brief review' },

  // ── Quote page ──
  { section: 'quote-page', card: 'business-details', label: 'Business details',
    terms: 'business name abn phone sms number email website postal address from panel footer company' },
  { section: 'quote-page', card: 'what-happens-next', label: 'What happens next',
    terms: 'lead time weeks expiry expires reason timeline next steps validity' },
  { section: 'quote-page', card: 'trust-points', label: 'Trust points & warranty',
    terms: 'trust points warranty guarantee family owned insured claims' },
  { section: 'quote-page', card: 'order-payment', label: 'Order & payment',
    terms: 'payment bank bsb account number deposit order terms trade amex surcharge credit card terms conditions privacy policy attachment' },
  { section: 'quote-page', card: 'reviews-testimonials', label: 'Reviews & testimonials',
    terms: 'google rating review count review url testimonial stars read reviews write a review' },

  // ── Quote wording ──
  { section: 'wording', card: 'operation-wording', label: 'Operation wording',
    terms: 'operation wording kaw mkh oslo track motor wand operated plain english code name' },
  { section: 'wording', card: 'fabric-wording', label: 'Fabric type wording',
    terms: 'fabric wording keyword kleen screen blockout sheer roller blind name' },

  // ── Message templates ──
  { section: 'messages', card: 'message-presets', label: 'Quote email & SMS presets',
    terms: 'message preset template quote email introduction terms conditions sms follow up quote ready order confirmed appointment reminder installation booked' },
  { section: 'messages', card: 'po-email-presets', label: 'Purchase order email presets',
    terms: 'purchase order po supplier email preset pre-written body' },
  { section: 'messages', card: 'website-auto-reply', label: 'Website lead auto-reply',
    terms: 'website lead auto reply autoreply enquiry acknowledgement instant email form lusso.com.au' },

  // ── Product types ──
  { section: 'products', card: 'product-types', label: 'Product types',
    terms: 'product type specs spec order measure sheet dropdown disable enable rename operation types per type override option family motor' },

  // ── Measure sheet ──
  { section: 'measure', card: 'measure-sheet-options', label: 'Measure sheet options',
    terms: 'measure sheet option dropdown add track type scope all products narrow' },

  // ── Curtain rates ──
  { section: 'curtains', card: 'curtain-rates', label: 'Curtain costing rates',
    terms: 'curtain rate cost fullness heading fabric making lining fitting track per metre calculator' },
  { section: 'curtains', card: 'oslo-bands', label: 'Oslo track price bands',
    terms: 'oslo band track price width motorised clear wave fold' },

  // ── Integrations ──
  { section: 'integrations', card: 'xero-integration', label: 'Xero integration',
    terms: 'xero invoice accounting connect oauth organisation branding theme account code' },
  { section: 'integrations', card: 'buz-fabric-codes', label: 'BUZ fabric code overrides',
    terms: 'buz export inventory code fabric range override xlsx order roller blind' },
  { section: 'integrations', card: 'buz-value-maps', label: 'BUZ value translations',
    terms: 'buz value translation controltype rolldir bottomtrim mapping wording column' },

  // ── Advanced ──
  { section: 'sync', card: 'sync-status', label: 'Cloud sync status',
    terms: 'sync cloud status offline supabase connection diagnostics' },
  { section: 'sync', card: 'danger-zone', label: 'Danger zone — force push / pull / resync',
    terms: 'force push pull reset resync overwrite repair data wrong out of sync danger' },
  { section: 'ai', card: null, label: 'AI knowledge base',
    terms: 'ai knowledge base job assistant document price list catalogue upload pdf policy' },
];

/**
 * Rank entries against a query.
 *
 * Deliberately simple: every typed word must appear somewhere in the entry
 * (label + section + terms), so "sms quote ready" narrows rather than widens.
 * A label hit outranks a keyword hit, since someone typing the card's name
 * wants that card, not everything that mentions it.
 */
export function searchSettings(query, navIndex = {}) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];

  return SEARCH_ENTRIES
    .map(e => {
      const sectionLabel = navIndex[e.section]?.label || '';
      const haystack = `${e.label} ${sectionLabel} ${e.terms}`.toLowerCase();
      if (!words.every(w => haystack.includes(w))) return null;
      const label = e.label.toLowerCase();
      const score = words.reduce((n, w) => n + (label.includes(w) ? 2 : 0), 0);
      return { ...e, sectionLabel, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}
