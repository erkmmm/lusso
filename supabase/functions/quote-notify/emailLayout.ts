/**
 * Lusso email layout — Deno/edge copy.
 *
 * This is a deliberate duplicate of functions/api/_emailLayout.js. The two run
 * on different platforms (Supabase Edge Functions vs Cloudflare Pages Functions)
 * with separate deploys, so they can't share a module without a build step.
 * KEEP THE TWO IN SYNC — if you change the brand palette, spacing or markup in
 * one, change it in the other, or staff email will drift from customer email.
 *
 * See the JS copy for the full notes on the email-client constraints
 * (tables not flex, inline styles only, 1px borders, pill buttons as <td>).
 */

export const BRAND = {
  paper:     '#F7F7F6',
  paperPure: '#FFFFFF',
  mist:      '#DEDFDC',
  stone:     '#8C8E8B',
  graphite:  '#3A3B3C',
  ink:       '#101113',
  bronze:    '#6E5A43',
}

const FONT = "'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

// Masthead logo. Hosted, not inlined: data: URIs are stripped by Outlook and
// Gmail, and a CID attachment would have to be threaded through all five
// senders. This exact URL is already proven — the staff email signatures use
// it. Native asset is 196x70; shown at 140x50 so it stays crisp on retina.
const LOGO_URL = 'https://app.lusso.com.au/email/lusso-logo.png'


export const escapeHtml = (s = '') =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

const richText = (s = '') => escapeHtml(s).replace(/\r?\n/g, '<br>')

export interface PanelRow { label: string; value?: string | number | null; strong?: boolean }

export interface EmailContent {
  /** Same shape as the Pages copy's `panel` — keep the two identical. */
  panel?: { title?: string; subtitle?: string; rows?: PanelRow[] } | null
  preheader?: string
  eyebrow?: string
  heading?: string
  greeting?: string
  body?: string
  cta?: { label: string; url: string } | null
  outro?: string
  signOff?: string
  /**
   * "Your reply comes back to us" line under the sign-off. Pass it only when
   * the message actually carries a per-conversation Reply-To — promising a
   * reply will reach us when it would land in a mailbox nobody watches is
   * worse than saying nothing. Mirrors the send-communication copy.
   */
  replyNote?: string
  footerNote?: string
}


/**
 * A bordered detail panel — label/value pairs, for bank details and the like.
 *
 * Ported from functions/api/_emailLayout.js with the same `panel` shape and
 * markup. Bank details written out as a sentence are how a customer mistypes
 * an account number; each value gets its own row.
 */
