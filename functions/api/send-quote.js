/**
 * Cloudflare Pages Function: /api/send-quote
 * Sends a quote email to the customer via Resend.
 *
 * Environment variables (set in Cloudflare Pages → Settings → Environment Variables):
 *   RESEND_API_KEY  — your Resend secret key (re_...)
 *   EMAIL_FROM      — optional sender address, e.g. "Lusso <quotes@yourdomain.com>"
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
  const origin    = appUrl || 'https://lusso.pages.dev';
  const quoteUrl  = `${origin}/quotes/${quote.id}/preview`;
  const firstName = customer.name?.split(' ')[0] || customer.name || 'there';
  const expiryFmt = quote.expiryDate
    ? new Date(quote.expiryDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your Quote from Lusso</title>
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F7F8F6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F8F6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #DDE5E2;">

        <!-- Header -->
        <tr>
          <td style="background:#0F3535;padding:24px 32px;">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="background:linear-gradient(135deg,#3D9090,#0F3B3B);width:36px;height:36px;border-radius:8px;text-align:center;vertical-align:middle;">
                <span style="color:#fff;font-weight:700;font-size:16px;">L</span>
              </td>
              <td style="padding-left:12px;color:#fff;font-size:18px;font-weight:600;">Lusso</td>
            </tr></table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 32px;">
            <p style="margin:0 0 8px;font-size:15px;color:#5E6B6B;">Hi ${firstName},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#1F2A2A;line-height:1.6;white-space:pre-line;">
              ${emailIntro || 'Thank you for your interest. Please find your quote from Lusso below. Click the button to view the full details online.'}
            </p>

            <!-- Quote card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#E6F0F0;border:1px solid #C5DCDC;border-radius:10px;margin-bottom:28px;">
              <tr><td style="padding:20px 24px;">
                <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#5E6B6B;text-transform:uppercase;letter-spacing:.5px;">Quote Reference</p>
                <p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#174D4D;">${quote.quoteNumber || quote.id}</p>
                ${quote.title ? `<p style="margin:0 0 12px;font-size:14px;color:#1F2A2A;"><strong>Job:</strong> ${quote.title}</p>` : ''}
                ${quote.grandTotal ? `<p style="margin:0 0 12px;font-size:14px;color:#1F2A2A;"><strong>Total:</strong> $${Number(quote.grandTotal).toLocaleString('en-AU', { minimumFractionDigits: 2 })}</p>` : ''}
                ${expiryFmt ? `<p style="margin:0;font-size:13px;color:#8A9696;">Valid until: ${expiryFmt}</p>` : ''}
              </td></tr>
            </table>

            <!-- CTA -->
            <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
              <tr>
                <td style="background:#174D4D;border-radius:8px;">
                  <a href="${quoteUrl}" style="display:inline-block;padding:14px 32px;color:#fff;font-weight:600;font-size:15px;text-decoration:none;">
                    View Your Quote →
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0 0 8px;font-size:14px;color:#5E6B6B;line-height:1.6;">
              If you have any questions, please don't hesitate to get in touch.
              We're happy to walk you through the details.
            </p>

            <p style="margin:24px 0 0;font-size:14px;color:#1F2A2A;">
              Kind regards,<br>
              <strong>The Lusso Team</strong>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #DDE5E2;">
            <p style="margin:0;font-size:12px;color:#8A9696;text-align:center;">
              Lusso · Window Furnishings ·
              <a href="${quoteUrl}" style="color:#174D4D;text-decoration:none;">View quote online</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // ── Send via Resend ───────────────────────────────────────────────────────
  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    FROM_ADDRESS,
        to:      [customer.email],
        subject: `Your quote from Lusso – ${quote.quoteNumber || quote.title || 'Quote'}`,
        html,
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

    return json(200, { success: true, id: resendData?.id });

  } catch (err) {
    console.error('[send-quote] fetch error:', err);
    return json(500, { error: err.message || 'Unexpected error contacting the email provider.' });
  }
}
