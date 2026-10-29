import { useEffect, useRef, useState } from 'react';
import { CAPTCHA_SITE_KEY, loadTurnstile } from '../lib/captcha';

/**
 * The Turnstile widget for the sign-in, sign-up and password-reset forms.
 *
 * Tokens are single-use and expire after a few minutes, so every attempt needs
 * a fresh widget. Rather than an imperative reset, remount with a new `key` —
 * see the captchaNonce pattern in Login.jsx. Renders nothing when no site key
 * is configured.
 */
export default function Turnstile({ onToken, action }) {
  const hostRef = useRef(null);
  const tokenCb = useRef(onToken);
  const [failed, setFailed] = useState(false);

  // Keep the callback current without re-rendering the widget.
  useEffect(() => { tokenCb.current = onToken; });

  useEffect(() => {
    if (!CAPTCHA_SITE_KEY) return;

    let widgetId;
    let dead = false;
    const emit = (t) => tokenCb.current?.(t);

    loadTurnstile()
      .then((ts) => {
        if (dead || !hostRef.current) return;
        widgetId = ts.render(hostRef.current, {
          sitekey: CAPTCHA_SITE_KEY,
          action,
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
          callback: emit,
          'expired-callback': () => emit(''),
          'timeout-callback': () => emit(''),
          'error-callback':   () => { emit(''); setFailed(true); },
        });
      })
      .catch(() => { if (!dead) setFailed(true); });

    return () => {
      dead = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [action]);

  if (!CAPTCHA_SITE_KEY) return null;

  return (
    <div>
      <div ref={hostRef} className="flex justify-center" />
      {failed && (
        <p className="text-[11px] text-slate-400 text-center mt-1.5">
          Verification could not load. Check your connection and reload the page.
        </p>
      )}
    </div>
  );
}
