import { useEffect, useState } from 'react';
import { Mic, ChevronDown, ChevronRight, Play, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Card from './Card';

const fmtDur = (s) => {
  if (!s) return '';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
};
const fmtDate = (iso) => {
  try {
    return new Date(iso).toLocaleString('en-AU', {
      day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return ''; }
};

export default function ConsultRecordings({ jobId }) {
  const [rows, setRows]     = useState(null); // null = loading
  const [openId, setOpenId] = useState(null);
  const [urls, setUrls]     = useState({});   // id -> signed audio URL

  useEffect(() => {
    let alive = true;
    if (!jobId || !supabase) return;
    supabase.from('job_transcripts')
      .select('id, recorded_at, duration_seconds, summary, transcript, segments, audio_path, created_at')
      .eq('job_id', jobId)
      .order('recorded_at', { ascending: false, nullsFirst: false })
      .then(({ data }) => { if (alive) setRows(data ?? []); });
    return () => { alive = false; };
  }, [jobId]);

  async function play(row) {
    if (urls[row.id] || !row.audio_path) return;
    const { data } = await supabase.storage.from('consult-audio').createSignedUrl(row.audio_path, 3600);
    if (data?.signedUrl) setUrls((u) => ({ ...u, [row.id]: data.signedUrl }));
  }

  if (rows === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400">
        <Loader2 size={15} className="animate-spin" /> Loading recordings…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="p-10 text-center">
        <Mic size={26} className="text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-500">No consult recordings yet.</p>
        <p className="text-xs text-slate-400 mt-1">Record one from this job’s measure sheet.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const processing = !r.transcript && !r.summary;
        const open = openId === r.id;
        const segs = Array.isArray(r.segments) ? r.segments : [];
        return (
          <Card key={r.id} className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                  <Mic size={16} className="text-amber-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{fmtDate(r.recorded_at || r.created_at)}</p>
                  <p className="text-xs text-slate-400">
                    {fmtDur(r.duration_seconds)}
                    {processing && <span className="text-amber-600"> · transcribing…</span>}
                  </p>
                </div>
              </div>
              {r.audio_path && !urls[r.id] && (
                <button onClick={() => play(r)}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors flex-shrink-0">
                  <Play size={13} /> Play
                </button>
              )}
            </div>

            {urls[r.id] && (
              <audio controls src={urls[r.id]} className="w-full mt-3" />
            )}

            {r.summary && (
              <div className="mt-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{r.summary}</div>
            )}
            {processing && (
              <p className="mt-3 text-xs text-slate-400">The transcript and summary will appear here once processing finishes.</p>
            )}

            {(r.transcript || segs.length > 0) && (
              <>
                <button onClick={() => setOpenId(open ? null : r.id)}
                  className="mt-3 text-xs text-amber-600 hover:underline flex items-center gap-1">
                  {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  {open ? 'Hide full transcript' : 'Show full transcript'}
                </button>
                {open && (
                  <div className="mt-2 border-t border-slate-100 pt-3 max-h-96 overflow-y-auto space-y-2">
                    {segs.length > 0
                      ? segs.map((s, i) => (
                          <p key={i} className="text-sm text-slate-700 leading-relaxed">
                            <span className="text-xs font-semibold text-amber-600 mr-2 whitespace-nowrap">Speaker {s.speaker}</span>
                            {s.text}
                          </p>
                        ))
                      : <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{r.transcript}</p>}
                  </div>
                )}
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}
