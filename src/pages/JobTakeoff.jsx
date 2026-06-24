import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import {
  ArrowLeft, Upload, Ruler, Crosshair, Hand, ZoomIn, ZoomOut, Maximize2,
  ChevronLeft, ChevronRight, Trash2, FileText, Loader2, AlertTriangle,
  Target, RefreshCw, X,
} from 'lucide-react';
import {
  getJob, getCustomer, getTakeoffByJob, saveTakeoff, deleteTakeoff,
  applyTakeoffToMeasureSheet,
} from '../store/data';
import { toast } from '../components/ToastContainer';
import { uploadTakeoffPlan, downloadTakeoffPlan } from '../lib/takeoffStorage';
import { loadPdf, getPageBaseSize, renderPageToCanvas } from '../lib/pdfRender';

// ── Tunables ────────────────────────────────────────────────────────────────
const MIN_SCALE = 0.05;
const MAX_SCALE = 40;
const ZOOM_STEP = 1.15;
const TAP_SLOP  = 6;            // px of movement still counted as a tap, not a drag
const MAX_BACKING = 4096;       // cap the canvas backing store (memory)
const DPR = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);

const TAGS = ['Width', 'Drop', 'Height', 'Other'];
const TAG_STYLE = {
  Width:  'bg-blue-50 text-blue-600 border-blue-200',
  Drop:   'bg-purple-50 text-purple-600 border-purple-200',
  Height: 'bg-purple-50 text-purple-600 border-purple-200',
  Other:  'bg-slate-100 text-slate-500 border-slate-200',
};

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmtMm = (mm) => (mm == null ? '—' : `${Math.round(mm)} mm`);

