import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import {
  ArrowLeft, Upload, Ruler, Crosshair, Hand, ZoomIn, ZoomOut, Maximize2,
  ChevronLeft, ChevronRight, Trash2, FileText, Loader2, AlertTriangle,
  Target, RefreshCw, Undo2, Redo2, Magnet, Square, Hash, MoreHorizontal,
  Copy, Download, History, CloudOff, CheckCircle2, DoorOpen, WifiOff,
  Spline, Waypoints, Check, Eye, PenLine, Keyboard, X,
} from 'lucide-react';
import {
  getJob, getCustomer, getTakeoffByJob, saveTakeoff, deleteTakeoff,
  applyTakeoffToMeasureSheet, takeoffRows, getProductTypes, addActivity,
} from '../store/data';
import { useProfile } from '../contexts/UserProfileContext';
import { toast } from '../components/ToastContainer';
import {
  uploadTakeoffPlan, downloadTakeoffPlan, uploadTakeoffPhoto,
  removeTakeoffPhotos, isPlanCached,
} from '../lib/takeoffStorage';
import { loadPdf, getPageBaseSize, renderPageToCanvas } from '../lib/pdfRender';
import { extractPageText, nearestRooms, suggestLabel, printedDimensionFor } from '../lib/planText';
import { nextRoomLabel } from '../lib/roomNaming';
import {
  resolveSnap, dist, clamp, polylineMetrics, arcMetrics, pointsOf,
  projectToBisector, sagittaOf, viaForSagitta, viaForRadius, minRadiusFor,
  chordFrame, viaFromFrame,
} from '../lib/takeoffGeometry';
import { plausibility } from '../lib/planScale';
import { buildAnnotatedPlan, buildClientPlan } from '../lib/planAnnotate';
import { buildClientSchedule } from '../lib/clientSchedule';
import ClientSchedule, { ClientPins, ClientScheduleTray } from '../components/takeoff/ClientView';
import { buildRateCard, estimateTakeoff } from '../lib/planEstimate';
import Overlay from '../components/takeoff/Overlay';
import ItemPanel from '../components/takeoff/ItemPanel';
import {
  ScaleDialog, DoorCheckDialog, DuplicatePageDialog, ReplacePlanDialog,
  RevisionsDialog, ConfirmDeleteDialog, PrintedDimensionPrompt,
} from '../components/takeoff/dialogs';

// ── Tunables ────────────────────────────────────────────────────────────────
const MIN_SCALE = 0.05;
const MAX_SCALE = 40;
const ZOOM_STEP = 1.15;
const TAP_SLOP  = 6;            // px of movement still counted as a tap, not a drag
const MAX_BACKING = 4096;       // cap the canvas backing store's long edge
const MAX_BACKING_PX = 8e6;     // …and its total area — phones bail on big canvases
const HISTORY_LIMIT = 60;
const SAVE_DEBOUNCE_MS = 500;
const DPR = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);

/** The markup a snapshot needs to restore — everything undo/redo touches. */
const snapshotOf = (t) => ({
  pages: t?.pages || [],
  measurements: t?.measurements || [],
  items: t?.items || [],
  markers: t?.markers || [],
});

