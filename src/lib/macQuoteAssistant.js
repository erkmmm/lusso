import { supabase } from './supabase';
const BASE = 'http://127.0.0.1:53146';
export async function macQuoteAssistant(path, { method = 'GET', body } = {}) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('Sign in to Lusso to use the quote assistant.');
  let response;
  try {
    response = await fetch(`${BASE}${path}`, { method,
      headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error('The quote assistant is not connected on this Mac. Open Start Lusso Quote Assistant, then check the connection. Allow the browser’s local-network request if prompted.');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The quote assistant could not complete that action.');
  return result;
}
