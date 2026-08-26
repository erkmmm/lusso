/**
 * Cloudflare Pages Function: /api/send-installer
 * Sends an installation request email to an installer via Resend.
 *
 * Environment variables (set in Cloudflare Pages → Settings → Environment Variables):
 *   RESEND_API_KEY  — your Resend secret key (re_...)
 *   EMAIL_FROM      — optional sender, e.g. "Lusso <jobs@lusso.com.au>"
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

  const { request, installer, job, measureSheet } = body || {};

  if (!request)           return json(400, { error: 'Missing installation request data' });
  if (!installer?.email)  return json(400, { error: 'Installer email address is missing' });

  if (!RESEND_API_KEY) {
    return json(500, { error: 'Email provider is not configured. Set RESEND_API_KEY in Cloudflare Pages environment variables.' });
  }

  const origin     = context.env.APP_URL || 'https://app.lusso.com.au';
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

  // Measure sheet — so the installer sees exactly what they're installing.
  const items = measureSheet?.lineItems || [];
  const table = items.length ? {
    caption: `Measure sheet — ${items.length} item${items.length !== 1 ? 's' : ''}`,
    head:  ['#', 'Location', 'Product', 'W × D (mm)', 'Qty', 'Fabric', 'Control', 'Fixing'],
    align: ['left', 'left', 'left', 'right', 'center', 'left', 'left', 'left'],
    rows: items.map((li, i) => {
      const w = li.widthMm || li.width || '';
      const d = li.dropMm  || li.drop  || '';
      return [
        String(i + 1),
        li.location || '—',
        li.productNameSnapshot || li.productType || '—',
        (w || d) ? `${w || '?'} × ${d || '?'}` : '—',
        String(li.quantity ?? 1),
        li.fabricColour || '—',
        li.control || '—',
        li.fixing || '—',
      ];
    }),
  } : null;

  const content = {
    preheader: `${request.suburb || 'Installation'} · ${proposedDate} · respond by ${deadline}`,
    eyebrow:   'Installation request',
    heading:   'A job that may suit your schedule',
    greeting:  `Hi ${firstName},`,
    body:      'Lusso has an installation job available. Please review the details below and let us know whether you can take it.',
    panel: {
      title: 'Job details',
      rows: [
        { label: 'Area',         value: request.suburb || 'TBC', strong: true },
        { label: 'Date',         value: proposedDate, strong: true },
        { label: 'Arrival time', value: request.arrivalTime || 'TBC' },
        { label: 'Duration',     value: request.expectedDuration || 'TBC' },
        { label: 'Job ref',      value: job?.jobNumber || '' },
      ],
    },
    noteBlocks: [
      { label: 'Service required', text: request.serviceRequired },
      { label: 'Product summary',  text: request.productSummary },
      { label: 'Notes',            text: request.installationNotes },
    ],
    table,
    ctaNote:      `Full address and customer details are shared once you accept. Please respond by ${deadline}.`,
    cta:          { label: 'Accept job',  url: acceptUrl },
    ctaSecondary: { label: 'Decline job', url: declineUrl },
    signOff:      'The Lusso Team',
    footerNote:   'Registered installer communications',
  };

  const html = renderEmail(content);
  const text = renderText(content);

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:     FROM_ADDRESS,
        to:       [installer.email],
        reply_to: context.env.EMAIL_REPLY_TO || undefined,
        subject:  `Installation request – ${request.suburb || 'Job'} – ${proposedDate}`,
        html,
        text,
      }),
    });

    const resendText = await resendRes.text();
    let resendData = null;
    try { resendData = JSON.parse(resendText); } catch { /* ignore */ }

    if (!resendRes.ok) {
      console.error('[send-installer] Resend error:', resendText);
      return json(500, { error: resendData?.message || resendText || 'Email provider failed.' });
    }

    await logOutboundEmail(context, bearerToken(context), {
      externalId: resendData?.id,
      to:         installer.email,
      subject:    `Installation request – ${request.suburb || 'Job'} – ${proposedDate}`,
      body:       `Installation request emailed to ${installer.name || installer.email}.`,
      jobId:      job?.id,
    });

    return json(200, { success: true, id: resendData?.id });
  } catch (err) {
    console.error('[send-installer] error:', err);
    return json(500, { error: err.message || 'Unexpected error.' });
  }
}
