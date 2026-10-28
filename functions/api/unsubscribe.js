/**
 * Cloudflare Pages Function: /api/unsubscribe
 *
 * The opt-out for marketing email. Unauthenticated by necessity — the person
 * clicking has no account, and the Spam Act 2003 (Cth) requires the opt-out to
 * work without one.
 *
 * GET  renders a confirmation page and writes NOTHING. This matters: corporate
 *      mail scanners and link-prefetchers follow every URL in an email, and a
 *      GET that unsubscribed on sight would quietly opt people out who never
 *      touched the link.
 * POST performs it. That covers both the Confirm button below and the
 *      List-Unsubscribe-Post one-click header, which Gmail and Yahoo send only
 *      on a deliberate user action.
 *
 * The write itself is public.marketing_unsubscribe(token) — SECURITY DEFINER,
 * idempotent, and the only database verb this endpoint has.
 */

const BRAND = {
  paper:    '#F7F7F6',
  paperPure:'#FFFFFF',
  mist:     '#DEDFDC',
  stone:    '#8C8E8B',
  graphite: '#3A3B3C',
  ink:      '#101113',
  bronze:   '#6E5A43',
};

const FONT = "'Manrope',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const page = (title, message, form) => `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Lusso</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;background:${BRAND.paper};font-family:${FONT};color:${BRAND.graphite};">
  <div style="max-width:460px;margin:0 auto;padding:72px 20px;">
    <div style="font-size:17px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${BRAND.ink};margin-bottom:28px;">Lusso</div>
    <div style="background:${BRAND.paperPure};border:1px solid ${BRAND.mist};border-radius:10px;padding:34px 30px;">
      <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-0.02em;color:${BRAND.ink};">${title}</h1>
      <p style="margin:0 0 ${form ? '24px' : '0'};font-size:15px;line-height:1.65;">${message}</p>
      ${form || ''}
    </div>
    <p style="margin:22px 0 0;text-align:center;font-size:11px;color:${BRAND.stone};">Lusso &middot; Fashion for Windows</p>
  </div>
</body></html>`;

const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

const TOKEN_RE = /^[0-9a-f]{32}$/;

function tokenFrom(request) {
  const t = new URL(request.url).searchParams.get('t') || '';
  return TOKEN_RE.test(t) ? t : null;
}

export async function onRequestGet(context) {
  const token = tokenFrom(context.request);
  if (!token) {
    return html(page('Link not recognised',
      'That unsubscribe link looks incomplete. Reply to any email from us and we will take you off the list by hand.'), 400);
  }

  // Deliberately does not name the address: the token is in a URL that may be
  // logged by mail gateways, and it should not be a way to read an email
  // address back out.
  return html(page(
    'Unsubscribe?',
    'Confirm and we will stop sending you marketing email. Quotes, order updates and anything about work in progress will still reach you.',
    `<form method="POST" action="/api/unsubscribe?t=${token}">
       <button type="submit" style="appearance:none;border:0;cursor:pointer;background:${BRAND.ink};color:${BRAND.paper};font-family:${FONT};font-size:15px;font-weight:500;padding:13px 30px;border-radius:999px;">Yes, unsubscribe me</button>
     </form>`));
}

export async function onRequestPost(context) {
  const token = tokenFrom(context.request);
  if (!token) {
    return html(page('Link not recognised',
      'That unsubscribe link looks incomplete. Reply to any email from us and we will take you off the list by hand.'), 400);
  }

  const URL_ = context.env.SUPABASE_URL || context.env.VITE_SUPABASE_URL;
  const KEY  = context.env.SUPABASE_ANON_KEY || context.env.VITE_SUPABASE_ANON_KEY;
  if (!URL_ || !KEY) {
    return html(page('Something went wrong',
      'We could not process that just now. Reply to any email from us and we will take you off the list by hand.'), 500);
  }

  try {
    const res = await fetch(`${URL_}/rest/v1/rpc/marketing_unsubscribe`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.ok) {
      return html(page('Link not recognised',
        'That unsubscribe link has expired or was not complete. Reply to any email from us and we will take you off the list by hand.'), 400);
    }

    return html(page('Done — you are unsubscribed',
      'You will not get marketing email from us again. Anything about a quote or a job in progress will still come through, and you can reply to this address any time.'));
  } catch {
    return html(page('Something went wrong',
      'We could not process that just now. Reply to any email from us and we will take you off the list by hand.'), 500);
  }
}
