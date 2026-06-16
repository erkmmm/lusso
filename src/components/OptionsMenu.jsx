/**
 * Reusable ⋯ options dropdown menu.
 *
 * Usage:
 *   <OptionsMenu items={[
 *     { label: 'Edit',   icon: Edit3,  onClick: () => {} },
 *     { label: 'Delete', icon: Trash2, onClick: () => {}, danger: true },
 *   ]} />
 */
import { useState, useEffect, useRef } from 'react';
import { MoreHorizontal } from 'lucide-react';

export default function OptionsMenu({ items = [], align = 'right', buttonClassName = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
        className={`w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors ${buttonClassName}`}
        title="Options"
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-1 w-44 bg-white rounded-xl border border-slate-200 shadow-lg py-1 ${
            align === 'left' ? 'left-0' : 'right-0'
          }`}
          onClick={e => e.stopPropagation()}
        >
          {items.map((item, i) => {
            if (item.divider) return <div key={i} className="h-px bg-slate-100 my-1" />;
            const Icon = item.icon;
            return (
              <button
                key={i}
                onClick={() => { setOpen(false); item.onClick?.(); }}
                disabled={item.disabled}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                  item.danger
                    ? 'text-red-600 hover:bg-red-50'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {Icon && <Icon size={14} className="flex-shrink-0" />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
