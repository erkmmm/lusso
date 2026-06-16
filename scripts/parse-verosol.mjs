/**
 * parse-verosol.mjs — Extract Verosol PDF text and call parse-supplier-pdf edge function
 * Handles large PDFs by finding the product section and chunking if needed
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL  = 'https://wwompnqglvdxcmjquuzr.supabase.co';
const ANON_KEY      = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3b21wbnFnbHZkeGNtanF1dXpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NDcxNjgsImV4cCI6MjA5MjMyMzE2OH0.Nwi3iDALvMgIcUQDfGDUjLa6dl_XaiuNT_aumcKJR4g';
const PDF_PATH      = 'C:\\Users\\hopki\\Downloads\\Verosol-2026-Retail-Pricelist-v1_0.pdf';
const SUPPLIER_NAME = 'Verosol';
const EMAIL         = 'jett@lusso.com.au';
const PASSWORD      = 'jh87883JH87883';

// 1. Sign in
console.log('🔑 Signing in...');
const authRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const { access_token: token } = await authRes.json();
if (!token) { console.error('Auth failed'); process.exit(1); }
console.log('✅ Signed in');

// 2. Extract PDF text
console.log('\n📄 Extracting text from Verosol PDF...');
const pdfjs = await import('../node_modules/pdfjs-dist/legacy/build/pdf.mjs');
const workerPath = new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href;
pdfjs.GlobalWorkerOptions.workerSrc = workerPath;

const pdfBuffer = readFileSync(PDF_PATH);
const pdf = await pdfjs.getDocument({
  data: new Uint8Array(pdfBuffer),
  disableFontFace: true,
  useWorkerFetch: false,
  isEvalSupported: false,
  useSystemFonts: true,
}).promise;

const total = pdf.numPages;
console.log(`  Pages: ${total}`);

const pageTexts = [];
for (let p = 1; p <= total; p++) {
  if (p % 100 === 0) process.stdout.write(`  ${p}/${total}... `);
  try {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();
    const text    = content.items.map(i => i.str ?? '').join(' ').trim();
    pageTexts.push({ page: p, text });
  } catch { pageTexts.push({ page: p, text: '' }); }
}

const fullText = pageTexts.map(p => p.text).join('\n');
console.log(`\n✅ ${fullText.length.toLocaleString()} chars extracted`);

// 3. Show structure of first few pages
console.log('\n📋 First 3 pages sample:');
pageTexts.slice(0, 3).forEach(p => {
  console.log(`  [Page ${p.page}]: ${p.text.slice(0, 120).replace(/\s+/g, ' ')}...`);
});

// 4. Show structure of pages 15-50 to find roller blind section
console.log('\n📋 Pages 15-50 content preview:');
for (let p = 15; p <= 50; p += 3) {
  const pg = pageTexts.find(x => x.page === p);
  if (pg?.text.length > 20) {
    const preview = pg.text.slice(0, 120).replace(/\s+/g, ' ');
    const hasDollar = (pg.text.match(/\$\d+/g) || []).length;
    const hasRoller = /roller|ambience|sunscreen|blockout|blackout/i.test(pg.text);
    console.log(`  [p${p}] ${hasDollar}× prices | roller:${hasRoller} | ${preview}`);
  }
}

// Find pages with $ prices that mention roller blinds
let rollerPages = [];
let otherPages  = [];
for (const pt of pageTexts) {
  const hasPrices = (pt.text.match(/\$\d+/g) || []).length >= 2;
  const isRoller  = /roller|ambience|screen|blackout|blockout|sunscreen/i.test(pt.text);
  const isPleated = /pleated|cellular|verocell/i.test(pt.text);
  if (hasPrices && pt.text.length > 100) {
    if (isRoller && !isPleated) rollerPages.push(pt.page);
    else if (!isPleated)        otherPages.push(pt.page);
  }
}
console.log(`\n🎯 Roller-related pages with prices: ${rollerPages.slice(0, 12).join(', ')}...`);

// Use roller blind pages for this pass (we already imported pleated pages)
const targetPages = rollerPages.length > 0 ? rollerPages : otherPages;
const startPage   = targetPages[0] || 15;

console.log(`   Targeting pages: ${targetPages.slice(0, 10).join(', ')}`);
const samplePage = pageTexts.find(p => p.page === startPage);
console.log(`   Sample from p${startPage}: ${samplePage?.text.slice(0, 300).replace(/\s+/g, ' ')}`);

// 5. Build chunk from roller blind pages
const productText = pageTexts
  .filter(p => targetPages.includes(p.page))
  .map(p => p.text)
  .join('\n');

// Split into 40k chunks to avoid token limit truncation
const CHUNK_SIZE = 40_000;
const chunks = [];
for (let i = 0; i < Math.min(productText.length, 160_000); i += CHUNK_SIZE) {
  chunks.push(productText.slice(i, i + CHUNK_SIZE));
}
console.log(`\n📦 Splitting into ${chunks.length} × 40k-char chunks (${targetPages.length} roller-blind pages)`);

// 6. Call edge function for each chunk, merge results
const allItems = [];
const seenNames = new Set();

for (let ci = 0; ci < chunks.length; ci++) {
  process.stdout.write(`\n🤖 Parsing chunk ${ci+1}/${chunks.length} (${chunks[ci].length.toLocaleString()} chars)... `);

  const parseRes = await fetch(`${SUPABASE_URL}/functions/v1/parse-supplier-pdf`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: chunks[ci], supplierName: SUPPLIER_NAME }),
  });

  const parseData = await parseRes.json();
  if (!parseRes.ok || parseData.error) {
    console.log(`❌ ${parseData.error}`);
    if (parseData.debug) console.log('   Debug:', parseData.debug.slice(0, 200));
    continue; // skip this chunk, try next
  }

  const chunkItems = parseData.items ?? [];
  let newCount = 0;
  for (const item of chunkItems) {
    const key = item.itemName?.toLowerCase().trim();
    if (key && !seenNames.has(key)) {
      seenNames.add(key);
      allItems.push(item);
      newCount++;
    }
  }
  console.log(`✅ ${chunkItems.length} found, ${newCount} new (${allItems.length} total)`);
}

const items = allItems;
if (items.length === 0) {
  console.error('\n❌ No products extracted from any chunk');
  process.exit(1);
}
console.log(`\n✅ ${items.length} products extracted`);

console.log('\n📦 First 10 items:');
items.slice(0, 10).forEach((item, i) => {
  const sell  = item.sellPrice  != null ? `RRP $${item.sellPrice}`  : '';
  const cost  = item.costPrice  != null ? `Cost $${item.costPrice}` : '';
  console.log(`  [${i+1}] ${item.itemName.slice(0,50).padEnd(50)} | ${item.category.padEnd(18)} | ${cost} ${sell}`);
});

// 7. Save results locally
const out = { supplier: SUPPLIER_NAME, parsedAt: new Date().toISOString(), count: items.length, items };
writeFileSync(join(__dirname, 'verosol-parsed.json'), JSON.stringify(out, null, 2));
console.log(`\n💾 Saved to scripts/verosol-parsed.json`);

// 8. Insert directly to Supabase priced_items table
// Generate IDs and map fields to DB schema
const { v4: uuidv4 } = await import('node:crypto').then(c => ({ v4: () => c.randomUUID() }));
const now = new Date().toISOString();

// First create a batch record
const batchId = uuidv4();
const batchPayload = {
  id: batchId,
  file_name: 'Verosol-2026-Retail-Pricelist-v1_0.pdf',
  source: 'Supplier PDF — Verosol',
  status: 'Completed',
  total_rows: items.length,
  imported_count: items.length,
  created_at: now,
};

// Use Jett's auth token (account manager — has write access to priced_items via RLS)
// We already have `token` from the sign-in step above
const authHeaders = {
  'Content-Type': 'application/json',
  'apikey': ANON_KEY,
  'Authorization': `Bearer ${token}`,
  'Prefer': 'return=minimal',
};

console.log('\n📤 Inserting batch record...');
const batchRes = await fetch(`${SUPABASE_URL}/rest/v1/priced_item_batches`, {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify(batchPayload),
});
if (!batchRes.ok) {
  const err = await batchRes.text();
  console.log('  Batch insert (non-fatal):', err.slice(0,200));
}

console.log('\n📤 Inserting', items.length, 'priced items into Supabase...');
const rows = items.map(item => ({
  id:             uuidv4(),
  item_name:      item.itemName,
  item_code:      item.itemCode || '',
  description:    item.description || '',
  category:       item.category || 'Other',
  supplier:       SUPPLIER_NAME,
  cost_price:     item.costPrice ?? null,
  sell_price:     item.sellPrice ?? null,
  margin_percent: item.marginPercent ?? null,
  unit:           item.unit || 'each',
  is_active:      true,
  gst_applicable: true,
  tax_rate:       10,
  source:         'Supplier PDF — Verosol',
  batch_id:       batchId,
  created_at:     now,
  updated_at:     now,
}));

const CHUNK = 50;
let inserted = 0;
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/priced_items`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(chunk),
  });
  if (res.ok) {
    inserted += chunk.length;
    console.log(`  ✅ Inserted ${inserted}/${rows.length}`);
  } else {
    const err = await res.text();
    console.error(`  ❌ Chunk ${i}-${i+CHUNK} failed:`, err.slice(0, 200));
  }
}

console.log(`\n🎉 Done! ${inserted} Verosol products now in the priced items library.`);
console.log('   Refresh the Priced Items page in the app to see them.');
