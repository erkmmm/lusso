# BUZ option vocabulary — capture 2026-10-27

Captured from the live BUZ portal (Skins2Go, go.buzmanager.com, v4.8.345) by
reading the Product Catalogue configuration forms' own `<select>` elements.
These are the **full option domains**, not a sample from one order.

| File | Contents |
|---|---|
| `buz-roll-schema.md` | `ROLL` (Rollerblinds) — 34 fields, every value, + data-quality traps |
| `buz-extbl-schema.md` | `EXTBL` (External Blind) — 37 fields, every value, + traps |
| `buz-fabric-map.json` | ROLL fabric cascade: 8 brands → 177 materials → 1,193 colours |
| `buz-extbl-fabric-map.json` | EXTBL fabric cascade: 5 types → 205 brand entries → 2,034 colours |
| `buz-option-vocabulary.md` | Earlier pass: what order 113073.A actually used (the subset in production) |

## Scope

Captured: `ROLL` and `EXTBL`, the two group codes used by the Lusso BUZ export.

**Not captured** — 24 other catalogue categories exist and were not walked:
Skins, External Skins, Skins Discontinued / Phaseout, Tubes & Rails,
Linked Rollerblinds, Pelmets & Cassettes, Acmeda Vertical Complete,
Acmeda Vertical Track Only, Vertical Blades, Panel Glide Complete,
Panel Glide Track Only, Roman, Roman Track Only, Aluminium Venetian Blinds,
Composite Venetian Blinds, Curtains & Sheers Complete, Motorised Curtain Track,
Folding Arm Awnings, Aluminium Shutter, PVC & Timber Shutters,
PVC Australian Made Shutter, Coolum Aust Made Polymer Shutter,
Coolangatta Prime Polymer Shutter, Accessories, Parts.

## Caveats

- **Conditional options.** Both forms list every field in the DOM and show or
  hide them by rule. A field's full domain is here, but the *valid subset*
  often depends on an upstream choice (e.g. `Control Option` on ROLL is filtered
  by `Control Type`; most EXTBL motor fields only apply when
  `Control Type = Motorised`). The dependency rules were not extracted.
- **Prices** in `buz-option-vocabulary.md` are Skins2Go trade prices for Lusso
  as at this date, at the line discounts on that order (ROLL 20%, EXTBL 15%).
- `buz-extbl-fabric-map.json` was rebuilt from a base map plus two deltas;
  reconstruction verified against the live counts (205 / 2,034).
- Order 113073.A was read only. No item was added and no form submitted;
  cart re-checked afterwards at 14 lines / $6,012.93, unchanged.

---

## INVENTORY CODE is derivable (added 2026-10-27)

The BUZ import's col-B `INVENTORY CODE` does **not** need a hand-maintained
lookup. It is a plain concatenation of the catalogue form's own `<option>`
**value** attributes:

```
INVENTORY CODE = InventoryGroupCode + Brand.value + MaterialType.value + Colour.value
```

- `InventoryGroupCode` is a hidden input on the `GetQuestions` form
  (`ROLL` for Rollerblinds).
- `Brand`, `Material Type` and `Colour` selects carry short tokens as their
  option values — e.g. `M110`, `T801`, `B59` — not GUIDs.

Verified both directions against a real BUZ export (`110366_A.xlsx`):

| Code | = | Group | Brand | Material Type | Colour |
|---|---|---|---|---|---|
| `ROLLM110T801B59` | | `ROLL` | `M110` Shaw | `T801` Linesque Blockout | `B59` Blanco |

**Caveat — two schemes exist.** Older codes in circulation use a legacy mnemonic
form instead: `ROLLSHAVIBBO1` (ROLL + SHA + VIB + BO + 1), `ROLLSERBOO1`. Don't
assume one scheme when reading historical files.

### ROLL token table — now live in the app at `src/data/buzRollCodes.json`

Captured 2026-10-27. 8 brands / 177 material types / **1,194 colours**, each as
`[code, name]`. Structure:

```
brands[brandCode] = { n: brandName,
                      m: { materialTypeCode: { n: name, c: [[colourCode, colourName], ...] } } }
```

Worked examples, generated from this file:

| Fabric | Code |
|---|---|
| Shaw / Linesque Blockout / Blanco | `ROLLM110T801B59`  *(matches `110366_A.xlsx`)* |
| Shaw / Palm Beach (New) Blockout / Quill | `ROLLM110T790Q5` |
| Shaw / Palm Beach (New) Light Filtering / Melody | `ROLLM110T791M52` |

**Verification.** The cascade is populated by async callbacks, so a harvest that
reads too eagerly can capture the *previous* material's colour list. Every
material whose colour list duplicated its immediate predecessor (20 of 177) was
re-read with a brand reset and 2.5s waits; all 20 confirmed genuine. The earlier
text-only `buz-fabric-map.json` does contain one such stale entry —
`Louvolite / Boston - Block Out` shows Bayside's colours. **Prefer
`buz-roll-codes.json`; it supersedes `buz-fabric-map.json`.**

### Wired into the export (2026-10-27)

`src/lib/buzFabricResolver.js` resolves a free-text Lusso fabric name against
this table; `buzExport.js` calls it via `resolveInventoryCode()`. The Settings
fabric-code table is now an **override**, not the primary mechanism — an entry
there still wins, for pinning anything the catalogue can't place.

Resolution requires BOTH the range and the colour to appear in the text, and
refuses to guess:

| Fabric text | Result |
|---|---|
| `vibe ice` | `ROLLM110T315I2` — Shaw / Vibe Blockout / Ice |
| `Palm Beach Quill` | `ROLLM110T790Q5` |
| `Kleen screen ivory` | `ROLLM105T1092I4` — matches BUZ's one-word `Kleenscreen` |
| `Le Reve Chalk` | **ambiguous** — Blockout and Light Filtering both have Chalk |
| `Coastal White` | **nomatch** — not a BUZ fabric name |

Ambiguous and unmatched fabrics are reported separately by `buildBuzRows()`,
because the fixes differ: an ambiguous one just needs the opacity saying
("Le Reve Chalk Blockout" resolves cleanly), an unmatched one needs a Settings
override.

**EXTBL codes are NOT captured.** `buz-extbl-fabric-map.json` is still text-only.
This was left out because `buzExport.js` exports roller blinds only
(`categorizeProduct` filters the rest), so EXTBL codes aren't needed yet. Same
harvest, run against the External Blind form, would produce them.
