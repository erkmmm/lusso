/**
 * Cloudflare Pages Function: /api/send-quote
 * Sends a quote email to the customer via Resend.
 *
 * Environment variables (set in Cloudflare Pages → Settings → Environment Variables):
 *   RESEND_API_KEY  — your Resend secret key (re_...)
 *   EMAIL_FROM      — sender address, e.g. "Lusso <quotes@lusso.com.au>"
 */

import { requireActiveUser } from './_auth.js';
import { renderEmail, renderText } from './_emailLayout.js';
import { logOutboundEmail, bearerToken } from './_logComm.js';
import { replyAddressFor, REPLY_NOTE } from './_replyToken.js';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

/** Valid enough to hand to the mail provider. Deliberately permissive. */
const isEmail = (v) => typeof v === 'string' && /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(v.trim());

const formatBytes = (n) => {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`;
};

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  // Only signed-in, active staff may send mail from the business domain.
  const caller = await requireActiveUser(context);
  if (!caller) return json(401, { error: 'Unauthorized' });

  const RESEND_API_KEY = context.env.RESEND_API_KEY;
  const FROM_ADDRESS   = context.env.EMAIL_FROM || 'Lusso <onboarding@resend.dev>';
  const SUPABASE_URL   = context.env.SUPABASE_URL || context.env.VITE_SUPABASE_URL || '';

  // ── Parse request body ────────────────────────────────────────────────────
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json(400, { error: 'Invalid JSON in request body' });
  }

  const { quote, customer, appUrl, emailIntro, followUp } = body || {};

  // ── Validate inputs ───────────────────────────────────────────────────────
  if (!quote)           return json(400, { error: 'Missing quote data' });
  if (!customer?.email) return json(400, { error: 'Customer email address is missing. Please add an email to the customer record and try again.' });

  if (!RESEND_API_KEY) {
    return json(500, { error: 'Email provider is not configured. Please set RESEND_API_KEY in the Cloudflare Pages environment variables.' });
  }

  // ── Build email ───────────────────────────────────────────────────────────
  const origin    = appUrl || 'https://app.lusso.com.au';
  // ?t= is the quote's public_token and is what authorises the page. Quote ids
  // are sequential, so a link carrying only the id was one anyone could guess —
  // and the page's RPCs now refuse without it, so a link built without the
  // token simply won't open.
  const quoteUrl  = `${origin}/quotes/${quote.id}/preview`
    + (quote.publicToken ? `?t=${encodeURIComponent(quote.publicToken)}` : '');
  const firstName = customer.name?.split(' ')[0] || customer.name || 'there';
  const quoteRef  = quote.quoteNumber || quote.id;
  const expiryFmt = quote.expiryDate
    ? new Date(quote.expiryDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const totalFmt = quote.grandTotal != null && quote.grandTotal !== ''
    ? '$' + Number(quote.grandTotal).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;

  // A follow-up is the SAME quote sent again — same link, same totals, same
  // expiry. Only the framing changes. Re-sending "Your quote is ready" would
  // read as a new quote and leave the customer hunting for what changed.
  const isFollowUp = !!followUp;

  // Documents the customer should read, as absolute links. Built here rather
  // than trusted from the client: the caller sends the quote object, and a
  // url field on it would be an open redirect dressed up as a brochure.
  // Only our own storage host is linked, and only http(s).
  const docBase = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/public/quote-docs/` : '';
  const documents = (!docBase ? [] : Array.isArray(quote.documents) ? quote.documents : [])
    .filter(d => d && typeof d.path === 'string' && d.path && !d.path.includes('..'))
    .slice(0, 10)
    .map(d => ({
      label: String(d.name || 'Document').slice(0, 120),
      url:   docBase + d.path.split('/').map(encodeURIComponent).join('/'),
      meta:  d.sizeBytes ? formatBytes(d.sizeBytes) : '',
    }));

  // One subject, used for both the send and the communications log. These were
  // two separate literals, so changing the email's subject silently left the
  // audit trail claiming something different had been sent.
  const subject = isFollowUp
    ? `Following up on your quote – ${quoteRef}`
    : `Your quote from Lusso – ${quoteRef}`;

  // A quote email already invites a reply ("just reply to this email"), which
  // until now went to the shared mailbox and never reached the customer's
  // thread. With a per-conversation Reply-To it goes where the copy has always
  // implied it goes. Best-effort: null simply means the generic address and no
  // promise about where a reply lands.
  // Who else gets a copy: the customer's second contact. Never the primary
  // address twice — Resend would deliver two copies of the same email to the
  // same person — and never a malformed one, which Resend rejects outright
  // and would take the whole send down with it.
  const ccList = [customer.secondaryEmail]
    .filter(isEmail)
    .map(e => e.trim())
    .filter(e => e.toLowerCase() !== String(customer.email).trim().toLowerCase());

  const callerToken  = bearerToken(context);
  const replyAddress = await replyAddressFor(context, callerToken, {
    jobId:      quote.jobId,
    customerId: customer.id,
  });

  const content = {
    preheader: `Quote ${quoteRef}${totalFmt ? ` · ${totalFmt}` : ''}${expiryFmt ? ` · valid until ${expiryFmt}` : ''}`,
    eyebrow:   isFollowUp ? 'Following up' : 'Quotation',
    heading:   isFollowUp ? 'Still thinking it over?' : 'Your quote is ready',
    greeting:  `Hi ${firstName},`,
    body:      emailIntro || (isFollowUp
      ? 'I wanted to follow up on the quote we sent you — it is included again below so it is easy to find. Nothing has changed in it, and it is still valid.'
      : 'Thank you for the opportunity to quote on your window furnishings. Your full proposal is ready to view online — you can accept it directly from the page.'),
    panel: {
      title:    'Quote reference',
      subtitle: quoteRef,
      rows: [
        { label: 'Job',          value: quote.title || '' },
        { label: 'Total',        value: totalFmt || '', strong: true },
        { label: 'Valid until',  value: expiryFmt || '' },
      ],
    },
    // Reading material attached to the quote. The quote page lists these too —
    // they are repeated here because the email is what lands in front of
    // someone, and "it's on the page" is one click more than most people make.
    linkList: documents.length ? { label: 'Attachments', items: documents } : null,
    cta:   { label: isFollowUp ? 'View your quote again' : 'View your quote', url: quoteUrl },
    outro: isFollowUp
      ? "If the timing isn't right, just reply and say so — we'd rather know than keep chasing."
      : "If you have any questions, just reply to this email — we're happy to walk you through the details.",
    replyNote: replyAddress ? REPLY_NOTE : '',
  };

  const html = renderEmail(content);
  const text = renderText(content);

  // ── Send via Resend ───────────────────────────────────────────────────────
  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:     FROM_ADDRESS,
        to:       [customer.email],
        // The second decision-maker on the customer record — a partner, an
        // office manager. CC rather than a second `to` so each of them can see
        // the other has it, which is the whole point of copying them in.
        cc:       ccList.length ? ccList : undefined,
        reply_to: replyAddress || context.env.EMAIL_REPLY_TO || undefined,
        subject,
        html,
        text,
      }),
    });

    const resendText = await resendRes.text();
    let resendData = null;
    try { resendData = JSON.parse(resendText); } catch { /* plain text error */ }

    if (!resendRes.ok) {
      console.error('[send-quote] Resend error:', resendText);
      return json(500, {
        error: resendData?.message || resendData?.name || resendText || 'Email provider failed to send the email.',
      });
    }

    // Log it so the customer's thread shows the quote went out, and so a
    // later bounce has a row to land on. Never blocks the response.
    await logOutboundEmail(context, callerToken, {
      externalId: resendData?.id,
      to:         customer.email,
      subject,
      body:       (isFollowUp
        ? `Follow-up on quote ${quoteRef} emailed to ${customer.email}`
        : `Quote ${quoteRef} emailed to ${customer.email}`)
        + (ccList.length ? `, copied to ${ccList.join(', ')}` : '')
        + (documents.length ? ` with ${documents.length} document${documents.length === 1 ? '' : 's'}` : '')
        + '.',
      customerId: customer.id,
      jobId:      quote.jobId,
    });

    return json(200, { success: true, id: resendData?.id });

  } catch (err) {
    console.error('[send-quote] fetch error:', err);
    return json(500, { error: err.message || 'Unexpected error contacting the email provider.' });
  }
}
