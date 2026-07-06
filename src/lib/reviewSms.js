import { supabase } from './supabase';

// SMS through the send-communication edge function (same rails as Inbox
// lead replies).
export async function sendReviewSms(to, body) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-communication`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
    body: JSON.stringify({ channel: 'sms', to, body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send');
}