export default function JobTakeoff() {
  const { id: jobId } = useParams();
  const navigate = useNavigate();
  const { displayName = '' } = useProfile() || {};

  const job = getJob(jobId);
  const customer = job ? getCustomer(job.customerId) : null;
  const productTypes = useMemo(() => getProductTypes().filter(p => p.isActive !== false), []);

  // ── Core state ──────────────────────────────────────────────────────────
  const [takeoff, setTakeoff] = useState(() => getTakeoffByJob(jobId) || null);
  const [pdf, setPdf] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageBaseSize, setPageBaseSize] = useState(null); // {width,height} @ scale 1
  const [status, setStatus] = useState('init');           // init|empty|loading|ready|error
  const [errorMsg, setErrorMsg] = useState('');
  const [uploading, setUploading] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  // Bumped to re-run the plan load when a takeoff appears after this page
  // mounted (hydration is async, and another device can add one).
  const [reloadKey, setReloadKey] = useState(0);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  // view = screen transform of the page: screen = base*scale + (tx,ty)
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const [rasterScale, setRasterScale] = useState(1);
  // Mirror of `view` kept in sync synchronously. A pinch on a phone fires far
  // more moves than React commits renders, so gesture maths must read the value
  // it just wrote, not the one from the last render.
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 });

  // interaction
  const [mode, setMode] = useState('pan');                // pan|window|measure|chain|arc|calibrate|count|verify
  // Points placed so far in the measurement being drawn. A straight line commits
  // at two; a bay run keeps going until you finish it; an arc takes three.
  const [draftPoints, setDraftPoints] = useState([]);
  const [hover, setHover] = useState(null);               // live cursor (base) while drawing
  const cancelDraft = useCallback(() => { setDraftPoints([]); setHover(null); }, []);
  const [snapOn, setSnapOn] = useState(true);
  const [orthoOn, setOrthoOn] = useState(false);          // sticky ortho (Shift also forces it)
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [activeHandle, setActiveHandle] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);      // panel tray on small screens
  // Client view: the same takeoff presented for the person paying for it.
  const [clientView, setClientView] = useState(false);
  const [clientShowSizes, setClientShowSizes] = useState(true);
  const [clientPick, setClientPick] = useState(null);
  // Id whose label field should take focus. Set when something UNNAMED is
  // selected, so tapping a window on the plan puts the cursor straight in the
  // room-name box — naming is the only thing left to do at that point.
  const [focusLabel, setFocusLabel] = useState(null);
  // true when the focus came from placing a mark, so its suggested name is
  // selected and one keystroke replaces it.
  const [focusSelects, setFocusSelects] = useState(false);
  // Stable identity: it sits in an effect's dep list down in the panel, and a
  // fresh closure each render would re-run that effect on every keystroke.
  const clearLabelFocus = useCallback(() => setFocusLabel(null), []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // The key handler is bound once; a ref keeps it aware of the page count
  // without re-binding on every render.
  const pageCountRef = useRef(1);
  const [busy, setBusy] = useState('');                   // long-running label
  const [photoBusyId, setPhotoBusyId] = useState(null);

  // dialogs
  const [scaleDialog, setScaleDialog] = useState(null);   // { pendingLine } | {}
  const [doorCheck, setDoorCheck] = useState(null);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [replacePrompt, setReplacePrompt] = useState(null);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [printedPrompt, setPrintedPrompt] = useState(null);

  // guided flows
  const [dropTarget, setDropTarget] = useState(null);     // itemId awaiting a Drop line

  // text layer, indexed per page (extraction is async and worth keeping)
  const [textIndexes, setTextIndexes] = useState({});
  const textIndex = pdf ? (textIndexes[pageNumber] || null) : null;

  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const rasterTimer = useRef(null);
  const pointers = useRef(new Map());                     // active pointers for pan/pinch
  const panState = useRef(null);
  const pinchState = useRef(null);
  const handleDrag = useRef(null);                        // { id, end } while dragging an endpoint
  const firstPageSize = useRef(null);
  const takeoffRef = useRef(takeoff);
  const history = useRef({ past: [], future: [] });
  // Mirrored into state purely so the undo/redo buttons re-render — the stacks
  // themselves live in a ref so pushing to them never costs a render.
  const [historyCounts, setHistoryCounts] = useState({ past: 0, future: 0 });
  const syncHistory = useCallback(() => setHistoryCounts({
    past: history.current.past.length,
    future: history.current.future.length,
  }), []);
  const saveTimer = useRef(null);
  const pendingSave = useRef(null);
  // The store dispatches its change event SYNCHRONOUSLY from inside the write,
  // and fires the same event for our own saves as for anyone else's. So the
  // listener below has to be told to stand down for the duration of our write —
  // a timestamp compared afterwards is always one step too late.
  const writingSelf = useRef(false);

  const pdfRef = useRef(null);
  useEffect(() => { takeoffRef.current = takeoff; }, [takeoff]);
  useEffect(() => { pdfRef.current = pdf; }, [pdf]);

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
        if (!buf) {
          setErrorMsg(navigator.onLine
            ? 'The plan file could not be loaded. Re-upload to continue.'
            : 'You’re offline and this plan hasn’t been saved for offline use yet.');
          setStatus('error');
          return;
        }
        const doc = await loadPdf(buf);
        if (!alive) return;
        setTakeoff(t);
        setPdf(doc);
        setPageNumber(1);
        setStatus('ready');
        firstPageSize.current = await getPageBaseSize(doc, 1);
        isPlanCached(t.filePath).then(v => alive && setOfflineReady(v));
      } catch (e) {
        console.error('[takeoff] load', e);
        if (alive) { setErrorMsg('Failed to open the plan PDF.'); setStatus('error'); }
      }
    })();
    return () => { alive = false; };
  }, [jobId, reloadKey]);

  /**
   * Adopt the stored takeoff when it changes underneath us.
   *
   * Supabase hydration completes AFTER the app starts, so opening this page
   * early leaves it holding an empty record while the real measurements land in
   * the store moments later. Without this the page showed nothing — and worse,
   * drawing on it would persist from that empty snapshot and wipe them.
   *
   * Only ever adopts a strictly NEWER record, and never mid-edit: a debounced
   * save in flight is the freshest version there is, and the store is behind it.
   */
  useEffect(() => {
    const onChanged = () => {
      if (writingSelf.current || pendingSave.current || handleDrag.current) return;
      const stored = getTakeoffByJob(jobId);
      if (!stored) return;
      const mine = takeoffRef.current;
      if (mine && stored.id === mine.id
          && !(Date.parse(stored.updatedAt || 0) > Date.parse(mine.updatedAt || 0))) return;
      takeoffRef.current = stored;
      setTakeoff(stored);
      history.current = { past: [], future: [] };
      syncHistory();
      if (stored.filePath && !pdfRef.current) setReloadKey(k => k + 1);
    };
    window.addEventListener('lusso:data-changed', onChanged);
    return () => window.removeEventListener('lusso:data-changed', onChanged);
  }, [jobId, syncHistory]);

  // Online/offline chip — the difference between "broken" and "working offline".
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

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

  // ── Mine the page's text layer (room names, printed dimensions) ─────────
  useEffect(() => {
    if (!pdf || textIndexes[pageNumber]) return;
    let alive = true;
    extractPageText(pdf, pageNumber).then(idx => {
      if (alive) setTextIndexes(prev => ({ ...prev, [pageNumber]: idx }));
    });
    return () => { alive = false; };
  }, [pdf, pageNumber, textIndexes]);

  // ── Render the page to canvas on raster/page change ─────────────────────
  useEffect(() => {
    if (!pdf || !canvasRef.current || !pageBaseSize) return;
    renderPageToCanvas(pdf, pageNumber, rasterScale, canvasRef.current, DPR)
      .catch(e => console.error('[takeoff] render', e));
  }, [pdf, pageNumber, rasterScale, pageBaseSize]);

  // raster cap for the current page so the backing store stays bounded, by long
  // edge and by area — a phone that can't allocate the canvas renders nothing.
  const maxRaster = useMemo(() => {
    if (!pageBaseSize) return MAX_SCALE;
    const { width, height } = pageBaseSize;
    const byEdge = MAX_BACKING / (Math.max(width, height) * DPR);
    const byArea = Math.sqrt(MAX_BACKING_PX / (width * height * DPR * DPR));
    return Math.max(1, Math.min(byEdge, byArea));
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
    setViewNow({ scale, tx, ty });
    setRasterScale(clamp(scale, 0.1, maxRaster));
  }

  // Single writer for the view: keeps the ref and the state in lockstep and
  // takes plain values, never an updater — updaters run during React's render
  // phase, where reading a gesture ref that a finger-up has since cleared throws
  // and takes the whole page down to the error boundary.
  const setViewNow = useCallback((next) => {
    viewRef.current = next;
    setView(next);
  }, []);

  // ── Persistence ─────────────────────────────────────────────────────────
  // Structural edits (add/delete/scale) write straight through. Typing —
  // labels, notes, quantities — is debounced: a keystroke used to rewrite the
  // takeoff, push it to Supabase AND rebuild the whole measure sheet.
  const flushSave = useCallback(() => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const rec = pendingSave.current;
    pendingSave.current = null;
    if (!rec) return;
    writingSelf.current = true;
    try {
      saveTakeoff(rec);
      applyTakeoffToMeasureSheet(rec);
    } finally {
      writingSelf.current = false;
    }
  }, []);

  useEffect(() => () => flushSave(), [flushSave]);

  const persist = useCallback((next, { debounce = false, record = true } = {}) => {
    if (record) {
      const prev = takeoffRef.current;
      if (prev) {
        history.current.past.push(snapshotOf(prev));
        if (history.current.past.length > HISTORY_LIMIT) history.current.past.shift();
        history.current.future = [];
        syncHistory();
      }
    }
    takeoffRef.current = next;
    setTakeoff(next);
    pendingSave.current = next;
    if (debounce) {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
    } else {
      flushSave();
    }
  }, [flushSave, syncHistory]);

  const undo = useCallback(() => {
    const snap = history.current.past.pop();
    if (!snap) return;
    const cur = takeoffRef.current;
    history.current.future.push(snapshotOf(cur));
    syncHistory();
    persist({ ...cur, ...snap }, { record: false });
    setSelectedIds(new Set());
    cancelDraft();
  }, [persist, syncHistory, cancelDraft]);

  const redo = useCallback(() => {
    const snap = history.current.future.pop();
    if (!snap) return;
    const cur = takeoffRef.current;
    history.current.past.push(snapshotOf(cur));
    syncHistory();
    persist({ ...cur, ...snap }, { record: false });
  }, [persist, syncHistory]);

  const pageScale = useCallback((pn) => {
    return (takeoff?.pages || []).find(p => p.pageNumber === pn) || null;
  }, [takeoff]);

  const curScale = pageScale(pageNumber);

  // ── Coordinate conversion ───────────────────────────────────────────────
  const screenToBase = useCallback((clientX, clientY) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (clientX - rect.left - view.tx) / view.scale,
      y: (clientY - rect.top - view.ty) / view.scale,
    };
  }, [view]);

  const baseToScreen = useCallback((p) => ({
    x: p.x * view.scale + view.tx,
    y: p.y * view.scale + view.ty,
  }), [view]);

  const pageMeasurements = useMemo(
    () => (takeoff?.measurements || []).filter(m => m.pageNumber === pageNumber),
    [takeoff, pageNumber]
  );
  const pageItems = useMemo(
    () => (takeoff?.items || []).filter(i => i.pageNumber === pageNumber),
    [takeoff, pageNumber]
  );
  const pageMarkers = useMemo(
    () => (takeoff?.markers || []).filter(k => k.pageNumber === pageNumber),
    [takeoff, pageNumber]
  );

  /** Apply the snap pipeline to a raw pointer position. */
  const snapPoint = useCallback((base, { anchor = null, forceOrtho = false, excludeId = null } = {}) => (
    resolveSnap(base, {
      anchor,
      measurements: pageMeasurements,
      canvas: canvasRef.current,
      rasterScale,
      dpr: DPR,
      viewScale: view.scale,
      forceOrtho: forceOrtho || orthoOn,
      snapEnabled: snapOn,
      excludeId,
    })
  ), [pageMeasurements, rasterScale, view.scale, orthoOn, snapOn]);

  // ── Zoom to a screen point ──────────────────────────────────────────────
  const zoomAt = useCallback((cx, cy, factor) => {
    const v = viewRef.current;
    const newScale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
    const k = newScale / v.scale;
    setViewNow({ scale: newScale, tx: cx - (cx - v.tx) * k, ty: cy - (cy - v.ty) * k });
    scheduleRaster(newScale);
  }, [scheduleRaster, setViewNow]);

  /**
   * Wheel and trackpad, on a NATIVE non-passive listener.
   *
   * React registers its delegated `onWheel` as passive, where preventDefault is
   * a silent no-op — so a trackpad pinch (which arrives as a wheel event with
   * ctrlKey set) fell through to the browser and zoomed the whole page instead
   * of the plan. It has to be bound directly, with `passive: false`.
   */
  useEffect(() => {
    const el = stageRef.current;
    if (!el || status !== 'ready') return;

    const onWheelNative = (e) => {
      const rect = el.getBoundingClientRect();
      if (!rect) return;
      e.preventDefault();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      // Pinch. The deltas are fine-grained, so scale exponentially rather than
      // in fixed steps — otherwise a gentle pinch jumps a whole zoom notch.
      if (e.ctrlKey || e.metaKey) {
        zoomAt(cx, cy, Math.exp(-e.deltaY * 0.012));
        return;
      }

      // A sideways component means a two-finger trackpad scroll: pan, don't
      // zoom. Shift-wheel is the mouse equivalent.
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const v = viewRef.current;
        setViewNow({ scale: v.scale, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY });
        scheduleRaster(v.scale);
        return;
      }

      zoomAt(cx, cy, e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    };

    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, [status, zoomAt, scheduleRaster, setViewNow]);

  const zoomButton = (factor) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    zoomAt(rect.width / 2, rect.height / 2, factor);
  };

  // ── Pointer handling (pan / pinch / tap-to-place / handle drag) ─────────
  // Both gestures are solved from a snapshot taken when they start, so every
  // move recomputes the view from scratch instead of compounding it. That keeps
  // a pinch stable when moves arrive in bursts (phones coalesce them) and makes
  // an interrupted gesture harmless.
  const beginPinch = () => {
    const rect = stageRef.current?.getBoundingClientRect();
    const [p1, p2] = [...pointers.current.values()];
    if (!rect || !p1 || !p2) return;
    const v = viewRef.current;
    pinchState.current = {
      startDist: Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y)),
      startScale: v.scale,
      startTx: v.tx,
      startTy: v.ty,
      midX: (p1.x + p2.x) / 2 - rect.left,
      midY: (p1.y + p2.y) / 2 - rect.top,
    };
    panState.current = null;
  };

  const beginPan = (pt) => {
    const v = viewRef.current;
    panState.current = {
      startX: pt.x, startY: pt.y,
      tx0: v.tx, ty0: v.ty, scale0: v.scale,
      moved: false, placing: false,
    };
  };

  /** Start dragging one end of a placed measurement. */
  const onHandleDown = (e, id, index) => {
    if (status !== 'ready') return;
    try { stageRef.current?.setPointerCapture?.(e.pointerId); } catch { /* non-capturable */ }
    handleDrag.current = { id, index, moved: false };
    setActiveHandle(index);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };

  const onPointerDown = (e) => {
    if (status !== 'ready') return;
    if (handleDrag.current) return;
    try { stageRef.current?.setPointerCapture?.(e.pointerId); } catch { /* non-capturable pointer */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size >= 2) { beginPinch(); return; }

    const panInitiated = mode === 'pan' || e.button === 1 || e.button === 2;
    beginPan({ x: e.clientX, y: e.clientY });
    panState.current.placing = !panInitiated;
  };

  const onPointerMove = (e) => {
    if (status !== 'ready') return;
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Endpoint drag — the fix for "I put that point 2 px out".
    if (handleDrag.current) {
      const hd = handleDrag.current;
      hd.moved = true;
      const m = (takeoffRef.current?.measurements || []).find(x => x.id === hd.id);
      if (!m) return;
      // Ortho-lock a dragged vertex against its NEIGHBOUR, so a facet of a bay
      // stays square to the one it joins rather than to the far end of the run.
      const pts = pointsOf(m);
      const bendHandle = m.kind === 'arc' && pts.length === 3 && hd.index === 1;
      // Ortho against a neighbour is meaningless for a bend — it would fight the
      // drag. Ink snapping still applies, so the bow can be pulled onto the
      // curve actually drawn on the plan.
      const anchor = bendHandle ? null : (pts[hd.index === 0 ? 1 : hd.index - 1] || null);
      const p = snapPoint(screenToBase(e.clientX, e.clientY), { anchor, forceOrtho: !bendHandle && e.shiftKey, excludeId: hd.id });
      moveVertex(hd.id, hd.index, p, { record: !hd.recorded, lockBend: bendHandle && e.shiftKey });
      hd.recorded = true;
      return;
    }

    // pinch zoom + pan — solved against the gesture snapshot, so the point of
    // the plan that was under the midpoint when the pinch began stays there.
    if (pinchState.current && pointers.current.size >= 2) {
      const ps = pinchState.current;
      const rect = stageRef.current?.getBoundingClientRect();
      const [p1, p2] = [...pointers.current.values()];
      if (!rect || !p1 || !p2) return;
      const d = Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y));
      const midX = (p1.x + p2.x) / 2 - rect.left;
      const midY = (p1.y + p2.y) / 2 - rect.top;
      const scale = clamp(ps.startScale * (d / ps.startDist), MIN_SCALE, MAX_SCALE);
      const k = scale / ps.startScale;
      setViewNow({
        scale,
        tx: midX - (ps.midX - ps.startTx) * k,
        ty: midY - (ps.midY - ps.startTy) * k,
      });
      return;   // re-raster once the fingers lift; rasterising mid-pinch janks
    }

    const ps = panState.current;
    if (!ps) return;
    const dx = e.clientX - ps.startX, dy = e.clientY - ps.startY;
    if (!ps.moved && Math.hypot(dx, dy) > TAP_SLOP) ps.moved = true;

    if (ps.moved) {
      // dragging in a placement mode still pans (so big plans stay navigable)
      setViewNow({ scale: ps.scale0, tx: ps.tx0 + dx, ty: ps.ty0 + dy });
    } else if (ps.placing && draftPoints.length) {
      setHover(snapPoint(screenToBase(e.clientX, e.clientY), { anchor: lastDraftPoint, forceOrtho: e.shiftKey }));
    }
  };

  const endPointer = (e, cancelled) => {
    const ps = panState.current;
    const wasPinching = !!pinchState.current;
    const hd = handleDrag.current;
    pointers.current.delete(e.pointerId);
    try { stageRef.current?.releasePointerCapture?.(e.pointerId); } catch { /* not captured */ }
    panState.current = null;

    if (hd) { handleDrag.current = null; return; }

    if (wasPinching) {
      pinchState.current = null;
      // Hand the gesture over to whatever is still touching the screen, so
      // lifting one finger of a pinch keeps panning instead of dead-ending.
      if (pointers.current.size >= 2) beginPinch();
      else if (pointers.current.size === 1) beginPan([...pointers.current.values()][0]);
      scheduleRaster(viewRef.current.scale);
      return;
    }

    if (!ps) return;
    if (ps.moved) scheduleRaster(viewRef.current.scale);
    // A cancelled pointer (OS gesture, palm rejection) is not a tap.
    if (!cancelled && ps.placing && !ps.moved) {
      const raw = screenToBase(e.clientX, e.clientY);
      placePoint(snapPoint(raw, { anchor: lastDraftPoint, forceOrtho: e.shiftKey }));
    }
  };

  const onPointerUp     = (e) => endPointer(e, false);
  const onPointerCancel = (e) => endPointer(e, true);

  // live cursor for desktop hover (no button pressed)
  const onHoverMove = (e) => {
    if (pointers.current.size >= 2 || handleDrag.current) return;
    if (status !== 'ready' || panState.current) return;
    if (!isPlacingMode) return;
    setHover(snapPoint(screenToBase(e.clientX, e.clientY), { anchor: lastDraftPoint, forceOrtho: e.shiftKey }));
  };

  const isPlacingMode = mode !== 'pan';
  const lastDraftPoint = draftPoints.length ? draftPoints[draftPoints.length - 1] : null;

  // How many points each tool needs before it commits on its own. A chain has
  // no fixed count — a bay can be two facets or five — so it commits only when
  // you say it's finished.
  const POINTS_NEEDED = { window: 2, measure: 2, calibrate: 2, verify: 2, arc: 2, count: 1, chain: Infinity };
  const needed = POINTS_NEEDED[mode] ?? 2;
  // A chain is finishable once it has a real leg; an arc only ever needs its
  // third point, which it takes automatically.
  const canFinishDraft = mode === 'chain' && draftPoints.length >= 2;
  const drawing = draftPoints.length > 0;


  // ── Placement ───────────────────────────────────────────────────────────
  function placePoint(base) {
    if (mode === 'count') { addMarker(base); return; }
    // Tapping the same spot twice is how you finish a run without reaching for
    // a button — the second tap would be a zero-length facet anyway.
    if (mode === 'chain' && lastDraftPoint && dist(lastDraftPoint, base) < 2) {
      if (draftPoints.length >= 2) commitDraft(draftPoints);
      return;
    }
    const next = [...draftPoints, base];
    if (next.length < needed) { setDraftPoints(next); setHover(base); return; }
    setHover(null);
    commitDraft(next);
  }

  /** Finish an open chain from the toolbar / Enter key. */
  function finishDraft() {
    if (draftPoints.length >= 2) commitDraft(draftPoints);
    else cancelDraft();
  }

  /**
   * Turn the placed points into a measurement.
   *
   * `kind` matters beyond drawing: a bay measured as one straight line reads the
   * chord and orders short, so a chain keeps every facet and an arc keeps its
   * radius. Those are the numbers the workroom actually builds to.
   */
  function commitDraft(pts0) {
    let points = pts0;
    setDraftPoints([]);
    setHover(null);
    if (points.length < 2) return;

    const kind = mode === 'chain' ? 'chain' : mode === 'arc' ? 'arc' : 'line';
    // A curve is committed straight — apex sitting exactly on the chord — and
    // then bent by dragging that middle handle. One thing to judge at a time.
    if (kind === 'arc' && points.length === 2) {
      points = [points[0], viaForSagitta(points[0], points[1], 0), points[1]];
    }
    const geom = shapeOf(kind, points);
    if (!(geom.px > 2)) return;                 // ignore a zero-length placement

    if (mode === 'calibrate') {
      // Only ever calibrate off a straight run — a curve has no known length.
      setScaleDialog({ pendingLine: { a: points[0], b: points[points.length - 1], px: geom.px } });
      return;
    }

    const scale = pageScale(pageNumber);
    if (!scale) {
      toast('Set the scale on this page first.');
      setScaleDialog({});
      return;
    }
    const measured = toMm(geom, scale.pxPerMm);

    if (mode === 'verify') { setDoorCheck({ measuredMm: measured.lengthMm }); setMode('window'); return; }
    if (dropTarget) {
      addMeasurement(points, kind, measured, { tag: 'Drop', itemId: dropTarget });
      // A measured drop supersedes anything typed, or the typed value would
      // keep shadowing it on the sheet.
      updateItem(dropTarget, { dropMm: '' });
      setDropTarget(null);
      setMode('window');
      return;
    }
    if (mode === 'window' || mode === 'chain' || mode === 'arc') {
      addWindow(points, kind, measured);
      return;
    }
    addMeasurement(points, kind, measured, { tag: 'Width' });
  }

  /** Pixel-space geometry for a set of points, by kind. */
  function shapeOf(kind, points) {
    if (kind === 'arc' && points.length === 3) {
      const a = arcMetrics(points[0], points[1], points[2]);
      return { kind, px: a.arcLength, segments: null, radius: a.radius, chord: a.chord, sweepDeg: a.sweepDeg };
    }
    const pm = polylineMetrics(points);
    return {
      kind: kind === 'chain' ? 'chain' : 'line',
      px: pm.total,
      segments: kind === 'chain' ? pm.segments : null,
      radius: null,
      chord: pm.chord,
      sweepDeg: 0,
    };
  }

  /** Pixel geometry → the millimetre fields stored on a measurement. */
  function toMm(geom, pxPerMm) {
    return {
      lengthMm: geom.px / pxPerMm,
      segments: geom.segments ? geom.segments.map(v => v / pxPerMm) : undefined,
      radiusMm: geom.radius != null ? geom.radius / pxPerMm : undefined,
      chordMm: geom.chord ? geom.chord / pxPerMm : undefined,
      sweepDeg: geom.sweepDeg || undefined,
    };
  }

  /**
   * Recompute a measurement's millimetres from its stored points.
   * Used whenever a page is rescaled — the pixel geometry is still correct, only
   * the multiplier changed. A measurement pinned to a printed dimension keeps
   * that number: it came off the drawing, not the ruler.
   */
  function rescaleMeasurement(m, pxPerMm) {
    if (m.printedMm != null) return m;
    const geom = shapeOf(m.kind || 'line', pointsOf(m));
    return { ...m, ...toMm(geom, pxPerMm) };
  }

  // ── Measurement + item mutation ─────────────────────────────────────────
  const baseRecord = useCallback(() => (
    takeoffRef.current || {
      id: uuidv4(), jobId, customerId: job?.customerId || null,
      pages: [], measurements: [], items: [], markers: [], revisions: [],
    }
  ), [jobId, job]);

  /**
   * The name to give a new covering, plus any renames that keeps the room's
   * A / B / C series consistent.
   *
   * Scoped across the whole takeoff rather than per page: the measure sheet
   * groups by label, so two "Bed 5" on different sheets would merge into one
   * row regardless of which page they were drawn on.
   */
  function autoName(t, midpoint) {
    const base = suggestLabel(textIndex, midpoint, { maxDist: 500 });
    if (!base) return { label: '', renames: [] };
    const existing = [
      ...(t.items || []).map(i => ({ id: i.id, label: i.label || '' })),
      ...(t.measurements || []).filter(m => !m.itemId).map(m => ({ id: m.id, label: m.label || '' })),
    ];
    return nextRoomLabel(base, existing);
  }

  /** Apply the renames `autoName` asked for, to whichever holds each id. */
  function applyRenames(t, renames) {
    if (!renames?.length) return t;
    const byId = new Map(renames.map(r => [r.id, r.to]));
    return {
      ...t,
      items: (t.items || []).map(i => byId.has(i.id) ? { ...i, label: byId.get(i.id) } : i),
      measurements: (t.measurements || []).map(m => byId.has(m.id) ? { ...m, label: byId.get(m.id) } : m),
    };
  }

  function newMeasurement(points, kind, measured, extra = {}) {
    const a = points[0], b = points[points.length - 1];
    return {
      id: uuidv4(), pageNumber,
      kind,
      points: points.map(p => ({ x: p.x, y: p.y })),
      // x1..y2 mirror the run's ends. Every reader that predates chains and
      // arcs — and `pointsOf` for anything without a points array — still works.
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
      ...measured,
      label: '', tag: 'Width',
      createdAt: new Date().toISOString(),
      ...extra,
    };
  }

  /**
   * Loose measurement — the original flat behaviour, still there.
   *
   * Named off the plan's text layer just like a window is. The tool you reach
   * for shouldn't decide whether the room name gets filled in for you; it was
   * only ever this way because auto-labelling was built for the window flow and
   * never wired into this one.
   *
   * A measurement that belongs to a window (a drop taken on an elevation) is
   * skipped — it inherits the window's name, and a second one would just be
   * noise on the sheet.
   */
  function addMeasurement(points, kind, measured, extra = {}) {
    const t0 = baseRecord();
    const a = points[0], b = points[points.length - 1];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const named = extra.itemId || extra.label != null
      ? { label: extra.label || '', renames: [] }
      : autoName(t0, mid);
    const t = applyRenames(t0, named.renames);
    const label = named.label;
    const m = newMeasurement(points, kind, measured, { ...extra, label });
    persist({ ...t, measurements: [...(t.measurements || []), m] });
    setSelectedIds(new Set([m.id]));
    setActiveHandle(kind === 'arc' ? 1 : points.length - 1);
    setSheetOpen(true);
    // Always land in the name box on a fresh mark. The suggestion arrives
    // SELECTED, so a good one is accepted by moving on and a bad one is
    // overwritten by typing — nearest-label gets the room wrong often enough
    // (a window between a bedroom and its ensuite is nearer the ensuite's text)
    // that making a wrong guess cost a click would be worse than not guessing.
    setFocusSelects(true);
    setFocusLabel(extra.itemId ? null : m.id);
    offerPrintedDimension(m);
  }

  /**
   * Place a whole window in one drag.
   *
   * A floor plan shows width, not drop — so the drag captures the width, the
   * room name comes off the text layer, and the drop is typed (or measured on
   * an elevation sheet via the item's own ruler button). One object, one row on
   * the sheet, instead of two lines that only reunite if you type the same
   * label twice.
   */
  function addWindow(points, kind, measured) {
    const t0 = baseRecord();
    const a = points[0], b = points[points.length - 1];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const named = autoName(t0, mid);
    const t = applyRenames(t0, named.renames);
    const label = named.label;
    const item = {
      id: uuidv4(),
      pageNumber,
      label,
      quantity: 1,
      productTypeId: '',
      productNameSnapshot: '',
      fixing: '',
      notes: '',
      dropMm: '',
      photos: [],
      status: 'plan',
      // A bay is usually one blind per facet. Default that on when the shape
      // says so — it's the common case, and it's one toggle to undo.
      splitSegments: kind === 'chain' && (measured.segments?.length || 0) > 1,
      createdAt: new Date().toISOString(),
    };
    const m = newMeasurement(points, kind, measured, { tag: 'Width', itemId: item.id });
    persist({
      ...t,
      items: [...(t.items || []), item],
      measurements: [...(t.measurements || []), m],
    });
    setSelectedIds(new Set([item.id, m.id]));
    // Land on the bend handle for a curve, so it's grabbable straight away.
    setActiveHandle(kind === 'arc' ? 1 : points.length - 1);
    setSheetOpen(true);
    // Same on a window: cursor in the box, suggestion selected.
    setFocusSelects(true);
    setFocusLabel(item.id);
    offerPrintedDimension(m);
  }

  /**
   * If the draughtsman printed the dimension right there, offer it.
   * Only ever offered when it's within a few percent of what was measured, so
   * accepting can't move a window somewhere else — it just swaps an approximate
   * scaled reading for the exact number off the drawing.
   */
  function offerPrintedDimension(m) {
    const scale = pageScale(m.pageNumber);
    if (!scale || !textIndex) return;
    // Only straight runs. A printed number next to a bay is one facet or the
    // chord, never the developed length, so "use it" would be wrong.
    if (m.kind && m.kind !== 'line') return;
    const hit = printedDimensionFor(textIndex, {
      midpoint: { x: (m.x1 + m.x2) / 2, y: (m.y1 + m.y2) / 2 },
      measuredMm: m.lengthMm,
      pxPerMm: scale.pxPerMm,
    });
    if (hit && Math.abs(hit.value - m.lengthMm) >= 1) {
      setPrintedPrompt({ measurementId: m.id, measuredMm: m.lengthMm, suggestion: hit });
    }
  }

  function acceptPrintedDimension() {
    const p = printedPrompt;
    setPrintedPrompt(null);
    if (!p) return;
    const t = takeoffRef.current;
    persist({
      ...t,
      measurements: t.measurements.map(m => m.id === p.measurementId
        ? { ...m, lengthMm: p.suggestion.value, printedMm: p.suggestion.value }
        : m),
    });
    toast(`Using the plan's printed ${p.suggestion.value} mm.`);
  }

  function moveVertex(id, index, point, { record = true, lockBend = false } = {}) {
    const t = takeoffRef.current;
    if (!t) return;
    const scale = pageScale(pageNumber);
    persist({
      ...t,
      measurements: t.measurements.map(m => {
        if (m.id !== id) return m;
        let pts = pointsOf(m).map((p, i) => (i === index ? { x: point.x, y: point.y } : p));

        // A curve's three points aren't independent. The apex is pinned to the
        // perpendicular bisector of the chord, so dragging it only ever changes
        // how deep the bow is — and moving an END carries the existing depth
        // across instead of skewing the curve into something you didn't draw.
        if (m.kind === 'arc' && pts.length === 3) {
          if (index === 1) {
            // The apex moves freely: out from the chord to deepen the bow, and
            // along it to shift where the curve is tightest. Hold Shift to drop
            // the sideways half and adjust depth alone.
            const via = lockBend
              ? projectToBisector(pts[0], pts[2], pts[1])
              : viaFromFrame(pts[0], pts[2], chordFrame(pts[0], pts[2], pts[1]));
            pts = [pts[0], via, pts[2]];
          } else {
            // An end moved — rebuild the apex from the shape it already had, so
            // stretching the opening doesn't also redraw the curve.
            const prev = pointsOf(m);
            pts = [pts[0], viaFromFrame(pts[0], pts[2], chordFrame(prev[0], prev[2], prev[1])), pts[2]];
          }
        }

        const a = pts[0], b = pts[pts.length - 1];
        const geom = shapeOf(m.kind || 'line', pts);
        return {
          ...m,
          points: pts,
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          // A dragged vertex means the printed-dimension override no longer
          // describes this run, so it's dropped rather than left stale.
          printedMm: undefined,
          ...(scale ? toMm(geom, scale.pxPerMm) : {}),
        };
      }),
    }, { record, debounce: true });
  }

  /**
   * Bend a curve to an exact radius.
   *
   * Dragging is for eyeballing it against the drawing; this is for when the
   * radius is a known number — off the plan, off a site measure, or off what
   * the supplier can actually bend to. A quoted radius describes an even bow,
   * so this re-centres the apex. A radius under half the chord can't reach both
   * ends, so it's refused rather than silently clamped.
   */
  function setArcRadius(mid, radiusMm) {
    const t = takeoffRef.current;
    const m = (t?.measurements || []).find(x => x.id === mid);
    const scale = pageScale(m?.pageNumber ?? pageNumber);
    if (!m || !scale) return;
    const pts = pointsOf(m);
    if (pts.length !== 3) return;
    const radiusPx = (Number(radiusMm) || 0) * scale.pxPerMm;
    const floorMm = minRadiusFor(pts[0], pts[2]) / scale.pxPerMm;
    if (!(radiusPx > 0) || radiusPx < minRadiusFor(pts[0], pts[2])) {
      toast(`That curve can't be tighter than ${Math.ceil(floorMm)} mm across this span.`);
      return;
    }
    const direction = sagittaOf(pts[0], pts[1], pts[2]) < 0 ? -1 : 1;
    const via = viaForRadius(pts[0], pts[2], radiusPx, direction);
    if (!via) return;
    moveVertex(mid, 1, via);
  }

  /** Flip which way a curve bows, without redrawing it. */
  function flipArc(mid) {
    const t = takeoffRef.current;
    const m = (t?.measurements || []).find(x => x.id === mid);
    if (!m) return;
    const pts = pointsOf(m);
    if (pts.length !== 3) return;
    moveVertex(mid, 1, viaForSagitta(pts[0], pts[2], -sagittaOf(pts[0], pts[1], pts[2])));
  }

  function updateMeasurement(mid, patch) {
    const t = takeoffRef.current;
    persist({ ...t, measurements: t.measurements.map(m => m.id === mid ? { ...m, ...patch } : m) }, { debounce: true });
  }

  function removeMeasurement(mid) {
    const t = takeoffRef.current;
    persist({ ...t, measurements: t.measurements.filter(m => m.id !== mid) });
    setSelectedIds(prev => { const n = new Set(prev); n.delete(mid); return n; });
  }

  function updateItem(itemId, patch) {
    const t = takeoffRef.current;
    persist({ ...t, items: t.items.map(i => i.id === itemId ? { ...i, ...patch } : i) }, { debounce: true });
  }

  /** Deleting a window takes its lines with it — they have no meaning alone. */
  function removeItem(itemId) {
    const t = takeoffRef.current;
    const item = (t.items || []).find(i => i.id === itemId);
    const photos = (item?.photos || []).map(p => p.path).filter(Boolean);
    persist({
      ...t,
      items: t.items.filter(i => i.id !== itemId),
      measurements: t.measurements.filter(m => m.itemId !== itemId),
    });
    if (photos.length) removeTakeoffPhotos(photos);
    setSelectedIds(new Set());
  }

  function deleteSelected() {
    const t = takeoffRef.current;
    if (!t || !selectedIds.size) return;
    const ids = selectedIds;
    const itemIds = new Set((t.items || []).filter(i => ids.has(i.id)).map(i => i.id));
    persist({
      ...t,
      items: (t.items || []).filter(i => !ids.has(i.id)),
      measurements: (t.measurements || []).filter(m => !ids.has(m.id) && !itemIds.has(m.itemId)),
      markers: reindexMarkers((t.markers || []).filter(k => !ids.has(k.id))),
    });
    setSelectedIds(new Set());
  }

  // ── Count markers ───────────────────────────────────────────────────────
  // For the budget-number pass: tap each opening, get a tally, no measuring.
  const reindexMarkers = (markers) => {
    const perPage = new Map();
    return markers.map(k => {
      const n = (perPage.get(k.pageNumber) || 0) + 1;
      perPage.set(k.pageNumber, n);
      return { ...k, index: n };
    });
  };

  function addMarker(base) {
    const t = baseRecord();
    const marker = {
      id: uuidv4(), pageNumber, x: base.x, y: base.y,
      index: pageMarkers.length + 1,
      label: suggestLabel(textIndex, base, { maxDist: 320 }),
      createdAt: new Date().toISOString(),
    };
    persist({ ...t, markers: [...(t.markers || []), marker] });
  }

  function updateMarker(id, patch) {
    const t = takeoffRef.current;
    persist({ ...t, markers: t.markers.map(k => k.id === id ? { ...k, ...patch } : k) }, { debounce: true });
  }

  function removeMarker(id) {
    const t = takeoffRef.current;
    persist({ ...t, markers: reindexMarkers((t.markers || []).filter(k => k.id !== id)) });
  }

  // ── Scale ───────────────────────────────────────────────────────────────
  function saveScale({ pxPerMm, ratio, method, scaleLabel, drawnSheet, knownLengthMm, applyAll }) {
    if (!(pxPerMm > 0)) { toast('That scale doesn’t work out — check the numbers.'); return; }
    const t = baseRecord();
    const line = scaleDialog?.pendingLine;
    const entry = {
      pxPerMm, unit: 'mm', method, ratio, scaleLabel, drawnSheet, knownLengthMm,
      calLine: line ? { x1: line.a.x, y1: line.a.y, x2: line.b.x, y2: line.b.y } : null,
      setAt: new Date().toISOString(),
    };
    const targets = applyAll
      ? Array.from({ length: pdf?.numPages || t.pageCount || 1 }, (_, i) => i + 1)
      : [pageNumber];

    const pages = [...(t.pages || []).filter(p => !targets.includes(p.pageNumber))];
    for (const pn of targets) pages.push({ ...entry, pageNumber: pn, calLine: pn === pageNumber ? entry.calLine : null });

    // Re-scaling only changes the multiplier — the stored pixel endpoints stay
    // valid — so recompute every affected length. A measurement pinned to a
    // printed dimension keeps that number: it came off the drawing, not the ruler.
    const measurements = (t.measurements || []).map(m => (
      targets.includes(m.pageNumber) ? rescaleMeasurement(m, pxPerMm) : m
    ));

    persist({ ...t, pages, measurements });
    setScaleDialog(null);
    setMode('window');
    logActivity(`Plan scale set to ${scaleLabel || `1 mm = ${pxPerMm.toFixed(3)} px`}${applyAll ? ' on all pages' : ` on page ${pageNumber}`}`);
    toast(applyAll ? `Scale applied to all ${targets.length} pages.` : 'Scale set. You can now measure.');
  }

  /** Nudge a page's scale by a factor (the door check's "correct the scale"). */
  function correctScale(factor) {
    const t = takeoffRef.current;
    const cur = pageScale(pageNumber);
    if (!cur) return;
    const pxPerMm = cur.pxPerMm / factor;
    const pages = t.pages.map(p => p.pageNumber === pageNumber
      ? { ...p, pxPerMm, scaleLabel: `${(p.scaleLabel || '').replace(/ \(corrected\)$/, '')} (corrected)` }
      : p);
    const measurements = t.measurements.map(m => (
      m.pageNumber === pageNumber ? rescaleMeasurement(m, pxPerMm) : m
    ));
    persist({ ...t, pages, measurements });
    setDoorCheck(null);
    toast('Scale corrected — every measurement on this page has been updated.');
  }

  // ── Duplicate a page's takeoff ──────────────────────────────────────────
  function duplicatePage({ toPage, prefix, copyScale }) {
    const t = takeoffRef.current;
    if (!t) return;
    const idMap = new Map();
    const items = (t.items || []).filter(i => i.pageNumber === pageNumber).map(i => {
      const id = uuidv4();
      idMap.set(i.id, id);
      return {
        ...i, id, pageNumber: toPage,
        label: prefix ? `${prefix}${i.label || ''}`.trim() : i.label,
        photos: [],                                  // photos belong to the original opening
        createdAt: new Date().toISOString(),
      };
    });
    const measurements = (t.measurements || []).filter(m => m.pageNumber === pageNumber).map(m => ({
      ...m, id: uuidv4(), pageNumber: toPage,
      itemId: m.itemId ? idMap.get(m.itemId) || null : null,
      label: m.itemId ? m.label : (prefix ? `${prefix}${m.label || ''}`.trim() : m.label),
    }));
    const markers = (t.markers || []).filter(k => k.pageNumber === pageNumber).map(k => ({
      ...k, id: uuidv4(), pageNumber: toPage,
    }));

    let pages = t.pages || [];
    if (copyScale && curScale && !pages.some(p => p.pageNumber === toPage)) {
      pages = [...pages, { ...curScale, pageNumber: toPage, calLine: null }];
    }

    persist({
      ...t,
      pages,
      items: [...(t.items || []), ...items],
      measurements: [...(t.measurements || []), ...measurements],
      markers: reindexMarkers([...(t.markers || []), ...markers]),
    });
    setDuplicateOpen(false);
    setPageNumber(toPage);
    toast(`Copied ${items.length} window${items.length === 1 ? '' : 's'} to page ${toPage}.`);
  }

  // ── Upload / revisions ──────────────────────────────────────────────────
  async function handleUpload(file) {
    if (!file) return;
    if (file.type !== 'application/pdf') { toast('Please choose a PDF file.'); return; }
    setUploading(true);
    try {
      const takeoffId = takeoff?.id || uuidv4();
      const filePath = await uploadTakeoffPlan(jobId, takeoffId, file, 1);
      const buf = await file.arrayBuffer();
      const doc = await loadPdf(buf);
      const record = {
        id: takeoffId,
        jobId,
        customerId: job?.customerId || null,
        filePath,
        fileName: file.name,
        pageCount: doc.numPages,
        revision: 1,
        revisionUploadedAt: new Date().toISOString(),
        revisions: [],
        pages: [],
        measurements: [],
        items: [],
        markers: [],
        createdAt: takeoff?.createdAt || new Date().toISOString(),
      };
      history.current = { past: [], future: [] };
      syncHistory();
      persist(record, { record: false });
      setPdf(doc);
      setPageNumber(1);
      setStatus('ready');
      firstPageSize.current = await getPageBaseSize(doc, 1);
      setOfflineReady(true);
      setTextIndexes({});
      logActivity(`Plan uploaded for takeoff — ${file.name} (${doc.numPages} page${doc.numPages === 1 ? '' : 's'})`);
      toast('Plan uploaded.');
    } catch (e) {
      console.error('[takeoff] upload', e);
      toast('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  /**
   * A new drawing arrives — Rev B, Rev C, "as-constructed". Wiping the takeoff
   * every time is why the newest plan never got uploaded; so this compares the
   * page geometry and, when it matches, keeps the markup in place. The
   * superseded revision is retained, never overwritten.
   */
  async function stageReplacement(file) {
    if (!file) return;
    if (file.type !== 'application/pdf') { toast('Please choose a PDF file.'); return; }
    setBusy('Checking the new plan…');
    try {
      const buf = await file.arrayBuffer();
      const doc = await loadPdf(buf);
      const size = await getPageBaseSize(doc, 1);
      const old = firstPageSize.current;
      const compatible = !!old
        && doc.numPages === (pdf?.numPages || takeoff?.pageCount || 0)
        && Math.abs(size.width - old.width) < 2
        && Math.abs(size.height - old.height) < 2;
      setReplacePrompt({ file, buf, doc, compatible });
    } catch (e) {
      console.error('[takeoff] stage replacement', e);
      toast('That PDF could not be opened.');
    } finally {
      setBusy('');
    }
  }

  async function confirmReplacement({ carry, note }) {
    const prompt = replacePrompt;
    setReplacePrompt(null);
    if (!prompt) return;
    setBusy('Uploading revision…');
    try {
      const t = takeoffRef.current;
      const nextRevision = (Number(t.revision) || 1) + 1;
      const filePath = await uploadTakeoffPlan(jobId, t.id, prompt.file, nextRevision);
      const superseded = {
        id: uuidv4(),
        revision: Number(t.revision) || 1,
        fileName: t.fileName,
        filePath: t.filePath,
        pageCount: t.pageCount,
        uploadedAt: t.revisionUploadedAt || t.createdAt,
        supersededAt: new Date().toISOString(),
        uploadedBy: displayName,
        note,
      };
      const keep = carry && prompt.compatible;
      const record = {
        ...t,
        filePath,
        fileName: prompt.file.name,
        pageCount: prompt.doc.numPages,
        revision: nextRevision,
        revisionUploadedAt: new Date().toISOString(),
        revisionNote: note,
        revisions: [...(t.revisions || []), superseded],
        pages: keep ? t.pages : [],
        measurements: keep ? t.measurements : [],
        items: keep ? t.items : [],
        markers: keep ? t.markers : [],
      };
      history.current = { past: [], future: [] };
      syncHistory();
      persist(record, { record: false });
      setPdf(prompt.doc);
      setPageNumber(1);
      setStatus('ready');
      firstPageSize.current = await getPageBaseSize(prompt.doc, 1);
      setTextIndexes({});
      setOfflineReady(true);
      logActivity(`Plan revision r${nextRevision} uploaded — ${prompt.file.name}${note ? ` (${note})` : ''}${keep ? ', measurements carried across' : ', takeoff restarted'}`);
      toast(keep ? 'Revision uploaded — check each measurement against the new drawing.' : 'Revision uploaded.');
    } catch (e) {
      console.error('[takeoff] revision', e);
      toast('Upload failed. Please try again.');
    } finally {
      setBusy('');
    }
  }

  /** Swap an earlier revision back to current (the new plan was the wrong one). */
  async function restoreRevision(rev) {
    setRevisionsOpen(false);
    setBusy('Loading revision…');
    try {
      const t = takeoffRef.current;
      const buf = await downloadTakeoffPlan(rev.filePath);
      if (!buf) { toast('That revision’s file could not be loaded.'); return; }
      const doc = await loadPdf(buf);
      const current = {
        id: uuidv4(),
        revision: Number(t.revision) || 1,
        fileName: t.fileName,
        filePath: t.filePath,
        pageCount: t.pageCount,
        uploadedAt: t.revisionUploadedAt || t.createdAt,
        supersededAt: new Date().toISOString(),
        uploadedBy: displayName,
        note: 'rolled back',
      };
      persist({
        ...t,
        filePath: rev.filePath,
        fileName: rev.fileName,
        pageCount: rev.pageCount,
        revision: rev.revision,
        revisionUploadedAt: new Date().toISOString(),
        revisions: [...(t.revisions || []).filter(r => r.id !== rev.id), current],
      }, { record: false });
      setPdf(doc);
      setPageNumber(1);
      firstPageSize.current = await getPageBaseSize(doc, 1);
      setTextIndexes({});
      logActivity(`Plan rolled back to revision r${rev.revision} — ${rev.fileName}`);
      toast(`Revision r${rev.revision} is now current.`);
    } catch (e) {
      console.error('[takeoff] restore revision', e);
      toast('Could not switch revision.');
    } finally {
      setBusy('');
    }
  }

  function handleDeleteTakeoff() {
    if (!takeoff) return;
    deleteTakeoff(takeoff.id);
    setConfirmDelete(false);
    setTakeoff(null); setPdf(null); setPageBaseSize(null); setStatus('empty');
    history.current = { past: [], future: [] };
    syncHistory();
    logActivity('Plan takeoff deleted');
    toast('Plan deleted.');
  }

  // ── Photos ──────────────────────────────────────────────────────────────
  async function addPhoto(itemId, file) {
    const t = takeoffRef.current;
    if (!t) return;
    setPhotoBusyId(itemId);
    try {
      const photoId = uuidv4();
      const path = await uploadTakeoffPhoto(jobId, t.id, photoId, file);
      const photo = { id: photoId, path, addedAt: new Date().toISOString(), addedBy: displayName };
      persist({
        ...takeoffRef.current,
        items: takeoffRef.current.items.map(i => i.id === itemId
          ? { ...i, photos: [...(i.photos || []), photo] }
          : i),
      });
    } catch (e) {
      console.error('[takeoff] photo', e);
      toast('Photo upload failed.');
    } finally {
      setPhotoBusyId(null);
    }
  }

  function removePhoto(itemId, photo) {
    const t = takeoffRef.current;
    persist({
      ...t,
      items: t.items.map(i => i.id === itemId
        ? { ...i, photos: (i.photos || []).filter(p => p.id !== photo.id) }
        : i),
    });
    removeTakeoffPhotos([photo.path]);
  }

  // ── Export ──────────────────────────────────────────────────────────────
  async function exportAnnotated() {
    const t = takeoffRef.current;
    if (!t?.filePath) return;
    setMenuOpen(false);
    setBusy('Building the annotated plan…');
    try {
      const buf = await downloadTakeoffPlan(t.filePath);
      if (!buf) { toast('Could not load the plan to export.'); return; }
      const blob = await buildAnnotatedPlan(buf, t, {
        jobNumber: job?.jobNumber,
        customerName: customer?.name,
        siteAddress: job?.siteAddress || customer?.address,
        preparedBy: displayName,
      });
      const name = `Takeoff - ${job?.jobNumber || customer?.name || 'plan'}.pdf`.replace(/[\\/:*?"<>|]/g, '');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      logActivity(`Annotated takeoff plan exported (${name})`);
      toast('Annotated plan downloaded.');
    } catch (e) {
      console.error('[takeoff] export', e);
      toast(e?.message || 'Export failed.');
    } finally {
      setBusy('');
    }
  }

  async function exportClientPlan() {
    const t = takeoffRef.current;
    if (!t?.filePath) return;
    setBusy('Building the client plan…');
    try {
      const buf = await downloadTakeoffPlan(t.filePath);
      if (!buf) { toast('Could not load the plan to export.'); return; }
      const blob = await buildClientPlan(buf, t, buildClientSchedule(t), {
        jobNumber: job?.jobNumber,
        customerName: customer?.name,
        siteAddress: job?.siteAddress || customer?.address,
        showSizes: clientShowSizes,
      });
      const name = `Window schedule - ${customer?.name || job?.jobNumber || 'plan'}.pdf`.replace(/[\\/:*?"<>|]/g, '');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      logActivity(`Client window schedule exported (${name})`);
      toast('Client plan downloaded.');
    } catch (e) {
      console.error('[takeoff] client export', e);
      toast(e?.message || 'Export failed.');
    } finally {
      setBusy('');
    }
  }

  const logActivity = useCallback((message) => {
    if (!jobId) return;
    addActivity({ jobId, type: 'takeoff', message, user: displayName || 'Someone' });
  }, [jobId, displayName]);

  // ── Keyboard ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (meta && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (e.key === 'Escape') {
        if (drawing) cancelDraft();
        else { setSelectedIds(new Set()); setFocusLabel(null); }
        return;
      }
      // Enter closes an open bay run — the keyboard twin of the Finish button.
      if (e.key === 'Enter' && canFinishDraft) { e.preventDefault(); finishDraft(); return; }
      // While drawing, Backspace drops the last point instead of deleting a
      // committed measurement — one mis-tap in a five-facet bay shouldn't
      // restart the whole run.
      if (e.key === 'Backspace' && drawing) {
        e.preventDefault();
        setDraftPoints(pts => pts.slice(0, -1));
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size) {
        e.preventDefault(); deleteSelected(); return;
      }
      // Tab steps through the vertices of the selected run, so the arrow keys
      // can nudge any of them — not just the two ends.
      if (e.key === 'Tab' && selectedIds.size === 1) {
        e.preventDefault();
        const m = (takeoffRef.current?.measurements || []).find(x => x.id === [...selectedIds][0]);
        const count = m ? pointsOf(m).length : 2;
        setActiveHandle(h => (h + 1) % count);
        return;
      }
      // Arrow-key nudge of the active endpoint — the last 2 px of precision that
      // a finger on glass can't give you.
      const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (nudge && selectedIds.size === 1) {
        const id = [...selectedIds][0];
        const m = (takeoffRef.current?.measurements || []).find(x => x.id === id);
        if (!m) return;
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        const pts = pointsOf(m);
        const idx = Math.min(activeHandle, pts.length - 1);
        const cur = pts[idx];
        moveVertex(id, idx, { x: cur.x + nudge[0] * step, y: cur.y + nudge[1] * step });
        return;
      }
      if (e.key === '?') { e.preventDefault(); setShortcutsOpen(v => !v); return; }
      if (meta) return;

      const k = e.key.toLowerCase();

      // View controls work in both views — a client is being shown the plan on
      // this same screen, and zooming is the first thing anyone reaches for.
      if (k === 'f') { e.preventDefault(); fitPage(); return; }
      if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomButton(ZOOM_STEP); return; }
      if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomButton(1 / ZOOM_STEP); return; }
      if (e.key === '[') { e.preventDefault(); setPageNumber(p => Math.max(1, p - 1)); return; }
      if (e.key === ']') { e.preventDefault(); setPageNumber(p => Math.min(pageCountRef.current, p + 1)); return; }
      if (k === 'p') { e.preventDefault(); setClientView(v => !v); cancelDraft(); setClientPick(null); return; }

      // Everything below edits the takeoff, so it stays out of the client view.
      if (clientView) return;

      if (k === 'e') { e.preventDefault(); exportAnnotated(); return; }
      if (k === 'd') { e.preventDefault(); setDuplicateOpen(true); return; }
      if (k === 'g') { setSnapOn(v => !v); return; }
      if (k === 'o') { setOrthoOn(v => !v); return; }

      const modeKey = { v: 'pan', w: 'window', m: 'measure', b: 'chain', r: 'arc', c: 'count', s: 'calibrate' }[k];
      if (modeKey) { setMode(modeKey); cancelDraft(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, draftPoints, canFinishDraft, selectedIds, activeHandle]);

  // ── Derived for render ──────────────────────────────────────────────────
  const pageCount = pdf?.numPages || takeoff?.pageCount || 1;
  pageCountRef.current = pageCount;
  const allCounts = {
    items: (takeoff?.items || []).length,
    measurements: (takeoff?.measurements || []).length,
    // Measurements not attached to a window — they count as marks in their own
    // right, and the panel's totals would otherwise pretend they don't exist.
    looseMeasurements: (takeoff?.measurements || []).filter(m => !m.itemId).length,
    markers: (takeoff?.markers || []).length,
  };

  // Budget range from the business's own quote history. Recomputed from the
  // takeoff rows so it always matches what the measure sheet will receive.
  const rateCard = useMemo(() => buildRateCard(), []);
  const estimate = useMemo(() => {
    if (!takeoff) return null;
    return estimateTakeoff(takeoffRows(takeoff), rateCard);
  }, [takeoff, rateCard]);

  // The customer-facing read of the same data. Built from `takeoffRows`, so it
  // can never drift from what actually goes on the measure sheet.
  const clientSchedule = useMemo(
    () => (clientView ? buildClientSchedule(takeoff) : { entries: [], palette: new Map() }),
    [clientView, takeoff]
  );

  // Room labels near whatever is selected, for the label suggestion chips.
  const roomSuggestions = useMemo(() => {
    if (!textIndex || selectedIds.size !== 1) return [];
    const id = [...selectedIds][0];
    const item = (takeoff?.items || []).find(i => i.id === id);
    const m = (takeoff?.measurements || []).find(x => x.id === id)
          || (takeoff?.measurements || []).find(x => x.itemId === item?.id);
    if (!m) return [];
    return nearestRooms(textIndex, { x: (m.x1 + m.x2) / 2, y: (m.y1 + m.y2) / 2 }, { limit: 3, maxDist: 600 });
  }, [textIndex, selectedIds, takeoff]);

  const flagged = useMemo(
    () => pageMeasurements.filter(m => plausibility(m.tag, m.lengthMm) === 'hard').length,
    [pageMeasurements]
  );

  /** What owns this id — the window if it has one, otherwise the mark itself. */
  const ownerOf = useCallback((id) => {
    const t = takeoffRef.current;
    if (!t) return null;
    const item = (t.items || []).find(i => i.id === id);
    if (item) return item;
    const m = (t.measurements || []).find(x => x.id === id);
    if (m) return m.itemId ? (t.items || []).find(i => i.id === m.itemId) || m : m;
    return (t.markers || []).find(k => k.id === id) || null;
  }, []);

  const selectOne = (id, additive = false) => {
    setSelectedIds(prev => {
      if (!additive) return new Set([id]);
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
    setActiveHandle(1);

    if (additive) { setFocusLabel(null); return; }
    // Only when it has no name yet — stealing the cursor off someone who is
    // just looking at a measurement they already labelled would be worse than
    // not helping at all.
    const owner = ownerOf(id);
    const unnamed = owner && !(owner.label || '').trim();
    setFocusSelects(false);
    setFocusLabel(unnamed ? owner.id : null);
    if (unnamed) setSheetOpen(true);
  };

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
            {!clientView && takeoff?.revision > 1 && (
              <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-semibold">r{takeoff.revision}</span>
            )}
          </h1>
          <p className="text-xs text-slate-400 truncate">{customer?.name} · {job.jobNumber}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!online && (
            <span className="text-[11px] text-amber-600 flex items-center gap-1" title="Working offline — changes sync when you're back">
              <WifiOff size={12} /> <span className="hidden sm:inline">Offline</span>
            </span>
          )}
          {takeoff && status === 'ready' && (
            <>
              {/* The same takeoff, read two ways: the marked-up drawing you work
                  on, and the numbered schedule you turn the screen around and
                  show the customer. */}
              <button
                onClick={() => { setClientView(v => !v); cancelDraft(); setClientPick(null); }}
                title={clientView ? 'Back to the working markup' : 'Show this as the customer sees it'}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  clientView ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {clientView ? <PenLine size={14} /> : <Eye size={14} />}
                <span className="hidden sm:inline">{clientView ? 'Working view' : 'Client view'}</span>
                <kbd className={`hidden md:inline text-[9px] font-semibold leading-none px-1 py-0.5 rounded border ${
                  clientView ? 'border-white/40 text-white/80' : 'border-slate-200 text-slate-400'
                }`}>P</kbd>
              </button>
              <span
                className={`text-[11px] items-center gap-1 ${clientView ? 'hidden' : 'flex'} ${offlineReady ? 'text-green-600' : 'text-slate-400'}`}
                title={offlineReady ? 'This plan is saved on this device for on-site use' : 'Not yet saved for offline use'}
              >
                {offlineReady ? <CheckCircle2 size={12} /> : <CloudOff size={12} />}
                <span className="hidden md:inline">{offlineReady ? 'Offline ready' : 'Online only'}</span>
              </span>
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(v => !v)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500"
                  aria-label="More actions"
                >
                  <MoreHorizontal size={16} />
                </button>
                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
                    <div className="absolute right-0 top-full mt-1 z-40 w-56 bg-white rounded-xl shadow-xl border border-slate-100 py-1 text-sm">
                      <MenuItem icon={Download} onClick={exportAnnotated} hint="E">Export annotated plan</MenuItem>
                      <MenuItem icon={Eye} onClick={() => { setMenuOpen(false); exportClientPlan(); }}>Export client schedule…</MenuItem>
                      <MenuItem icon={Copy} onClick={() => { setMenuOpen(false); setDuplicateOpen(true); }} hint="D">Copy page takeoff…</MenuItem>
                      <MenuItem icon={DoorOpen} onClick={() => { setMenuOpen(false); setMode('verify'); cancelDraft(); toast('Measure a door leaf to check the scale.'); }} disabled={!curScale}>
                        Check scale against a door
                      </MenuItem>
                      <MenuItem icon={History} onClick={() => { setMenuOpen(false); setRevisionsOpen(true); }}>
                        Revisions ({(takeoff.revisions || []).length + 1})
                      </MenuItem>
                      <label className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer text-slate-700">
                        <RefreshCw size={14} className="text-slate-400" /> Upload new revision…
                        <input type="file" accept="application/pdf" className="hidden"
                          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; setMenuOpen(false); stageReplacement(f); }} />
                      </label>
                      <div className="h-px bg-slate-100 my-1" />
                      <MenuItem icon={Keyboard} onClick={() => { setMenuOpen(false); setShortcutsOpen(true); }} hint="?">Keyboard shortcuts</MenuItem>
                      <MenuItem icon={Trash2} danger onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}>Delete plan</MenuItem>
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      {status === 'empty' && <UploadPane uploading={uploading} onFile={handleUpload} />}
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
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            {/* Toolbar */}
            <div className="flex items-center gap-1.5 px-3 py-2 border-b border-slate-100 bg-white overflow-x-auto">
              {clientView ? (
                <span className="text-xs text-slate-500 flex items-center gap-1.5 pr-2">
                  <Eye size={13} className="text-slate-400" /> Client view — nothing here can be edited
                </span>
              ) : (
                <>
              <ToolBtn active={mode === 'pan'} onClick={() => { setMode('pan'); cancelDraft(); }} icon={Hand} label="Pan" hint="V" />
              <ToolBtn active={mode === 'window'} onClick={() => { setMode('window'); cancelDraft(); }} icon={Square} label="Window" hint="W" disabled={!curScale} />
              <ToolBtn active={mode === 'measure'} onClick={() => { setMode('measure'); cancelDraft(); }} icon={Ruler} label="Measure" hint="M" disabled={!curScale} />
              <ToolBtn active={mode === 'chain'} onClick={() => { setMode('chain'); cancelDraft(); }} icon={Waypoints} label="Bay" hint="B" disabled={!curScale} />
              <ToolBtn active={mode === 'arc'} onClick={() => { setMode('arc'); cancelDraft(); }} icon={Spline} label="Curve" hint="R" disabled={!curScale} />
              <ToolBtn active={mode === 'count'} onClick={() => { setMode('count'); cancelDraft(); }} icon={Hash} label="Count" hint="C" />
              <ToolBtn active={mode === 'calibrate'} onClick={() => { setMode('calibrate'); cancelDraft(); }} icon={Crosshair} label="Scale" hint="S" />

              <div className="w-px h-5 bg-slate-200 mx-1" />
              <IconBtn onClick={() => setSnapOn(v => !v)} active={snapOn} title={`${snapOn ? 'Snapping on — endpoints and linework' : 'Snapping off'} (G)`}><Magnet size={15} /></IconBtn>
              <IconBtn onClick={() => setOrthoOn(v => !v)} active={orthoOn} title="Lock to horizontal / vertical (O, or hold Shift)">
                <span className="text-[11px] font-bold px-0.5">90°</span>
              </IconBtn>
              <IconBtn onClick={undo} disabled={!historyCounts.past} title="Undo (⌘Z)"><Undo2 size={15} /></IconBtn>
              <IconBtn onClick={redo} disabled={!historyCounts.future} title="Redo (⇧⌘Z)"><Redo2 size={15} /></IconBtn>
                </>
              )}

              <div className="w-px h-5 bg-slate-200 mx-1" />
              <button onClick={() => zoomButton(1 / ZOOM_STEP)} className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="Zoom out (−)"><ZoomOut size={16} /></button>
              <span className="text-xs text-slate-500 tabular-nums w-12 text-center">{Math.round(view.scale * 100)}%</span>
              <button onClick={() => zoomButton(ZOOM_STEP)} className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="Zoom in (+)"><ZoomIn size={16} /></button>
              <button onClick={() => fitPage()} className="p-1.5 rounded hover:bg-slate-100 text-slate-600" title="Fit page (F)"><Maximize2 size={16} /></button>

              {pageCount > 1 && (
                <>
                  <div className="w-px h-5 bg-slate-200 mx-1" />
                  <button disabled={pageNumber <= 1} onClick={() => setPageNumber(p => Math.max(1, p - 1))} title="Previous page ([)" className="p-1.5 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30"><ChevronLeft size={16} /></button>
                  {/* keyed: a remount keeps the typed draft in step with the chevrons */}
                  <PageJump key={pageNumber} pageNumber={pageNumber} pageCount={pageCount} onGo={setPageNumber} />
                  <button disabled={pageNumber >= pageCount} onClick={() => setPageNumber(p => Math.min(pageCount, p + 1))} title="Next page (])" className="p-1.5 rounded hover:bg-slate-100 text-slate-600 disabled:opacity-30"><ChevronRight size={16} /></button>
                </>
              )}

              <div className="ml-auto flex items-center gap-2 pl-2 whitespace-nowrap">
                {clientView ? null : curScale ? (
                  <button
                    onClick={() => setScaleDialog({})}
                    className="text-xs text-green-600 flex items-center gap-1 hover:underline"
                    title="Change this page's scale"
                  >
                    <Target size={12} /> {curScale.scaleLabel || `1 mm = ${curScale.pxPerMm.toFixed(3)} px`}
                  </button>
                ) : (
                  <button onClick={() => setScaleDialog({})} className="text-xs text-amber-600 flex items-center gap-1 hover:underline">
                    <AlertTriangle size={12} /> Scale not set
                  </button>
                )}
              </div>
            </div>

            {/* Mode hint */}
            <div className="px-3 py-1.5 text-xs text-slate-500 bg-slate-50/60 border-b border-slate-100 flex items-center gap-2">
              {clientView && (
                <span className="truncate">
                  Every numbered pin is one opening we&rsquo;ve allowed for. Tap a pin, or a line in the list, to see which is which.
                </span>
              )}
              <span className={`truncate ${clientView ? 'hidden' : ''}`}>
                {dropTarget && 'Drag across the DROP on an elevation sheet for this window.'}
                {!dropTarget && mode === 'pan' && 'Drag to pan · scroll or pinch to zoom.'}
                {!dropTarget && mode === 'window' && (drawing ? 'Tap the other side of the opening.' : 'Tap each side of a window — the room name is filled in for you.')}
                {!dropTarget && mode === 'measure' && (drawing ? 'Tap the second point.' : 'Tap two points for a loose measurement.')}
                {!dropTarget && mode === 'chain' && (draftPoints.length >= 2
                  ? `${draftPoints.length - 1} facet${draftPoints.length === 2 ? '' : 's'} — keep tapping corners, then Finish (or Enter). Backspace undoes the last point.`
                  : drawing ? 'Tap the next corner of the bay.' : 'Trace a bay or splayed window corner by corner — every facet is measured, and the total is the real track length.')}
                {!dropTarget && mode === 'arc' && (drawing
                  ? 'Tap the far end — then drag the handle at its middle to shape it.'
                  : 'Tap the two ends, then drag the round handle at its middle — out to bow it, sideways to shift where it curves. Shift locks it to depth only; or type an exact radius in the panel.')}
                {!dropTarget && mode === 'count' && 'Tap each opening to count it. No scale needed.'}
                {!dropTarget && mode === 'calibrate' && (drawing ? 'Tap the other end of the known dimension.' : 'Tap two ends of a known dimension — or use a scale preset.')}
                {!dropTarget && mode === 'verify' && (drawing ? 'Tap the other side of the door.' : 'Tap each side of a door leaf to check the scale.')}
              </span>
              {!clientView && flagged > 0 && (
                <span className="ml-auto flex-shrink-0 text-red-600 flex items-center gap-1">
                  <AlertTriangle size={12} /> {flagged} implausible — check the scale
                </span>
              )}
              {!clientView && textIndex?.rooms?.length > 0 && flagged === 0 && (
                <span className="ml-auto flex-shrink-0 text-slate-400 hidden sm:flex items-center gap-1">
                  {textIndex.rooms.length} room labels read from the plan
                </span>
              )}
            </div>

            {/* Stage */}
            <div
              ref={stageRef}
              className="relative flex-1 overflow-hidden bg-slate-200 touch-none select-none"
              style={{ cursor: mode === 'pan' ? 'grab' : 'crosshair' }}
              onPointerDown={onPointerDown}
              onPointerMove={(e) => { onPointerMove(e); onHoverMove(e); }}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onContextMenu={(e) => e.preventDefault()}
            >
              {/* PDF canvas in a transform wrapper (bridges raster→live scale) */}
              <div className="absolute top-0 left-0" style={wrapperStyle}>
                <canvas ref={canvasRef} className="block shadow-lg bg-white" />
              </div>

              {/* Client view replaces the working markup entirely — measurement
                  lines are working marks, and leaving them on invites questions
                  about the drawing rather than about the quote. */}
              {clientView ? (
                <ClientPins
                  entries={clientSchedule.entries.filter(e => e.pageNumber === pageNumber)}
                  palette={clientSchedule.palette}
                  baseToScreen={baseToScreen}
                  viewScale={view.scale}
                  selectedKey={clientPick}
                  onSelect={setClientPick}
                />
              ) : (
              <Overlay
                baseToScreen={baseToScreen}
                viewScale={view.scale}
                measurements={pageMeasurements}
                markers={pageMarkers}
                items={pageItems}
                selectedIds={selectedIds}
                onSelect={selectOne}
                onHandleDown={onHandleDown}
                activeHandle={activeHandle}
                draftPoints={draftPoints}
                hover={hover}
                mode={mode}
                pxPerMm={curScale?.pxPerMm}
              />
              )}

              {/* Finish is only reachable while a run is open, and it sits over
                  the plan so a thumb can reach it without leaving the drawing. */}
              {!clientView && canFinishDraft && (
                <div
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex gap-2"
                  // The stage captures the pointer on pointerdown, which would
                  // swallow the click and place another point instead. Stop the
                  // gesture here so these behave like the buttons they are.
                  onPointerDown={e => e.stopPropagation()}
                  onPointerUp={e => e.stopPropagation()}
                >
                  <button
                    onClick={finishDraft}
                    className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-semibold shadow-lg hover:bg-amber-400"
                  >
                    <Check size={15} /> Finish run · {draftPoints.length - 1} facet{draftPoints.length === 2 ? '' : 's'}
                  </button>
                  <button
                    onClick={() => setDraftPoints(pts => pts.slice(0, -1))}
                    className="px-3 py-2.5 rounded-xl bg-white text-slate-600 text-sm font-medium shadow-lg hover:bg-slate-50"
                  >
                    Undo point
                  </button>
                </div>
              )}

              {!clientView && printedPrompt && (
                <PrintedDimensionPrompt
                  suggestion={printedPrompt.suggestion}
                  measuredMm={printedPrompt.measuredMm}
                  onAccept={acceptPrintedDimension}
                  onDismiss={() => setPrintedPrompt(null)}
                />
              )}

              {busy && (
                <div className="absolute inset-0 z-30 bg-white/70 flex items-center justify-center gap-2 text-sm text-slate-600">
                  <Loader2 size={18} className="animate-spin text-amber-500" /> {busy}
                </div>
              )}
            </div>

            {/* Panel, collapsed under the plan — phones and iPads have no room
                for the side panel, and it used to just vanish there. */}
            {clientView ? (
              <ClientScheduleTray
                entries={clientSchedule.entries}
                palette={clientSchedule.palette}
                pageNumber={pageNumber}
                selectedKey={clientPick}
                onSelect={setClientPick}
                showSizes={clientShowSizes}
              />
            ) : (
            <ItemPanel
              layout="sheet"
              open={sheetOpen}
              onToggle={() => setSheetOpen(o => !o)}
              pageNumber={pageNumber}
              items={pageItems}
              measurements={pageMeasurements}
              markers={pageMarkers}
              allCounts={allCounts}
              selectedIds={selectedIds}
              onSelect={selectOne}
              hasScale={!!curScale}
              onCalibrate={() => setScaleDialog({})}
              productTypes={productTypes}
              roomSuggestions={roomSuggestions}
              estimate={estimate}
              onUpdateItem={updateItem}
              onRemoveItem={removeItem}
              onUpdateMeasurement={updateMeasurement}
              onRemoveMeasurement={removeMeasurement}
              onUpdateMarker={updateMarker}
              onRemoveMarker={removeMarker}
              onMeasureDrop={(id) => { setDropTarget(id); setMode('measure'); cancelDraft(); setSheetOpen(false); }}
              onAddPhoto={addPhoto}
              onRemovePhoto={removePhoto}
              onSetArcRadius={setArcRadius}
              onFlipArc={flipArc}
              focusLabelId={focusLabel}
            focusSelectsAll={focusSelects}
              focusSelectsAll={focusSelects}
              onLabelFocused={clearLabelFocus}
              photoBusyId={photoBusyId}
            />
            )}
          </div>

          {/* Side panel — wide screens only */}
          {clientView ? (
            <ClientSchedule
              entries={clientSchedule.entries}
              palette={clientSchedule.palette}
              pageNumber={pageNumber}
              pageCount={pageCount}
              showSizes={clientShowSizes}
              onToggleSizes={setClientShowSizes}
              selectedKey={clientPick}
              onSelect={setClientPick}
              onExport={exportClientPlan}
              exporting={!!busy}
              customerName={customer?.name}
              jobNumber={job?.jobNumber}
            />
          ) : (
          <ItemPanel
            pageNumber={pageNumber}
            items={pageItems}
            measurements={pageMeasurements}
            markers={pageMarkers}
            allCounts={allCounts}
            selectedIds={selectedIds}
            onSelect={selectOne}
            hasScale={!!curScale}
            onCalibrate={() => setScaleDialog({})}
            productTypes={productTypes}
            roomSuggestions={roomSuggestions}
            estimate={estimate}
            onUpdateItem={updateItem}
            onRemoveItem={removeItem}
            onUpdateMeasurement={updateMeasurement}
            onRemoveMeasurement={removeMeasurement}
            onUpdateMarker={updateMarker}
            onRemoveMarker={removeMarker}
            onMeasureDrop={(id) => { setDropTarget(id); setMode('measure'); cancelDraft(); }}
            onAddPhoto={addPhoto}
            onRemovePhoto={removePhoto}
            onSetArcRadius={setArcRadius}
            onFlipArc={flipArc}
            focusLabelId={focusLabel}
            focusSelectsAll={focusSelects}
            onLabelFocused={clearLabelFocus}
            photoBusyId={photoBusyId}
          />
          )}
        </div>
      )}

      {/* Dialogs */}
      {scaleDialog && (
        <ScaleDialog
          baseSize={pageBaseSize}
          pageNumber={pageNumber}
          pageCount={pageCount}
          existing={curScale}
          pendingLine={scaleDialog.pendingLine}
          onCancel={() => setScaleDialog(null)}
          onNeedLine={() => { setScaleDialog(null); setMode('calibrate'); cancelDraft(); toast('Draw a line across something you know the length of.'); }}
          onSave={saveScale}
        />
      )}
      {doorCheck && (
        <DoorCheckDialog
          measuredMm={doorCheck.measuredMm}
          onCancel={() => setDoorCheck(null)}
          onAccept={() => setDoorCheck(null)}
          onFix={correctScale}
          onSetScale={() => { setDoorCheck(null); setScaleDialog({}); }}
        />
      )}
      {duplicateOpen && (
        <DuplicatePageDialog
          fromPage={pageNumber}
          pageCount={pageCount}
          itemCount={pageItems.length}
          onCancel={() => setDuplicateOpen(false)}
          onConfirm={duplicatePage}
        />
      )}
      {replacePrompt && (
        <ReplacePlanDialog
          fileName={replacePrompt.file.name}
          compatible={replacePrompt.compatible}
          measurementCount={(takeoff?.measurements || []).length}
          onCancel={() => setReplacePrompt(null)}
          onConfirm={confirmReplacement}
        />
      )}
      {revisionsOpen && takeoff && (
        <RevisionsDialog takeoff={takeoff} onCancel={() => setRevisionsOpen(false)} onRestore={restoreRevision} />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {confirmDelete && takeoff && (
        <ConfirmDeleteDialog
          measurements={takeoff.measurements?.length || 0}
          pages={takeoff.pages?.length || 0}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={handleDeleteTakeoff}
        />
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────
function ToolBtn({ active, onClick, icon: Icon, label, disabled, hint }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'Set the scale first' : `${label}${hint ? ` (${hint})` : ''}`}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 flex-shrink-0 ${
        active ? 'bg-amber-500 text-white' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      <Icon size={14} /> <span className="hidden sm:inline">{label}</span>
      {/* The key printed on the button, not hidden in a tooltip — that's the
          difference between a shortcut people discover and one they don't. */}
      {hint && (
        <kbd className={`hidden md:inline text-[9px] font-semibold leading-none px-1 py-0.5 rounded border ${
          active ? 'border-white/40 text-white/80' : 'border-slate-200 text-slate-400'
        }`}>
          {hint}
        </kbd>
      )}
    </button>
  );
}

function IconBtn({ active, disabled, onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded flex-shrink-0 disabled:opacity-30 transition-colors ${
        active ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  );
}

function MenuItem({ icon: Icon, children, onClick, disabled, danger, hint }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-40 ${
        danger ? 'text-red-600' : 'text-slate-700'
      }`}
    >
      <Icon size={14} className={danger ? 'text-red-400' : 'text-slate-400'} />
      <span className="flex-1">{children}</span>
      {hint && <kbd className="text-[9px] font-semibold px-1 py-0.5 rounded border border-slate-200 text-slate-400">{hint}</kbd>}
    </button>
  );
}

/** Every shortcut in one place, reachable with `?` or from the menu. */
function ShortcutsDialog({ onClose }) {
  const groups = [
    ['Tools', [
      ['V', 'Pan'], ['W', 'Window'], ['M', 'Measure'], ['B', 'Bay'],
      ['R', 'Curve'], ['C', 'Count'], ['S', 'Set scale'],
    ]],
    ['While drawing', [
      ['Shift', 'Lock to horizontal / vertical'],
      ['Enter', 'Finish a bay run'],
      ['Backspace', 'Undo the last point'],
      ['Esc', 'Cancel'],
    ]],
    ['Selection', [
      ['Tab', 'Step through a run’s points'],
      ['↑ ↓ ← →', 'Nudge the active point (Shift = ×5)'],
      ['Delete', 'Delete what’s selected'],
      ['⌘Z / ⇧⌘Z', 'Undo / redo'],
    ]],
    ['View', [
      ['+ / −', 'Zoom in / out'], ['F', 'Fit page'],
      ['[ / ]', 'Previous / next page'], ['P', 'Client view'],
      ['Pinch', 'Zoom the plan'], ['Two-finger drag', 'Pan the plan'],
    ]],
    ['Options', [
      ['G', 'Snapping on / off'], ['O', 'Ortho lock on / off'],
      ['E', 'Export annotated plan'], ['D', 'Copy this page’s takeoff'],
      ['?', 'This list'],
    ]],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Keyboard size={16} className="text-amber-500" /> Keyboard shortcuts
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="px-5 pb-5 overflow-y-auto grid sm:grid-cols-2 gap-x-6 gap-y-5">
          {groups.map(([title, rows]) => (
            <div key={title}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1.5">{title}</p>
              <div className="space-y-1">
                {rows.map(([key, label]) => (
                  <div key={key} className="flex items-center gap-3 text-xs">
                    <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-600 font-semibold text-[10px] whitespace-nowrap min-w-[2.4rem] text-center">
                      {key}
                    </kbd>
                    <span className="text-slate-600">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
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
          <p className="text-xs text-slate-400 mt-1">Architectural plan for this job · multi-page supported · saved for offline use</p>
        </div>
        <span className="text-xs flex items-center gap-1 text-amber-600"><FileText size={12} /> Choose PDF</span>
        <input type="file" accept="application/pdf" className="hidden" disabled={uploading} onChange={e => onFile(e.target.files?.[0])} />
      </label>
    </div>
  );
}

// Page readout that doubles as a jump box — paging through a 30-sheet plan set
// with the chevrons is slow. Typing commits on Enter or blur; anything out of
// range or non-numeric snaps back to the page you're on.
function PageJump({ pageNumber, pageCount, onGo }) {
  // Keyed on pageNumber by the caller, so a page change from anywhere else
  // remounts this and the draft starts from the new page.
  const [draft, setDraft] = useState(String(pageNumber));

  const commit = () => {
    const n = parseInt(draft, 10);
    if (!Number.isFinite(n) || n < 1 || n > pageCount) { setDraft(String(pageNumber)); return; }
    setDraft(String(n));
    if (n !== pageNumber) onGo(n);
  };

  return (
    <span className="text-xs text-slate-500 whitespace-nowrap flex items-center gap-1">
      Page
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={draft}
        aria-label={`Page number, 1 to ${pageCount}`}
        onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onFocus={e => e.target.select()}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
          if (e.key === 'Escape') { setDraft(String(pageNumber)); e.currentTarget.blur(); }
        }}
        className="w-9 text-center tabular-nums border border-slate-200 rounded px-1 py-0.5 text-xs text-slate-700 bg-white outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
      />
      /{pageCount}
    </span>
  );
}
