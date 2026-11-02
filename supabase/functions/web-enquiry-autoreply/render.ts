/**
 * Website-lead auto-reply — field normalisation and copy assembly.
 *
 * WHY THIS IS A SEPARATE, DEPENDENCY-FREE MODULE
 * ----------------------------------------------
 * Every value here was typed by a stranger into a public form with almost no
 * validation, and the output goes straight into an email we never read before
 * it sends. The first 42 rows of web_enquiries contain, verbatim:
 *
 *   name:    "jett hopkins"  "214"  "24"  "13"  "qe"  "gs"  "Digs"  "Stevie-Lee"
 *   suburb:  "GOLD COAST MC"  "Reedy Creek 4226"  "southport"  "dog"  "124"  ""
 *   interest: 11 distinct values across the site's various forms, including
 *            "Outdoor Blinds & Awnings" and "Outdoor blinds & awnings" (two
 *            casings of one thing), "Not sure yet — I'd like advice", and
 *            "Curtains — sheer, blockout or decorative"
 *
 * Interpolated raw — the way quote-notify does `custName.split(" ")[0]` for
 * customers, where the name came off an invoice — that is "Hi 214," and "your
 * place in GOLD COAST MC". So nothing here trusts a column. Each field goes
 * through a normaliser that returns a *usable* value or null, and the copy is
 * assembled from whichever fields survived. The worst case is a correct,
 * well-written, slightly less specific email — never a wrong one.
 *
 * Being free of Deno globals is deliberate: this module is run against the real
 * web_enquiries rows from the command line (see render.test.ts) so the output
 * can be read with human eyes before anything is deployed.
 */

export interface Enquiry {
  name?: string | null
  email?: string | null
  phone?: string | null
  suburb?: string | null
  interest?: string | null
}

// ─── Names ───────────────────────────────────────────────────────────────────

const TITLES = new Set([
  'mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof', 'sir', 'madam', 'rev',
])

/**
 * Recase a single name token, leaving deliberate internal capitals alone.
 *
 * "ANDREW" → "Andrew", "stevie-lee" → "Stevie-Lee", "o'brien" → "O'Brien",
 * but "McKenzie" and "deAndre" are returned untouched: a name that is neither
 * all-upper nor all-lower was capitalised on purpose and we would only break
 * it.
 */
