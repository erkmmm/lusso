// Tests the inbound-email parsing helpers in
// supabase/functions/comms-inbound/email.ts.
//
//   node scripts/test-reply-parsing.mjs
//
// The two functions under test are pure, but they live in a Deno edge function,
// so this pulls their source out of the .ts file and strips the annotations
// rather than duplicating them here — a copy would drift from what ships.
//
// Worth keeping green: stripQuotedReply is the difference between a readable
// comms thread and one where every reply repeats the entire history, and its
// failure mode in the other direction is deleting what a customer wrote.

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, "..", "supabase", "functions", "comms-inbound", "email.ts")
const src = readFileSync(SRC, "utf8")

function extractFn(name) {
  const start = src.indexOf(`function ${name}(`)
  if (start === -1) throw new Error(`${name} not found in ${SRC}`)
  let i = src.indexOf("{", start), depth = 0
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++
    else if (src[i] === "}") { depth--; if (depth === 0) { i++; break } }
  }
  return src.slice(start, i)
    .replace("(text: string): string {", "(text) {")
    .replace("(address: string): string | null {", "(address) {")
}

const { stripQuotedReply, extractToken } = new Function(
  `${extractFn("stripQuotedReply")}\n${extractFn("extractToken")}\n` +
  `return { stripQuotedReply, extractToken }`
)()

let pass = 0, fail = 0
const eq = (label, got, want) => {
  if (got === want) { console.log(`  PASS  ${label}`); pass++ }
  else {
    console.log(`  FAIL  ${label}`)
    console.log(`        got:  ${JSON.stringify(got)}`)
    console.log(`        want: ${JSON.stringify(want)}`)
    fail++
  }
}

console.log("── extractToken ──")
eq("token address", extractToken("q-k7m2p9qrstuvwxyz@reply.lusso.com.au"), "k7m2p9qrstuvwxyz")
eq("case-folded in transit", extractToken("Q-K7M2P9QRSTUVWXYZ@Reply.Lusso.Com.Au"), "k7m2p9qrstuvwxyz")
eq("plain address is not a token", extractToken("jobs@lusso.com.au"), null)
eq("too short to be a token", extractToken("q-abc@reply.lusso.com.au"), null)

console.log("\n── stripQuotedReply ──")
eq("gmail reply",
  stripQuotedReply("Yes that works for us, Tuesday morning is fine.\n\nOn Mon, 4 Aug 2026 at 09:12, Jett Hopkins <jobs@lusso.com.au> wrote:\n> Would Tuesday suit for the install?\n> Let me know."),
  "Yes that works for us, Tuesday morning is fine.")

eq("gmail attribution wrapped over two lines",
  stripQuotedReply("Sounds good.\n\nOn Mon, 4 Aug 2026 at 09:12, Jett Hopkins\n<jobs@lusso.com.au> wrote:\n> the quote is attached"),
  "Sounds good.")

eq("outlook header block",
  stripQuotedReply("Approved, please proceed.\n\nFrom: Jett Hopkins <jobs@lusso.com.au>\nSent: Monday, 4 August 2026 9:12 AM\nTo: Jane Smith\nSubject: Your quote\n\nHere is the quote."),
  "Approved, please proceed.")

eq("original message separator",
  stripQuotedReply("Can you do Thursday instead?\n\n-----Original Message-----\nFrom: Lusso"),
  "Can you do Thursday instead?")

eq("iphone signature",
  stripQuotedReply("Looks great thanks\n\nSent from my iPhone"),
  "Looks great thanks")

eq("bare quote block",
  stripQuotedReply("No problem.\n\n> are you free Friday?"),
  "No problem.")

eq("no quoting is untouched",
  stripQuotedReply("Hi, just checking on the blinds for the living room. When can you come out?"),
  "Hi, just checking on the blinds for the living room. When can you come out?")

// Over-trimming is the dangerous direction: these two must survive intact.
eq("prose starting with On is not cut",
  stripQuotedReply("On reflection we'd like the darker fabric please."),
  "On reflection we'd like the darker fabric please.")

eq("prose containing from: is not cut",
  stripQuotedReply("The measurement is from: the top of the architrave."),
  "The measurement is from: the top of the architrave.")

eq("multi-paragraph reply keeps every paragraph",
  stripQuotedReply("Thanks for that.\n\nTwo things though: can we move the install to Thursday, and does the price include the motor?\n\nOn Mon, 4 Aug 2026 at 09:12, Jett wrote:\n> quote attached"),
  "Thanks for that.\n\nTwo things though: can we move the install to Thursday, and does the price include the motor?")

eq("wholly-quoted forward is kept intact",
  stripQuotedReply("> everything below is quoted\n> and nothing else"),
  "> everything below is quoted\n> and nothing else")

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
