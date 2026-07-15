/**
 * PricedItemPicker — searchable dropdown over the Price Library.
 *
 * Props:
 *   value           string   — currently selected item name (display)
 *   onSelect        fn(item) — called with the full priced item object when chosen
 *   productTypes    array    — fallback list of product types (shown at bottom)
 *   onSelectType    fn(pt)   — called when a plain product type is chosen (no library item)
 *   placeholder     string
 *   error           bool
 */
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Package, Tag } from 'lucide-react';
import { getPricedItems } from '../store/data';

export default function PricedItemPicker({
  value = '',
  onSelect,
  productTypes = [],
  onSelectType,
  placeholder = 'Search price library…',
  error = false,
  typesFirst = false, // measure sheet: surface the product types above the price library
}) {
  const [open,   setOpen]   = useState(false);
  const [query,  setQuery]  = useState('');
  const [pos,    setPos]    = useState(null); // fixed-position rect for the portalled dropdown
  const ref      = useRef(null);   // trigger wrapper (for outside-click)
  const menuRef  = useRef(null);   // portalled dropdown (for outside-click)
  const inputRef = useRef(null);

  // Position the dropdown relative to the trigger. It's portalled to <body> with
  // fixed positioning so it's never clipped by an overflow container (e.g. the
  // measure-sheet table's horizontal scroll). Flips above when short on space.
  const updatePos = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 300);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const spaceBelow = window.innerHeight - r.bottom;
    const flipUp = spaceBelow < 280 && r.top > spaceBelow;
    setPos({
      left,
      width,
      top: flipUp ? undefined : r.bottom + 4,
      bottom: flipUp ? window.innerHeight - r.top + 4 : undefined,
      maxHeight: (flipUp ? r.top : spaceBelow) - 16,
    });
  };

  const allItems = getPricedItems().filter(i => i.isActive !== false);

  // Filter by query
  const q = query.trim().toLowerCase();
  const matchedItems = q
    ? allItems.filter(i =>
        (i.itemName    || '').toLowerCase().includes(q) ||
        (i.category    || '').toLowerCase().includes(q) ||
        (i.sku         || '').toLowerCase().includes(q) ||
        (i.description || '').toLowerCase().includes(q) ||
        (i.supplier    || '').toLowerCase().includes(q)
      )
    : allItems;

  const matchedTypes = productTypes.filter(pt =>
    !q || pt.name.toLowerCase().includes(q)
  );

  // Close on outside click — the dropdown is portalled out of `ref`, so check
  // both the trigger and the menu, else a click inside the menu counts as
  // "outside" and closes it before the selection registers.
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Keep the portalled dropdown pinned to the trigger while open (handles the
  // table's inner scroll and window resize).
  useEffect(() => {
    if (!open) return;
    updatePos();
    const onMove = () => updatePos();
    window.addEventListener('scroll', onMove, true); // capture → catches inner scroll containers
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  // Focus search when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const handleSelectItem = (item) => {
    onSelect?.(item);
    setOpen(false);
    setQuery('');
  };

  const handleSelectType = (pt) => {
    onSelectType?.(pt);
    setOpen(false);
    setQuery('');
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onSelect?.(null);
    onSelectType?.(null);
    setQuery('');
  };

  const hasResults = matchedItems.length > 0 || matchedTypes.length > 0;

  return (
    <div className="relative" ref={ref}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-sm text-left transition-colors bg-white ${
          error
            ? 'border-red-300 ring-1 ring-red-300'
            : open
              ? 'border-amber-400 ring-2 ring-amber-200'
              : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <Package size={13} className="text-slate-400 flex-shrink-0" />
        <span className={`flex-1 leading-snug ${value ? 'text-slate-800' : 'text-slate-400'}`}>
          {value || placeholder}
        </span>
        {value ? (
          <span onClick={handleClear} className="text-slate-300 hover:text-slate-500 flex-shrink-0 cursor-pointer">
            <X size={12} />
          </span>
        ) : (
          <Search size={12} className="text-slate-300 flex-shrink-0" />
        )}
      </button>

      {/* Dropdown — portalled to <body> so an overflow-scroll ancestor (the
          measure-sheet table) can't clip it. Positioned fixed to the trigger. */}
      {open && pos && createPortal(
        <div ref={menuRef} style={{
            position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom,
            width: pos.width, maxHeight: pos.maxHeight, zIndex: 60,
            display: 'flex', flexDirection: 'column',
          }}
          className="bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-slate-100 flex-shrink-0">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 rounded-lg">
              <Search size={13} className="text-slate-400 flex-shrink-0" />
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search by name, category, supplier…"
                className="flex-1 bg-transparent text-sm outline-none text-slate-800 placeholder-slate-400"
              />
              {query && (
                <button onClick={() => setQuery('')} className="text-slate-400 hover:text-slate-600">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {(() => {
              // Product Types block — the 12 window-furnishing types that drive
              // the measure-sheet specs. Rendered prominently (and first) when
              // typesFirst so it's always one tap away, not buried under the
              // price library.
              const typesBlock = matchedTypes.length > 0 && (
                <div key="types">
                  <p className={`px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider ${
                    typesFirst ? 'text-amber-600' : 'text-slate-400 border-t border-slate-100'
                  }`}>
                    Product Types
                  </p>
                  {matchedTypes.map(pt => (
                    <button
                      key={pt.id}
                      type="button"
                      onClick={() => handleSelectType(pt)}
                      className={`w-full flex items-center gap-2.5 px-3 hover:bg-amber-50 transition-colors text-left ${typesFirst ? 'py-2.5' : 'py-2'}`}
                    >
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${typesFirst ? 'bg-amber-100' : 'bg-slate-100'}`}>
                        <Tag size={13} className={typesFirst ? 'text-amber-600' : 'text-slate-500'} />
                      </div>
                      <span className={`text-sm ${typesFirst ? 'text-slate-800 font-medium' : 'text-slate-600'}`}>{pt.name}</span>
                    </button>
                  ))}
                </div>
              );

              // Price Library block.
              const itemsBlock = matchedItems.length > 0 && (
                <div key="items">
                  <p className={`px-3 pt-2 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider ${typesFirst ? 'border-t border-slate-100' : ''}`}>
                    Price Library ({matchedItems.length})
                  </p>
                  {matchedItems.map(item => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectItem(item)}
                      className="w-full flex items-start gap-2.5 px-3 py-2.5 hover:bg-amber-50 transition-colors text-left"
                    >
                      <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <Package size={13} className="text-amber-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 leading-snug">{item.itemName}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {item.category && (
                            <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-medium">{item.category}</span>
                          )}
                          {item.supplier && (
                            <span className="text-[10px] text-slate-400">{item.supplier}</span>
                          )}
                        </div>
                      </div>
                      {item.sellPrice > 0 && (
                        <span className="text-xs font-semibold text-amber-700 flex-shrink-0 mt-0.5">
                          ${Number(item.sellPrice).toLocaleString('en-AU', { minimumFractionDigits: 0 })}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              );

              return typesFirst ? [typesBlock, itemsBlock] : [itemsBlock, typesBlock];
            })()}

            {!hasResults && (
              <div className="px-3 py-6 text-center">
                <p className="text-sm text-slate-400">No items found for "{query}"</p>
                <p className="text-xs text-slate-300 mt-1">Try a different search term</p>
              </div>
            )}

            {allItems.length === 0 && !q && (
              <div className="px-3 py-4 text-center">
                <p className="text-xs text-slate-400">No items in the price library yet.</p>
                <p className="text-xs text-slate-300 mt-0.5">Add items in Settings → Products → Price Library.</p>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
