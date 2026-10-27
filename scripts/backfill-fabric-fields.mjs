/**
 * Phase 2 backfill for the fabric field split (docs/fabric-field-split.md).
 *
 * Works out fabricSupplier / fabricRange / fabricColourName / fabricCode for
 * every DISTINCT fabric string already on measure-sheet line items, and emits
 * the SQL to merge them in.
 *
 * Distinct-value based on purpose: the same fabric text always derives the
 * same fields, so there is one decision per fabric name rather than one per
 * line, which makes the result small enough to actually read before applying.
 *
 *   node scripts/backfill-fabric-fields.mjs --in fabrics.json          # report
 *   node scripts/backfill-fabric-fields.mjs --in fabrics.json --sql    # + SQL
 *
 * `fabrics.json` is [{ "fabric": "...", "lines": 26 }, ...], straight from:
 *
 *   select li->>'fabricColour' as fabric, count(*) as lines
 *   from measure_sheets ms
 *   cross join lateral jsonb_array_elements(ms.line_items) as li
 *   where coalesce(trim(li->>'fabricColour'),'') <> ''
 *   group by 1;
 *
 * Writes nothing itself. Print the SQL, read it, then run it.
 */
import { readFileSync } from 'node:fs';
import { deriveFabricFields } from '../src/lib/fabricFields.js';

const args = process.argv.slice(2);
const inPath = args[args.indexOf('--in') + 1];
const emitSql = args.includes('--sql');
if (!inPath || inPath.startsWith('--')) {
  console.error('usage: node scripts/backfill-fabric-fields.mjs --in <fabrics.json> [--sql]');
  process.exit(2);
}

const rows = JSON.parse(readFileSync(inPath, 'utf8'));
const results = rows.map((r) => ({ ...r, fields: deriveFabricFields(r.fabric) }));

const bucket = (f) => {
  if (f.fabricCode) return 'full';          // orderable: supplier + range + colour + code
  if (f.fabricRange) return 'range only';   // supplier + range, colour missing
  if (f.fabricSupplier) return 'supplier';  // supplier only
  return 'unplaced';
};

const tally = {};
let lines = 0;
for (const r of results) {
  const b = bucket(r.fields);
  tally[b] = (tally[b] || 0) + r.lines;
  lines += r.lines;
}

const pad = Math.max(...results.map((r) => JSON.stringify(r.fabric).length));
console.log('fabric'.padEnd(pad), ' lines  result');
console.log('-'.repeat(pad + 40));
for (const r of results.sort((a, b) => bucket(a.fields).localeCompare(bucket(b.fields)) || b.lines - a.lines)) {
  const f = r.fields;
  const detail = f.fabricCode
    ? `${f.fabricCode}  ${f.fabricRange} / ${f.fabricColourName}`
    : f.fabricRange ? `${f.fabricSupplier}  ${f.fabricRange}  (no colour)`
    : f.fabricSupplier ? `${f.fabricSupplier}  (range unknown)`
    : '—';
  console.log(JSON.stringify(r.fabric).padEnd(pad), String(r.lines).padStart(5), ' ', bucket(f).padEnd(11), detail);
}

console.log(`\n--- ${lines} lines over ${results.length} distinct fabrics ---`);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(11)} ${String(v).padStart(4)}  ${(v / lines * 100).toFixed(0)}%`);
}

if (!emitSql) {
  console.log('\n(dry run — pass --sql to print the UPDATE)');
  process.exit(0);
}

const placed = results.filter((r) => Object.keys(r.fields).length > 0);
if (!placed.length) { console.log('\nnothing to write'); process.exit(0); }

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const values = placed
  .map((r) => `    (${lit(r.fabric)}, ${lit(JSON.stringify(r.fields))}::jsonb)`)
  .join(',\n');

// Rebuilds line_items per sheet, merging the derived keys into elements whose
// fabricColour matches. `||` on jsonb is a shallow merge, so untouched keys
// survive and re-running is a no-op. Elements with no match pass through.
console.log(`
-- Phase 2 backfill. Review before running. Re-runnable (shallow merge).
-- Take a snapshot first:
--   create table measure_sheets_pre_fabric_backfill as select * from measure_sheets;

with m(fabric, fields) as (
  values
${values}
)
update measure_sheets ms
set line_items = (
  select jsonb_agg(
           case when m.fields is not null then li || m.fields else li end
           order by ord
         )
  from jsonb_array_elements(ms.line_items) with ordinality as t(li, ord)
  left join m on m.fabric = li->>'fabricColour'
)
where exists (
  select 1 from jsonb_array_elements(ms.line_items) as li
  join m on m.fabric = li->>'fabricColour'
);
`);
