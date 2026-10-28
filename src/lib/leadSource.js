// Where a website lead came from.
//
// The site records two different things on every enquiry, and they answer two
// different questions:
//
//   page_url          the page the form was on when they hit send
//   meta.landing_page the page they first arrived on that visit
//   meta.first_referrer / utm_* / gclid  what sent them there
//
// They are not the same. Someone finds the shutters page on Google, reads two
// articles, then enquires from the homepage — page_url says homepage, and the
// page that actually earned the lead gets no credit. So both are surfaced, and
// the entry page is the one the reporting counts.
//
// Older rows (before the site carried first-touch attribution) only have
// page_url and meta.referrer. Everything here degrades to those.

/** Parse a stored URL. Returns null rather than throwing on junk. */
function parseUrl(raw) {
  if (!raw) return null;
  try {
    return new URL(String(raw), 'https://www.lusso.com.au');
  } catch {
    return null;
  }
}

// Words a title keeps lowercase unless they lead: "How to Clean Blinds",
// "Roller Blinds vs Vertical Blinds".
const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'at', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to',
  'vs', 'with', 'your', 'do', 'is', 'are',
]);

/**
 * A page path turned into something readable: "/blockout-roller-blinds.html"
 * becomes "Blockout Roller Blinds". The homepage is the one special case.
 */
