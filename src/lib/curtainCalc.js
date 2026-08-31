/**
 * Curtain cost calculator.
 *
 * A faithful port of the "Curtain calculation" workbook (Sheet1 → 32×
 * 'calculation sheet N' → 'Curtain Cost'), collapsed into one pure function.
 * Each calculation sheet in that workbook was the same formulas pointed at a
 * different measure-sheet row, so one function replaces all 32.
 *
 * The cost of a curtain is four things added together:
 *
 *   fabric   — metreage × $/m, where the metreage depends on whether the fabric
 *              runs vertically ("Regular": cut into drops) or is railroaded
 *              ("Continuous": run sideways off the roll). Continuous is used
 *              whenever the finished drop fits inside the fabric's width.
 *   making   — total fullness ÷ a standard 1.4m drop width × $/drop.
 *   track    — either $/m × width for a manual track, or a banded lookup for
 *              the motorised Oslo range (priced by track size and heading).
 *   fitting  — a banded install charge on width, plus a surcharge for tall
 *              drops, doubled for dual tracks.
 *
 * Attached lining, when enabled, adds a second fabric + making pair.
 *
 * ── Deviation from the spreadsheet ──────────────────────────────────────────
 * The lining block in the workbook is broken and has been reimplemented here.
 * In the original, A28 reads `=D22+350` where D22 is an empty cell (so it
 * computed 350 instead of drop+350), C28 divides by 1000 a second time, F31 is
 * a hard-typed 100.6 rather than a formula, and F34's Regular/Continuous test
 * compares a number against the text label in F21 (so it always chose
 * Continuous). Lining was "Disabled" on every row of the sheets I worked from,
 * so none of it ever affected a real number. It is implemented here by exact
 * analogy with the main fabric block, which is what those formulas were
 * evidently copied from.
 */

