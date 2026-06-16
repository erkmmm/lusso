/**
 * AddressAutocomplete
 *
 * Drop-in replacement for any address <input>.
 * Queries OpenStreetMap Nominatim (free, no API key).
 * Biased to Australian addresses. Debounced at 400 ms.
 *
 * Props:
 *   value          string    controlled full address (including unit if present)
 *   onChange       fn(str)   called with the full address string on every change
 *   placeholder    string
 *   className      string    wrapper div className
 *   inputClassName string    extra classes on the street <input>
 *   disabled       bool
 *   showUnit       bool      show the Unit / Suite / Level prefix field (default true)
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { MapPin, Loader2, X } from 'lucide-react';

// Australian state name → abbreviation
const STATE_ABBR = {
  'queensland':                   'QLD',
  'new south wales':               'NSW',
  'victoria':                      'VIC',
  'western australia':             'WA',
  'south australia':               'SA',
  'tasmania':                      'TAS',
  'northern territory':            'NT',
  'australian capital territory':  'ACT',
};

// Regex to detect a leading unit prefix in a stored address
// Matches: "Unit 3, ", "Level 2, ", "Suite 5A, ", "Apt 12, ", "Shop 3, ", "3A, ", "1/", etc.
const UNIT_PREFIX_RE = /^((?:unit|level|suite|apt|apartment|flat|shop|office|villa|lot)\s+[\w/-]+|[\d]+[a-z]?(?:\/[\d]+)?),\s*/i;

function parseUnitAndStreet(full = '') {
  const m = full.match(UNIT_PREFIX_RE);
  if (m) return { unit: m[1].trim(), street: full.slice(m[0].length) };
  return { unit: '', street: full };
}

function combine(unit, street) {
  const u = unit.trim();
  const s = street.trim();
  if (!u) return s;
  if (!s) return u;
  return `${u}, ${s}`;
}

function formatAddress(addr) {
  const parts = [];
  const street = [addr.house_number, addr.road].filter(Boolean).join(' ');
  if (street) parts.push(street);
  const suburb =
    addr.suburb       ||
    addr.village      ||
    addr.town         ||
    addr.neighbourhood||
    addr.hamlet       ||
    null;
  if (suburb) parts.push(suburb);
  const stateAbbr = STATE_ABBR[(addr.state || '').toLowerCase()] || addr.state || '';
  if (stateAbbr && addr.postcode) parts.push(`${stateAbbr} ${addr.postcode}`);
  else if (stateAbbr)             parts.push(stateAbbr);
  return parts.join(', ');
}