export default function JobTakeoff() {
  const { id: jobId } = useParams();
  const navigate = useNavigate();

  const job = getJob(jobId);
  const customer = job ? getCustomer(job.customerId) : null;

  // ── Core state ──────────────────────────────────────────────────────────
  const [takeoff, setTakeoff] = useState(() => getTakeoffByJob(jobId) || null);
  const [pdf, setPdf] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageBaseSize, setPageBaseSize] = useState(null); // {width,height} @ scale 1
  const [status, setStatus] = useState('init');           // init|empty|loading|ready|error
  const [errorMsg, setErrorMsg] = useState('');
  const [uploading, setUploading] = useState(false);

  // view = screen transform of the page: screen = base*scale + (tx,ty)
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [rasterScale, setRasterScale] = useState(1);

  // interaction
  const [mode, setMode] = useState('pan');                // pan|measure|calibrate
  const [draft, setDraft] = useState(null);               // first point (base) while drawing
  const [hover, setHover] = useState(null);               // live cursor (base) while drawing
  const [calInput, setCalInput] = useState(null);         // {a,b,base px length} pending calibration
  const [calMm, setCalMm] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const rasterTimer = useRef(null);
  const pointers = useRef(new Map());                     // active pointers for pan/pinch
  const panState = useRef(null);
  const pinchState = useRef(null);

  // ── Load the PDF for an existing takeoff ────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      const t = getTakeoffByJob(jobId);
      if (!t || !t.filePath) { setStatus('empty'); return; }
      setStatus('loading');
      try {
        const buf = await downloadTakeoffPlan(t.filePath);
        if (!alive) return;
        if (!buf) { setErrorMsg('The plan file could not be loaded. Re-upload to continue.'); setStatus('error'); return; }
        const doc = await loadPdf(buf);
        if (!alive) return;
        setTakeoff(t);
        setPdf(doc);
        setPageNumber(1);
        setStatus('ready');
      } catch (e) {
        console.error('[takeoff] load', e);
        if (alive) { setErrorMsg('Failed to open the plan PDF.'); setStatus('error'); }
      }
    })();
    return () => { alive = false; };
  }, [jobId]);

  // ── Page base size whenever pdf/page changes ────────────────────────────
  useEffect(() => {
    if (!pdf) return;
    let alive = true;
    getPageBaseSize(pdf, pageNumber).then(size => {
      if (!alive) return;
      setPageBaseSize(size);
      fitPage(size);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, pageNumber]);

  // ── Render the page to canvas on raster/page change ─────────────────────
  useEffect(() => {
    if (!pdf || !canvasRef.current || !pageBaseSize) return;
    renderPageToCanvas(pdf, pageNumber, rasterScale, canvasRef.current, DPR)
      .catch(e => console.error('[takeoff] render', e));
  }, [pdf, pageNumber, rasterScale, pageBaseSize]);

  // raster cap for the current page so the backing store stays bounded
  const maxRaster = useMemo(() => {
    if (!pageBaseSize) return MAX_SCALE;
    const longEdge = Math.max(pageBaseSize.width, pageBaseSize.height);
    return Math.max(1, MAX_BACKING / (longEdge * DPR));
  }, [pageBaseSize]);

  const scheduleRaster = useCallback((scale) => {
    if (rasterTimer.current) clearTimeout(rasterTimer.current);
    rasterTimer.current = setTimeout(() => {
      setRasterScale(clamp(scale, 0.1, maxRaster));
    }, 90);
  }, [maxRaster]);

  // ── Fit page into the stage, centered ───────────────────────────────────
  function fitPage(size = pageBaseSize) {
    const stage = stageRef.current;
    if (!stage || !size) return;
    const rect = stage.getBoundingClientRect();
    const pad = 32;
    const scale = clamp(
      Math.min((rect.width - pad) / size.width, (rect.height - pad) / size.height),
      MIN_SCALE, MAX_SCALE
    );
    const tx = (rect.width - size.width * scale) / 2;
    const ty = (rect.height - size.height * scale) / 2;
    setView({ scale, tx, ty });
    setRasterScale(clamp(scale, 0.1, maxRaster));
  }

  // ── Coordinate conversion ───────────────────────────────────────────────
  const screenToBase = useCallback((clientX, clientY) => {
    const rect = stageRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.tx) / view.scale,
      y: (clientY - rect.top - view.ty) / view.scale,
    };
  }, [view]);

  const baseToScreen = useCallback((p) => ({
    x: p.x * view.scale + view.tx,
    y: p.y * view.scale + view.ty,
  }), [view]);

  // ── Zoom to a screen point ──────────────────────────────────────────────
  const zoomAt = useCallback((cx, cy, factor) => {
    setView(v => {
      const newScale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
      const k = newScale / v.scale;
      const next = { scale: newScale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k };
      scheduleRaster(newScale);
      return next;
    });
  }, [scheduleRaster]);

  const onWheel = (e) => {
    if (status !== 'ready') return;
    e.preventDefault();
    const rect = stageRef.current.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
  };

  const zoomButton = (factor) => {
    const rect = stageRef.current.getBoundingClientRect();
    zoomAt(rect.width / 2, rect.height / 2, factor);
  };

  // ── Pointer handling (pan / pinch / tap-to-place) ───────────────────────
  const onPointerDown = (e) => {
    if (status !== 'ready') return;
    try { stageRef.current.setPointerCapture?.(e.pointerId); } catch { /* non-capturable pointer */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2) {
      // begin pinch
      const [p1, p2] = [...pointers.current.values()];
      pinchState.current = {
        startDist: Math.hypot(p2.x - p1.x, p2.y - p1.y),
        startScale: view.scale,
        midX: (p1.x + p2.x) / 2,
        midY: (p1.y + p2.y) / 2,
      };
      panState.current = null;
      return;
    }

    const panInitiated = mode === 'pan' || e.button === 1 || e.button === 2;
    panState.current = {
      startX: e.clientX, startY: e.clientY,
      tx0: view.tx, ty0: view.ty,
      moved: false, placing: !panInitiated,
    };
  };

  const onPointerMove = (e) => {
    if (status !== 'ready') return;
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // pinch zoom + pan
    if (pinchState.current && pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      const d = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
      const rect = stageRef.current.getBoundingClientRect();
      const targetScale = clamp(pinchState.current.startScale * (d / pinchState.current.startDist), MIN_SCALE, MAX_SCALE);
      setView(v => {
        const k = targetScale / v.scale;
        return {
          scale: targetScale,
          tx: (midX - rect.left) - ((pinchState.current.midX - rect.left) - v.tx) * k + (midX - pinchState.current.midX),
          ty: (midY - rect.top) - ((pinchState.current.midY - rect.top) - v.ty) * k + (midY - pinchState.current.midY),
        };
      });
      scheduleRaster(targetScale);
      return;
    }

    const ps = panState.current;
    if (!ps) return;
    const dx = e.clientX - ps.startX, dy = e.clientY - ps.startY;
    if (!ps.moved && Math.hypot(dx, dy) > TAP_SLOP) ps.moved = true;

    if (ps.moved && !ps.placing) {
      setView(v => ({ ...v, tx: ps.tx0 + dx, ty: ps.ty0 + dy }));
    } else if (ps.moved && ps.placing) {
      // dragging in a placement mode still pans (so big plans stay navigable)
      setView(v => ({ ...v, tx: ps.tx0 + dx, ty: ps.ty0 + dy }));
    } else if (ps.placing && draft) {
      setHover(screenToBase(e.clientX, e.clientY));
    }
  };

  const onPointerUp = (e) => {
    const ps = panState.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchState.current = null;
    panState.current = null;
    if (!ps) return;
    if (ps.placing && !ps.moved) {
      placePoint(screenToBase(e.clientX, e.clientY));
    }
  };

  // live cursor for desktop hover (no button pressed)
  const onHoverMove = (e) => {
    if (status === 'ready' && draft && !panState.current) {
      setHover(screenToBase(e.clientX, e.clientY));
    }
  };

  // ── Placement: calibrate or measure ─────────────────────────────────────
  function placePoint(base) {
    if (!draft) { setDraft(base); setHover(base); return; }
    const a = draft, b = base;
    const px = dist(a, b);
    if (px < 2) { setDraft(null); setHover(null); return; } // ignore zero-length
    if (mode === 'calibrate') {
      setCalInput({ a, b, px });
      setCalMm('');
    } else {
      const scale = pageScale(pageNumber);
      if (!scale) { toast('Calibrate this page first.'); setMode('calibrate'); setDraft(null); setHover(null); return; }
      addMeasurement(a, b, px / scale.pxPerMm);
    }
    setDraft(null);
    setHover(null);
  }

  // ── Takeoff record mutation helpers ─────────────────────────────────────
  const persist = useCallback((next) => {
    saveTakeoff(next);
    applyTakeoffToMeasureSheet(next);
    setTakeoff(next);
  }, []);

  const pageScale = useCallback((pn) => {
    return (takeoff?.pages || []).find(p => p.pageNumber === pn) || null;
  }, [takeoff]);

  function saveCalibration() {
    const mm = parseFloat(calMm);
    if (!calInput || !(mm > 0)) { toast('Enter a length greater than 0.'); return; }
    const pxPerMm = calInput.px / mm;
    const pages = [...(takeoff.pages || []).filter(p => p.pageNumber !== pageNumber)];
    pages.push({
      pageNumber, pxPerMm, knownLengthMm: mm, unit: 'mm',
      calLine: { x1: calInput.a.x, y1: calInput.a.y, x2: calInput.b.x, y2: calInput.b.y },
    });
    persist({ ...takeoff, pages });
    setCalInput(null);
    setCalMm('');
    setMode('measure');
    toast('Scale set. You can now measure.');
  }

  function addMeasurement(a, b, lengthMm) {
    const m = {
      id: uuidv4(), pageNumber,
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      lengthMm, label: '', tag: 'Width', createdAt: new Date().toISOString(),
    };
    persist({ ...takeoff, measurements: [...(takeoff.measurements || []), m] });
    setSelectedId(m.id);
  }

  function updateMeasurement(mid, patch) {
    persist({ ...takeoff, measurements: takeoff.measurements.map(m => m.id === mid ? { ...m, ...patch } : m) });
  }

  function removeMeasurement(mid) {
    persist({ ...takeoff, measurements: takeoff.measurements.filter(m => m.id !== mid) });
    if (selectedId === mid) setSelectedId(null);
  }

  // ── Upload a new plan ────────────────────────────────────────────────────
  async function handleUpload(file) {
    if (!file) return;
    if (file.type !== 'application/pdf') { toast('Please choose a PDF file.'); return; }
    setUploading(true);
    try {
      const takeoffId = takeoff?.id || uuidv4();
      const filePath = await uploadTakeoffPlan(jobId, takeoffId, file);
      const buf = await file.arrayBuffer();
      const doc = await loadPdf(buf);
      const record = {
        id: takeoffId,
        jobId,
        customerId: job?.customerId || null,
        filePath,
        fileName: file.name,
        pageCount: doc.numPages,
        // Re-uploading keeps prior measurements/scale only if it's the same takeoff id.
        pages: takeoff?.pages || [],
        measurements: takeoff?.measurements || [],
        createdAt: takeoff?.createdAt || new Date().toISOString(),
      };
      saveTakeoff(record);
      setTakeoff(record);
      setPdf(doc);
      setPageNumber(1);
      setStatus('ready');
      toast('Plan uploaded.');
    } catch (e) {
      console.error('[takeoff] upload', e);
      toast('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  function handleReplace(file) { handleUpload(file); }

  function handleDeleteTakeoff() {
    if (!takeoff) return;
    deleteTakeoff(takeoff.id);
    setTakeoff(null); setPdf(null); setPageBaseSize(null); setStatus('empty');
    toast('Takeoff removed.');
  }

  // ── Derived for render ──────────────────────────────────────────────────
  const pageMeasurements = useMemo(
    () => (takeoff?.measurements || []).filter(m => m.pageNumber === pageNumber),
    [takeoff, pageNumber]
  );
  const curScale = pageScale(pageNumber);
  const pageCount = pdf?.numPages || takeoff?.pageCount || 1;

  // wrapper transform: canvas raster is at rasterScale; bridge to live scale
  const wrapperStyle = {
    transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale / rasterScale})`,
    transformOrigin: '0 0',
  };

  // ── Render ───────────────────────────────────────────────────────────────
  if (!job) {
    return <div className="p-6 text-slate-500">Job not found. <button className="text-amber-600 underline" onClick={() => navigate('/jobs')}>Back to jobs</button></div>;
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-white">
        <button onClick={() => navigate(`/jobs/${jobId}`)} className="text-slate-500 hover:text-slate-800 flex items-center gap-1 text-sm">
          <ArrowLeft size={16} /> <span className="hidden sm:inline">Back to job</span>
        </button>
        <div className="min-w-0">
          <h1 className="font-semibold text-slate-900 text-sm truncate flex items-center gap-2">
            <Ruler size={15} className="text-amber-500" /> Plan Takeoff
          </h1>
          <p className="text-xs text-slate-400 truncate">{customer?.name} · {job.jobNumber}</p>
        </div>
        {takeoff && status === 'ready' && (
          <div className="ml-auto flex items-center gap-2">
            <label className="text-xs text-amber-600 hover:underline cursor-pointer flex items-center gap-1">
              <RefreshCw size={12} /> Replace
              <input type="file" accept="application/pdf" className="hidden" onChange={e => handleReplace(e.target.files?.[0])} />
            </label>
            <button onClick={handleDeleteTakeoff} className="text-xs text-red-500 hover:underline flex items-center gap-1">
              <Trash2 size={12} /> Remove
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      {status === 'empty' && (
        <UploadPane uploading={uploading} onFile={handleUpload} />
      )}
      {status === 'loading' && (
        <div className="flex-1 flex items-center justify-center text-slate-400 gap-2">
          <Loader2 size={18} className="animate-spin" /> Loading plan…
        </div>
      )}
      {status === 'error' && (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 p-6">
          <AlertTriangle size={28} className="text-amber-500" />
          <p className="text-sm text-slate-600 max-w-sm">{errorMsg}</p>
          <UploadPane uploading={uploading} onFile={handleUpload} compact />
        </div>
      )}

      {status === 'ready' && (
        <div className="flex-1 flex min-h-0">
          {/* Plan stage */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Toolbar */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-100 bg-white overflow-x-auto">
              <ToolBtn active={mode === 'pan'} onClick={() => { setMode('pan'); setDraft(null); }} icon={Hand} label="Pan" />
              <ToolBtn active={mode === 'calibrate'} onClick={() => { setMode('calibrate'); setDraft(null); }} icon={Crosshair} label="Set scale" />
              <ToolBtn active={mode === 'measure'} onClick={() => { setMode('measure'); setDraft(null); }} icon={Ruler} label="Measure" disabled={!curScale} />
              <div className="w-px h-5 bg-slate-200 mx-1" />
              <button onClick={() => zoomButton(1 / ZOOM_STEP)} className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="Zoom out"><ZoomOut size={16} /></button>
              <span className="text-xs text-slate-500 tabular-nums w-12 text-center">{Math.round(view.scale * 100)}%</span>
              <button onClick={() => zoomButton(ZOOM_STEP)} className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="Zoom in"><ZoomIn size={16} /></button>
              <button onClick={() => fitPage()} className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="Fit page"><Maximize2 size={16} /></button>
              {pageCount > 1 && (
                <>
                  <div className="w-px h-5 bg-slate-200 mx-1" />
                  <button disabled={pageNumber <= 1} onClick={() => setPageNumber(p => Math.max(1, p - 1))} className="p-1.5 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30"><ChevronLeft size={16} /></button>
                  <span className="text-xs text-slate-500 whitespace-nowrap">Page {pageNumber}/{pageCount}</span>
                  <button disabled={pageNumber >= pageCount} onClick={() => setPageNumber(p => Math.min(pageCount, p + 1))} className="p-1.5 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30"><ChevronRight size={16} /></button>
                </>
              )}
              <div className="ml-auto flex items-center gap-2 pl-2 whitespace-nowrap">
                {curScale
                  ? <span className="text-xs text-green-600 flex items-center gap-1"><Target size={12} /> 1&nbsp;mm = {(curScale.pxPerMm).toFixed(3)} px</span>
                  : <span className="text-xs text-amber-600 flex items-center gap-1"><AlertTriangle size={12} /> Scale not set</span>}
              </div>
            </div>

            {/* Mode hint */}
            <div className="px-3 py-1.5 text-xs text-slate-500 bg-slate-50/60 border-b border-slate-100">
              {mode === 'pan' && 'Drag to pan · scroll or pinch to zoom.'}
              {mode === 'calibrate' && (draft ? 'Click the second end of a known dimension.' : 'Click two ends of a known dimension, then enter its real length.')}
              {mode === 'measure' && (draft ? 'Click the second point.' : 'Click two points to measure. Zoom in for precision.')}
            </div>

            {/* Stage */}
            <div
              ref={stageRef}
              className="relative flex-1 overflow-hidden bg-slate-200 touch-none select-none"
              style={{ cursor: mode === 'pan' ? 'grab' : 'crosshair' }}
              onWheel={onWheel}
              onPointerDown={onPointerDown}
              onPointerMove={(e) => { onPointerMove(e); onHoverMove(e); }}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onContextMenu={(e) => e.preventDefault()}
            >
              {/* PDF canvas in a transform wrapper (bridges raster→live scale) */}
              <div className="absolute top-0 left-0" style={wrapperStyle}>
                <canvas ref={canvasRef} className="block shadow-lg bg-white" />
              </div>

              {/* Overlay (screen-space, constant stroke widths) */}
              <Overlay
                baseToScreen={baseToScreen}
                measurements={pageMeasurements}
                selectedId={selectedId}
                onSelect={setSelectedId}
                draft={draft}
                hover={hover}
                pxPerMm={curScale?.pxPerMm}
              />
            </div>
          </div>

          {/* Measurement list */}
          <MeasureList
            measurements={pageMeasurements}
            allCount={takeoff?.measurements?.length || 0}
            pageNumber={pageNumber}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onUpdate={updateMeasurement}
            onRemove={removeMeasurement}
            hasScale={!!curScale}
            onCalibrate={() => { setMode('calibrate'); setDraft(null); }}
          />
        </div>
      )}

      {/* Calibration dialog */}
      {calInput && (
        <CalibrationDialog
          px={calInput.px}
          value={calMm}
          onChange={setCalMm}
          onCancel={() => { setCalInput(null); setCalMm(''); }}
          onSave={saveCalibration}
        />
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────
function ToolBtn({ active, onClick, icon: Icon, label, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Set the scale first' : label}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 ${
        active ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      <Icon size={14} /> <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function Overlay({ baseToScreen, measurements, selectedId, onSelect, draft, hover, pxPerMm }) {
  const liveLen = draft && hover && pxPerMm ? dist(draft, hover) / pxPerMm : null;
  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none">
      {measurements.map(m => {
        const p1 = baseToScreen({ x: m.x1, y: m.y1 });
        const p2 = baseToScreen({ x: m.x2, y: m.y2 });
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        const sel = m.id === selectedId;
        const stroke = sel ? '#d97706' : '#0f766e';
        return (
          <g key={m.id} className="pointer-events-auto cursor-pointer" onClick={() => onSelect(m.id)}>
            <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={stroke} strokeWidth={sel ? 3 : 2} />
            <circle cx={p1.x} cy={p1.y} r={4} fill="#fff" stroke={stroke} strokeWidth={2} />
            <circle cx={p2.x} cy={p2.y} r={4} fill="#fff" stroke={stroke} strokeWidth={2} />
            <g transform={`translate(${mid.x}, ${mid.y})`}>
              <rect x={-30} y={-22} width={60} height={16} rx={3} fill={sel ? '#d97706' : '#0f766e'} />
              <text x={0} y={-10} textAnchor="middle" fontSize={11} fill="#fff" fontWeight="600">{fmtMm(m.lengthMm)}</text>
            </g>
          </g>
        );
      })}

      {/* live drawing */}
      {draft && (
        <g>
          {hover && (() => {
            const p1 = baseToScreen(draft); const p2 = baseToScreen(hover);
            const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
            return (
              <>
                <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#d97706" strokeWidth={2} strokeDasharray="5 4" />
                {liveLen != null && (
                  <g transform={`translate(${mid.x}, ${mid.y})`}>
                    <rect x={-30} y={-22} width={60} height={16} rx={3} fill="#d97706" />
                    <text x={0} y={-10} textAnchor="middle" fontSize={11} fill="#fff" fontWeight="600">{fmtMm(liveLen)}</text>
                  </g>
                )}
              </>
            );
          })()}
          {(() => { const p = baseToScreen(draft); return <circle cx={p.x} cy={p.y} r={4} fill="#d97706" stroke="#fff" strokeWidth={2} />; })()}
        </g>
      )}
    </svg>
  );
}

function MeasureList({ measurements, allCount, pageNumber, selectedId, onSelect, onUpdate, onRemove, hasScale, onCalibrate }) {
  return (
    <div className="w-72 border-l border-slate-200 bg-white flex flex-col min-h-0 hidden md:flex">
      <div className="px-4 py-3 border-b border-slate-100">
        <h2 className="font-semibold text-slate-800 text-sm">Measurements</h2>
        <p className="text-xs text-slate-400 mt-0.5">{measurements.length} on this page · {allCount} total</p>
      </div>
      {!hasScale && (
        <div className="m-3 p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-700">
          Set the scale on this page before measuring.
          <button onClick={onCalibrate} className="block mt-1.5 font-medium underline">Set scale now</button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-50">
        {measurements.length === 0 && (
          <p className="px-4 py-6 text-xs text-slate-400 text-center">No measurements on page {pageNumber} yet.</p>
        )}
        {measurements.map(m => (
          <div key={m.id} className={`px-3 py-2.5 ${m.id === selectedId ? 'bg-amber-50/60' : 'hover:bg-slate-50'}`} onClick={() => onSelect(m.id)}>
            <div className="flex items-center gap-2">
              <input
                value={m.label}
                onChange={e => onUpdate(m.id, { label: e.target.value })}
                onClick={e => e.stopPropagation()}
                placeholder="Label (e.g. Bed 1 window)"
                className="flex-1 min-w-0 text-sm bg-transparent border-b border-transparent focus:border-amber-400 outline-none text-slate-800 placeholder:text-slate-300"
              />
              <button onClick={(e) => { e.stopPropagation(); onRemove(m.id); }} className="text-slate-300 hover:text-red-500"><Trash2 size={14} /></button>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <select
                value={m.tag}
                onChange={e => onUpdate(m.id, { tag: e.target.value })}
                onClick={e => e.stopPropagation()}
                className={`text-xs font-medium rounded border px-1.5 py-0.5 outline-none cursor-pointer ${TAG_STYLE[m.tag] || TAG_STYLE.Other}`}
              >
                {TAGS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
              <span className="text-sm font-semibold text-slate-700 tabular-nums ml-auto">{fmtMm(m.lengthMm)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="px-3 py-2 border-t border-slate-100 text-[11px] text-slate-400">
        Labelled Width/Drop measurements flow into this job's measure sheet automatically.
      </div>
    </div>
  );
}

function UploadPane({ uploading, onFile, compact }) {
  return (
    <div className={`${compact ? '' : 'flex-1'} flex items-center justify-center p-6`}>
      <label className={`flex flex-col items-center justify-center gap-3 ${compact ? 'p-6' : 'p-12'} border-2 border-dashed border-slate-300 rounded-2xl cursor-pointer hover:border-amber-400 hover:bg-amber-50/30 transition-colors text-center max-w-md w-full`}>
        {uploading
          ? <Loader2 size={28} className="text-amber-500 animate-spin" />
          : <Upload size={28} className="text-slate-400" />}
        <div>
          <p className="text-sm font-medium text-slate-700">{uploading ? 'Uploading…' : 'Upload a plan PDF'}</p>
          <p className="text-xs text-slate-400 mt-1">Architectural plan for this job · multi-page supported</p>
        </div>
        <span className="text-xs flex items-center gap-1 text-amber-600"><FileText size={12} /> Choose PDF</span>
        <input type="file" accept="application/pdf" className="hidden" disabled={uploading} onChange={e => onFile(e.target.files?.[0])} />
      </label>
    </div>
  );
}

function CalibrationDialog({ px, value, onChange, onCancel, onSave }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2"><Crosshair size={16} className="text-amber-500" /> Set scale</h3>
          <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <p className="text-xs text-slate-500 mb-4">Enter the real-world length of the line you drew. The line is {px.toFixed(1)} px on the plan.</p>
        <label className="text-xs font-medium text-slate-600">Known length (mm)</label>
        <input
          autoFocus type="number" inputMode="decimal" value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') onSave(); }}
          placeholder="e.g. 1000"
          className="mt-1 w-full border border-slate-300 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
        />
        {value > 0 && (
          <p className="text-xs text-slate-400 mt-2">Resulting scale: 1&nbsp;mm = {(px / parseFloat(value)).toFixed(3)} px</p>
        )}
        <div className="flex gap-2 mt-5">
          <button onClick={onCancel} className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={onSave} className="flex-1 py-2 rounded-lg bg-amber-500 text-white text-sm font-medium hover:bg-amber-600">Set scale</button>
        </div>
      </div>
    </div>
  );
}
