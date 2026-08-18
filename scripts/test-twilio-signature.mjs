// Tests the Twilio signature payload construction in
// supabase/functions/comms-inbound/twilio.ts against Twilio's own published
// test vector.
//
//   node scripts/test-twilio-signature.mjs
//
// If this drifts, inbound SMS stops being verifiable: either genuine Twilio
// webhooks get rejected (customer messages vanish) or the check passes on
// input it shouldn't. The vector below is from
// https://www.twilio.com/docs/usage/security

import { readFileSync } from "node:fs"
import { createHmac } from "node:crypto"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, "..", "supabase", "functions", "comms-inbound", "twilio.ts")
const src = readFileSync(SRC, "utf8")

// Pull the real function out rather than restating it here — a copy would let
// the shipped code drift away from the thing under test.
const start = src.indexOf("function signablePayload(")
if (start === -1) throw new Error(`signablePayload not found in ${SRC}`)
let i = src.indexOf("{", start), depth = 0
for (; i < src.length; i++) {
  if (src[i] === "{") depth++
  else if (src[i] === "}") { depth--; if (depth === 0) { i++; break } }
}
const signablePayload = new Function(
  src.slice(start, i).replace("(params: URLSearchParams): string {", "(params) {") +
  "\nreturn signablePayload"
)()

const sign = (data, token) =>
  createHmac("sha1", token).update(data, "utf8").digest("base64")

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

console.log("── Twilio published vector ──")

const URL_ = "https://example.com/myapp.php?foo=1&bar=2"
const TOKEN = "12345"
// Deliberately not in sorted order: sorting is part of what's under test.
const params = new URLSearchParams([
  ["Digits", "1234"],
  ["To", "+18005551212"],
  ["From", "+14158675310"],
  ["Caller", "+14158675310"],
  ["CallSid", "CA1234567890ABCDE"],
])

eq("concatenation",
  URL_ + signablePayload(params),
  "https://example.com/myapp.php?foo=1&bar=2CallSidCA1234567890ABCDECaller+14158675310Digits1234From+14158675310To+18005551212")

eq("signature",
  sign(URL_ + signablePayload(params), TOKEN),
  "L/OH5YylLD5NRKLltdqwSvS0BnU=")

console.log("\n── payload construction ──")

eq("keys are sorted, not left in arrival order",
  signablePayload(new URLSearchParams([["b", "2"], ["a", "1"]])),
  "a1b2")

eq("no params yields an empty payload",
  signablePayload(new URLSearchParams()),
  "")

eq("repeated keys contribute every value in arrival order",
  signablePayload(new URLSearchParams([["MediaUrl", "one"], ["A", "x"], ["MediaUrl", "two"]])),
  "AxMediaUrloneMediaUrltwo")

eq("empty values still contribute their key",
  signablePayload(new URLSearchParams([["Body", ""], ["From", "+61400000000"]])),
  "BodyFrom+61400000000")

// A tampered body must not produce the genuine signature.
const tampered = new URLSearchParams([
  ["Digits", "1234"],
  ["To", "+18005551212"],
  ["From", "+14158675310"],
  ["Caller", "+14158675310"],
  ["CallSid", "CA1234567890ABCDF"], // last character changed
])
eq("altered parameter breaks the signature",
  sign(URL_ + signablePayload(tampered), TOKEN) === "L/OH5YylLD5NRKLltdqwSvS0BnU=",
  false)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