// ── Default rates ────────────────────────────────────────────────────────────
// The values the workbook used. Everything here is editable in Settings and
// stored per-business; these are only the starting point (and the fallback if
// the rates row hasn't loaded yet).
export const DEFAULT_CURTAIN_RATES = {
  // Heading → fullness multiplier. Widths are multiplied by this before being
  // divided into drops.
  // Headings are matched case-insensitively, so the app's Title Case options
  // ("Knife Pleat") hit the workbook's sentence case ("Knife pleat"). "Wave
  // Fold" is the app's name for what the workbook called "Ripple fold" — both
  // are listed so either spelling prices.
  fullness: {
    'Double pinch pleat': 2.5,
    'Triple pinch pleat': 2.5,
    'Ripple fold':        2.3,
    'Wave fold':          2.3,
    'Reverse pleat':      2,
    'Gathered':           1.8,
    'Knife pleat':        1.6,
  },

  fabricWidthMm:     3300,  // roll width, used to decide Regular vs Continuous
  fabricPricePerM:   21,    // $/m — normally overridden per line by the fabric
  sideAllowanceM:    0.2,   // added to every fullness calc (returns + side hems)
  hemAllowanceMm:    350,   // added to the drop for a cut length
  makingRatePerDrop: 55,    // $ per made drop
  makingDropWidthM:  1.4,   // a "drop" for making purposes

  lining: {
    heading:           'Gathered', // lining is made to this fullness…
    followCurtain:     false,      // …unless this is on, then it matches the face fabric
    fabricWidthMm:     3000,
    pricePerM:         17,
    makingRatePerDrop: 55,
  },

  // Manually-priced tracks: $/m of track. A track type listed here is priced
  // per metre; anything else falls through to the Oslo table below.
  trackRatePerM: {
    'No tracks':      0,
    'CRM01':          65,
    'KAW':            17,
    'MKH':            40,
    'Dual KAW':       30,
    'Dual MKH':       57,
    'MKH and KAW':    42,
    'Fineline':       40,
    'Bendable track': 11,
  },

  // Motorised / Oslo tracks: price by band. `widthsMm` is the upper bound of
  // each band — the first band at or above the curtain width is the one used.
  oslo: {
    widthsMm: [2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000],
    prices: {
      'Oslo 84 (Manual)': {
        standard:  [127.70, 167.00, 207.65, 251.75, 291.05, 340.15, 380.85, 423.55, 464.20, 504.85, 541.45],
        clearWave: [170.65, 233.80, 290.90, 351.35, 408.45, 473.95, 531.05, 597.60, 654.65, 711.75, 768.80],
      },
      'Oslo 84 (240v)': {
        standard:  [480, 550, 640, 695, 750, 810, 865, 940, 1000, 1065, 1150],
        clearWave: [585, 665, 755, 830, 905, 985, 1060, 1140, 1215, 1285, 1360],
      },
      'Oslo 83 (Battery)': {
        standard:  [680, 750, 840, 895, 950, 1010, 1065, 1140, 1200, 1265, 1350],
        clearWave: [785, 865, 955, 1030, 1105, 1185, 1260, 1340, 1415, 1485, 1560],
      },
      'Oslo 70 (Recess)': {
        standard:  [63.80, 86.00, 109.15, 132.30, 140.40, 164.40, 188.40, 212.40, 236.40, 260.40, 284.40],
        clearWave: [101.60, 138.90, 177.00, 219.20, 242.40, 283.40, 324.40, 365.40, 406.40, 447.40, 488.40],
      },
    },
    // Headings that take the "Clear Wave" column instead of "Standard".
    clearWaveHeadings: ['Ripple fold', 'Wave fold'],
  },

  fitting: {
    // Banded on width: the first band at or above the width wins.
    bands: [
      { maxWidthMm: 2000, cost: 100 },
      { maxWidthMm: 3000, cost: 150 },
      { maxWidthMm: 5000, cost: 250 },
    ],
    // Past the last band: base, plus `step` for every whole `perMm` over.
    over: { fromMm: 5000, base: 300, perMm: 1000, step: 50 },
    // Tall drops: `amount` for every whole `perMm` over `overMm`.
    dropSurcharge: { overMm: 3000, perMm: 1000, amount: 70 },
    // Track types that need two runs fitted, so the whole charge doubles.
    dualTrackTypes: ['Dual KAW', 'Dual MKH', 'MKH and KAW'],
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Deep-merge stored rates over the defaults, so a partial row still works. */
export const mergeCurtainRates = (stored) => {
  const s = stored && typeof stored === 'object' ? stored : {};
  const d = DEFAULT_CURTAIN_RATES;
  return {
    ...d,
    ...s,
    fullness:      { ...d.fullness,      ...(s.fullness      || {}) },
    trackRatePerM: { ...d.trackRatePerM, ...(s.trackRatePerM || {}) },
    lining:        { ...d.lining,        ...(s.lining        || {}) },
    oslo:  { ...d.oslo,  ...(s.oslo  || {}), prices: { ...d.oslo.prices, ...(s.oslo?.prices || {}) } },
    fitting: {
      ...d.fitting, ...(s.fitting || {}),
      over:          { ...d.fitting.over,          ...(s.fitting?.over          || {}) },
      dropSurcharge: { ...d.fitting.dropSurcharge, ...(s.fitting?.dropSurcharge || {}) },
    },
  };
};

/**
 * Fullness multiplier for a heading.
 *
 * Matched case-insensitively so "knife pleat" off a pasted measure sheet still
 * prices — the workbook's exact-match IF chain silently returned FALSE (which
 * Excel then treats as 0) for anything it didn't recognise, quietly zeroing the
 * fabric. Here an unknown heading is reported instead.
 */
export const fullnessFor = (heading, rates) => {
  const table = rates.fullness || {};
  const want  = String(heading || '').trim().toLowerCase();
  if (!want) return null;
  const hit = Object.keys(table).find(k => k.toLowerCase() === want);
  return hit ? num(table[hit]) : null;
};

/** Case-insensitive lookup of a track's per-metre rate. `null` if not listed. */
const trackRateFor = (trackType, rates) => {
  const table = rates.trackRatePerM || {};
  const want  = String(trackType || '').trim().toLowerCase();
  if (!want) return null;
  const hit = Object.keys(table).find(k => k.toLowerCase() === want);
  if (hit) return num(table[hit]);
  // The workbook also matched any name containing both "MKH" and "KAW" at the
  // dual rate, so a "MKH & KAW" or "KAW/MKH" spelling still prices.
  if (want.includes('mkh') && want.includes('kaw')) {
    const dual = Object.keys(table).find(k => k.toLowerCase() === 'mkh and kaw');
    return dual ? num(table[dual]) : null;
  }
  return null;
};

/** Banded Oslo lookup: first band at or above the width. */
const osloPrice = (trackType, heading, widthMm, rates) => {
  const oslo = rates.oslo || {};
  const want = String(trackType || '').trim().toLowerCase();
  const key  = Object.keys(oslo.prices || {}).find(k => k.toLowerCase() === want);
  if (!key) return { price: null, reason: 'unknown-track' };

  // Bands can differ per series — a recess track is sold 1–6m in half metres
  // while a motorised 84 runs 2–12m in whole ones, and a battery track stops at
  // 8m because you can't buy it longer. A series carries its own widths when it
  // has them, falling back to the shared set.
  const bands = oslo.prices[key]?.widthsMm?.length ? oslo.prices[key].widthsMm : (oslo.widthsMm || []);
  const idx   = bands.findIndex(b => widthMm <= num(b));
  if (idx < 0) return { price: null, reason: 'over-max-width' };

  const wave = oslo.clearWaveHeadings || (oslo.clearWaveHeading ? [oslo.clearWaveHeading] : []);
  const isClearWave = wave.some(h =>
    String(h).trim().toLowerCase() === String(heading || '').trim().toLowerCase());
  const column = isClearWave ? 'clearWave' : 'standard';
  const price  = oslo.prices[key]?.[column]?.[idx];
  if (!Number.isFinite(Number(price))) return { price: null, reason: 'no-band-price' };
  return { price: num(price), band: num(bands[idx]), column };
};

/**
 * Fabric metreage for one curtain, in both cutting modes.
 *
 * Continuous (railroaded) is used when the finished drop fits inside the
 * fabric's width — the fabric runs sideways off the roll, so you buy the made
 * width and nothing more. Otherwise the fabric runs vertically and is cut into
 * whole drops, each one the finished drop plus a hem allowance.
 */
const fabricMetreage = ({ widthMm, dropMm, fullness, fabricWidthMm, hemAllowanceMm, sideAllowanceM }) => {
  const totalFullnessM = widthMm * fullness / 1000 + sideAllowanceM;
  const cutLengthMm    = dropMm + hemAllowanceMm;
  const mode           = cutLengthMm > fabricWidthMm ? 'Regular' : 'Continuous';

  const dropsRequired  = Math.ceil(totalFullnessM / (fabricWidthMm / 1000));
  const regularM       = cutLengthMm * dropsRequired / 1000;

  return {
    mode,
    totalFullnessM,
    cutLengthMm,
    dropsRequired: mode === 'Regular' ? dropsRequired : null,
    meterage: mode === 'Regular' ? regularM : totalFullnessM,
  };
};

// ── The calculator ───────────────────────────────────────────────────────────

/**
 * Cost one curtain.
 *
 * @param {object} input
 *   widthMm, dropMm            — finished size (required)
 *   heading                    — e.g. 'Knife pleat'; drives fullness (required)
 *   fabricPricePerM            — $/m for the face fabric
 *   fabricWidthMm              — roll width; defaults to the configured width
 *   trackType                  — e.g. 'Oslo 84 (240v)', 'Fineline', 'No tracks'
 *   fittingEnabled             — include the install charge (default true)
 *   lining                     — { enabled, pricePerM?, fabricWidthMm?, heading? }
 *   extraCost                  — one-off additions (bending, freight, …)
 * @param {object} rates        — merged rate config (see mergeCurtainRates)
 * @returns {object} a full breakdown; `warnings` lists anything it couldn't price.
 */
export function calcCurtain(input = {}, rates = DEFAULT_CURTAIN_RATES) {
  const r        = mergeCurtainRates(rates);
  const warnings = [];

  const widthMm = num(input.widthMm);
  const dropMm  = num(input.dropMm);
  const heading = input.heading || '';

  const fabricWidthMm   = num(input.fabricWidthMm) || num(r.fabricWidthMm);
  const fabricPricePerM = num(input.fabricPricePerM);
  const hemAllowanceMm  = num(r.hemAllowanceMm);
  const sideAllowanceM  = num(r.sideAllowanceM);

  // A line without a size isn't a cheap curtain, it's an unmeasured one. The
  // workbook returned #N/A for these; returning $0 and a warning keeps a
  // half-filled row from quietly contributing a fitting charge to a quote.
  if (widthMm <= 0 || dropMm <= 0) {
    if (widthMm <= 0) warnings.push('No width — not priced.');
    if (dropMm  <= 0) warnings.push('No drop — not priced.');
    return {
      warnings, priced: false,
      fabric:  { mode: null, fullness: 0, meterage: 0, pricePerM: fabricPricePerM, cost: 0 },
      making:  { drops: 0, ratePerDrop: num(r.makingRatePerDrop), cost: 0 },
      lining:  { enabled: !!input.lining?.enabled, cost: 0, fabricCost: 0, makingCost: 0 },
      track:   { type: input.trackType || '', method: 'none', cost: 0 },
      fitting: { enabled: input.fittingEnabled !== false, base: 0, dropSurcharge: 0, doubled: false, cost: 0 },
      extras: 0, materialsCost: 0, labourCost: 0, totalCost: 0,
    };
  }

  const fullness = fullnessFor(heading, r);
  if (fullness === null) {
    warnings.push(heading ? `Unknown heading "${heading}" — fabric not priced.`
                          : 'No heading — fabric not priced.');
  }
  if (fabricPricePerM <= 0) warnings.push('No fabric price — fabric costed at $0.');

  // ── Face fabric ────────────────────────────────────────────────────────────
  const fm = fullness !== null
    ? fabricMetreage({ widthMm, dropMm, fullness, fabricWidthMm, hemAllowanceMm, sideAllowanceM })
    : { mode: null, totalFullnessM: 0, cutLengthMm: 0, dropsRequired: null, meterage: 0 };

  const fabric = {
    mode:           fm.mode,
    fullness:       fullness ?? 0,
    fabricWidthMm,
    totalFullnessM: fm.totalFullnessM,
    cutLengthMm:    fm.cutLengthMm,
    dropsRequired:  fm.dropsRequired,
    meterage:       fm.meterage,
    pricePerM:      fabricPricePerM,
    cost:           fm.meterage * fabricPricePerM,
  };

  // ── Making ─────────────────────────────────────────────────────────────────
  // Charged on total fullness regardless of cutting mode, exactly as the
  // workbook did — the labour is in the made width, not in how it was cut.
  const makingDropWidthM = num(r.makingDropWidthM) || 1.4;
  const makingDrops      = fm.totalFullnessM / makingDropWidthM;
  const making = {
    drops:       makingDrops,
    ratePerDrop: num(r.makingRatePerDrop),
    cost:        makingDrops * num(r.makingRatePerDrop),
  };

  // ── Attached lining ────────────────────────────────────────────────────────
  const lin        = input.lining || {};
  const linEnabled = !!lin.enabled;
  let lining = { enabled: false, cost: 0, fabricCost: 0, makingCost: 0 };

  if (linEnabled) {
    const linCfg      = r.lining || {};
    const linHeading  = lin.heading || (linCfg.followCurtain ? heading : linCfg.heading);
    const linFullness = fullnessFor(linHeading, r);
    const linWidthMm  = num(lin.fabricWidthMm) || num(linCfg.fabricWidthMm);
    const linPrice    = lin.pricePerM !== undefined && lin.pricePerM !== null && lin.pricePerM !== ''
                        ? num(lin.pricePerM) : num(linCfg.pricePerM);

    if (linFullness === null) {
      warnings.push(`Unknown lining heading "${linHeading}" — lining not priced.`);
      lining = { enabled: true, cost: 0, fabricCost: 0, makingCost: 0, heading: linHeading };
    } else {
      const lm = fabricMetreage({
        widthMm, dropMm, fullness: linFullness,
        fabricWidthMm: linWidthMm, hemAllowanceMm, sideAllowanceM,
      });
      const linMakingDrops = lm.totalFullnessM / makingDropWidthM;
      const linMakingRate  = num(linCfg.makingRatePerDrop);
      lining = {
        enabled:        true,
        heading:        linHeading,
        mode:           lm.mode,
        fullness:       linFullness,
        fabricWidthMm:  linWidthMm,
        totalFullnessM: lm.totalFullnessM,
        dropsRequired:  lm.dropsRequired,
        meterage:       lm.meterage,
        pricePerM:      linPrice,
        fabricCost:     lm.meterage * linPrice,
        makingDrops:    linMakingDrops,
        makingRate:     linMakingRate,
        makingCost:     linMakingDrops * linMakingRate,
        cost:           lm.meterage * linPrice + linMakingDrops * linMakingRate,
      };
    }
  }

  // ── Track ──────────────────────────────────────────────────────────────────
  const trackType = input.trackType || '';
  const widthM    = widthMm / 1000;
  const perM      = trackRateFor(trackType, r);
  let track;

  if (perM !== null) {
    track = { type: trackType, method: 'perMetre', ratePerM: perM, widthM, cost: perM * widthM };
  } else {
    const { price, reason, band, column } = osloPrice(trackType, heading, widthMm, r);
    if (price === null) {
      if (reason === 'over-max-width') {
        const key = Object.keys(r.oslo.prices || {})
          .find(k => k.toLowerCase() === String(trackType).trim().toLowerCase());
        const bands = r.oslo.prices?.[key]?.widthsMm?.length ? r.oslo.prices[key].widthsMm : (r.oslo.widthsMm || [0]);
        warnings.push(`${trackType} is not priced past ${Math.max(...bands)}mm — track costed at $0.`);
      } else if (!trackType) {
        warnings.push('No track type — track costed at $0.');
      } else {
        warnings.push(`Unknown track type "${trackType}" — track costed at $0.`);
      }
      track = { type: trackType, method: 'none', cost: 0 };
    } else {
      track = { type: trackType, method: 'table', band, column, widthM, cost: price };
    }
  }

  // ── Fitting ────────────────────────────────────────────────────────────────
  const fitCfg  = r.fitting || {};
  const bands   = fitCfg.bands || [];
  const over    = fitCfg.over  || {};
  const dropSur = fitCfg.dropSurcharge || {};

  const band = bands.find(b => widthMm <= num(b.maxWidthMm));
  let base;
  if (band) base = num(band.cost);
  else if (widthMm > num(over.fromMm)) {
    base = num(over.base) + num(over.step) * Math.floor((widthMm - num(over.fromMm)) / (num(over.perMm) || 1));
  } else base = 0;

  const surcharge = dropMm > num(dropSur.overMm)
    ? num(dropSur.amount) * Math.floor((dropMm - num(dropSur.overMm)) / (num(dropSur.perMm) || 1))
    : 0;

  const isDual = (fitCfg.dualTrackTypes || [])
    .some(t => String(t).toLowerCase() === String(trackType).trim().toLowerCase());

  const fittingEnabled = input.fittingEnabled !== false;
  const fitting = {
    enabled: fittingEnabled,
    base, dropSurcharge: surcharge, doubled: isDual,
    cost: fittingEnabled ? (base + surcharge) * (isDual ? 2 : 1) : 0,
  };

  // ── Totals ─────────────────────────────────────────────────────────────────
  const extras = num(input.extraCost);

  // Split so the app's margin model stays meaningful: bought-in goods are cost,
  // work done is labour.
  const materialsCost = fabric.cost + lining.fabricCost + track.cost + extras;
  const labourCost    = making.cost + (lining.makingCost || 0) + fitting.cost;

  return {
    warnings, priced: true,
    fabric, making, lining, track, fitting,
    extras,
    materialsCost,
    labourCost,
    totalCost: materialsCost + labourCost,
  };
}

/**
 * Cost a measure-sheet or quote line item.
 *
 * Bridges the app's field names onto calcCurtain's inputs. Returns null for a
 * line that isn't a curtain, so callers can leave non-curtain pricing alone.
 */
export function calcCurtainLine(li = {}, rates = DEFAULT_CURTAIN_RATES, opts = {}) {
  return calcCurtain({
    widthMm:         li.widthMm,
    dropMm:          li.dropMm,
    heading:         li.heading,
    trackType:       li.trackType || li.operationType || '',
    fabricPricePerM: opts.fabricPricePerM ?? li.fabricPricePerM,
    fabricWidthMm:   opts.fabricWidthMm   ?? li.fabricWidthMm,
    fittingEnabled:  opts.fittingEnabled !== false && li.fittingEnabled !== false,
    extraCost:       opts.extraCost ?? li.extraCost ?? 0,
    lining: {
      enabled:       !!li.attachedLining,
      pricePerM:     opts.liningPricePerM ?? li.liningPricePerM,
      fabricWidthMm: opts.liningFabricWidthMm ?? li.liningFabricWidthMm,
    },
  }, rates);
}

/**
 * True when a price-library unit means "per linear metre" — the unit curtain
 * fabric is bought in.
 *
 * This guard matters: the library is full of `per sqm` items (roller-blind
 * fabrics), and a $/m² rate used as a $/m rate would silently misprice every
 * curtain that name-matched one. Anything square is rejected outright.
 */
export function isPerMetreUnit(unit) {
  const u = String(unit || '').trim().toLowerCase().replace(/[.\s]+$/, '');
  if (!u) return false;
  if (/sq|m2|m²|each|ea\b|unit|item|roll|pair/.test(u)) return false;
  return /(^|\b)(m|lm|mtr|metre|meter|lineal|linear|running)(\b|$)/.test(u) || u === '/m';
}

/**
 * The unit a price-library item is sold in.
 *
 * The app carries this under two names. A record freshly written by an import
 * has `unitType` (that's the shape runPricedItemImport builds); the same record
 * read back from Supabase has `unit`. Reading only one of them makes a fabric
 * look like a fabric on one page load and a plain product on the next — which
 * is exactly what sent a just-imported fabric range into the general library
 * instead of the Fabrics tab.
 */
export const unitOf = (p) => p?.unit || p?.unitType || '';

/**
 * Is this price-library item a curtain fabric?
 *
 * Fabric is bought by the linear metre; everything else in the library — blinds,
 * tracks, installation, accessories — is priced per m², per unit or as a job.
 * That single distinction is what separates the fabric list from the rest of the
 * price library, and it's the same test the calculator uses when matching a
 * fabric name, so the two can never disagree about what a fabric is.
 */
export const isFabricItem = (p) =>
  !!p && p.isActive !== false && Number(p.costPrice) > 0 && isPerMetreUnit(unitOf(p));

/**
 * Find a fabric's cost per metre in the price library, by the name written on
 * the measure sheet.
 *
 * Exact name or item-code match wins; otherwise the longest name that appears
 * inside the fabric string (or contains it), the same "longest range wins" rule
 * the BUZ fabric-code map uses. Returns null when nothing usable matches, so
 * the caller falls back to the rate card rather than guessing.
 */
export function resolveFabricPricePerM(fabricName, pricedItems = []) {
  const want = String(fabricName || '').trim().toLowerCase();
  if (!want) return null;

  const usable = (pricedItems || []).filter(p =>
    p && p.isActive !== false && Number(p.costPrice) > 0 && isPerMetreUnit(unitOf(p)));
  if (!usable.length) return null;

  const nameOf = (p) => String(p.itemName || '').trim().toLowerCase();
  const codeOf = (p) => String(p.itemCode || '').trim().toLowerCase();

  const exact = usable.find(p => nameOf(p) === want || (codeOf(p) && codeOf(p) === want));
  if (exact) return { pricePerM: Number(exact.costPrice), item: exact, match: 'exact' };

  const partial = usable
    .filter(p => { const n = nameOf(p); return n && (want.includes(n) || n.includes(want)); })
    .sort((a, b) => nameOf(b).length - nameOf(a).length)[0];
  if (partial) return { pricePerM: Number(partial.costPrice), item: partial, match: 'partial' };

  return null;
}

/**
 * Where a curtain line's fabric $/m came from, in priority order:
 *   manual  — typed on the line; always wins, never overwritten by a re-cost
 *   library — matched from the price library by the fabric's name
 *   default — the rate card's fallback, when neither of the above applies
 */
export function resolveLineFabricPrice(li = {}, rates = DEFAULT_CURTAIN_RATES, pricedItems = []) {
  // The matched library item also carries the fabric's roll width, which decides
  // Continuous vs Regular cutting. Returned alongside the price so a line never
  // has to fall back to the rate card's generic roll width when the real one is
  // known — a 3.3m drapery fabric and a 1.4m upholstery fabric cut very
  // differently, and that branch moves the price more than the price itself.
  const hit = resolveFabricPricePerM(li.fabricColour, pricedItems);
  const libWidth = Number(hit?.item?.fabricWidthMm) || null;

  const manual = Number(li.curtainFabricPricePerM) || Number(li.fabricPricePerM) || 0;
  if (manual > 0) return { pricePerM: manual, source: 'manual', widthMm: libWidth };

  if (hit) return { pricePerM: hit.pricePerM, source: 'library', item: hit.item, match: hit.match, widthMm: libWidth };

  return { pricePerM: Number(rates.fabricPricePerM) || 0, source: 'default', widthMm: null };
}

/**
 * Auto-cost a line that came from (or is linked to) a measure sheet.
 *
 * Shared by every measure-sheet → quote path so they can't drift apart:
 * QuoteFromJob's "create quote from job", QuoteBuilder's measure-sheet import,
 * and the builder's "Cost curtains" bulk action.
 *
 * Returns:
 *   null                     — not a curtain; leave the line alone
 *   { blocked: true, ... }   — a curtain the calculator can't fully price
 *   { unitCostPrice, ... }   — costs ready to write onto the line
 *
 * A line it can't fully price is reported as blocked rather than part-costed,
 * so a missing cost stays visible instead of quietly under-quoting.
 */
export function autoCostCurtainLine(li = {}, rates = DEFAULT_CURTAIN_RATES, pricedItems = []) {
  if (!isCurtainProduct(li.productNameSnapshot || li.productType || li.productName || '')) return null;

  const r = mergeCurtainRates(rates);
  // A measure sheet records the fabric by NAME, not by price — so look the name
  // up in the price library, and fall back to the rate card's default. Either
  // way the resolved price is handed back so the caller can write it onto the
  // line: visible and correctable in the calculator panel rather than an
  // invisible assumption.
  const fabricPrice = resolveLineFabricPrice(li, r, pricedItems);
  const fabricPricePerM = fabricPrice.pricePerM;
  // Roll width: typed on the line wins, then the matched fabric's own width,
  // then the rate card default (handled inside calcCurtain).
  const fabricWidthMm = Number(li.curtainFabricWidthMm) || fabricPrice.widthMm || undefined;

  const result = calcCurtain({
    widthMm:         li.widthMm,
    dropMm:          li.dropMm,
    heading:         li.heading,
    trackType:       li.trackType,
    fabricPricePerM,
    fabricWidthMm,
    fittingEnabled:  li.curtainFittingEnabled !== false,
    extraCost:       li.curtainExtraCost,
    lining: {
      enabled:   !!li.attachedLining,
      pricePerM: li.curtainLiningPricePerM,
    },
  }, r);

  if (!result.priced || result.warnings.length > 0) {
    return { blocked: true, warnings: result.warnings, result, fabricPriceSource: fabricPrice.source };
  }

  return {
    blocked: false,
    unitCostPrice:          Math.round(result.materialsCost * 100) / 100,
    labourCost:             Math.round(result.labourCost    * 100) / 100,
    curtainFabricPricePerM: fabricPricePerM,
    curtainFabricWidthMm:   fabricWidthMm ?? null,
    fabricPriceSource:      fabricPrice.source,      // 'manual' | 'library' | 'default'
    fabricPriceItem:        fabricPrice.item || null,
    result,
  };
}

/** True when a product type should be costed by this calculator. */
export const isCurtainProduct = (name) =>
  /curtain|curt\b|sheer|drape/i.test(String(name || ''));