function panelHtml(panel: EmailContent['panel']): string {
  if (!panel) return ''
  const { title, subtitle, rows = [] } = panel

  const rowsHtml = rows.filter(r => r && r.value != null && r.value !== '').map(r => `
    <tr>
      <td style="padding:7px 0 0;font-family:${FONT};font-size:13px;color:${BRAND.stone};white-space:nowrap;">${escapeHtml(r.label)}</td>
      <td align="right" style="padding:7px 0 0;font-family:${FONT};font-size:13px;font-weight:${r.strong ? '700' : '500'};color:${BRAND.ink};">${escapeHtml(String(r.value))}</td>
    </tr>`).join('')

  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background:${BRAND.paper};border:1px solid ${BRAND.mist};border-radius:8px;margin:0 0 28px;">
      <tr><td style="padding:20px 22px;">
        ${title ? `<div style="font-family:${FONT};font-size:9.5px;font-weight:500;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.stone};">${escapeHtml(title)}</div>` : ''}
        ${subtitle ? `<div style="font-family:${FONT};font-size:20px;font-weight:700;color:${BRAND.ink};padding-top:5px;letter-spacing:-0.01em;">${escapeHtml(subtitle)}</div>` : ''}
        ${rowsHtml ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:${title || subtitle ? '10px' : '0'};">${rowsHtml}</table>` : ''}
      </td></tr>
    </table>`
}

export function renderEmail({
  panel = null,
  preheader = '',
  eyebrow = '',
  heading = '',
  greeting = '',
  body = '',
  cta = null,
  outro = '',
  signOff = 'The Lusso Team',
  replyNote = '',
  footerNote = '',
}: EmailContent = {}): string {
  const eyebrowHtml = eyebrow ? `
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0 0 14px;">
      <tr>
        <td valign="middle" style="width:18px;font-size:0;line-height:0;">
          <div style="width:18px;height:2px;background:${BRAND.bronze};font-size:0;line-height:0;">&nbsp;</div>
        </td>
        <td valign="middle" style="padding-left:10px;font-family:${FONT};font-size:10px;font-weight:500;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.stone};">${escapeHtml(eyebrow)}</td>
      </tr>
    </table>` : ''

  const ctaHtml = cta?.url && cta?.label ? `
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0 0 30px;">
      <tr>
        <td style="background:${BRAND.ink};border-radius:999px;">
          <a href="${encodeURI(cta.url)}" style="display:inline-block;padding:14px 32px;font-family:${FONT};font-size:15px;font-weight:500;letter-spacing:0.01em;color:${BRAND.paper};text-decoration:none;border-radius:999px;">${escapeHtml(cta.label)}</a>
        </td>
      </tr>
    </table>` : ''

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(heading || 'Lusso')}</title>
<!--[if mso]><style>*{font-family:Helvetica,Arial,sans-serif !important;}</style><![endif]-->
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${BRAND.paper};-webkit-font-smoothing:antialiased;">

<div style="display:none;font-size:1px;color:${BRAND.paper};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</div>

<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background:${BRAND.paper};">
<tr><td align="center" style="padding:40px 16px;">

  <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" style="width:100%;max-width:600px;">

    <tr><td style="padding:0 0 22px;">
      <img src="${LOGO_URL}" width="140" height="50" alt="Lusso"
        style="display:block;border:0;outline:none;text-decoration:none;width:140px;height:50px;-ms-interpolation-mode:bicubic;font-family:${FONT};font-size:17px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${BRAND.ink};">
    </td></tr>

    <tr><td style="background:${BRAND.paperPure};border:1px solid ${BRAND.mist};border-radius:10px;padding:36px 34px;">
      ${eyebrowHtml}
      ${heading ? `<h1 style="margin:0 0 20px;font-family:${FONT};font-size:25px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:${BRAND.ink};">${escapeHtml(heading)}</h1>` : ''}
      ${greeting ? `<p style="margin:0 0 12px;font-family:${FONT};font-size:15px;line-height:1.65;color:${BRAND.graphite};">${escapeHtml(greeting)}</p>` : ''}
      ${body ? `<p style="margin:0 0 26px;font-family:${FONT};font-size:15px;line-height:1.65;color:${BRAND.graphite};">${richText(body)}</p>` : ''}
      ${panelHtml(panel)}
      ${ctaHtml}
      ${outro ? `<p style="margin:0 0 22px;font-family:${FONT};font-size:14px;line-height:1.65;color:${BRAND.stone};">${richText(outro)}</p>` : ''}
      ${signOff ? `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
        <tr><td style="border-top:1px solid ${BRAND.mist};padding-top:20px;font-family:${FONT};font-size:14px;line-height:1.6;color:${BRAND.graphite};">
          Kind regards,<br><span style="font-weight:700;color:${BRAND.ink};">${escapeHtml(signOff)}</span>
        </td></tr>
      </table>` : ''}
      ${replyNote ? `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:20px;">
        <tr><td style="background:${BRAND.paper};border:1px solid ${BRAND.mist};border-radius:8px;padding:12px 14px;font-family:${FONT};font-size:13px;line-height:1.6;color:${BRAND.stone};">${richText(replyNote)}</td></tr>
      </table>` : ''}
    </td></tr>

    <tr><td align="center" style="padding:22px 12px 0;">
      <p style="margin:0;font-family:${FONT};font-size:11px;line-height:1.7;color:${BRAND.stone};">
        Lusso &middot; Fashion for Windows
        ${footerNote ? `<br>${richText(footerNote)}` : ''}
      </p>
    </td></tr>

  </table>

</td></tr>
</table>
</body>
</html>`
}

export function renderText({ greeting = '', body = '', panel = null, cta = null, outro = '', signOff = 'The Lusso Team', replyNote = '' }: EmailContent = {}): string {
  const out: string[] = []
  if (greeting) out.push(greeting)
  if (body) out.push(body)
  if (panel) {
    const lines: string[] = []
    if (panel.title)    lines.push(panel.title.toUpperCase())
    if (panel.subtitle) lines.push(panel.subtitle)
    ;(panel.rows || []).filter(r => r && r.value != null && r.value !== '').forEach(r => lines.push(`${r.label}: ${r.value}`))
    if (lines.length) out.push(lines.join('\n'))
  }
  if (cta?.url) out.push(`${cta.label}: ${cta.url}`)
  if (outro) out.push(outro)
  if (replyNote) out.push(replyNote)
  // Internal notifications pass an empty signOff — don't leave a dangling
  // "Kind regards," with nothing after it.
  out.push(signOff ? `Kind regards,\n${signOff}\n\nLusso · Fashion for Windows` : 'Lusso · Fashion for Windows')
  return out.join('\n\n')
}
