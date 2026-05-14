/**
 * Cloudflare Pages Function: /api/send-installer
 * Sends an installation request email to an installer via Resend.
 *
 * Environment variables (set in Cloudflare Pages → Settings → Environment Variables):
 *   RESEND_API_KEY  — your Resend secret key (re_...)
 *   EMAIL_FROM      — optional sender, e.g. "Lusso <jobs@yourdomain.com>"
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
  const FROM_ADDRESS   = context.env.EMAIL_FROM || 'Lusso <noreply@resend.dev>';

  let body;
  try {
    body = await context.request.json();
  } catch {
    return json(400, { error: 'Invalid JSON in request body' });
  }

  const { request, installer, job } = body || {};

  if (!request)           return json(400, { error: 'Missing installation request data' });
  if (!installer?.email)  return json(400, { error: 'Installer email address is missing' });

  if (!RESEND_API_KEY) {
    return json(500, { error: 'Email provider is not configured. Set RESEND_API_KEY in Cloudflare Pages environment variables.' });
  }

  const origin     = context.env.APP_URL || 'https://lusso.pages.dev';
  const acceptUrl  = `${origin}/install-response/${request.secureAcceptToken}`;
  const declineUrl = `${origin}/install-response/${request.secureDeclineToken}`;

  const deadline = (() => {
    const d = new Date(); d.setDate(d.getDate() + 3);
    return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  })();

  const proposedDate = request.proposedDate
    ? new Date(request.proposedDate).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : 'TBC';

  const firstName = installer.name?.split(' ')[0] || installer.name || 'there';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#F7F8F6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F8F6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #DDE5E2;">
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
        <tr>
          <td style="padding:36px 32px;">
            <p style="margin:0 0 8px;font-size:15px;color:#5E6B6B;">Hi ${firstName},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#1F2A2A;line-height:1.6;">
              Lusso has an installation job that may suit your schedule. Please review the details and let us know.
            </p>
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#E6F0F0;border:1px solid #C5DCDC;border-radius:10px;margin-bottom:24px;">
              <tr><td style="padding:20px 24px;">
                <p style="margin:0 0 14px;font-size:15px;font-weight:700;color:#1F2A2A;">📋 Job Details</p>
                <table width="100%" cellpadding="4" cellspacing="0" style="font-size:14px;color:#1F2A2A;">
                  <tr><td style="color:#5E6B6B;width:140px;">Area:</td><td><strong>${request.suburb || 'TBC'}</strong></td></tr>
                  <tr><td style="color:#5E6B6B;">Date:</td><td><strong>${proposedDate}</strong></td></tr>
                  <tr><td style="color:#5E6B6B;">Arrival Time:</td><td><strong>${request.arrivalTime || 'TBC'}</strong></td></tr>
                  <tr><td style="color:#5E6B6B;">Duration:</td><td><strong>${request.expectedDuration || 'TBC'}</strong></td></tr>
                  ${job ? `<tr><td style="color:#5E6B6B;">Job Ref:</td><td><strong>${job.jobNumber}</strong></td></tr>` : ''}
                </table>
              </td></tr>
            </table>
            ${request.serviceRequired ? `<p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#1F2A2A;">🔧 Service Required</p><p style="margin:0 0 20px;padding:12px 16px;background:#F7F8F6;border:1px solid #DDE5E2;border-radius:8px;font-size:14px;color:#1F2A2A;">${request.serviceRequired}</p>` : ''}
            ${request.productSummary ? `<p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#1F2A2A;">📦 Product Summary</p><p style="margin:0 0 20px;padding:12px 16px;background:#F7F8F6;border:1px solid #DDE5E2;border-radius:8px;font-size:14px;color:#5E6B6B;">${request.productSummary}</p>` : ''}
            ${request.installationNotes ? `<p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#1F2A2A;">📝 Notes</p><p style="margin:0 0 20px;padding:12px 16px;background:#F7F8F6;border:1px solid #DDE5E2;border-radius:8px;font-size:14px;color:#5E6B6B;">${request.installationNotes}</p>` : ''}
            <p style="margin:0 0 28px;padding:12px 16px;background:#F0F4FF;border:1px solid #C0CCEE;border-radius:8px;font-size:13px;color:#5E6B6B;">
              🔒 Full address and customer details will be shared once you accept.
            </p>
            <p style="margin:0 0 16px;font-size:14px;color:#1F2A2A;">Please respond by <strong>${deadline}</strong>:</p>
            <table cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
              <tr>
                <td style="background:#2F7D5B;border-radius:8px;">
                  <a href="${acceptUrl}" style="display:inline-block;padding:14px 28px;color:#fff;font-weight:600;font-size:15px;text-decoration:none;">✅ Accept Job</a>
                </td>
                <td width="12"></td>
                <td style="background:#FEE2E2;border:1px solid #FECACA;border-radius:8px;">
                  <a href="${declineUrl}" style="display:inline-block;padding:14px 28px;color:#B91C1C;font-weight:600;font-size:15px;text-decoration:none;">❌ Decline Job</a>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;font-size:14px;color:#1F2A2A;">Thank you,<br><strong>The Lusso Team</strong></p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #DDE5E2;">
            <p style="margin:0;font-size:12px;color:#8A9696;text-align:center;">Lusso · Window Furnishings · Registered installer communications</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    FROM_ADDRESS,
        to:      [installer.email],
        subject: `Installation Request – ${request.suburb || 'Job'} – ${proposedDate}`,
        html,
      }),
    });

    const resendText = await resendRes.text();
    let resendData = null;
    try { resendData = JSON.parse(resendText); } catch { /* ignore */ }

    if (!resendRes.ok) {
      console.error('[send-installer] Resend error:', resendText);
      return json(500, { error: resendData?.message || resendText || 'Email provider failed.' });
    }

    return json(200, { success: true, id: resendData?.id });
  } catch (err) {
    console.error('[send-installer] error:', err);
    return json(500, { error: err.message || 'Unexpected error.' });
  }
}
