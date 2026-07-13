/**
 * Frontend email helpers.
 * Calls Cloudflare Pages Functions which hold the Resend API key server-side.
 *
 * Routes:
 *   POST /api/send-quote      → functions/api/send-quote.js
 *   POST /api/send-installer  → functions/api/send-installer.js
 *
 * These are same-origin calls in both dev (Vite dev server) and production
 * (Cloudflare Pages), so no cross-origin issues and no BASE URL needed.
 */

import { supabase } from './supabase';

/**
 * Safe HTTP POST to a local API route.
 * Handles empty / non-JSON responses gracefully so a bad body never
 * throws the cryptic "Unexpected end of JSON input" error.
 */
async function post(path, body) {
  // Attach the caller's Supabase session so the server can verify them.
  let token = '';
  try {
    const { data } = await supabase.auth.getSession();
    token = data?.session?.access_token || '';
  } catch { /* no session — server will reject with 401 */ }

  let res;
  try {
    res = await fetch(`/api/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new Error('Network error — could not reach the email service. Please check your connection and try again.', { cause: networkErr });
  }

  // Read raw text first so we never crash on an empty body
  const text = await res.text();

  // Try to parse as JSON
  let data = null;
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      // Server returned non-JSON (e.g. a Cloudflare 404 HTML page)
      if (!res.ok) {
        throw new Error(
          res.status === 404
            ? 'Email API route not found (404). Ensure the Cloudflare Pages Function is deployed.'
            : `Email service error ${res.status}: ${text.slice(0, 200)}`
        );
      }
      // 2xx but non-JSON — treat as success with no data
      return { success: true };
    }
  }

  if (!res.ok) {
    throw new Error(data?.error || data?.message || text || `Email service returned HTTP ${res.status}`);
  }

  return data || { success: true };
}

/**
 * Send a quote email to the customer.
 * @param {object} quote    - full quote object
 * @param {object} customer - customer object (must have .email)
 */
export async function sendQuoteEmail(quote, customer, emailIntro) {
  return post('send-quote', {
    quote,
    customer,
    appUrl: window.location.origin,
    emailIntro,
  });
}

/**
 * Send an installation request email to the installer.
 * @param {object} request      - install request object
 * @param {object} installer    - installer object (must have .email)
 * @param {object} job          - job object (for reference number)
 * @param {object} [measureSheet] - the job's measure sheet, so the installer
 *                                  sees exactly what they're installing.
 */
export async function sendInstallerEmail(request, installer, job, measureSheet = null) {
  return post('send-installer', {
    request,
    installer,
    job,
    measureSheet,
    appUrl: window.location.origin,
  });
}

/**
 * Email a generated Purchase Order (PDF) to a recipient as an attachment.
 * The PDF is built client-side and passed as base64 — the Resend key stays
 * server-side in the Cloudflare Pages Function.
 * @param {object} args
 * @param {string} args.to            - recipient email
 * @param {string} args.subject       - email subject
 * @param {string} args.message       - email body text
 * @param {string} args.filename      - attachment filename (e.g. "Curtain PO.pdf")
 * @param {string} args.contentBase64 - base64-encoded PDF bytes
 */
export async function sendPurchaseOrder({ to, subject, message, filename, contentBase64 }) {
  return post('send-purchase-order', { to, subject, message, filename, contentBase64 });
}
