/**
 * Web Push subscribe / unsubscribe.
 *
 * The device registers with its browser's push service, and we store the
 * resulting endpoint + keys in `push_subscriptions`. From then on any row
 * inserted into `notifications` is fanned out to it by the `push-send` edge
 * function (see supabase/migrations/push_notifications.sql).
 */

import { supabase } from './supabase';

// A VAPID public key is public by design — it's sent to the push service on
// every subscribe. Keeping it here rather than in an env var means the key can
// never drift out of sync with the private half stored in the database.
export const VAPID_PUBLIC_KEY =
  'BNNPicGjx3oV8U_UKEBClwZn6PaWxIZ-bQ9--qL2WAkPpNOITmhpE_lNeus2F1T4y6joJqvN0bNbt-425BtMbtE';

const b64urlToUint8 = (s) => {
  const padded = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

const keyToB64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

// iOS only allows Web Push from a PWA that has been added to the Home Screen.
export const isIOS = () =>
  /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

export const needsHomeScreenInstall = () => isIOS() && !isStandalone();

/** Register the worker. Safe to call repeatedly — the browser dedupes. */
export async function registerServiceWorker() {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (e) {
    console.warn('[push] service worker registration failed', e);
    return null;
  }
}

/** { supported, permission, subscribed } for this device. */
export async function getPushStatus() {
  if (!pushSupported()) return { supported: false, permission: 'unsupported', subscribed: false };
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return { supported: true, permission: Notification.permission, subscribed: !!sub };
}

/** Ask permission, subscribe, and store the endpoint. Throws with a readable reason. */
export async function enablePush() {
  if (!pushSupported()) throw new Error('This browser does not support push notifications.');
  if (!supabase) throw new Error('Not connected to the cloud.');
  if (needsHomeScreenInstall())
    throw new Error('On iPhone, add Lusso to your Home Screen first (Share → Add to Home Screen), then open it from there.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted')
    throw new Error(permission === 'denied'
      ? 'Notifications are blocked for this site — allow them in your browser settings, then try again.'
      : 'Notification permission was dismissed.');

  const reg = (await registerServiceWorker()) || (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: b64urlToUint8(VAPID_PUBLIC_KEY),
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('You need to be signed in to receive notifications.');

  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id:    user.id,
    endpoint:   sub.endpoint,
    p256dh:     keyToB64url(sub.getKey('p256dh')),
    auth:       keyToB64url(sub.getKey('auth')),
    user_agent: navigator.userAgent.slice(0, 300),
    label:      deviceLabel(),
    failure_count: 0,
  }, { onConflict: 'endpoint' });
  if (error) throw new Error(error.message);

  return true;
}

/** Unsubscribe this device and forget its endpoint. */
export async function disablePush() {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    if (supabase) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
    await sub.unsubscribe();
  }
  return true;
}

/** Bounce a test notification off the server so the whole path is proven. */
export async function sendTestPush() {
  if (!supabase) throw new Error('Not connected to the cloud.');
  const { data, error } = await supabase.functions.invoke('push-send', { body: { test: true } });
  if (error) throw new Error(error.message);
  if (data?.sent === 0) throw new Error(data?.note || 'No devices are subscribed yet.');
  return data;
}

function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows' : 'Device';
  const browser = /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox'
    : /Edg/.test(ua) ? 'Edge' : /Safari/.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${browser}`;
}

// ── First-run prompt ─────────────────────────────────────────────────────────
// The browser won't let us ask for permission on its own — Safari requires the
// request to come from a tap, and a reflexive "Don't Allow" is permanent. So the
// app offers one tap instead, and takes no for an answer for a month.
const SNOOZE_KEY = 'lusso_push_prompt_snoozed_until';

export const pushPromptSnoozed = () => Number(localStorage.getItem(SNOOZE_KEY) || 0) > Date.now();
export const snoozePushPrompt = (days = 30) =>
  localStorage.setItem(SNOOZE_KEY, String(Date.now() + days * 86400000));

/**
 * What (if anything) to offer this device right now:
 *   'enable'  — we can ask for permission, one tap away
 *   'install' — iOS in a browser tab, where asking is impossible until the PWA
 *               is on the Home Screen
 *   null      — already on, already refused, snoozed, or unsupported
 */
export async function pushPromptMode() {
  if (!pushSupported() || pushPromptSnoozed()) return null;
  if (needsHomeScreenInstall()) return 'install';
  const { permission, subscribed } = await getPushStatus();
  if (subscribed || permission !== 'default') return null;
  return 'enable';
}
