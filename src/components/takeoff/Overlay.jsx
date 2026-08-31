import { plausibility } from '../../lib/planScale';
import { arcPathD, arcMidpoint, arcMetrics, pointsOf, polylineMetrics } from '../../lib/takeoffGeometry';

const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const fmtMm = (mm) => (mm == null ? '—' : `${Math.round(mm)} mm`);

const STROKE = {
  normal:   '#0f766e',
  selected: '#d97706',
  warn:     '#b45309',
  bad:      '#dc2626',
};

/**
 * The screen-space markup layer.
 *
 * Everything is drawn in screen coordinates rather than transformed with the
 * canvas, so stroke widths and label text stay a constant size at every zoom —
 * a measurement label has to stay readable whether you're looking at the whole
 * sheet or one window.
 */
export default function Overlay({
  baseToScreen, viewScale = 1, measurements, markers, items, selectedIds, onSelect,
  draftPoints, hover, mode, pxPerMm, onHandleDown, activeHandle, showLabels = true,
}) {
  const itemById = new Map((items || []).map(i => [i.id, i]));
  const selected = selectedIds || new Set();
  const soleSelected = selected.size === 1 ? [...selected][0] : null;

  return (
    <svg className="absolute inset-0 w-full h-full pointer-events-none">
      {measurements.map(m => {
        const pts = pointsOf(m);
        const screen = pts.map(baseToScreen);
        const sel = selected.has(m.id);
        const flag = plausibility(m.tag, m.lengthMm);
        const stroke = sel ? STROKE.selected
                     : flag === 'hard' ? STROKE.bad
                     : flag === 'soft' ? STROKE.warn
                     : STROKE.normal;
        const item = m.itemId ? itemById.get(m.itemId) : null;
        const label = showLabels
          ? [item?.label || m.label, fmtMm(m.lengthMm)].filter(Boolean).join('  ')
          : fmtMm(m.lengthMm);

        const isArc = m.kind === 'arc' && pts.length === 3;
        const d = isArc
          ? arcPathD(pts[0], pts[1], pts[2], baseToScreen, viewScale)
          : `M ${screen.map(p => `${p.x} ${p.y}`).join(' L ')}`;
        const mid = isArc
          ? baseToScreen(arcMidpoint(pts[0], pts[1], pts[2]))
          : midOfPolyline(screen);

        return (
          <g key={m.id} className="pointer-events-auto cursor-pointer" onPointerDown={() => onSelect(m.id)}>
            {/* Fat invisible hit path — a 2px stroke is not a tap target. */}
            <path d={d} fill="none" stroke="transparent" strokeWidth={18} />
            <path d={d} fill="none" stroke="#fff" strokeWidth={sel ? 6 : 4} opacity={0.7} strokeLinejoin="round" />
            <path d={d} fill="none" stroke={stroke} strokeWidth={sel ? 3 : 2} strokeLinejoin="round" />

            {/* The chord, dashed, while a curve is selected — it's the thing the
                bend is measured against, and the number a straight measurement
                would have given. */}
            {isArc && sel && (
              <line
                x1={screen[0].x} y1={screen[0].y} x2={screen[2].x} y2={screen[2].y}
                stroke={stroke} strokeWidth={1} strokeDasharray="3 4" opacity={0.45}
              />
            )}

            {/* Vertices. Interior ones are smaller so the run's ends stay clear. */}
            {screen.map((p, i) => {
              const interior = i > 0 && i < screen.length - 1;
              // An arc's middle point is a bend handle, not a corner — it gets
              // its own affordance below rather than a vertex dot.
              if (isArc && interior) return null;
              return (
                <circle key={i} cx={p.x} cy={p.y} r={interior ? 3 : 4}
                  fill={interior ? stroke : '#fff'} stroke={stroke} strokeWidth={2} />
              );
            })}

            {/* Per-facet lengths on a bay — each one is usually its own blind. */}
            {sel && m.kind === 'chain' && m.segments?.length > 1 && screen.slice(1).map((p, i) => {
              const a = screen[i], b = p;
              const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              return (
                <g key={`seg${i}`} transform={`translate(${c.x}, ${c.y})`}>
                  <rect x={-24} y={4} width={48} height={14} rx={3} fill="#0f172a" opacity={0.85} />
                  <text x={0} y={11.5} textAnchor="middle" dominantBaseline="central" fontSize={10} fill="#fff" fontWeight="600">
                    {Math.round(m.segments[i])}
                  </text>
                </g>
              );
            })}

            {flag === 'hard' && (
              <g transform={`translate(${mid.x}, ${mid.y + 14})`}>
                <circle r={8} fill={STROKE.bad} />
                <text x={0} y={0} textAnchor="middle" dominantBaseline="central" fontSize={11} fill="#fff" fontWeight="700">!</text>
              </g>
            )}

            <Chip x={mid.x} y={mid.y} text={label} fill={stroke} sub={shapeBadge(m)} />
          </g>
        );
      })}

      {/* Bend handles. A curve is placed as two ends and then pulled into shape,
          so the apex needs to look grabbable whether or not it's selected —
          otherwise a freshly-placed curve just looks like a straight line. */}
      {measurements.filter(m => m.kind === 'arc' && pointsOf(m).length === 3).map(m => {
        const pts = pointsOf(m);
        const p = baseToScreen(pts[1]);
        const sel = selected.has(m.id);
        const flat = Math.abs(pts[1].x - (pts[0].x + pts[2].x) / 2) < 0.5
                  && Math.abs(pts[1].y - (pts[0].y + pts[2].y) / 2) < 0.5;
        return (
          <g
            key={`bend-${m.id}`}
            className="pointer-events-auto cursor-move"
            onPointerDown={(e) => { e.stopPropagation(); onSelect(m.id); onHandleDown?.(e, m.id, 1); }}
          >
            <circle cx={p.x} cy={p.y} r={18} fill="transparent" />
            {/* A still-straight curve pulses its handle — that's the only cue
                that there's something left to do. */}
            {flat && <circle cx={p.x} cy={p.y} r={11} fill={STROKE.selected} opacity={0.18} />}
            <circle cx={p.x} cy={p.y} r={sel || flat ? 7 : 5}
              fill="#fff" stroke={STROKE.selected} strokeWidth={2.5} />
            {/* A four-way arrow — the handle moves in both axes: out from the
                chord to deepen the bow, along it to shift the curve. */}
            <path
              d={`M ${p.x} ${p.y - 4.5} l -2 2 M ${p.x} ${p.y - 4.5} l 2 2
                  M ${p.x} ${p.y + 4.5} l -2 -2 M ${p.x} ${p.y + 4.5} l 2 -2
                  M ${p.x - 4.5} ${p.y} l 2 -2 M ${p.x - 4.5} ${p.y} l 2 2
                  M ${p.x + 4.5} ${p.y} l -2 -2 M ${p.x + 4.5} ${p.y} l -2 2`}
              fill="none" stroke={STROKE.selected} strokeWidth={1.5} strokeLinecap="round"
            />
          </g>
        );
      })}

      {/* Drag handles for the one selected measurement. A misplaced point used
          to mean delete-and-redraw; now it's a drag. */}
      {soleSelected && (() => {
        const m = measurements.find(x => x.id === soleSelected);
        if (!m) return null;
        const isArcSel = m.kind === 'arc' && pointsOf(m).length === 3;
        return pointsOf(m).map((p, i) => {
          if (isArcSel && i === 1) return null;   // the bend handle above owns it
          const s = baseToScreen(p);
          const active = (activeHandle ?? 1) === i;
          return (
            <g
              key={i}
              className="pointer-events-auto cursor-move"
              onPointerDown={(e) => { e.stopPropagation(); onHandleDown?.(e, m.id, i); }}
            >
              <circle cx={s.x} cy={s.y} r={16} fill="transparent" />
              <circle cx={s.x} cy={s.y} r={7} fill={active ? STROKE.selected : '#fff'} stroke={STROKE.selected} strokeWidth={2.5} />
              <circle cx={s.x} cy={s.y} r={2.5} fill={active ? '#fff' : STROKE.selected} />
            </g>
          );
        });
      })()}

      {/* Count markers */}
      {(markers || []).map(k => {
        const p = baseToScreen(k);
        const sel = selected.has(k.id);
        return (
          <g key={k.id} className="pointer-events-auto cursor-pointer" onPointerDown={() => onSelect(k.id)}>
            <circle cx={p.x} cy={p.y} r={14} fill={sel ? '#d97706' : 'rgba(217,119,6,0.9)'} stroke="#fff" strokeWidth={2} />
            <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize={11} fill="#fff" fontWeight="700">
              {k.index}
            </text>
            {k.label && (
              <text x={p.x} y={p.y + 26} textAnchor="middle" fontSize={11} fill="#0f172a" fontWeight="600"
                    stroke="#fff" strokeWidth={3} paintOrder="stroke">
                {k.label}
              </text>
            )}
          </g>
        );
      })}

      <DraftLayer
        draftPoints={draftPoints}
        hover={hover}
        mode={mode}
        pxPerMm={pxPerMm}
        baseToScreen={baseToScreen}
        viewScale={viewScale}
      />
    </svg>
  );
}

