/**
 * Import — one page for everything that loads data into Lusso.
 *
 * These used to live on six unrelated routes, three of them linked from a
 * Settings section and the rest reachable only if you already knew the URL.
 * Importing a supplier price list is a recurring job, not a setting, so it sits
 * in the sidebar next to the Price Library rather than behind Settings.
 *
 * Grouped by what you're loading rather than by which page happens to implement
 * it — pricing is the group you'll open most, so it goes first.
 */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Upload, FileSpreadsheet, Ruler, Users, FileText, History,
  ArrowRight, Layers, Calculator, Package,
} from 'lucide-react';
import { useDataRefresh } from '../hooks/useDataRefresh';
import { getPricedItems, getCurtainRates, getPricedItemBatches } from '../store/data';
import { isFabricItem } from '../lib/curtainCalc';

/** One importer. `status` is a live count so the page shows what's already in. */
function ImportCard({ icon: Icon, title, desc, format, status, accent, onClick }) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-amber-300 hover:bg-amber-50/40"
    >
      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${accent}`}>
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-semibold text-slate-800">{title}</span>
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{format}</span>
        </span>
        <span className="mt-0.5 block text-xs text-slate-500">{desc}</span>
        {status && <span className="mt-1.5 block text-[11px] font-medium text-teal-700">{status}</span>}
      </span>
      <ArrowRight size={15} className="mt-1 shrink-0 text-slate-300 transition-colors group-hover:text-amber-500" />
    </button>
  );
}

function Group({ label, hint, children }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</h2>
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export default function ImportHub() {
  const navigate = useNavigate();
  useDataRefresh();

  // Live counts, so the page says what's already loaded rather than making you
  // go and look.
  const { products, fabrics, trackTables, lastImport } = useMemo(() => {
    const items = getPricedItems();
    const rates = getCurtainRates();
    const batches = getPricedItemBatches() || [];
    const latest = [...batches].sort((a, b) =>
      new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
    return {
      products:    items.filter(p => !isFabricItem(p)).length,
      fabrics:     items.filter(isFabricItem).length,
      trackTables: Object.keys(rates.oslo?.prices || {}).length,
      lastImport:  latest,
    };
  }, []);

  const when = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
          <Upload size={20} className="text-amber-500" /> Import
        </h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Everything that loads data into Lusso, in one place.
        </p>
      </div>

      <Group label="Pricing" hint="the ones you'll run again each year">
        <ImportCard
          icon={FileText} accent="bg-amber-100 text-amber-700"
          title="Supplier price list" format="PDF"
          desc="Read a fabric price book straight off the page — name, cost per metre and roll width, every row."
          status={fabrics > 0 ? `${fabrics} fabrics in the library` : null}
          onClick={() => navigate('/priced-items/import-pdf')}
        />
        <ImportCard
          icon={Calculator} accent="bg-teal-100 text-teal-700"
          title="Track prices" format="PDF"
          desc="Update the banded track pricing the curtain calculator uses, with old against new before you apply."
          status={trackTables > 0 ? `${trackTables} track tables on the rate card` : null}
          onClick={() => navigate('/curtain-rates/import')}
        />
        <ImportCard
          icon={Package} accent="bg-slate-100 text-slate-600"
          title="Priced items" format="CSV"
          desc="Bulk-load the product side of the price library from a spreadsheet."
          status={products > 0 ? `${products} products in the library` : null}
          onClick={() => navigate('/priced-items?tab=import')}
        />
        <ImportCard
          icon={Layers} accent="bg-slate-100 text-slate-600"
          title="Measure sheet" format="Excel"
          desc="Bring an existing measure sheet in as a job rather than retyping it."
          onClick={() => navigate('/measure-sheets/import')}
        />
      </Group>

      <Group label="Customers & history" hint="usually one-off, when setting up">
        <ImportCard
          icon={Users} accent="bg-slate-100 text-slate-600"
          title="Contacts" format="CSV"
          desc="Import customer contacts from Quotient or any other source."
          onClick={() => navigate('/import')}
        />
        <ImportCard
          icon={FileSpreadsheet} accent="bg-slate-100 text-slate-600"
          title="Past quotes" format="CSV"
          desc="Quotient “Summary of Quotes” plus “Price Items” — brings your quote history across."
          onClick={() => navigate('/quotes/import')}
        />
      </Group>

      <Group label="Record">
        <ImportCard
          icon={History} accent="bg-slate-100 text-slate-600"
          title="Import history" format="Log"
          desc="What was imported, when, and how many rows landed or failed."
          status={lastImport ? `Last: ${lastImport.fileName || 'import'}${when(lastImport.createdAt) ? ` · ${when(lastImport.createdAt)}` : ''}` : null}
          onClick={() => navigate('/import-history')}
        />
        <ImportCard
          icon={Ruler} accent="bg-slate-100 text-slate-600"
          title="BUZ export" format="Excel"
          desc="The other direction — send a roller-blind measure sheet out to BUZ."
          onClick={() => navigate('/settings?section=exports')}
        />
      </Group>
    </div>
  );
}
