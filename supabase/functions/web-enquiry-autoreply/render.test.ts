/**
 * Auto-reply rendering checks.
 *
 * Run from the repo root with no build step and no Deno:
 *
 *   node supabase/functions/web-enquiry-autoreply/render.test.ts
 *
 * The fixtures are not invented. Every value in REAL_VALUES was copied out of
 * public.web_enquiries — they are what the public form has actually produced —
 * so a change that would have emailed "Hi 214," fails here instead of in
 * someone's inbox. Add a row whenever a new form option or a new flavour of
 * junk shows up in the table.
 */

import {
  firstNameFrom, suburbFrom, interestFrom, phoneFrom, emailFrom,
  callWindow, renderAutoReply,
} from './render.ts'

let failures = 0
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures++
    console.error(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`)
  }
  return ok
}

// ── Names: the real ones, good and bad ──────────────────────────────────────
console.log('\nfirstNameFrom')
const NAMES: [string | null, string | null][] = [
  // Observed in web_enquiries
  ['Jett Hopkins', 'Jett'],
  ['jett hopkins', 'Jett'],          // all-lowercase typing
  ['Digs', 'Digs'],                  // single word, real name
  ['Stevie-Lee', 'Stevie-Lee'],      // hyphen must survive
  ['Teresa Greenhill', 'Teresa'],
  ['214', null],                     // digits-only
  ['24', null],
  ['13', null],
  ['qe', 'Qe'],                       // 2 letters: indistinguishable from a real short name
  ['gs', 'Gs'],
  // Shapes the form will produce eventually
  ['ANDREW SMITH', 'Andrew'],
  ['  sarah   jones  ', 'Sarah'],
  ["o'brien", "O'Brien"],
  ['McKenzie Taylor', 'McKenzie'],   // deliberate internal capital, left alone
  ['Dr Jane Patel', 'Jane'],
  ['Mr. Tony Hopkins', 'Tony'],
  ['Smith, John', 'John'],
  ['Mr & Mrs Smith', null],          // a household, not a person
  ['John and Jane', null],
  ['jane@gmail.com', null],          // email in the name field
  ['https://spam.ru', null],
  ['J', null],                       // an initial
  ['', null],
  [null, null],
]
for (const [input, expected] of NAMES) check(`name ${JSON.stringify(input)}`, firstNameFrom(input), expected)

// ── Suburbs ─────────────────────────────────────────────────────────────────
console.log('suburbFrom')
const SUBURBS: [string | null, string | null][] = [
  ['GOLD COAST MC', 'Gold Coast'],       // Australia Post mail centre, 14 rows
  ['Reedy Creek 4226', 'Reedy Creek'],   // postcode appended
  ['southport', 'Southport'],
  ['Gold Coast', 'Gold Coast'],
  ['Mermaid Beach, QLD', 'Mermaid Beach'],
  ['4217 Surfers Paradise', 'Surfers Paradise'],
  ['Ayr', 'Ayr'],                        // 3 letters, real QLD town — kept
  ['', null],
  [null, null],
  ['dog', null],
  ['new', null],
  ['124', null],
  ['13', null],
  ['wr', null],                          // 2 letters
  ['gs', null],
  ['brus', 'Brus'],                      // a typo we cannot detect; harmless
  ['12 Smith Street, Southport', null],  // pasted full address
]
for (const [input, expected] of SUBURBS) check(`suburb ${JSON.stringify(input)}`, suburbFrom(input), expected)

// ── Interest: all 11 values live in the table today ─────────────────────────
console.log('interestFrom')
const INTERESTS: [string, string, boolean][] = [
  ['Curtains', 'curtains', false],
  ['Blinds', 'blinds', false],
  ['Shutters', 'shutters', false],
  ['Thermalite shutters', 'Thermalite shutters', false],
  ['Ziptrak track-guided blinds', 'Ziptrak blinds', false],
  ['Honeycomb / cellular blinds', 'honeycomb blinds', false],
  ['Curtains — sheer, blockout or decorative', 'curtains', false],
  ['Outdoor Blinds & Awnings', 'outdoor blinds and awnings', false],
  ['Outdoor blinds & awnings', 'outdoor blinds and awnings', false],  // other casing
  ['Motorised blinds or curtains (new order)', 'motorised blinds or curtains', false],
  ['Commercial project', 'commercial project', false],
  ["Not sure yet — I'd like advice", 'windows', true],
  // Options from pages that do not exist yet
  ['Roller Blinds', 'roller blinds', false],
  ['Wave Fold Sheers', 'wave fold sheers', false],
  ['Luxaflex Duette', 'Luxaflex Duette', false],   // brands keep their capital
  ['', 'window furnishings', false],
  ['???', 'window furnishings', false],
]
for (const [input, noun, advice] of INTERESTS) {
  const r = interestFrom(input)
  check(`interest ${JSON.stringify(input)}`, [r.noun, r.advice], [noun, advice])
}
check('commercial flagged', interestFrom('Commercial project').commercial, true)
check('curtains not commercial', interestFrom('Curtains').commercial, false)

// ── The self-measure alternative ────────────────────────────────────────────
console.log('self-measure offer')
const anyReply = renderAutoReply({ name: 'Sam Reed', interest: 'Curtains' }, new Date('2026-11-03T23:30:00Z'))
check('offers the self-measure path', /send us your own measurements/i.test(anyReply.body), true)
check('says approximate is acceptable', /approximate figures are fine at this stage/i.test(anyReply.body), true)
// A quote off a customer's own tape measure must never read as a fixed price.
check('keeps the quote indicative', /confirm exact sizes before anything goes into production/i.test(anyReply.body), true)
// index.ts rewrites the reply ask when there is no threading address. The
// measurement offer must still make sense after that substitution.
const degraded = anyReply.body.replace('please reply with:', 'it would help to have the following to hand:')
check('self-measure survives the no-threading rewrite', /send us your own measurements/i.test(degraded), true)
check('no stale reply instruction left', /please reply with/i.test(degraded), false)

// ── Phone ───────────────────────────────────────────────────────────────────
console.log('phoneFrom')
const PHONES: [string | null, string | null][] = [
  ['0412345678', '0412 345 678'],
  ['0412 345 678', '0412 345 678'],
  ['+61412345678', '0412 345 678'],
  ['61412345678', '0412 345 678'],
  ['(07) 5528 4006', '(07) 5528 4006'],
  ['0755284006', '(07) 5528 4006'],
  ['412345678', '0412 345 678'],      // leading zero omitted
  ['13', null],
  ['123', null],
  ['notaphone', null],
  ['', null],
  [null, null],
]
for (const [input, expected] of PHONES) check(`phone ${JSON.stringify(input)}`, phoneFrom(input), expected)

// ── Email gate ──────────────────────────────────────────────────────────────
console.log('emailFrom')
check('email normal', emailFrom(' Jane@Gmail.COM '), 'jane@gmail.com')
check('email no at', emailFrom('jane.gmail.com'), null)
check('email no tld', emailFrom('jane@gmail'), null)
check('email example.com', emailFrom('a@example.com'), null)
check('email mailinator', emailFrom('a@mailinator.com'), null)
check('email blank', emailFrom(''), null)

// ── Call window, in Brisbane time ───────────────────────────────────────────
console.log('callWindow (Australia/Brisbane, UTC+10)')
const at = (iso: string) => callWindow(new Date(iso))
check('Wed 10:00 AEST',       at('2026-11-04T00:00:00Z'), 'today')
check('Wed 07:00 AEST',       at('2026-11-03T21:00:00Z'), 'this morning')
check('Wed 18:00 AEST',       at('2026-11-04T08:00:00Z'), 'tomorrow morning')
check('Fri 19:00 AEST',       at('2026-11-06T09:00:00Z'), 'first thing Monday')
check('Sat 11:00 AEST',       at('2026-11-07T01:00:00Z'), 'first thing Monday')
check('Sun 20:00 AEST',       at('2026-11-08T10:00:00Z'), 'first thing Monday')
check('Mon 09:00 AEST sharp', at('2026-11-02T23:00:00Z'), 'today')
check('Mon 16:59 AEST',       at('2026-11-02T06:59:00Z'), 'today')

// ── SMS stays inside one GSM-7 segment ──────────────────────────────────────
console.log('sms segment')
const GSM7 = new Set("@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà\n\r")
const GSM7_EXT = new Set('^{}\\[~]|€')
const longest = renderAutoReply(
  { name: 'Christopher', suburb: 'Surfers Paradise', interest: 'Curtains', phone: '0412345678' },
  new Date('2026-11-04T08:00:00Z'),   // "tomorrow morning", the longest phrase
)
const bad = [...longest.sms].filter((c) => !GSM7.has(c) && !GSM7_EXT.has(c))
check('sms is GSM-7 only', bad, [])
// The no-name path must still punctuate its greeting.
const noName = renderAutoReply({ name: '214', interest: 'Curtains' }, new Date('2026-11-03T23:30:00Z'))
check('sms greets with a comma when there is no name', noName.sms.slice(0, 20), 'Hi, Lusso Window Fur')
check('sms greets by name when there is one', longest.sms.slice(0, 18), 'Hi Christopher, Lu')
const segLen = [...longest.sms].reduce((n, c) => n + (GSM7_EXT.has(c) ? 2 : 1), 0)
if (segLen > 160) { failures++; console.error(`  FAIL  sms is ${segLen} GSM-7 chars (>160, so 2 segments)`) }
console.log(`        longest SMS = ${segLen} chars: ${longest.sms}`)

// ── Golden output: every real row shape, rendered for human eyes ────────────
//
// Wed 09:30 AEST unless the scenario says otherwise, so the call promise is
// comparable across rows.
const WED_0930 = '2026-11-03T23:30:00Z'

const SCENARIOS: Array<[string, Record<string, string | null>, string]> = [
  // ── The ordinary ones ────────────────────────────────────────────────────
  ['typical lead, no suburb given',  { name: 'Teresa Greenhill', suburb: null, interest: 'Curtains', phone: '0412345678' }, WED_0930],
  ['suburb given',                   { name: 'Sarah Chen', suburb: 'Mermaid Beach', interest: 'Curtains — sheer, blockout or decorative', phone: '0412345678' }, WED_0930],
  ['wants advice, not a product',    { name: 'Hannah Melotto', suburb: 'Burleigh Heads', interest: "Not sure yet — I'd like advice", phone: '0412345678' }, WED_0930],
  ['commercial job',                 { name: 'Tony Hopkins', suburb: 'Southport', interest: 'Commercial project', phone: '0755284006' }, WED_0930],

  // ── Dirty data that is really in the table ───────────────────────────────
  ['AusPost mail centre suburb',     { name: 'Jett Hopkins', suburb: 'GOLD COAST MC', interest: 'Curtains', phone: '0412345678' }, WED_0930],
  ['all-lowercase name + suburb',    { name: 'jett hopkins', suburb: 'southport', interest: 'Blinds', phone: '0412345678' }, WED_0930],
  ['postcode stuck on suburb',       { name: 'Kevin Denlay', suburb: 'Reedy Creek 4226', interest: 'Blinds', phone: '0412345678' }, WED_0930],
  ['single-word name',               { name: 'Digs', suburb: 'southport', interest: 'Ziptrak track-guided blinds', phone: '0412345678' }, WED_0930],
  ['hyphenated name',                { name: 'Stevie-Lee', suburb: 'Gold Coast', interest: 'Honeycomb / cellular blinds', phone: '0412345678' }, WED_0930],
  ['SHOUTED name',                   { name: 'ANDREW SMITH', suburb: 'Robina', interest: 'Shutters', phone: '0412345678' }, WED_0930],

  // ── Adversarial: nothing here may produce a wrong sentence ───────────────
  ['a household, not a person',      { name: 'Mr & Mrs Smith', suburb: 'Palm Beach', interest: 'Plantation shutters', phone: '0412345678' }, WED_0930],
  ['email typed in the name field',  { name: 'jane@gmail.com', suburb: 'Varsity Lakes', interest: 'Curtains', phone: '0412345678' }, WED_0930],
  ['junk suburb',                    { name: 'Chris Green', suburb: 'dog', interest: 'Curtains', phone: '0412345678' }, WED_0930],
  ['junk phone',                     { name: 'Chris Green', suburb: 'Nerang', interest: 'Curtains', phone: '13' }, WED_0930],
  ['product option nobody mapped',   { name: 'Alex Tran', suburb: 'Coolangatta', interest: 'Wave Fold Sheers', phone: '0412345678' }, WED_0930],
  ['brand option nobody mapped',     { name: 'Alex Tran', suburb: 'Currumbin', interest: 'Luxaflex Duette', phone: '0412345678' }, WED_0930],
  ['every single field unusable',    { name: '214', suburb: '124', interest: '???', phone: 'xyz' }, WED_0930],

  // ── Same lead, different clock ───────────────────────────────────────────
  ['submitted 07:10 Wed',            { name: 'Ruby Nelson', suburb: 'Broadbeach', interest: 'Curtains', phone: '0412345678' }, '2026-11-03T21:10:00Z'],
  ['submitted 21:40 Wed',            { name: 'Ruby Nelson', suburb: 'Broadbeach', interest: 'Curtains', phone: '0412345678' }, '2026-11-04T11:40:00Z'],
  ['submitted 19:00 Friday',         { name: 'Ruby Nelson', suburb: 'Broadbeach', interest: 'Curtains', phone: '0412345678' }, '2026-11-06T09:00:00Z'],
  ['submitted Sunday afternoon',     { name: 'Ruby Nelson', suburb: 'Broadbeach', interest: 'Curtains', phone: '0412345678' }, '2026-11-08T04:00:00Z'],
]

// A one-line-per-scenario table first: the greeting and opening sentence are
// where a bad field shows up, so they are what is worth scanning in bulk.
console.log('\n' + '═'.repeat(100))
console.log('SCENARIO TABLE — greeting + opening sentence, which is where bad data surfaces')
console.log('═'.repeat(100))
for (const [label, row, now] of SCENARIOS) {
  const r = renderAutoReply(row, new Date(now))
  const dropped = Object.entries(r.used).filter(([, v]) => !v).map(([k]) => k)
  console.log(`\n▸ ${label}`)
  console.log(`  in      name=${JSON.stringify(row.name)} suburb=${JSON.stringify(row.suburb)} interest=${JSON.stringify(row.interest)} phone=${JSON.stringify(row.phone)}`)
  console.log(`  dropped ${dropped.length ? dropped.join(', ') : '—'}`)
  console.log(`  out     ${r.greeting} ${r.body.split('\n')[0]}`)
  console.log(`  call    ${r.body.split('\n').find((l) => l.startsWith("Here's")).split('. ')[0]}.`)
}

// Then three complete emails, so the whole thing can be read as a customer.
console.log('\n' + '═'.repeat(100))
console.log('FULL EMAILS — a good lead, a filthy one, and an after-hours one')
console.log('═'.repeat(100))
for (const [label, row, now] of [
  SCENARIOS.find((x) => x[0] === 'suburb given')!,
  SCENARIOS.find((x) => x[0] === 'every single field unusable')!,
  SCENARIOS.find((x) => x[0] === 'submitted 19:00 Friday')!,
]) {
  const r = renderAutoReply(row, new Date(now))
  console.log(`\n┌─ ${label} ${'─'.repeat(Math.max(0, 92 - label.length))}`)
  console.log(`│ Subject: ${r.subject}`)
  console.log(`│ Preview: ${r.preheader}`)
  console.log('│')
  console.log(`│ ${r.greeting}`)
  for (const line of r.body.split('\n')) console.log(`│ ${line}`)
  console.log('│')
  console.log(`│ ${r.outro}`)
  console.log('│')
  console.log('│ Kind regards,')
  console.log('│ The Lusso Team')
  console.log(`│ [SMS variant] ${r.sms}`)
  console.log('└' + '─'.repeat(98))
}

console.log('\n' + '─'.repeat(100))
if (failures) {
  console.error(`${failures} check(s) FAILED`)
  process.exit(1)
}
console.log('all assertions passed')