/** The measurement being drawn, including the running total for a chain. */
function DraftLayer({ draftPoints, hover, mode, pxPerMm, baseToScreen, viewScale }) {
  if (!draftPoints?.length) {
    return hover?.snapped ? <SnapPip point={baseToScreen(hover)} kind={hover.snapped} /> : null;
  }
  const live = hover ? [...draftPoints, hover] : draftPoints;
  const screen = live.map(baseToScreen);
  const isArc = mode === 'arc' && live.length === 3;   // only after a bend exists

  const metrics = polylineMetrics(live);
  let total = metrics.total;
  let d;
  if (isArc) {
    d = arcPathD(live[0], live[1], live[2], baseToScreen, viewScale);
    total = arcMetrics(live[0], live[1], live[2]).arcLength;
  } else {
    d = `M ${screen.map(p => `${p.x} ${p.y}`).join(' L ')}`;
  }
  const mid = isArc ? baseToScreen(arcMidpoint(live[0], live[1], live[2])) : midOfPolyline(screen);

  return (
    <g>
      {/* A green ghost behind the line is the only way an ortho lock is visible. */}
      {hover?.snapped === 'ortho' && !isArc && (
        <path d={d} fill="none" stroke="#22c55e" strokeWidth={6} opacity={0.25} strokeLinecap="round" />
      )}
      <path d={d} fill="none" stroke="#d97706" strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" />
      {screen.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={i === 0 ? 4 : 3} fill="#d97706" stroke="#fff" strokeWidth={2} />
      ))}
      {pxPerMm > 0 && live.length > 1 && (
        <Chip
          x={mid.x} y={mid.y} fill="#d97706"
          text={fmtMm(total / pxPerMm)}
          sub={mode === 'chain' && metrics.segments.length > 1
            ? `${metrics.segments.length} facets`
            : (mode === 'arc' ? 'then drag the middle to bend it' : null)}
        />
      )}
      {hover && <SnapPip point={screen[screen.length - 1]} kind={hover.snapped} />}
    </g>
  );
}

