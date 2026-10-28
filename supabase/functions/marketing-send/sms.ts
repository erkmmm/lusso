/**
 * SMS composition and cost maths for campaign sends.
 *
 * The thing worth knowing: a text is not "160 characters". It is 160 only
 * while every character is in the GSM-7 alphabet. One curly apostrophe, one
 * em dash, one emoji flips the whole message to UCS-2 at 70 characters a
 * segment — so a 150-character message that looked like one text silently
 * becomes three, and a 1,200-recipient wave costs three times what was
 * budgeted. Copy pasted out of a word processor does this constantly, because
 * autocorrect turns ' into ’ without being asked.
 *
 * So segments are computed here and shown in the preview, rather than left for
 * the Twilio bill to reveal a week later.
 */

// GSM 03.38 basic set. Order is irrelevant; membership is the whole point.
const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"

// These exist in GSM-7 only as an escape pair, so each costs two characters.
const GSM7_EXTENDED = "^{}\\[~]|€"

const GSM7_SET = new Set([...GSM7])
const GSM7_EXT_SET = new Set([...GSM7_EXTENDED])

export type SmsMetrics = {
  encoding: "GSM-7" | "UCS-2"
  chars: number        // billable character units, extension chars counted twice
  segments: number
  /** Characters that forced UCS-2, de-duplicated, for the preview to name. */
  offenders: string[]
}

export function smsMetrics(text: string): SmsMetrics {
  const s = String(text ?? "")

  const offenders: string[] = []
  let units = 0
  let gsm = true

  for (const ch of s) {
    if (GSM7_SET.has(ch)) { units += 1; continue }
    if (GSM7_EXT_SET.has(ch)) { units += 2; continue }
    gsm = false
    if (!offenders.includes(ch)) offenders.push(ch)
  }

  if (!gsm) {
    // UCS-2 counts UTF-16 code units, so an emoji outside the BMP is 2.
    units = s.length
  }

  const single = gsm ? 160 : 70
  const multi  = gsm ? 153 : 67
  const segments = units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multi)

  return { encoding: gsm ? "GSM-7" : "UCS-2", chars: units, segments, offenders }
}

/**
 * The opt-out line appended to every marketing text.
 *
 * Not optional and not editable per campaign. The Spam Act 2003 requires a
 * functional unsubscribe facility on every commercial electronic message, and
 * "reply STOP" only works because comms-inbound actually honours the keyword —
 * the two halves have to ship together or this is just decoration.
 */
export const SMS_OPT_OUT = "Reply STOP to opt out"

/** Body plus the mandatory opt-out line, which is what actually gets sent. */
export function composeSms(body: string): string {
  const b = String(body ?? "").trim()
  if (!b) return ""
  // Already carries it (an author who wrote their own) — don't say it twice.
  if (/\breply\s+stop\b/i.test(b)) return b
  return `${b}\n${SMS_OPT_OUT}`
}

/**
 * Reasons this message must not be sent.
 *
 * Sender identification is a legal requirement, not a style note: a commercial
 * text that doesn't say who it is from fails the Spam Act regardless of how
 * good the offer is. Checked here rather than trusted to the campaign author,
 * because the cost of getting it wrong is measured in 1,200 messages.
 */
export function smsProblems(composed: string): string[] {
  const problems: string[] = []
  if (!composed) problems.push("SMS body rendered empty")
  if (!/lusso/i.test(composed)) {
    problems.push("message never says who it is from — add Lusso to the text")
  }
  const m = smsMetrics(composed)
  if (m.segments > 3) {
    problems.push(`${m.segments} segments (${m.chars} chars, ${m.encoding}) — too long for a campaign text`)
  }
  return problems
}
