/**
 * Product Docs — the searchable directory of supplier spec sheets, install
 * guides, warranty and care documents.
 *
 * Grouped by PRODUCT rather than listed as files, because the question a
 * salesperson arrives with is "what do I know about this blind?", not "where is
 * that PDF?".
 *
 * Two kinds of search, deliberately:
 *   • titles, suppliers, codes and product names — local, instant, works with no
 *     signal, which is the case that matters in someone's house.
 *   • inside the documents — an online query against the extracted text. It
 *     widens the results when there's a connection and is silently skipped when
 *     there isn't, so the page never depends on it.
 */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  FileText, Plus, Search, X, Package, Tag, Building2, WifiOff, Loader2, FileSearch,
} from 'lucide-react';
import {
  getProductDocuments, deleteProductDocument, searchProductDocumentText,
  getPricedItems, getActiveProductTypes, getPricedItemsInScope,
} from '../store/data';
import { DOC_TYPES, docTypeLabel } from '../lib/productDocs';
import { summariseLimits } from '../lib/productLimits';
import Card from '../components/Card';
import ProductDocUpload from '../components/ProductDocUpload';
import ProductDocViewer from '../components/ProductDocViewer';

const TYPE_STYLE = {
  spec:     'bg-amber-50 text-amber-700 border-amber-200',
  install:  'bg-blue-50 text-blue-700 border-blue-200',
  fabric:   'bg-purple-50 text-purple-700 border-purple-200',
  warranty: 'bg-green-50 text-green-700 border-green-200',
  care:     'bg-teal-50 text-teal-700 border-teal-200',
  other:    'bg-slate-50 text-slate-600 border-slate-200',
};

const fmtSize = (b) => (!b ? '' : b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`);

function DocRow({ doc, onOpen }) {
  return (
    <button onClick={() => onOpen(doc)}
      className="w-full text-left flex items-start gap-3 px-4 py-2.5 hover:bg-amber-50/60 transition-colors border-t border-slate-50">
      <FileText size={15} className="text-slate-300 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-slate-800 font-medium">{doc.title}</span>
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${TYPE_STYLE[doc.docType] || TYPE_STYLE.other}`}>
            {docTypeLabel(doc.docType)}
          </span>
          {summariseLimits(doc.limits) && (
            <span title="These limits are checked against every measured line"
              className="text-[10px] font-medium px-1.5 py-0.5 rounded-full border bg-teal-50 text-teal-700 border-teal-200">
              {summariseLimits(doc.limits)}
            </span>
          )}
          {!doc.hasText && (
            <span title="No text layer — findable by its details, not its contents"
              className="text-[10px] text-slate-400 border border-slate-200 rounded-full px-1.5 py-0.5">
              not text-searchable
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400 truncate">
          {[doc.productCode, doc.version && `v${doc.version}`, doc.issued,
            doc.pageCount ? `${doc.pageCount}p` : null, fmtSize(doc.fileSize)]
            .filter(Boolean).join(' · ') || doc.fileName}
        </p>
      </div>
    </button>
  );
}