export default function AddressAutocomplete({
  value        = '',
  onChange,
  placeholder  = 'Start typing an address…',
  className    = '',
  inputClassName = '',
  disabled     = false,
  showUnit     = true,
}) {
  // Parse unit prefix out of the incoming value on first render
  const parsed     = parseUnitAndStreet(value);
  const [unit,    setUnit]    = useState(parsed.unit);
  const [query,   setQuery]   = useState(parsed.street);
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open,    setOpen]    = useState(false);
  const [focused, setFocused] = useState(false);

  const debounceRef  = useRef(null);
  const containerRef = useRef(null);
  const inputRef     = useRef(null);

  // Sync when the parent resets the value externally (e.g. form clear or
  // pre-fill from a customer selection). Skip the re-parse when the change
  // came from the user typing — identified by the combined internal state
  // already matching the incoming value, meaning WE emitted it via onChange.
  useEffect(() => {
    const current = combine(unit, query);
    if (current === (value || '')) return; // internal change — no re-parse needed
    const p = parseUnitAndStreet(value || '');
    setUnit(p.unit);
    setQuery(p.street);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (!containerRef.current?.contains(e.target)) {
        setOpen(false);
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const search = useCallback(async (q) => {
    if (!q || q.trim().length < 3) { setSuggestions([]); setOpen(false); setLoading(false); return; }
    setLoading(true);
    try {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.set('format',         'json');
      url.searchParams.set('q',              q);
      url.searchParams.set('countrycodes',   'au');
      url.searchParams.set('limit',          '6');
      url.searchParams.set('addressdetails', '1');
      url.searchParams.set('dedupe',         '1');
      const res  = await fetch(url.toString(), { headers: { 'Accept-Language': 'en-AU,en' } });
      if (!res.ok) throw new Error('geocode failed');
      const data = await res.json();
      const results = data
        .map(r => ({ display: formatAddress(r.address) || r.display_name.replace(', Australia', '') }))
        .filter(r => r.display);
      const seen   = new Set();
      const deduped = results.filter(r => { if (seen.has(r.display)) return false; seen.add(r.display); return true; });
      setSuggestions(deduped);
      setOpen(deduped.length > 0);
    } catch {
      setSuggestions([]); setOpen(false);
    } finally {
      setLoading(false);
    }
  }, []);

  // Street input changed (user typing)
  const handleStreetChange = (e) => {
    const v = e.target.value;
    setQuery(v);
    onChange?.(combine(unit, v));
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(v), 400);
  };

  // Unit input changed
  const handleUnitChange = (e) => {
    const v = e.target.value;
    setUnit(v);
    onChange?.(combine(v, query));
  };

  // Suggestion selected from dropdown
  const handleSelect = (suggestion) => {
    let display = suggestion.display;

    // Nominatim often returns street-level matches (no house_number in the
    // address object) even when the user typed one.  If the user's query
    // started with digits (e.g. "25 Surf Pde") and the formatted result
    // doesn't start with a number, prepend the number from the query.
    const houseMatch = query.trim().match(/^(\d+\w*)\s+/);
    if (houseMatch && !/^\d/.test(display)) {
      display = `${houseMatch[1]} ${display}`;
    }

    setQuery(display);
    onChange?.(combine(unit, display));
    setSuggestions([]);
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleClearStreet = () => {
    setQuery('');
    onChange?.(combine(unit, ''));
    setSuggestions([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'Enter' && open && suggestions.length === 1) {
      e.preventDefault();
      handleSelect(suggestions[0]);
    }
  };

  return (
    <div ref={containerRef} className={`space-y-1.5 ${className}`}>
      {/* Unit / Suite / Level row */}
      {showUnit && (
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-1">
            Unit / Suite / Level <span className="font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={unit}
            onChange={handleUnitChange}
            placeholder="e.g. Unit 3, Level 2, Shop 5"
            disabled={disabled}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:opacity-50"
          />
        </div>
      )}

      {/* Street address with autocomplete */}
      <div className="relative">
        <MapPin
          size={14}
          className={`absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none transition-colors ${focused ? 'text-amber-500' : 'text-slate-400'}`}
        />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleStreetChange}
          onFocus={() => { setFocused(true); if (suggestions.length > 0) setOpen(true); }}
          onBlur={() => setFocused(false)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          className={`w-full pl-8 pr-8 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 transition-colors disabled:opacity-50 ${
            focused ? 'border-amber-400' : 'border-slate-200'
          } ${inputClassName}`}
        />
        <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
          {loading
            ? <Loader2 size={13} className="text-slate-400 animate-spin" />
            : query
              ? <button type="button" onClick={handleClearStreet} className="text-slate-300 hover:text-slate-500 transition-colors" tabIndex={-1}><X size={13} /></button>
              : null
          }
        </div>

        {/* Suggestions dropdown */}
        {open && suggestions.length > 0 && (
          <div className="absolute z-[200] left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
            {suggestions.map((s, i) => (
              <button
                key={i}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); handleSelect(s); }}
                className="w-full text-left px-3 py-2.5 text-sm hover:bg-amber-50 flex items-start gap-2 border-b border-slate-50 last:border-0 transition-colors"
              >
                <MapPin size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <span className="text-slate-700 leading-snug">{s.display}</span>
              </button>
            ))}
            <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-100">
              <span className="text-[10px] text-slate-400">Powered by OpenStreetMap</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
