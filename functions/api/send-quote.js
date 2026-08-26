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

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

  // ── Parse request body ────────────────────────────────────────────────────
  let body;
  try {
    body = await context.request.json();
  } catch {
    return json(400, { error: 'Invalid JSON in request body' });
  }

  const { quote, customer, appUrl, emailIntro } = body || {};

  // ── Validate inputs ───────────────────────────────────────────────────────
  if (!quote)           return json(400, { error: 'Missing quote data' });
  if (!customer?.email) return json(400, { error: 'Customer email address is missing. Please add an email to the customer record and try again.' });

  if (!RESEND_API_KEY) {
    return json(500, { error: 'Email provider is not configured. Please set RESEND_API_KEY in the Cloudflare Pages environment variables.' });
  }

  // ── Build email ───────────────────────────────────────────────────────────
  const origin    = appUrl || 'https://app.lusso.com.au';
  const quoteUrl  = `${origin}/quotes/${quote.id}/preview`;
  const firstName = customer.name?.split(' ')[0] || customer.name || 'there';
  const quoteRef  = quote.quoteNumber || quote.id;
  const expiryFmt = quote.expiryDate
    ? new Date(quote.expiryDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const totalFmt = quote.grandTotal != null && quote.grandTotal !== ''
    ? '$' + Number(quote.grandTotal).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : null;

  const content = {
    preheader: `Quote ${quoteRef}${totalFmt ? ` · ${totalFmt}` : ''}${expiryFmt ? ` · valid until ${expiryFmt}` : ''}`,
    eyebrow:   'Quotation',
    heading:   'Your quote is ready',
    greeting:  `Hi ${firstName},`,
    body:      emailIntro || 'Thank you for the opportunity to quote on your window furnishings. Your full proposal is ready to view online — you can accept it directly from the page.',
    panel: {
      title:    'Quote reference',
      subtitle: quoteRef,
      rows: [
        { label: 'Job',          value: quote.title || '' },
        { label: 'Total',        value: totalFmt || '', strong: true },
        { label: 'Valid until',  value: expiryFmt || '' },
      ],
    },
    cta:   { label: 'View your quote', url: quoteUrl },
    outro: "If you have any questions, just reply to this email — we're happy to walk you through the details.",
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
        reply_to: context.env.EMAIL_REPLY_TO || undefined,
        subject:  `Your quote from Lusso – ${quoteRef}`,
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
    await logOutboundEmail(context, bearerToken(context), {
      externalId: resendData?.id,
      to:         customer.email,
      subject:    `Your quote from Lusso – ${quoteRef}`,
      body:       `Quote ${quoteRef} emailed to ${customer.email}.`,
      customerId: customer.id,
      jobId:      quote.jobId,
    });

    return json(200, { success: true, id: resendData?.id });

  } catch (err) {
    console.error('[send-quote] fetch error:', err);
    return json(500, { error: err.message || 'Unexpected error contacting the email provider.' });
  }
}
