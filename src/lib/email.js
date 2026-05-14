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

/**
 * Safe HTTP POST to a local API route.
 * Handles empty / non-JSON responses gracefully so a bad body never
 * throws the cryptic "Unexpected end of JSON input" error.
 */
async function post(path, body) {
  let res;
  try {
    res = await fetch(`/api/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    throw new Error('Network error — could not reach the email service. Please check your connection and try again.');
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
export async function sendQuoteEmail(quote, customer) {
  return post('send-quote', {
    quote,
    customer,
    appUrl: window.location.origin,
  });
}

/**
 * Send an installation request email to the installer.
 * @param {object} request   - install request object
 * @param {object} installer - installer object (must have .email)
 * @param {object} job       - job object (for reference number)
 */
export async function sendInstallerEmail(request, installer, job) {
  return post('send-installer', {
    request,
    installer,
    job,
    appUrl: window.location.origin,
  });
}
