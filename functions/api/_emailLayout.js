/**
 * Shared Lusso email layout.
 *
 * Every outbound email — quotes, installer requests, purchase orders and the
 * free-text messages staff send from the Comms tab — renders through here, so
 * they all look like they came from the same company. The palette and type are
 * the Lusso brand kit (the same tokens the customer quote page uses):
 *
 *   Paper #F7F7F6 · Paper Pure #FFFFFF · Mist #DEDFDC · Stone #8C8E8B
 *   Graphite #3A3B3C · Ink #101113 · Bronze #6E5A43 · Manrope
 *
 * Email-client constraints this file works around, so don't "simplify" them:
 *   · Tables, not flex/grid — Outlook's Word renderer supports neither.
 *   · Every style inline — <style> blocks are stripped by Gmail's web client.
 *   · 1px borders, not the brand's 0.5px hairlines — clients round 0.5 to 0.
 *   · Buttons are a padded <a> inside a rounded <td>, not a styled <button>.
 *   · Webfonts only land in Apple Mail/iOS; the stack degrades to system sans.
 */

export const BRAND = {
  paper:     '#F7F7F6',
  paperPure: '#FFFFFF',
  mist:      '#DEDFDC',
  stone:     '#8C8E8B',
  graphite:  '#3A3B3C',
  ink:       '#101113',
  bronze:    '#6E5A43',
};

const FONT = "'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Masthead logo. Hosted, not inlined: data: URIs are stripped by Outlook and
// Gmail, and a CID attachment would have to be threaded through all five
// senders. This exact URL is already proven — the staff email signatures use
// it. Native asset is 196x70; shown at 140x50 so it stays crisp on retina.
const LOGO_URL = 'https://app.lusso.com.au/email/lusso-logo.png'


export const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Escape, then turn newlines into <br> — for user-authored copy. */
const richText = (s = '') => escapeHtml(s).replace(/\r?\n/g, '<br>');

/** The signature bronze dash + uppercase eyebrow, as a table row. */
function eyebrowHtml(text) {
  if (!text) return '';
  return `
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0 0 14px;">
      <tr>
        <!-- The rule lives in a fixed-height div, not on the cell: a cell's
             background fills the whole row height, which turns the 2px hairline
             into a block as soon as the label beside it is taller. -->
        <td valign="middle" style="width:18px;font-size:0;line-height:0;">
          <div style="width:18px;height:2px;background:${BRAND.bronze};font-size:0;line-height:0;">&nbsp;</div>
        </td>
        <td valign="middle" style="padding-left:10px;font-family:${FONT};font-size:10px;font-weight:500;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.stone};">${escapeHtml(text)}</td>
      </tr>
    </table>`;
}

/**
 * A bordered detail panel — the quote reference block, the PO summary, the
 * install address. `rows` render as label/value pairs.
 */
