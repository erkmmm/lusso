/**
 * Consult audio helpers — upload a recording to the private `consult-audio`
 * bucket and kick off transcription. The audio binary lives in Storage; the
 * job_transcripts row (inserted by the caller) holds the path + metadata.
 */
import { supabase } from './supabase';

const BUCKET = 'consult-audio';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

/**
 * Upload the recorded Blob to `${jobId}/${timestamp}.${ext}`, retrying up to 3×
 * with backoff. Returns the storage path on success; throws after 3 failures.
 */
export async function uploadConsultAudio(jobId, ext, blob) {
  if (!supabase) throw new Error('Supabase not configured');
  const path = `${jobId}/${Date.now()}.${ext}`;
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
      contentType: blob.type || 'application/octet-stream',
      upsert: false,
    });
    if (!error) return path;
    lastErr = error;
    await new Promise((r) => setTimeout(r, attempt * 800));
  }
  throw lastErr || new Error('Upload failed after 3 attempts');
}

/**
 * Invoke the transcribe-consult edge function for a transcript row. Fire-and-
 * forget from the UI's perspective — the function transcribes server-side and
 * writes the results back to the row. Returns the fetch Response.
 */
export async function invokeTranscribe(transcriptId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');
  return fetch(`${SUPABASE_URL}/functions/v1/transcribe-consult`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ transcript_id: transcriptId }),
  });
}
