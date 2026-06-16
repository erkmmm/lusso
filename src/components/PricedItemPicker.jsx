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
import { Search, X, Package, Tag } from 'lucide-react';
import { getPricedItems } from '../store/data';

export default function PricedItemPicker({
  value = '',
  onSelect,
  productTypes = [],
  onSelectType,
  placeholder = 'Search price library…',
  error = false,
}) {
  const [open,   setOpen]   = useState(false);
  const [query,  setQuery]  = useState('');
  const ref      = useRef(null);
  const inputRef = useRef(null);

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

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
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

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 left-0 right-0 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-slate-100">
            <div className="flex items-center gap-2 px-2.5 py-1.5 bg-slate-50 rounded-lg">
              <Search size={13} className="text-slate-400 flex-shrink-0" />
              <input
                ref={inputRef}
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

          <div className="max-h-72 overflow-y-auto">
            {/* Price library items */}
            {matchedItems.length > 0 && (
              <div>
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
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
            )}

            {/* Product type fallback */}
            {matchedTypes.length > 0 && (
              <div>
                <p className="px-3 pt-2 pb-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-t border-slate-100">
                  Product Types
                </p>
                {matchedTypes.map(pt => (
                  <button
                    key={pt.id}
                    type="button"
                    onClick={() => handleSelectType(pt)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 transition-colors text-left"
                  >
                    <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                      <Tag size={13} className="text-slate-500" />
                    </div>
                    <span className="text-sm text-slate-600">{pt.name}</span>
                  </button>
                ))}
              </div>
            )}

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
        </div>
      )}
    </div>
  );
}