export default function ProductDocs() {
  // Arriving from a Price Library row lands here pre-searched for that product.
  const [searchParams] = useSearchParams();
  const [docs, setDocs]       = useState(() => getProductDocuments());
  const [query, setQuery]     = useState(() => searchParams.get('q') || '');
  const [typeFilter, setType] = useState('');
  const [supFilter, setSup]   = useState('');
  const [uploadOpen, setUp]   = useState(false);
  const [editDoc, setEdit]    = useState(null);
  const [viewDoc, setView]    = useState(null);
  // Result of the last full-text search, tagged with the query it answered.
  // Tagging (rather than clearing on every keystroke) is what lets the effect
  // below avoid setting state synchronously, and it means a stale result can
  // never be shown against a newer query.
  const [textHits, setHits]   = useState(null);   // { q, ids: Set<docId> }
  const [offline, setOffline] = useState(!navigator.onLine);

  const pricedItems  = useMemo(() => getPricedItems(), []);
  const productTypes = useMemo(() => getActiveProductTypes(), []);

  const refresh = () => setDocs(getProductDocuments());

  useEffect(() => {
    const on = () => setOffline(false), off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Full-text search runs debounced and separately from the local filter, so the
  // list is never waiting on the network to show what it already knows.
  const trimmed = query.trim();
  const hits     = textHits && textHits.q === trimmed ? textHits.ids : null;
  const searching = trimmed.length >= 3 && !hits;

  useEffect(() => {
    if (trimmed.length < 3) return;
    let live = true;
    const t = setTimeout(async () => {
      const ids = await searchProductDocumentText(trimmed);
      if (live) setHits({ q: trimmed, ids: new Set(ids) });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [trimmed]);

  // The heading each document gets grouped under, from its scope. A supplier
  // range is titled by what it covers and says how many products that is, so
  // the reach of one PDF is visible without opening anything.
  const labelFor = useMemo(() => {
    const byItem = Object.fromEntries(pricedItems.map(i => [i.id, i]));
    const byType = Object.fromEntries(productTypes.map(p => [p.id, p]));
    return (doc) => {
      if (doc.scope === 'supplier' && doc.supplier) {
        const cat = String(doc.category || '').trim();
        const n = getPricedItemsInScope({ supplier: doc.supplier, category: cat }).length;
        return {
          key:  `s:${doc.supplier.toLowerCase()}|${cat.toLowerCase()}`,
          name: cat ? `${doc.supplier} — ${cat}` : `${doc.supplier} — all products`,
          sub:  n ? `${n} price-library product${n !== 1 ? 's' : ''}` : 'no matching products yet',
          kind: 'supplier',
        };
      }
      const item = doc.scope === 'item' && doc.pricedItemId && byItem[doc.pricedItemId];
      if (item) return { key: `i:${item.id}`, name: item.itemName, sub: item.supplier || item.category || '', kind: 'item' };
      const pt = doc.scope === 'type' && doc.productTypeId && byType[doc.productTypeId];
      if (pt) return { key: `t:${pt.id}`, name: pt.name, sub: 'Product type — every brand', kind: 'type' };
      return { key: 'unassigned', name: 'Not attached to a product', sub: '', kind: 'none' };
    };
  }, [pricedItems, productTypes]);

  const suppliers = useMemo(
    () => [...new Set(docs.map(d => d.supplier).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [docs],
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (d) => {
      if (typeFilter && d.docType !== typeFilter) return false;
      if (supFilter && d.supplier !== supFilter) return false;
      if (!q) return true;
      const local = [d.title, d.supplier, d.productCode, d.fileName, d.notes, labelFor(d).name]
        .filter(Boolean).join(' ').toLowerCase();
      return local.includes(q) || (hits?.has(d.id) ?? false);
    };

    const map = new Map();
    for (const d of docs) {
      if (!matches(d)) continue;
      const l = labelFor(d);
      if (!map.has(l.key)) map.set(l.key, { ...l, docs: [] });
      map.get(l.key).docs.push(d);
    }
    return [...map.values()]
      .sort((a, b) => (a.kind === 'none') - (b.kind === 'none') || a.name.localeCompare(b.name));
  }, [docs, query, typeFilter, supFilter, hits, labelFor]);

  const shown = groups.reduce((n, g) => n + g.docs.length, 0);
  const insideHits = hits ? docs.filter(d => hits.has(d.id)).length : 0;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5 pb-28">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Product Docs</h1>
          <p className="text-sm text-slate-400">
            {docs.length} document{docs.length !== 1 ? 's' : ''} — spec sheets, install guides, warranty and care
          </p>
        </div>
        <button onClick={() => { setEdit(null); setUp(true); }}
          className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-white text-sm font-semibold rounded-lg px-4 py-2.5 flex-shrink-0">
          <Plus size={15} /> <span className="hidden sm:inline">Add document</span>
        </button>
      </div>

      {/* Search + filters */}
      <Card className="p-4 space-y-3">
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search products, suppliers, codes — or words inside the documents…"
            className="w-full pl-9 pr-9 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select value={typeFilter} onChange={e => setType(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white">
            <option value="">All types</option>
            {DOC_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <select value={supFilter} onChange={e => setSup(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white">
            <option value="">All suppliers</option>
            {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {(query || typeFilter || supFilter) && (
            <button onClick={() => { setQuery(''); setType(''); setSup(''); }}
              className="text-xs text-slate-400 hover:text-slate-600 px-1">Clear</button>
          )}

          {/* Be explicit about what the search did and didn't cover. */}
          <span className="ml-auto text-xs text-slate-400 flex items-center gap-1.5">
            {searching ? (
              <><Loader2 size={12} className="animate-spin" /> searching inside documents…</>
            ) : offline && trimmed.length >= 3 ? (
              <><WifiOff size={12} /> offline — searched titles and codes only</>
            ) : insideHits > 0 ? (
              <><FileSearch size={12} /> {insideHits} matched on their contents</>
            ) : null}
          </span>
        </div>
      </Card>

      {/* Results */}
      {groups.length === 0 ? (
        <Card className="px-5 py-12 text-center">
          <FileText size={28} className="text-slate-200 mx-auto mb-3" />
          {docs.length === 0 ? (
            <>
              <p className="text-sm text-slate-600 font-medium">No documents yet</p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Add a supplier spec sheet and attach it to the product it describes — it'll be findable here and,
                soon, from the measure sheet line itself.
              </p>
              <button onClick={() => { setEdit(null); setUp(true); }}
                className="mt-4 text-sm font-medium text-amber-600 hover:underline">Add the first one →</button>
            </>
          ) : (
            <p className="text-sm text-slate-500">
              Nothing matches <strong>{query}</strong>{typeFilter || supFilter ? ' with those filters' : ''}.
            </p>
          )}
        </Card>
      ) : (
        <>
          <p className="text-xs text-slate-400 px-1">
            {shown} document{shown !== 1 ? 's' : ''} across {groups.length} product{groups.length !== 1 ? 's' : ''}
          </p>
          <div className="space-y-3">
            {groups.map(g => (
              <Card key={g.key} className="overflow-hidden">
                <div className="px-4 py-3 bg-slate-50/60 flex items-center gap-2.5">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    g.kind === 'supplier' ? 'bg-amber-100 text-amber-600'
                      : g.kind === 'item' ? 'bg-green-100 text-green-600'
                      : g.kind === 'type' ? 'bg-slate-200 text-slate-500'
                      : 'bg-red-50 text-red-400'
                  }`}>
                    {g.kind === 'supplier' ? <Building2 size={14} />
                      : g.kind === 'item' ? <Package size={14} />
                      : g.kind === 'type' ? <Tag size={14} /> : <FileText size={14} />}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{g.name}</p>
                    {g.sub && <p className="text-xs text-slate-400">{g.sub}</p>}
                  </div>
                  <span className="ml-auto text-xs text-slate-400 flex-shrink-0">
                    {g.docs.length} doc{g.docs.length !== 1 ? 's' : ''}
                  </span>
                </div>
                {g.docs.map(d => <DocRow key={d.id} doc={d} onOpen={setView} />)}
              </Card>
            ))}
          </div>
        </>
      )}

      {uploadOpen && (
        <ProductDocUpload
          key={editDoc?.id || 'new'}
          editDoc={editDoc}
          onClose={() => { setUp(false); setEdit(null); }}
          onSaved={refresh}
        />
      )}

      {viewDoc && (
        <ProductDocViewer
          key={viewDoc.id}
          doc={viewDoc}
          onClose={() => setView(null)}
          onEdit={(d) => { setView(null); setEdit(d); setUp(true); }}
          onDelete={(d) => { deleteProductDocument(d.id); refresh(); }}
        />
      )}
    </div>
  );
}
