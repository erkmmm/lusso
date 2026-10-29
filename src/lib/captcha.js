/**
 * Cloudflare Turnstile loader for Supabase Auth's built-in CAPTCHA check.
 *
 * Supabase verifies the token server-side (Dashboard → Authentication →
 * Attack Protection → CAPTCHA), so the app never sees the secret key and has
 * nothing to verify itself — it only has to pass the token to signIn, signUp
 * and resetPasswordForEmail.
 */

export const CAPTCHA_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '';

/** False until a site key is configured, so builds without one still work. */
export const captchaEnabled = Boolean(CAPTCHA_SITE_KEY);

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise = null;

export function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src   = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.onload  = () => resolve(window.turnstile);
      s.onerror = () => { scriptPromise = null; reject(new Error('Turnstile failed to load')); };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}