function panelHtml(panel) {
  if (!panel) return '';
  const { title, subtitle, rows = [] } = panel;

  const rowsHtml = rows.filter(r => r && r.value != null && r.value !== '').map(r => `
    <tr>
      <td style="padding:7px 0 0;font-family:${FONT};font-size:13px;color:${BRAND.stone};white-space:nowrap;">${escapeHtml(r.label)}</td>
      <td align="right" style="padding:7px 0 0;font-family:${FONT};font-size:13px;font-weight:${r.strong ? '700' : '500'};color:${BRAND.ink};">${escapeHtml(r.value)}</td>
    </tr>`).join('');

  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background:${BRAND.paper};border:1px solid ${BRAND.mist};border-radius:8px;margin:0 0 28px;">
      <tr><td style="padding:20px 22px;">
        ${title ? `<div style="font-family:${FONT};font-size:9.5px;font-weight:500;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.stone};">${escapeHtml(title)}</div>` : ''}
        ${subtitle ? `<div style="font-family:${FONT};font-size:20px;font-weight:700;color:${BRAND.ink};padding-top:5px;letter-spacing:-0.01em;">${escapeHtml(subtitle)}</div>` : ''}
        ${rowsHtml ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:${title || subtitle ? '10px' : '0'};">${rowsHtml}</table>` : ''}
      </td></tr>
    </table>`;
}

/** One pill button cell. Primary = solid ink; secondary = hairline outline. */
function buttonCell(cta, variant = 'primary') {
  const solid = variant === 'primary';
  const bg     = solid ? BRAND.ink : BRAND.paperPure;
  const colour = solid ? BRAND.paper : BRAND.ink;
  const border = solid ? 'none' : `1px solid ${BRAND.stone}`;
  return `
    <td style="background:${bg};border:${border};border-radius:999px;">
      <a href="${encodeURI(cta.url)}" style="display:inline-block;padding:${solid ? '14px 32px' : '13px 31px'};font-family:${FONT};font-size:15px;font-weight:500;letter-spacing:0.01em;color:${colour};text-decoration:none;border-radius:999px;">${escapeHtml(cta.label)}</a>
    </td>`;
}

/** Ink pill button, optionally paired with a secondary outline button. */
function ctaHtml(cta, ctaSecondary) {
  if (!cta?.url || !cta?.label) return '';
  return `
    <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:0 0 30px;">
      <tr>
        ${buttonCell(cta, 'primary')}
        ${ctaSecondary?.url ? `<td style="width:10px;font-size:0;line-height:0;">&nbsp;</td>${buttonCell(ctaSecondary, 'secondary')}` : ''}
      </tr>
    </table>`;
}

/** Labelled note blocks — "Service required", "Notes", and similar. */
function noteBlocksHtml(blocks = []) {
  return blocks.filter(b => b && b.text).map(b => `
    <div style="margin:0 0 20px;">
      ${b.label ? `<div style="font-family:${FONT};font-size:9.5px;font-weight:500;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.stone};padding-bottom:7px;">${escapeHtml(b.label)}</div>` : ''}
      <div style="background:${BRAND.paper};border:1px solid ${BRAND.mist};border-radius:8px;padding:13px 16px;font-family:${FONT};font-size:14px;line-height:1.6;color:${BRAND.graphite};">${richText(b.text)}</div>
    </div>`).join('');
}

/**
 * A data table — the installer's measure sheet. `align` is a per-column
 * 'left' | 'right' | 'center' list.
 */
function tableHtml(table) {
  if (!table?.rows?.length) return '';
  const { caption, head = [], rows = [], align = [] } = table;
  const at = (i) => align[i] || 'left';

  const thead = head.length ? `
    <tr>${head.map((h, i) => `<th align="${at(i)}" style="padding:9px 10px;background:${BRAND.paper};border-bottom:1px solid ${BRAND.mist};font-family:${FONT};font-size:9.5px;font-weight:500;letter-spacing:0.1em;text-transform:uppercase;color:${BRAND.stone};">${escapeHtml(h)}</th>`).join('')}</tr>` : '';

  // Numeric columns must not wrap — "2400 × 2100" breaking across two lines in
  // a 600px email makes the measure sheet hard to read at a glance.
  const nowrap = (i) => at(i) === 'left' ? '' : 'white-space:nowrap;';

  const tbody = rows.map(r => `
    <tr>${r.map((c, i) => `<td align="${at(i)}" style="padding:9px 8px;border-top:1px solid ${BRAND.mist};font-family:${FONT};font-size:13px;color:${BRAND.graphite};${nowrap(i)}">${escapeHtml(c ?? '')}</td>`).join('')}</tr>`).join('');

  return `
    ${caption ? `<div style="font-family:${FONT};font-size:9.5px;font-weight:500;letter-spacing:0.12em;text-transform:uppercase;color:${BRAND.stone};padding-bottom:8px;">${escapeHtml(caption)}</div>` : ''}
    <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="border:1px solid ${BRAND.mist};border-radius:8px;border-collapse:separate;border-spacing:0;margin:0 0 26px;">
      ${thead}${tbody}
    </table>`;
}

/**
 * Render a complete Lusso email.
 *
 * @param {object}  o
 * @param {string}  o.preheader  Hidden inbox preview line. Always set one —
 *                               without it clients preview the raw body.
 * @param {string}  o.eyebrow    Small uppercase label, e.g. "Quotation".
 * @param {string}  o.heading    Main heading.
 * @param {string}  o.greeting   e.g. "Hi Sarah,".
 * @param {string}  o.body       Body copy; newlines become line breaks.
 * @param {object}  o.panel      { title, subtitle, rows:[{label,value,strong}] }
 * @param {Array}   o.noteBlocks [{ label, text }] — bordered note panels.
 * @param {object}  o.table      { caption, head, rows, align } — data table.
 * @param {object}  o.cta        { label, url }
 * @param {object}  o.ctaSecondary  Optional outline button beside the CTA.
 * @param {string}  o.ctaNote    Line shown directly above the buttons.
 * @param {string}  o.outro      Copy below the CTA.
 * @param {string}  o.signOff    Defaults to "The Lusso Team".
 * @param {string}  o.footerNote Small print under the footer rule.
 */
export function renderEmail({
  preheader = '',
  eyebrow = '',
  heading = '',
  greeting = '',
  body = '',
  panel = null,
  noteBlocks = [],
  table = null,
  cta = null,
  ctaSecondary = null,
  ctaNote = '',
  outro = '',
  signOff = 'The Lusso Team',
  footerNote = '',
} = {}) {
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

    <!-- Wordmark -->
    <tr><td style="padding:0 0 22px;">
      <img src="${LOGO_URL}" width="140" height="50" alt="Lusso"
        style="display:block;border:0;outline:none;text-decoration:none;width:140px;height:50px;-ms-interpolation-mode:bicubic;font-family:${FONT};font-size:17px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${BRAND.ink};">
    </td></tr>

    <!-- Card -->
    <tr><td style="background:${BRAND.paperPure};border:1px solid ${BRAND.mist};border-radius:10px;padding:36px 34px;">
      ${eyebrowHtml(eyebrow)}
      ${heading ? `<h1 style="margin:0 0 20px;font-family:${FONT};font-size:25px;line-height:1.25;font-weight:700;letter-spacing:-0.02em;color:${BRAND.ink};">${escapeHtml(heading)}</h1>` : ''}
      ${greeting ? `<p style="margin:0 0 12px;font-family:${FONT};font-size:15px;line-height:1.65;color:${BRAND.graphite};">${escapeHtml(greeting)}</p>` : ''}
      ${body ? `<p style="margin:0 0 26px;font-family:${FONT};font-size:15px;line-height:1.65;color:${BRAND.graphite};">${richText(body)}</p>` : ''}
      ${panelHtml(panel)}
      ${noteBlocksHtml(noteBlocks)}
      ${tableHtml(table)}
      ${ctaNote ? `<p style="margin:0 0 14px;font-family:${FONT};font-size:14px;line-height:1.65;color:${BRAND.graphite};">${richText(ctaNote)}</p>` : ''}
      ${ctaHtml(cta, ctaSecondary)}
      ${outro ? `<p style="margin:0 0 22px;font-family:${FONT};font-size:14px;line-height:1.65;color:${BRAND.stone};">${richText(outro)}</p>` : ''}
      ${signOff ? `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
        <tr><td style="border-top:1px solid ${BRAND.mist};padding-top:20px;font-family:${FONT};font-size:14px;line-height:1.6;color:${BRAND.graphite};">
          Kind regards,<br><span style="font-weight:700;color:${BRAND.ink};">${escapeHtml(signOff)}</span>
        </td></tr>
      </table>` : ''}
    </td></tr>

    <!-- Footer -->
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
</html>`;
}

/**
 * Plain-text alternative. Sending one alongside the HTML measurably improves
 * deliverability and is what text-only clients and screen readers fall back to.
 */
export function renderText({ greeting = '', body = '', panel = null, cta = null, outro = '', signOff = 'The Lusso Team' } = {}) {
  const out = [];
  if (greeting) out.push(greeting);
  if (body) out.push(body);
  if (panel) {
    const lines = [];
    if (panel.title)    lines.push(panel.title.toUpperCase());
    if (panel.subtitle) lines.push(panel.subtitle);
    (panel.rows || []).filter(r => r && r.value != null && r.value !== '').forEach(r => lines.push(`${r.label}: ${r.value}`));
    if (lines.length) out.push(lines.join('\n'));
  }
  if (cta?.url) out.push(`${cta.label}: ${cta.url}`);
  if (outro) out.push(outro);
  // Internal notifications pass an empty signOff — don't leave a dangling
  // "Kind regards," with nothing after it.
  out.push(signOff ? `Kind regards,\n${signOff}\n\nLusso · Fashion for Windows` : 'Lusso · Fashion for Windows');
  return out.join('\n\n');
}
