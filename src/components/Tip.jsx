/**
 * A tooltip that also works on the device this app is actually used on.
 *
 * The native `title` attribute is useless here: it never appears on a touch
 * screen, and the takeoff is done on an iPad on site. So this shows on hover
 * with a mouse AND on press-and-hold with a finger, which is the gesture people
 * already try when they want to know what a button does.
 *
 * Portalled to <body> and positioned fixed, because the toolbars it lives in
 * scroll horizontally — a tooltip inside one would be clipped by its own
 * container at exactly the edge where the buttons run out of room.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const HOVER_DELAY = 350;   // ms before a mouse hover opens one
const HOLD_DELAY  = 400;   // ms of finger-down that counts as "what is this?"

export default function Tip({ title, body, hint, children, placement = 'right', disabled = false }) {
  const [pos, setPos] = useState(null);     // {top,left,arrow} or null when closed
  const wrapRef = useRef(null);
  const timer = useRef(null);
  const held = useRef(false);               // a long-press opened it → swallow the click

  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  const open = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    // The wrapper is `display: contents` so it never disturbs the layout of the
    // toolbars it sits in — which also means IT HAS NO BOX, and its own
    // getBoundingClientRect() is all zeros. Measure the control inside it.
    const target = el.firstElementChild || el;
    const r = target.getBoundingClientRect();
    if (!r.width && !r.height) return;
    const GAP = 10, W = 260;
    // Prefer the requested side, but never run off screen — on a phone in
    // portrait there is no room to the right of the tool rail.
    let left = placement === 'right' ? r.right + GAP : r.left + r.width / 2 - W / 2;
    let top  = placement === 'right' ? r.top + r.height / 2 : r.bottom + GAP;
    if (left + W > window.innerWidth - 8) {
      left = placement === 'right' ? r.left - W - GAP : window.innerWidth - W - 8;
    }
    left = Math.max(8, left);
    top = Math.max(8, Math.min(top, window.innerHeight - 8));
    setPos({ top, left, width: W, centred: placement !== 'right' });
  }, [placement]);

  const close = useCallback(() => { clear(); setPos(null); }, []);

  useEffect(() => {
    if (!pos) return;
    const onAway = () => close();
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    // Any scroll or outside press dismisses it — a tooltip that outlives the
    // thing it points at is worse than none.
    window.addEventListener('scroll', onAway, true);
    window.addEventListener('resize', onAway);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onAway, true);
      window.removeEventListener('resize', onAway);
      window.removeEventListener('keydown', onKey);
    };
  }, [pos, close]);

  useEffect(() => clear, []);

  if (disabled || (!title && !body)) return children;

  return (
    <>
      <span
        ref={wrapRef}
        className="contents"
        onMouseEnter={() => { clear(); timer.current = setTimeout(open, HOVER_DELAY); }}
        onMouseLeave={close}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse') { close(); return; }   // a real click shouldn't leave it up
          held.current = false;
          clear();
          timer.current = setTimeout(() => { held.current = true; open(); }, HOLD_DELAY);
        }}
        onPointerUp={() => { clear(); if (!held.current) close(); }}
        onPointerCancel={close}
        // A long-press that opened the tip must not also fire the button —
        // asking what a tool does should never switch you to it.
        onClickCapture={(e) => {
          if (held.current) { e.preventDefault(); e.stopPropagation(); held.current = false; close(); }
        }}
      >
        {children}
      </span>

      {pos && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed', top: pos.top, left: pos.left, width: pos.width,
            transform: pos.centred ? undefined : 'translateY(-50%)', zIndex: 80,
          }}
          className="pointer-events-none rounded-xl bg-slate-900 text-white shadow-xl px-3 py-2.5"
        >
          {title && (
            <p className="text-xs font-semibold flex items-center gap-2">
              {title}
              {hint && (
                <kbd className="text-[9px] font-bold px-1 py-0.5 rounded border border-white/25 text-white/70">
                  {hint}
                </kbd>
              )}
            </p>
          )}
          {body && <p className="text-[11px] leading-snug text-slate-300 mt-1">{body}</p>}
        </div>,
        document.body,
      )}
    </>
  );
}
