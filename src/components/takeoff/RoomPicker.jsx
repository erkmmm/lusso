import { MapPin, X } from 'lucide-react';

/**
 * Pick a window's room by tapping its name on the plan.
 *
 * Auto-naming guesses from the nearest label and gets it right maybe four times
 * in ten — not because the text is bad, but because "nearest" can't tell which
 * side of a wall a window is on. A window between a bedroom and its ensuite
 * genuinely sits closer to the ensuite's text.
 *
 * Nothing here is new data: the text layer was already mined and indexed with
 * coordinates for the guess. This just hands the choice back, so a wrong guess
 * costs one tap on the right word instead of typing the room out.
 */
export default function RoomPicker({
  rooms, baseToScreen, anchor, onPick, onCancel, limit = 60,
}) {
  if (!rooms?.length) return null;

  // Nearest first, so the ones actually in play survive the cap on a sheet
  // carrying a hundred labels.
  const ranked = anchor
    ? [...rooms].sort((a, b) =>
        Math.hypot(a.x - anchor.x, a.y - anchor.y) - Math.hypot(b.x - anchor.x, b.y - anchor.y))
    : rooms;
  const shown = ranked.slice(0, limit);

  return (
    <>
      {/* Catches the taps that miss a label, so the picker can be dismissed by
          tapping the plan rather than hunting for the cancel button. */}
      <div className="absolute inset-0 z-20" onPointerDown={onCancel} />

      <svg className="absolute inset-0 w-full h-full pointer-events-none z-20">
        {anchor && (() => {
          const a = baseToScreen(anchor);
          return <circle cx={a.x} cy={a.y} r={7} fill="none" stroke="#d97706" strokeWidth={2.5} />;
        })()}
        {shown.map((r, i) => {
          const p = baseToScreen(r);
          const w = Math.max(46, r.str.length * 6.6 + 18);
          const nearest = i < 3;
          return (
            <g
              key={`${r.str}-${i}`}
              data-room-chip={r.str}
              className="pointer-events-auto cursor-pointer"
              onPointerDown={(e) => { e.stopPropagation(); onPick(r.str); }}
            >
              <rect
                x={p.x - w / 2} y={p.y - 11} width={w} height={22} rx={5}
                fill={nearest ? '#0f172a' : 'rgba(15,23,42,0.72)'}
                stroke={nearest ? '#d97706' : 'transparent'} strokeWidth={1.5}
              />
              <text
                x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central"
                fontSize={11.5} fill="#fff" fontWeight="600"
              >
                {r.str}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-slate-900 text-white rounded-xl shadow-2xl px-3.5 py-2 max-w-[92vw]">
        <MapPin size={15} className="text-amber-400 flex-shrink-0" />
        <span className="text-xs">
          Tap the room name on the plan
          {rooms.length > limit && <span className="text-slate-400"> · {limit} nearest shown</span>}
        </span>
        <button onClick={onCancel} className="text-slate-400 hover:text-white flex-shrink-0" aria-label="Cancel">
          <X size={15} />
        </button>
      </div>
    </>
  );
}
