/**
 * Cloudflare Pages Function: /api/send-purchase-order
 * Emails a generated Purchase Order (PDF) to a recipient as an attachment via Resend.
 *
 * Environment variables (Cloudflare Pages → Settings → Environment Variables):
 *   RESEND_API_KEY  — your Resend secret key (re_...)
 *   EMAIL_FROM      — optional sender address, e.g. "Lusso <orders@yourdomain.com>"
 *
 * The PDF is generated client-side and sent here as base64 — no secret ever
 * reaches the browser.
 */

import { requireActiveUser } from './_auth.js';

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function onRequestPost(context) {
  const caller = await requireActiveUser(context);
  if (!caller) return json(401, { error: 'Unauthorized' });

  const RESEND_API_KEY = context.env.RESEND_API_KEY;
  const FROM_ADDRESS   = context.env.EMAIL_FROM || 'Lusso <onboarding@resend.dev>';

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json(400, { error: 'Invalid JSON in request body' });
  }

  const { to, subject, message, filename, contentBase64 } = body || {};

  if (!to || !EMAIL_RE.test(String(to).trim())) {
    return json(400, { error: 'A valid recipient email address is required.' });
  }
  if (!contentBase64) {
    return json(400, { error: 'Missing purchase order attachment.' });
  }
  if (!RESEND_API_KEY) {
    return json(500, { error: 'Email provider is not configured. Please set RESEND_API_KEY in the Cloudflare Pages environment variables.' });
  }

  const safeSubject = subject || 'Curtain Purchase Order';
  const bodyText = message || 'Please find the attached curtain purchase order.';
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;font-size:14px;color:#1f2a2a;line-height:1.5">
    <p>${escapeHtml(bodyText).replace(/\n/g, '<br>')}</p>
    <p style="color:#8a9696;font-size:12px">Sent from Lusso Job Management.</p>
  </body></html>`;

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    FROM_ADDRESS,
        to:      [String(to).trim()],
        subject: safeSubject,
        html,
        attachments: [
          { filename: filename || 'Curtain-PO.pdf', content: contentBase64 },
        ],
      }),
    });

    const resendText = await resendRes.text();
    let resendData = null;
    try { resendData = JSON.parse(resendText); } catch { /* plain text error */ }

    if (!resendRes.ok) {
      console.error('[send-purchase-order] Resend error:', resendText);
      return json(500, {
        error: resendData?.message || resendData?.name || resendText || 'Email provider failed to send the email.',
      });
    }

    return json(200, { success: true, id: resendData?.id });
  } catch (err) {
    console.error('[send-purchase-order] fetch error:', err);
    return json(500, { error: err.message || 'Unexpected error contacting the email provider.' });
  }
}
