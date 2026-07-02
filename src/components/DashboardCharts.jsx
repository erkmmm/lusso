/**
 * Hand-rolled SVG charts for the dashboard — no charting library.
 * Calm, premium palette (muted, never neon), tuned to Lusso's brand.
 * All charts are responsive (viewBox-scaled) and theme/dark-mode friendly
 * because they read `currentColor` / slate-neutral strokes where possible.
 */
import { useId } from 'react';

const money = (v) =>
  Math.abs(v) >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M`
  : Math.abs(v) >= 1_000   ? `$${Math.round(v / 1_000)}K`
  : `$${Math.round(v)}`;

// ── Donut ────────────────────────────────────────────────────────────────────
// data: [{ label, value, color }]. Renders an SVG donut + a legend beside it.
export function DonutChart({ data, centerValue, centerLabel, size = 168, thickness = 22, valueFmt = (v) => v }) {
  const items = (data || []).filter((d) => d.value > 0);
  const total = items.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-5 flex-wrap">
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={centerLabel || 'chart'}>
          {/* track */}
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EAEBE6" strokeWidth={thickness} />
          {total > 0 && items.map((d, i) => {
            const frac = d.value / total;
            const len = frac * c;
            const seg = (
              <circle
                key={i}
                cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={d.color} strokeWidth={thickness}
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                strokeLinecap="butt"
              >
                <title>{`${d.label}: ${d.value} (${Math.round(frac * 100)}%)`}</title>
              </circle>
            );
            offset += len;
            return seg;
          })}
        </svg>
        {(centerValue != null || centerLabel) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
            {centerValue != null && <span className="text-2xl font-bold text-slate-900 leading-none">{centerValue}</span>}
            {centerLabel && <span className="text-[11px] text-slate-400 mt-1">{centerLabel}</span>}
          </div>
        )}
      </div>

      <ul className="flex-1 min-w-[140px] space-y-1.5">
        {items.map((d, i) => (
          <li key={i} className="flex items-center gap-2 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: d.color }} />
            <span className="text-slate-600 truncate flex-1">{d.label}</span>
            <span className="text-slate-400 tabular-nums">{total > 0 ? Math.round((d.value / total) * 100) : 0}%</span>
            <span className="text-slate-800 font-medium tabular-nums min-w-8 text-right">{valueFmt(d.value)}</span>
          </li>
        ))}
        {items.length === 0 && <li className="text-xs text-slate-400">No data in range.</li>}
      </ul>
    </div>
  );
}

// ── Dual-axis line chart ──────────────────────────────────────────────────────
// series: [{ name, color, axis:'left'|'right', values:number[] }]
// xLabels: string[] (same length as values). left axis = money, right = count.
export function LineChart({ series, xLabels, height = 220 }) {
  const W = 720, H = height;
  const padL = 46, padR = 42, padT = 16, padB = 28;
  const iw = W - padL - padR, ih = H - padT - padB;
  const n = xLabels.length;

  const left  = series.find((s) => s.axis !== 'right');
  const right = series.find((s) => s.axis === 'right');
  const maxL = Math.max(1, ...(left?.values || [0]));
  const maxR = Math.max(1, ...(right?.values || [0]));

  const x = (i) => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yFor = (v, max) => padT + ih - (v / max) * ih;
  const path = (vals, max) => vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${yFor(v, max).toFixed(1)}`).join(' ');

  const gridY = [0, 0.25, 0.5, 0.75, 1];
  const tickEvery = Math.ceil(n / 6);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="trend chart">
      {gridY.map((g, i) => {
        const yy = padT + ih - g * ih;
        return (
          <g key={i}>
            <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="#EEEFEA" strokeWidth="1" />
            <text x={padL - 8} y={yy + 3} textAnchor="end" fontSize="10" fill="#9AA0A6">{money(g * maxL)}</text>
            {right && <text x={W - padR + 8} y={yy + 3} textAnchor="start" fontSize="10" fill="#9AA0A6">{Math.round(g * maxR)}</text>}
          </g>
        );
      })}
      {right && <path d={path(right.values, maxR)} fill="none" stroke={right.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />}
      {left && (
        <>
          <path d={`${path(left.values, maxL)} L ${x(n - 1)} ${padT + ih} L ${x(0)} ${padT + ih} Z`} fill={left.color} opacity="0.07" />
          <path d={path(left.values, maxL)} fill="none" stroke={left.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        </>
      )}
      {left?.values.map((v, i) => (
        <circle key={i} cx={x(i)} cy={yFor(v, maxL)} r="2.5" fill="#fff" stroke={left.color} strokeWidth="1.5" />
      ))}
      {xLabels.map((lb, i) => (
        (i % tickEvery === 0 || i === n - 1) && (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#9AA0A6">{lb}</text>
        )
      ))}
    </svg>
  );
}

// ── Sparkline ──────────────────────────────────────────────────────────────────
// Tiny inline trend for KPI cards. Stretches to fill its container width.
export function Sparkline({ values = [], color = '#C0873A', height = 34, fill = true }) {
  const gid = useId();
  const n = values.length;
  if (!n) return null;
  const W = 120, H = height, pad = 2;
  const max = Math.max(...values), min = Math.min(...values);
  const range = max - min || 1;
  const x = (i) => (n <= 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v) => H - pad - ((v - min) / range) * (H - pad * 2);
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(n - 1).toFixed(1)} ${H} L ${x(0).toFixed(1)} ${H} Z`;
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#${gid})`} />}
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── Area chart ───────────────────────────────────────────────────────────────
// Single-series gradient area (the Apex-style hero revenue chart). left axis =
// formatted via `format` (money by default).
export function AreaChart({ values = [], xLabels = [], color = '#C0873A', height = 240, format = money }) {
  const gid = useId();
  const W = 720, H = height;
  const padL = 48, padR = 16, padT = 16, padB = 28;
  const iw = W - padL - padR, ih = H - padT - padB;
  const n = values.length;
  const max = Math.max(1, ...values);
  const x = (i) => padL + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => padT + ih - (v / max) * ih;
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(n - 1).toFixed(1)} ${padT + ih} L ${x(0).toFixed(1)} ${padT + ih} Z`;
  const gridY = [0, 0.25, 0.5, 0.75, 1];
  const tickEvery = Math.max(1, Math.ceil(n / 6));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="revenue trend">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {gridY.map((g, i) => {
        const yy = padT + ih - g * ih;
        return (
          <g key={i}>
            <line x1={padL} y1={yy} x2={W - padR} y2={yy} stroke="#EEEFEA" strokeWidth="1" />
            <text x={padL - 8} y={yy + 3} textAnchor="end" fontSize="10" fill="#9AA0A6">{format(g * max)}</text>
          </g>
        );
      })}
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {values.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r="2.5" fill="#fff" stroke={color} strokeWidth="1.5" />
      ))}
      {xLabels.map((lb, i) => (
        (i % tickEvery === 0 || i === n - 1) && (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="#9AA0A6">{lb}</text>
        )
      ))}
    </svg>
  );
}
