/**
 * Frontend email helpers.
 * Calls Netlify Functions which hold the Resend API key server-side.
 */

const BASE = import.meta.env.DEV
  ? 'http://localhost:8888'  // netlify dev
  : '';                       // same origin in production

async function post(fn, body) {
  const res = await fetch(`${BASE}/.netlify/functions/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Email send failed');
  return data;
}

/**
 * Send a quote email to the customer.
 * @param {object} quote  - full quote object
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