function Chip({ x, y, text, fill, sub }) {
  const w = Math.max(58, text.length * 6.2 + 12);
  const subW = sub ? Math.max(48, sub.length * 5.6 + 10) : 0;
  return (
    <g transform={`translate(${x}, ${y})`}>
      <rect x={-w / 2} y={-23} width={w} height={17} rx={3} fill={fill} />
      <text x={0} y={-14.5} textAnchor="middle" dominantBaseline="central" fontSize={11} fill="#fff" fontWeight="600">
        {text}
      </text>
      {sub && (
        <>
          <rect x={-subW / 2} y={-40} width={subW} height={15} rx={3} fill="#0f172a" opacity={0.85} />
          <text x={0} y={-32.5} textAnchor="middle" dominantBaseline="central" fontSize={9.5} fill="#fff" fontWeight="600">
            {sub}
          </text>
        </>
      )}
    </g>
  );
}

/** A one-word badge for anything that isn't a plain straight run. */
function shapeBadge(m) {
  if (m.kind === 'arc') return m.radiusMm ? `curved · R${Math.round(m.radiusMm)}` : 'curved';
  if (m.kind === 'chain' && m.segments?.length > 1) return `${m.segments.length}-part bay`;
  return null;
}

/** Label anchor for a polyline: the midpoint of its longest leg. */
function midOfPolyline(screen) {
  if (screen.length < 2) return screen[0] || { x: 0, y: 0 };
  let best = null;
  for (let i = 1; i < screen.length; i++) {
    const d = dist(screen[i - 1], screen[i]);
    if (!best || d > best.d) best = { d, a: screen[i - 1], b: screen[i] };
  }
  return { x: (best.a.x + best.b.x) / 2, y: (best.a.y + best.b.y) / 2 };
}

/** Tells you WHY the point moved — otherwise a snap feels like a misfire. */
function SnapPip({ point, kind }) {
  if (!kind) return null;
  const colour = kind === 'endpoint' ? '#2563eb' : kind === 'ink' ? '#16a34a' : '#22c55e';
  if (kind === 'endpoint') {
    return (
      <rect
        x={point.x - 7} y={point.y - 7} width={14} height={14}
        fill="none" stroke={colour} strokeWidth={2}
      />
    );
  }
  return (
    <g>
      <circle cx={point.x} cy={point.y} r={8} fill="none" stroke={colour} strokeWidth={2} />
      <circle cx={point.x} cy={point.y} r={2} fill={colour} />
    </g>
  );
}
