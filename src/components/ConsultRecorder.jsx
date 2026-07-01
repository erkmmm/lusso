import { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, Square, Pause, Play, Loader2, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { uploadConsultAudio, invokeTranscribe } from '../lib/consultAudio';
import Card from './Card';

// iPad Safari records audio/mp4 (AAC), not webm — feature-detect in this order.
const MIME_CANDIDATES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
function pickMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  for (const t of MIME_CANDIDATES) if (MediaRecorder.isTypeSupported(t)) return t;
  return '';
}
const extFor = (mime) => (mime.includes('mp4') ? 'mp4' : 'webm');

function fmtClock(total) {
  const s = Math.max(0, Math.floor(total));
  const m = Math.floor(s / 60);
  const sec = String(s % 60).padStart(2, '0');
  return `${m}:${sec}`;
}

export default function ConsultRecorder({ jobId }) {
  // idle | recording | paused | uploading | processing | saved | error
  const [status, setStatus]   = useState('idle');
  const [micState, setMicState] = useState('unknown'); // unknown | granted | denied
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [hasPending, setHasPending] = useState(false); // an un-uploaded recording is held for retry
  const [count, setCount]     = useState(null); // existing recordings for this job

  const recorderRef = useRef(null);
  const streamRef   = useRef(null);
  const chunksRef   = useRef([]);
  const wakeLockRef = useRef(null);
  const timerRef    = useRef(null);
  const mimeRef     = useRef('');
  const startedAtRef = useRef(null);   // ISO recorded_at
  const elapsedRef  = useRef(0);       // seconds — always current for onstop
  const pendingRef  = useRef(null);    // { blob, ext, seconds, recordedAt } for retry

  // ── Existing recording count (subtle context, not a full list) ─────────────
  useEffect(() => {
    let alive = true;
    if (!jobId || !supabase) return;
    supabase.from('job_transcripts').select('id', { count: 'exact', head: true }).eq('job_id', jobId)
      .then(({ count: c }) => { if (alive) setCount(c ?? 0); });
    return () => { alive = false; };
  }, [jobId, status]);

  // ── Timer ──────────────────────────────────────────────────────────────────
  const startTimer = useCallback(() => {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsed(elapsedRef.current);
    }, 1000);
  }, []);
  const stopTimer = useCallback(() => { clearInterval(timerRef.current); timerRef.current = null; }, []);

  // ── Screen Wake Lock ────────────────────────────────────────────────────────
  const acquireWakeLock = useCallback(async () => {
    try { if ('wakeLock' in navigator) wakeLockRef.current = await navigator.wakeLock.request('screen'); }
    catch { /* wake lock is best-effort */ }
  }, []);
  const releaseWakeLock = useCallback(async () => {
    try { await wakeLockRef.current?.release?.(); } catch { /* ignore */ }
    wakeLockRef.current = null;
  }, []);

  // Re-acquire the wake lock when the tab returns to the foreground mid-record.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && status === 'recording' && !wakeLockRef.current) {
        acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [status, acquireWakeLock]);

  // ── Clean up on unmount ─────────────────────────────────────────────────────
  useEffect(() => () => {
    stopTimer();
    releaseWakeLock();
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, [stopTimer, releaseWakeLock]);

  // ── Mic permission + device list (labels only appear after permission) ──────
  const ensureDevices = useCallback(async () => {
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
      probe.getTracks().forEach((t) => t.stop()); // just needed the permission grant
      const all = await navigator.mediaDevices.enumerateDevices();
      setDevices(all.filter((d) => d.kind === 'audioinput'));
      setMicState('granted');
      return true;
    } catch {
      setMicState('denied');
      setStatus('error');
      setErrorMsg("I couldn't access the microphone. Check Safari's mic permission for this site (aA menu → Website Settings → Microphone), then try again.");
      return false;
    }
  }, []);

  // Populate the picker when the user focuses it, before recording.
  const onPickerFocus = () => { if (micState !== 'granted') ensureDevices(); };

  // ── Recording lifecycle ─────────────────────────────────────────────────────
  async function startRecording() {
    setErrorMsg('');
    if (micState !== 'granted') {
      const ok = await ensureDevices();
      if (!ok) return;
    }
    try {
      const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      const mime = pickMimeType();
      mimeRef.current = mime;
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = handleStopped;
      recorderRef.current = rec;

      rec.start(1000); // 1s timeslice
      startedAtRef.current = new Date().toISOString();
      elapsedRef.current = 0;
      setElapsed(0);
      setStatus('recording');
      startTimer();
      acquireWakeLock();
    } catch {
      setMicState('denied');
      setStatus('error');
      setErrorMsg("I couldn't start recording from that microphone. Try a different mic or reconnect it, then start again.");
    }
  }

  const pauseRecording = () => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.pause();
      stopTimer();
      setStatus('paused');
    }
  };
  const resumeRecording = () => {
    if (recorderRef.current?.state === 'paused') {
      recorderRef.current.resume();
      startTimer();
      setStatus('recording');
    }
  };
  const stopRecording = () => {
    stopTimer();
    releaseWakeLock();
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop(); // fires handleStopped
    }
  };

  // Fired by MediaRecorder.onstop — build the blob and save.
  function handleStopped() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const mime = mimeRef.current || (chunksRef.current[0]?.type ?? 'audio/mp4');
    const blob = new Blob(chunksRef.current, { type: mime });
    chunksRef.current = [];
    pendingRef.current = {
      blob,
      ext: extFor(mime),
      seconds: elapsedRef.current,
      recordedAt: startedAtRef.current || new Date().toISOString(),
    };
    setHasPending(true);
    saveRecording();
  }

  // Upload → insert row → invoke transcription. Retryable on failure.
  async function saveRecording() {
    const p = pendingRef.current;
    if (!p) return;
    setStatus('uploading');
    setErrorMsg('');
    try {
      const path = await uploadConsultAudio(jobId, p.ext, p.blob);
      const { data, error } = await supabase.from('job_transcripts').insert({
        job_id: jobId,
        audio_path: path,
        duration_seconds: Math.round(p.seconds),
        recorded_at: p.recordedAt,
      }).select('id').single();
      if (error) throw error;
      pendingRef.current = null;
      setHasPending(false);
      setStatus('processing');
      // Fire transcription — runs server-side; results flow back to the row.
      invokeTranscribe(data.id).catch(() => { /* transcription is best-effort */ });
      setStatus('saved');
    } catch {
      setStatus('error');
      setErrorMsg('The recording finished but couldn’t be uploaded. Check your connection — your audio is still here, so you can retry.');
    }
  }

  const reset = () => { pendingRef.current = null; setHasPending(false); elapsedRef.current = 0; setStatus('idle'); setElapsed(0); setErrorMsg(''); };

  const isLive = status === 'recording' || status === 'paused';

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
            <Mic size={15} className="text-amber-500" /> Consult recording
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Records the on-site conversation and links it to this job so the assistant can reference it.
          </p>
        </div>
        {count > 0 && status === 'idle' && (
          <span className="text-xs text-slate-400 whitespace-nowrap mt-0.5">{count} saved</span>
        )}
      </div>

      {/* Mic device picker — labels appear once permission is granted */}
      {(status === 'idle' || isLive) && (
        <div className="mb-4">
          <label className="block text-xs text-slate-500 mb-1">Microphone</label>
          <select
            value={deviceId}
            onFocus={onPickerFocus}
            onChange={(e) => setDeviceId(e.target.value)}
            disabled={isLive}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-60"
          >
            <option value="">{micState === 'granted' ? 'Default microphone' : 'Default microphone (tap to choose)'}</option>
            {devices.map((d, i) => (
              <option key={d.deviceId || i} value={d.deviceId}>
                {d.label || `Microphone ${i + 1}`}
              </option>
            ))}
          </select>
          {micState !== 'granted' && (
            <p className="text-[11px] text-slate-400 mt-1">Allow microphone access to pick a specific mic (e.g. a plugged-in lav).</p>
          )}
        </div>
      )}

      {/* Primary control */}
      {status === 'idle' && (
        <button
          onClick={startRecording}
          className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 text-white font-semibold rounded-xl px-4 py-3.5 transition-colors"
        >
          <Mic size={18} /> Start recording
        </button>
      )}

      {isLive && (
        <div>
          <div className="flex items-center justify-center gap-2 mb-4">
            <span className={`w-2.5 h-2.5 rounded-full ${status === 'recording' ? 'bg-red-500 animate-pulse' : 'bg-slate-300'}`} />
            <span className="text-2xl font-bold tabular-nums text-slate-900">{fmtClock(elapsed)}</span>
            <span className="text-xs text-slate-400 ml-1">{status === 'paused' ? 'Paused' : 'Recording'}</span>
          </div>
          <div className="flex gap-2">
            {status === 'recording' ? (
              <button onClick={pauseRecording} className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                <Pause size={15} /> Pause
              </button>
            ) : (
              <button onClick={resumeRecording} className="flex-1 flex items-center justify-center gap-1.5 text-sm font-medium px-3 py-2.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
                <Play size={15} /> Resume
              </button>
            )}
            <button onClick={stopRecording} className="flex-1 flex items-center justify-center gap-1.5 text-sm font-semibold px-3 py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white transition-colors">
              <Square size={14} /> Stop &amp; save
            </button>
          </div>
        </div>
      )}

      {status === 'uploading' && (
        <div className="flex items-center justify-center gap-2 py-3 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Uploading recording…
        </div>
      )}

      {status === 'processing' && (
        <div className="flex items-center justify-center gap-2 py-3 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Saving…
        </div>
      )}

      {status === 'saved' && (
        <div className="text-center py-2">
          <div className="flex items-center justify-center gap-2 text-sm font-medium text-green-600 mb-1">
            <CheckCircle2 size={16} /> Saved to this job
          </div>
          <p className="text-xs text-slate-400 mb-3">Transcribing in the background — it’ll be available to the assistant shortly.</p>
          <button onClick={reset} className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
            Record another
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3">
          <div className="flex items-start gap-2 text-sm text-red-700">
            <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
          <div className="flex gap-2 mt-3">
            {hasPending && (
              <button onClick={saveRecording} className="flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-white transition-colors">
                <RefreshCw size={14} /> Retry upload
              </button>
            )}
            <button onClick={reset} className="text-sm font-medium px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors">
              Start over
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
