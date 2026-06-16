/**
 * ToastContainer — global top-right notification toasts.
 *
 * Basic usage:
 *   toast('Calendar event saved.');
 *   toast('Something went wrong.', 'error');
 *
 * With undo action:
 *   toast('Customer deleted.', 'info', { onUndo: () => restoreCustomer(id), duration: 8000 });
 */

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, XCircle, Info, X, RotateCcw } from 'lucide-react';

// ── Helper — call from anywhere ───────────────────────────────────────────────
export function toast(message, type = 'success', options = {}) {
  window.dispatchEvent(new CustomEvent('lusso:toast', {
    detail: { message, type, ...options }
  }));
}

// ── Config per type ────────────────────────────────────────────────────────────
const CONFIG = {
  success: { icon: CheckCircle2, bar: 'bg-green-500',  icon_cls: 'text-green-500',  ring: 'ring-green-100'  },
  error:   { icon: XCircle,      bar: 'bg-red-500',    icon_cls: 'text-red-500',    ring: 'ring-red-100'    },
  info:    { icon: Info,         bar: 'bg-blue-500',   icon_cls: 'text-blue-500',   ring: 'ring-blue-100'   },
  warning: { icon: Info,         bar: 'bg-amber-500',  icon_cls: 'text-amber-500',  ring: 'ring-amber-100'  },
};

// ── Single toast card ──────────────────────────────────────────────────────────
function ToastCard({ id, message, type = 'success', onUndo, duration = 3500, onRemove }) {
  const [exiting, setExiting] = useState(false);
  const [progress, setProgress] = useState(100);
  const cfg = CONFIG[type] || CONFIG.success;
  const Icon = cfg.icon;

  const dismiss = useCallback((undone = false) => {
    setExiting(true);
    setTimeout(() => onRemove(id), 300);
  }, [id, onRemove]);

  const handleUndo = useCallback(() => {
    onUndo?.();
    dismiss(true);
  }, [onUndo, dismiss]);

  // Auto-dismiss timer
  useEffect(() => {
    const t = setTimeout(() => dismiss(), duration);
    return () => clearTimeout(t);
  }, [dismiss, duration]);

  // Progress bar animation
  useEffect(() => {
    const start = Date.now();
    const tick = () => {
      const pct = Math.max(0, 100 - ((Date.now() - start) / duration) * 100);
      setProgress(pct);
      if (pct > 0) requestAnimationFrame(tick);
    };
    const raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [duration]);

  return (
    <div className={`
      flex flex-col w-72 max-w-[calc(100vw-2rem)]
      bg-white rounded-xl shadow-lg ring-1 ${cfg.ring}
      overflow-hidden
      transition-all duration-300 ease-out
      ${exiting ? 'opacity-0 translate-x-4' : 'opacity-100 translate-x-0'}
    `}>
      <div className="flex items-start gap-3">
        {/* Coloured left bar */}
        <div className={`w-1 self-stretch flex-shrink-0 ${cfg.bar} rounded-l-xl`} />

        {/* Icon + message */}
        <div className="flex items-start gap-2.5 py-3 pr-1 flex-1 min-w-0">
          <Icon size={16} className={`flex-shrink-0 mt-0.5 ${cfg.icon_cls}`} />
          <p className="text-sm text-slate-800 font-medium leading-snug">{message}</p>
        </div>

        <div className="flex items-center gap-1 py-2 pr-2 flex-shrink-0">
          {/* Undo button */}
          {onUndo && (
            <button
              onClick={handleUndo}
              className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-colors"
            >
              <RotateCcw size={11} /> Undo
            </button>
          )}
          {/* Dismiss */}
          <button
            onClick={() => dismiss()}
            className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors rounded-lg hover:bg-slate-100"
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Progress bar — shows time remaining, useful for undo */}
      {onUndo && (
        <div className="h-0.5 bg-slate-100 mx-1 mb-1 rounded-full overflow-hidden">
          <div
            className={`h-full ${cfg.bar} transition-none rounded-full`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ── Container — mount once in App.jsx ─────────────────────────────────────────
let _nextId = 1;

export default function ToastContainer() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handler = (e) => {
      const { message, type = 'success', onUndo, duration } = e.detail || {};
      if (!message) return;
      const id = _nextId++;
      setToasts(prev => [...prev, { id, message, type, onUndo, duration }]);
    };
    window.addEventListener('lusso:toast', handler);
    return () => window.removeEventListener('lusso:toast', handler);
  }, []);

  const remove = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 items-end pointer-events-none"
      aria-live="polite"
    >
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto">
          <ToastCard {...t} onRemove={remove} />
        </div>
      ))}
    </div>
  );
}