function recase(token: string): string {
  if (token !== token.toLowerCase() && token !== token.toUpperCase()) return token
  return token.toLowerCase().replace(/(^|[-'’])(\p{L})/gu, (_m, sep, ch) => sep + ch.toUpperCase())
}

/**
 * The first name to greet, or null to fall back to "Hi there".
 *
 * Null is a perfectly good answer and is returned readily. "Hi there," costs
 * nothing; "Hi 214," or "Hi qe," tells the reader they are in a mail merge.
 */
export function firstNameFrom(raw: string | null | undefined): string | null {
  let s = String(raw ?? '').trim()
  if (!s) return null

  // An email address, a URL or a number in the name field — 3 of the first 42
  // rows. Nothing in here is a greeting.
  if (/[@\d_/\\]|https?:/i.test(s)) return null

  // A household rather than a person: "Mr & Mrs Smith", "John and Jane".
  // There is no single right first name, so greet them neutrally.
  if (/\s(?:&|\+|and)\s/i.test(s)) return null

  // "Smith, John" → "John"
  const comma = s.split(',')
  if (comma.length === 2 && comma[1].trim()) s = comma[1].trim()

  const tokens = s.split(/\s+/).filter(Boolean)
  // Drop leading titles so "Dr Jane" greets Jane, not Dr.
  while (tokens.length > 1 && TITLES.has(tokens[0].toLowerCase().replace(/\.$/, ''))) tokens.shift()

  const first = (tokens[0] ?? '').replace(/[.]+$/, '')
  // Letters, hyphens and apostrophes only, 2–20 chars. A single letter is an
  // initial, not a name.
  if (!/^[\p{L}][\p{L}'’-]{1,19}$/u.test(first)) return null
  if (TITLES.has(first.toLowerCase())) return null

  return recase(first)
}

// ─── Suburbs ─────────────────────────────────────────────────────────────────

// Values that are plainly not a place. Short and specific on purpose — this is
// a safety net under the structural checks below, not a spam filter.
const SUBURB_JUNK = /^(n\/?a|na|none|nil|test|testing|asdf+|qwerty|dog|cat|new|old|home|house|here|there|idk|unknown|anywhere|xx+|aa+)$/i

/**
 * A suburb fit to appear in "your place in ___", or null to drop the clause.
 *
 * The clause is optional in the copy, which is what makes aggressive rejection
 * safe: 6 of the first 42 rows left the field blank (it isn't required on the
 * form) and the sentence has to read properly without it regardless.
 */
export function suburbFrom(raw: string | null | undefined): string | null {
  let s = String(raw ?? '').trim()
  if (!s) return null

  s = s.replace(/[,.;]+$/, '').trim()
  // "Reedy Creek 4226" → "Reedy Creek", and the same with the postcode first.
  s = s.replace(/[,\s]*\b\d{4}\b\s*$/, '').trim()
  s = s.replace(/^\d{4}\b[,\s]*/, '').trim()
  // "GOLD COAST MC" is an Australia Post mail centre, not a suburb — it comes
  // from browser autofill on anyone with a PO box, and 14 of the first 42 rows
  // carry it. "your place in Gold Coast" is the honest reading.
  s = s.replace(/\s+(mc|bc|dc)$/i, '').trim()
  // "QLD", "Queensland", "Australia" tails add nothing.
  s = s.replace(/[,\s]+(qld|queensland|nsw|new south wales|australia|aus)$/i, '').trim()

  if (!s) return null
  if (/\d/.test(s)) return null                              // "124", "13"
  if (s.length > 40) return null                             // a pasted address
  if (SUBURB_JUNK.test(s)) return null
  // Two letters or fewer is a typo or a test ("wr", "gs", "qe"). Three is kept:
  // Ayr is a real Queensland town.
  if (s.replace(/[^\p{L}]/gu, '').length < 3) return null
  if (!/^[\p{L}][\p{L}\s'’-]*$/u.test(s)) return null

  return s.split(/\s+/).map(recase).join(' ')
}

// ─── Interest ────────────────────────────────────────────────────────────────

/**
 * Known interest values → the phrase that follows "about".
 *
 * Keyed on a slug (lowercase, punctuation flattened) so the casing variants the
 * site's different forms emit — "Outdoor Blinds & Awnings" and "Outdoor blinds
 * & awnings" are both live — collapse to one entry. New product pages ship new
 * options without touching this file, which is why there is a fallback below
 * rather than a hard failure on an unknown value.
 */
const INTEREST_NOUNS: Record<string, string> = {
  'curtains': 'curtains',
  'curtains sheer blockout or decorative': 'curtains',
  'sheer curtains': 'sheer curtains',
  'blockout curtains': 'blockout curtains',
  'decorative curtains': 'curtains',
  'blinds': 'blinds',
  'roller blinds': 'roller blinds',
  'blockout roller blinds': 'blockout roller blinds',
  'honeycomb cellular blinds': 'honeycomb blinds',
  'venetian blinds': 'venetian blinds',
  'timber venetian blinds': 'timber venetian blinds',
  'roman blinds': 'roman blinds',
  'vertical blinds': 'vertical blinds',
  'panel glide blinds': 'panel glides',
  'shutters': 'shutters',
  'plantation shutters': 'plantation shutters',
  'thermalite shutters': 'Thermalite shutters',
  'window shutters': 'shutters',
  'outdoor blinds awnings': 'outdoor blinds and awnings',
  'outdoor blinds': 'outdoor blinds',
  'awnings': 'awnings',
  'ziptrak track guided blinds': 'Ziptrak blinds',
  'ziptrak blinds': 'Ziptrak blinds',
  'motorised blinds or curtains new order': 'motorised blinds or curtains',
  'motorisation': 'motorised blinds or curtains',
  'commercial project': 'commercial project',
  'curtain tracks and rods': 'curtain tracks',
}

// Capitalised words in an unknown option that are brands, not nouns. Without
// this list "Luxaflex Duette" comes out as "luxaflex duette": there is no way
// to tell a product name from a Title Cased common noun ("Roller Blinds") by
// shape alone, so the brands are named explicitly and everything else is
// lowercased.
const BRANDS = new Set([
  'ziptrak', 'zipscreen', 'luxaflex', 'verosol', 'thermalite', 'duette',
  'vertilux', 'shaw', 'warwick', 'somfy', 'acmeda', 'rollease', 'wynstan',
])

// The one option that isn't a product. It gets its own opening sentence, since
// "Thanks for getting in touch about your not sure yet — I'd like advice" is
// how a template betrays itself.
const ADVICE_SLUG = 'not sure yet i d like advice'

function slug(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

export interface InterestRead {
  /** Bare product noun, e.g. "sheer curtains" — the copy adds "your". */
  noun: string
  /** The customer asked for advice rather than naming a product. */
  advice: boolean
  /** A commercial job: "your place in X" is the wrong frame for it. */
  commercial: boolean
  /** No usable value: the copy falls back to generic wording. */
  generic: boolean
}

export function interestFrom(raw: string | null | undefined): InterestRead {
  const base = { advice: false, commercial: false, generic: false }
  const s = String(raw ?? '').trim()
  if (!s) return { ...base, noun: 'window furnishings', generic: true }

  const key = slug(s)
  if (key === ADVICE_SLUG || /^not sure/.test(key)) {
    return { ...base, noun: 'windows', advice: true }
  }
  const known = INTEREST_NOUNS[key]
  if (known) return { ...base, noun: known, commercial: known === 'commercial project' }

  // Unknown option from a page added since this map was written. Take the part
  // before any dash or bracket ("Curtains — sheer, blockout or decorative" →
  // "Curtains"), then only use it if it reads like a product name.
  const head = s.split(/\s*[—–\-(,/]\s*/)[0].trim()
  if (/^[\p{L}][\p{L}\s&'’]{2,34}$/u.test(head)) {
    const words = head.replace(/\s*&\s*/g, ' and ').split(/\s+/)
      .map((w) => (BRANDS.has(w.toLowerCase()) || w === w.toUpperCase()) && w.length > 1 ? w : w.toLowerCase())
    return { ...base, noun: words.join(' ') }
  }

  return { ...base, noun: 'window furnishings', generic: true }
}

// ─── Phone ───────────────────────────────────────────────────────────────────

/**
 * The customer's number in readable AU form, or null.
 *
 * Echoed back so they can see we hold the right number — which only works if
 * it is actually a number. Anything implausible drops the clause and the copy
 * says "will call you" instead of "will call you on 13".
 */
export function phoneFrom(raw: string | null | undefined): string | null {
  const cleaned = String(raw ?? '').replace(/[^\d+]/g, '')
  let n = cleaned
  if (n.startsWith('+61')) n = '0' + n.slice(3)
  else if (n.startsWith('0061')) n = '0' + n.slice(4)
  else if (/^61[2-478]\d{8}$/.test(n)) n = '0' + n.slice(2)
  n = n.replace(/\D/g, '')
  if (/^[2-478]\d{8}$/.test(n)) n = '0' + n            // typed without the leading 0
  if (!/^0[2-478]\d{8}$/.test(n)) return null
  return /^04|^05/.test(n)
    ? `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`
    : `(${n.slice(0, 2)}) ${n.slice(2, 6)} ${n.slice(6)}`
}

// ─── Email ───────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;.]+(\.[^\s@,;.]+)+$/
// Addresses that exist to fill a form in. Sending to them earns bounces, and
// bounce rate is the one deliverability number a small sender cannot afford.
const EMAIL_JUNK_DOMAIN = /@(example|test|testing|localhost|mailinator|yopmail|guerrillamail|sharklasers|tempmail|10minutemail)\./i

export function emailFrom(raw: string | null | undefined): string | null {
  const s = String(raw ?? '').trim().toLowerCase()
  if (!s || s.length > 254) return null
  if (!EMAIL_RE.test(s)) return null
  if (EMAIL_JUNK_DOMAIN.test(s) || /@(example|test)\.com$/i.test(s)) return null
  return s
}

// ─── When we will call ───────────────────────────────────────────────────────

/**
 * The call promise, worked out in Brisbane time.
 *
 * This is the only sentence in the email that can make a liar of us, so the
 * phrasing stays loose enough to keep ("today", "tomorrow morning") and never
 * claims a Saturday: the roster isn't in the database, and promising weekend
 * contact we don't make is worse than promising nothing.
 */
export function callWindow(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Brisbane',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now)
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Mon'
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '12')

  const weekend = weekday === 'Sat' || weekday === 'Sun'
  if (weekend) return 'first thing Monday'
  if (hour < 9) return 'this morning'
  if (hour < 17) return 'today'
  return weekday === 'Fri' ? 'first thing Monday' : 'tomorrow morning'
}

// ─── The copy ────────────────────────────────────────────────────────────────

export const OFFICE_PHONE = '(07) 5528 4006'

export interface RenderedReply {
  subject: string
  preheader: string
  greeting: string
  body: string
  outro: string
  /** ≤160 GSM-7 characters, for the after-hours SMS. */
  sms: string
  /** Which fields survived normalisation — logged so drops are visible. */
  used: { name: boolean; suburb: boolean; interest: boolean; phone: boolean }
}

/**
 * Wording held in Settings, overriding the copy below.
 *
 * Any field may be absent, and absent means "use the built-in" rather than
 * "say nothing" — a business that has never opened the editor must keep
 * getting the shipped message, and clearing a box must restore it rather than
 * send an empty email.
 */
export interface ReplyTemplate {
  subject?: string | null
  body?: string | null
  sms?: string | null
}

/**
 * Fill {{tokens}} in an edited message.
 *
 * Unknown tokens are left alone rather than blanked. A typo should look like a
 * typo in a preview, not silently delete the sentence it was in — and leaving
 * it visible is the only way the person editing finds out.
 */
export function fillTokens(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, name: string) => {
    const v = values[String(name).toLowerCase()]
    return v === undefined ? whole : v
  })
}

export function renderAutoReply(
  enquiry: Enquiry,
  now: Date,
  officePhone = OFFICE_PHONE,
  template: ReplyTemplate = {},
): RenderedReply {
  const first = firstNameFrom(enquiry.name)
  const suburb = suburbFrom(enquiry.suburb)
  const interest = interestFrom(enquiry.interest)
  const phone = phoneFrom(enquiry.phone)
  const when = callWindow(now)

  // The suburb clause is a whole clause, present or absent — never a dangling
  // "your place in" with nothing after it. A commercial enquiry takes "in X"
  // rather than "for your place in X", which would read as a home.
  const opening = interest.advice
    ? `Thanks for getting in touch — you mentioned you'd like some advice on what would suit${suburb ? ` your place in ${suburb}` : ' your windows'}. That's the part we enjoy most.`
    : interest.commercial
      ? `Thanks for getting in touch about your commercial project${suburb ? ` in ${suburb}` : ''}.`
      : suburb
        ? `Thanks for getting in touch about ${interest.noun} for your place in ${suburb}.`
        : `Thanks for getting in touch about your ${interest.noun}.`

  const callLine = phone
    ? `one of our consultants will call you on ${phone} ${when}`
    : `one of our consultants will call you ${when}`

  const body =
    `${opening} Your enquiry is with our team now, not sitting in a queue.\n\n`
    + `Here's what happens next: ${callLine}. We'll talk through your windows, then book a free in-home consultation — we bring the fabric and colour samples to you, measure up properly, and you get a fixed written quote. No obligation either way.\n\n`
    + `To save time on that call, hit reply and tell us:\n\n`
    + `• Roughly how many windows are involved\n`
    + `• New build or renovation, or replacing what's there\n`
    + `• Any timeframe you're working to\n\n`
    // The second path, for the landlord, the builder, and anyone who does not
    // want a stranger in their lounge room. "Rough is fine to start" is doing
    // real work: a customer who thinks they need exact numbers sends nothing
    // at all. The sentence after it is doing more — a quote built on someone
    // else's tape measure must never read as a fixed price, or a 40mm error
    // becomes a remake at our cost.
    + `Not nearby, or would rather skip the home visit? Send us your own rough measurements instead — width and drop for each window, in centimetres — and we'll quote from those. Rough is fine to start; we'd confirm exact sizes before anything goes into production.`

  const outro = `Prefer to talk now? Call us on ${officePhone}.`

  // A question mark earns opens and invites the reply the body asks for, and
  // the brand name up front stops it reading as an automated receipt.
  const subject = 'Your Lusso enquiry — and a quick question'

  // Strictly GSM-7: a single curly apostrophe or en dash in here flips the
  // whole message to UCS-2 and halves the segment to 70 characters, doubling
  // the Twilio cost per send. Kept under 160 with the longest plausible name.
  // "Hi it's Lusso" without the comma is the giveaway when there is no usable
  // name, so the greeting is punctuated either way.
  const smsHello = first ? `Hi ${first},` : 'Hi,'
  const sms = `${smsHello} it's Lusso Window Furnishings - we have your enquiry and will call you ${when}. Need us sooner? ${officePhone.replace(/[()\s]/g, '')}`

  // The edited versions are filled from the same values the built-in copy was
  // composed from, so {{opening}} and {{call_line}} carry the per-enquiry
  // intelligence into a message somebody has rewritten by hand.
  const tokens: Record<string, string> = {
    opening,
    call_line: callLine,
    first_name: first ?? 'there',
    suburb: suburb ?? '',
    interest: interest.noun,
    phone: phone ?? '',
    call_window: when,
    office_phone: officePhone,
  }
  const pick = (edited: string | null | undefined, built: string) => {
    const t = (edited ?? '').trim()
    return t ? fillTokens(t, tokens) : built
  }

  return {
    subject: pick(template.subject, subject),
    preheader: `We have your enquiry — ${callLine.replace(/^one of our consultants /, 'a consultant ')}.`,
    greeting: first ? `Hi ${first},` : 'Hi there,',
    body: pick(template.body, body),
    outro,
    sms: pick(template.sms, sms),
    used: {
      name: first !== null,
      suburb: suburb !== null,
      interest: !interest.generic,
      phone: phone !== null,
    },
  }
}