export function pageLabel(path) {
  if (!path) return null;
  let slug = String(path).split('?')[0].split('#')[0];
  slug = slug.replace(/\.html?$/i, '').replace(/^\/+|\/+$/g, '');
  if (!slug || slug === 'index') return 'Home page';
  const words = slug.split('/').pop().replace(/[-_]+/g, ' ').trim().split(/\s+/);
  if (!words[0]) return 'Home page';
  return words
    .map((w, i) => (i > 0 && MINOR_WORDS.has(w.toLowerCase())
      ? w.toLowerCase()
      : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * The normalised path of a URL, '/' for the homepage. Used as a group key, so
 * "/" and "/index.html" have to collapse to one — otherwise the homepage
 * reports as two separate pages that each look half as good as it is.
 */
function pathOf(raw) {
  const u = parseUrl(raw);
  let path;
  if (u) {
    path = u.pathname || '/';
  } else {
    // Not an absolute URL — the site stores landing_page as a bare path.
    const bare = String(raw || '').split('?')[0].split('#')[0];
    if (!bare) return null;
    path = bare.startsWith('/') ? bare : `/${bare}`;
  }
  return path.replace(/\/index\.html?$/i, '/');
}

// Who sent them, named the way a person would say it. Matched against a
// referrer's hostname and against a bare utm_source token alike, so
// "chatgpt.com" lands on ChatGPT whichever way it arrives.
//
// AI assistants come first: Gemini referrals arrive as gemini.google.com and
// would otherwise be filed as Google, which hides the thing worth watching.
const KNOWN_SOURCES = [
  [/(^|\.)(gemini|bard)(\.|$)/i,        'Gemini',     'ai'],
  [/(^|\.)(chatgpt|openai)(\.|$)/i,     'ChatGPT',    'ai'],
  [/(^|\.)perplexity(\.|$)/i,           'Perplexity', 'ai'],
  [/(^|\.)claude(\.|$)/i,               'Claude',     'ai'],
  [/(^|\.)copilot(\.|$)/i,              'Copilot',    'ai'],
  [/(^|\.)google(\.|$)/i,               'Google',     'search'],
  [/(^|\.)bing(\.|$)/i,                 'Bing',       'search'],
  [/(^|\.)duckduckgo(\.|$)/i,           'DuckDuckGo', 'search'],
  [/(^|\.)yahoo(\.|$)/i,                'Yahoo',      'search'],
  [/(^|\.)ecosia(\.|$)/i,               'Ecosia',     'search'],
  [/(^|\.)(facebook|fb|meta)(\.|$)/i,   'Facebook',   'social'],
  [/(^|\.)instagram(\.|$)/i,            'Instagram',  'social'],
  [/(^|\.)pinterest(\.|$)/i,            'Pinterest',  'social'],
  [/(^|\.)(linkedin|lnkd)(\.|$)/i,      'LinkedIn',   'social'],
  [/(^|\.)tiktok(\.|$)/i,               'TikTok',     'social'],
  [/(^|\.)(youtube|youtu)(\.|$)/i,      'YouTube',    'social'],
  [/(^|\.)reddit(\.|$)/i,               'Reddit',     'social'],
  [/(^|\.)houzz(\.|$)/i,                'Houzz',      'referral'],
  [/(^|\.)yelp(\.|$)/i,                 'Yelp',       'referral'],
  [/(^|\.)productreview(\.|$)/i,        'ProductReview', 'referral'],
  [/(^|\.)(mail|email|newsletter)(\.|$)/i, 'Email',   'campaign'],
];

/** Match a hostname or a utm_source token against the table above. */
function describeToken(token, fallbackKind) {
  const t = String(token || '').trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '');
  if (!t) return null;
  for (const [re, label, kind] of KNOWN_SOURCES) {
    if (re.test(t)) return { label, kind };
  }
  return { label: t.charAt(0).toUpperCase() + t.slice(1), kind: fallbackKind };
}

// Paid click IDs, in the order a lead would most likely carry them.
const CLICK_IDS = [
  ['gclid',  'Google Ads'],
  ['gbraid', 'Google Ads'],
  ['wbraid', 'Google Ads'],
  ['msclkid','Microsoft Ads'],
  ['fbclid', 'Facebook'],
  ['ttclid', 'TikTok'],
];

function describeReferrer(raw) {
  const u = parseUrl(raw);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./i, '');
  const known = describeToken(u.hostname, 'referral');
  return { label: known.label, kind: known.kind, host };
}

/**
 * Everything knowable about where one enquiry came from.
 *
 * `sourceLabel` is the single line to show when there is room for one, and it
 * always names the platform — ChatGPT, Google, Facebook — never the campaign.
 * Three campaigns on Facebook should stack up as Facebook in a breakdown; the
 * campaign name rides alongside in `campaign`.
 */
export function leadSource(enquiry) {
  const e = enquiry || {};
  const meta = (e.meta && typeof e.meta === 'object') ? e.meta : {};

  const submittedUrl = parseUrl(e.page_url);
  const landingUrl   = parseUrl(meta.landing_page);
  const referrerUrl  = parseUrl(meta.referrer);
  const firstTouchKnown = !!meta.landing_page;

  // Where a campaign tag is read from, and the order, is the whole difference
  // between first-touch and last-touch attribution.
  //
  // When the site recorded the entry point, trust only that: meta carries the
  // tags from the first page of the visit, and a tag sitting on the page they
  // happened to submit from must not outrank the thing that actually brought
  // them in. Older rows have no entry point at all, so there the only tags
  // that exist are the ones on the URLs the row did keep.
  const param = (k) => firstTouchKnown
    ? (meta[k] || landingUrl?.searchParams.get(k) || null)
    : (meta[k] ||
       submittedUrl?.searchParams.get(k) ||
       referrerUrl?.searchParams.get(k) ||
       null);

  const utmSource   = param('utm_source');
  const utmMedium   = param('utm_medium');
  const utmCampaign = param('utm_campaign');

  const clickId = CLICK_IDS.find(([k]) => param(k));

  // first_referrer is the one that brought them to the site. meta.referrer is
  // only the previous page, which is usually this same site — useless as a
  // source, but it is all the older rows have.
  const firstRef = describeReferrer(meta.first_referrer);
  const lastRef  = describeReferrer(meta.referrer);
  const isInternal = lastRef && /(^|\.)lusso\.com\.au$/i.test(lastRef.host);
  const referrer = firstRef || (isInternal ? null : lastRef);

  const entryPath  = pathOf(meta.landing_page) || pathOf(e.page_url);
  const submitPath = pathOf(e.page_url);

  const tagged = utmSource ? describeToken(utmSource, 'campaign') : null;
  const paidMedium = /^(cpc|ppc|paid|paid[-_]?social|display|retargeting)$/i.test(utmMedium || '');

  let sourceLabel, sourceKind;
  if (tagged) {
    sourceLabel = tagged.label;
    sourceKind  = paidMedium ? 'paid' : tagged.kind;
  } else if (clickId) {
    sourceLabel = clickId[1];
    sourceKind  = 'paid';
  } else if (referrer) {
    sourceLabel = referrer.label;
    sourceKind  = referrer.kind;
  } else if (e.source && e.source !== 'website') {
    // Newsletter signups and anything else filed under its own source.
    sourceLabel = e.source.charAt(0).toUpperCase() + e.source.slice(1);
    sourceKind  = 'other';
  } else {
    sourceLabel = 'Direct';
    sourceKind  = 'direct';
  }

  return {
    sourceLabel,
    sourceKind,
    referrerUrl: meta.first_referrer || (isInternal ? null : meta.referrer) || null,
    campaign: utmCampaign || null,
    utmSource: utmSource || null,
    utmMedium: utmMedium || null,
    paidClickId: clickId ? clickId[0] : null,

    entryPath,
    entryLabel: pageLabel(entryPath),
    submitPath,
    submitLabel: pageLabel(submitPath),
    submitUrl: e.page_url || null,
    // Worth showing only when they differ — otherwise it is the same fact twice.
    browsed: !!(entryPath && submitPath && entryPath !== submitPath),
    pagesSeen: Number(meta.pages) > 0 ? Number(meta.pages) : null,

    // False when the row predates first-touch capture, so the UI can say the
    // entry page is unknown rather than quietly showing the form's page.
    firstTouchKnown,
  };
}

// Tailwind classes per source kind, so a lead's origin reads the same colour
// in the list, the detail panel, and the report.
export const SOURCE_STYLE = {
  search:   { pill: 'bg-blue-50 text-blue-700 border-blue-200',       bar: 'bg-blue-400' },
  ai:       { pill: 'bg-violet-50 text-violet-700 border-violet-200', bar: 'bg-violet-400' },
  social:   { pill: 'bg-pink-50 text-pink-700 border-pink-200',       bar: 'bg-pink-400' },
  paid:     { pill: 'bg-amber-50 text-amber-700 border-amber-200',    bar: 'bg-amber-400' },
  campaign: { pill: 'bg-amber-50 text-amber-700 border-amber-200',    bar: 'bg-amber-400' },
  referral: { pill: 'bg-teal-50 text-teal-700 border-teal-200',       bar: 'bg-teal-400' },
  direct:   { pill: 'bg-slate-100 text-slate-600 border-slate-200',   bar: 'bg-slate-400' },
  other:    { pill: 'bg-slate-100 text-slate-600 border-slate-200',   bar: 'bg-slate-400' },
};

export const sourceStyle = (kind) => SOURCE_STYLE[kind] || SOURCE_STYLE.other;

/** Add one enquiry to a page tally. */
function tallyPage(map, key, label, path, won) {
  const row = map.get(key) || { key, label, path, count: 0, converted: 0 };
  row.count += 1;
  if (won) row.converted += 1;
  map.set(key, row);
}

/**
 * Roll a set of enquiries up into the breakdowns worth looking at.
 *
 * Pages come out twice over, because they answer different questions:
 *
 *   entryPages   the page that brought them to the site — what SEO and ads
 *                are actually buying. Only known for leads captured since the
 *                site started recording it.
 *   formPages    the page they were on when they sent the form. Known for
 *                every lead ever taken, and the better read on which page
 *                does the convincing.
 *
 * Converted counts ride along on both, so a page that brings volume can be
 * told apart from one that brings customers.
 */
export function summariseLeadSources(enquiries) {
  const entryPages = new Map();
  const formPages  = new Map();
  const sources    = new Map();
  let firstTouchCount = 0;

  for (const e of enquiries) {
    const s = leadSource(e);
    const won = e.status === 'converted';

    // Rows with no first-touch data would otherwise all pile onto whichever
    // page their form sat on and overstate it, so they are counted separately.
    if (s.firstTouchKnown) {
      firstTouchCount += 1;
      tallyPage(entryPages, s.entryPath, s.entryLabel, s.entryPath, won);
    } else {
      tallyPage(entryPages, '__unknown__', 'Not recorded', null, won);
    }

    tallyPage(formPages, s.submitPath || '__unknown__', s.submitLabel || 'Unknown', s.submitPath, won);

    const src = sources.get(s.sourceLabel) || {
      key: s.sourceLabel, label: s.sourceLabel, kind: s.sourceKind,
      count: 0, converted: 0,
    };
    src.count += 1;
    if (won) src.converted += 1;
    sources.set(s.sourceLabel, src);
  }

  const byCount = (a, b) => b.count - a.count || a.label.localeCompare(b.label);
  return {
    total: enquiries.length,
    firstTouchCount,
    entryPages: [...entryPages.values()].sort(byCount),
    formPages:  [...formPages.values()].sort(byCount),
    sources:    [...sources.values()].sort(byCount),
  };
}
