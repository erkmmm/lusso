// Where customers come from — one canonical list, used by every place that
// asks and every report that counts.
//
// The point of this file is that attribution only works if the answers are
// closed-vocabulary. A free-text box collects "google", "Google", "the
// internet", "found us online" and "ad?" and none of them group, which is how
// you end up unable to tell paid from organic after spending $20k on ads.
//
// `paid` marks the sources that cost money per lead, so the growth scoreboard
// can divide spend by booked measures without being told which rows to count.

export const LEAD_SOURCES = [
  { value: 'google_ads',     label: 'Google Ads',              paid: true,  hint: 'Clicked a paid search ad' },
  { value: 'google_organic', label: 'Google — organic search', paid: false, hint: 'Found a page in normal results' },
  { value: 'gbp',            label: 'Google Business Profile', paid: false, hint: 'The map listing or review panel' },
  { value: 'website',        label: 'Website enquiry form',    paid: false, hint: 'Submitted the form on lusso.com.au' },
  { value: 'referral_trade', label: 'Trade referral',          paid: false, hint: 'Builder, designer, architect, stylist' },
  { value: 'referral_past',  label: 'Past customer referral',  paid: false, hint: 'Sent by someone who bought before' },
  { value: 'repeat',         label: 'Repeat customer',         paid: false, hint: 'Has bought from Lusso before' },
  { value: 'word_of_mouth',  label: 'Word of mouth',           paid: false, hint: 'Knows of Lusso, no named referrer' },
  { value: 'signage',        label: 'Signage or vehicle',      paid: false, hint: 'Saw the van or a site sign' },
  { value: 'social',         label: 'Social media',            paid: false, hint: 'Instagram or Facebook' },
  { value: 'other',          label: 'Other',                   paid: false, hint: '' },
];

const BY_VALUE = new Map(LEAD_SOURCES.map(s => [s.value, s]));

/** Display label for a stored value; falls back to the raw value, never blank. */
export const leadSourceLabel = (v) =>
  !v ? 'Not asked' : (BY_VALUE.get(v)?.label || v);

export const isPaidSource = (v) => !!BY_VALUE.get(v)?.paid;

// web_enquiries.source is written by the public site's form handler and uses
// its own words. Map them onto the canonical list when a web lead is converted
// into a customer, so a form submission and a phone call about the same ad
// land in the same bucket.
const WEB_SOURCE_MAP = {
  website: 'website',
  web: 'website',
  contact_form: 'website',
  organic: 'google_organic',
  google: 'google_organic',
  gbp: 'gbp',
  maps: 'gbp',
  ads: 'google_ads',
  google_ads: 'google_ads',
  cpc: 'google_ads',
  paid: 'google_ads',
};

/**
 * Best canonical source for a converted web lead. Falls back to 'website',
 * which is true by construction — it did arrive through the site — rather
 * than leaving it null and losing the one thing we do know.
 */
export function leadSourceFromWebEnquiry(enquiry) {
  const meta = enquiry?.meta || {};

  // A Google Ads click carries gclid (or gbraid/wbraid on iOS) through
  // autotagging, which is ON BY DEFAULT and survives when someone forgets the
  // utm tags on a final URL. Check it first: it is the most reliable paid
  // signal there is, and the marketing site already captures it first-touch.
  if (meta.gclid || meta.gbraid || meta.wbraid) return 'google_ads';

  const utm = String(meta.utm_medium || '').trim().toLowerCase();
  if (utm === 'cpc' || utm === 'ppc' || utm === 'paid' || utm === 'paidsearch') return 'google_ads';

  const src = String(meta.utm_source || '').trim().toLowerCase();
  if (src === 'google' && utm) return utm === 'organic' ? 'google_organic' : 'google_ads';

  const raw = String(enquiry?.source || '').trim().toLowerCase();
  if (WEB_SOURCE_MAP[raw]) return WEB_SOURCE_MAP[raw];
  return 'website';
}
