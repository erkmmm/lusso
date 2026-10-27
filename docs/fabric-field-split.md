# Scope: splitting the measure-sheet fabric field

**Status:** proposal, nothing built
**Written:** 2026-10-27
**Why now:** two consecutive BUZ export failures (LUS-6236) traced to the same
root cause — `fabricColour` is one free-text box, so what BUZ needs can't be
guaranteed to be in there.

---

## The problem in one line

`fabricColour` is a single free-text field shared by every product type, and
three separate parts of the app try to parse meaning back out of it.

Today it feeds:

| Consumer | What it needs | How it copes |
|---|---|---|
| `buzExport.js` | brand + range + colour | fuzzy match vs BUZ catalogue |
| `curtainCalc.js` → `resolveFabricPricePerM` | a price-library item | fuzzy match, "longest name wins" |
| `describeLine.js` | opacity words for the title | keyword sniffing |
| `poDocument.js`, `QuoteBuilder`, `QuoteFromJob` | display only | passes through |

Three fuzzy matchers over one unvalidated string. Each has its own heuristics
and its own failure mode, and none can be made reliable because the information
they need was never required at entry.

---

## Evidence

Every distinct `fabricColour` in production (164 lines, 30 distinct values) run
through the current resolver. **Roller-blind lines only** (59 of 164 — the rest
are curtains, pelmets and cellular blinds that never reach BUZ):

| Outcome | Lines | Share | Example |
|---|---:|---:|---|
| Resolves to a BUZ code | 29 | 49% | `vibe ice` → `ROLLM110T315I2` |
| Range known, **colour missing** | 7 | 12% | `Solar view` |
| **Different supplier** (Verosol) | 11 | 19% | `205 0020 silverscren performance beige` |
| **Not a fabric at all** | 12 | 20% | `"`, `Same as existing`, `Ceiling fix infront of mullions` |

So roughly **half** of BUZ-bound lines work today, and the other half fail for
three genuinely different reasons.

### What this tells us that "range + colour" alone doesn't fix

1. **Supplier is a routing key, not a disambiguator.** Roller blinds are
   ordered from two suppliers, and **only Skins2Go uses BUZ** — Verosol has no
   BUZ at all and is ordered on its own Excel form. So a Verosol line
   (`205 0020`, `890 0000`, `103 …`, plus the cellular blinds) must not merely
   *fail* to resolve against the BUZ catalogue; it should never be in the BUZ
   file in the first place. The BUZ export's filter is currently
   "is it a roller blind?" when it should be "is it a Skins2Go roller blind?".

   **Latent, not live.** Checked all 11 sheets with roller lines: each is
   single-supplier today, so nothing is broken right now. But nothing prevents
   a mixed sheet either, and on one, the Verosol lines would be written with
   blank codes and sink the whole BUZ upload with the deserialization error —
   the exact failure this work exists to kill. A supplier field closes that
   before it happens.

2. **One in five roller-blind fabric fields holds something that isn't a
   fabric** — a stray quote mark, "Same as existing", or an install note that
   belongs in the notes column. No schema fixes bad input on its own; this
   needs entry-time validation or it just moves the mess.

3. **The field is shared with curtains.** 105 of 164 lines are curtain,
   pelmet or cellular. Curtain fabrics (Warwick, Nettex, Carré, Hugo) have no
   relationship to the BUZ catalogue and are priced through a different
   library. A change that assumes "fabric = BUZ roller fabric" breaks curtain
   pricing.

---

## Options

### A. Validation only — no schema change
Keep one field; reject or warn at entry when a roller-blind fabric doesn't
resolve. Mostly shipped already (the export now refuses and names the colours).

- **Pro:** nothing to migrate, no risk to curtains.
- **Con:** doesn't fix Verosol, doesn't stop notes landing in the field, and
  leaves three fuzzy matchers in place. Treats the symptom.

### B. Additive structured fields *(recommended)*
Keep `fabricColour` as the canonical display string — everything that renders
it keeps working untouched. Add optional structured fields alongside, written
by a picker:

```
fabricSupplier   'skins2go' | 'verosol' | null   // routes the line to an export
fabricRange      'Solarview Screen Fabric'
fabricColourName 'Charcoal'
fabricCode       'ROLLM105T461C14'               // resolved once, at entry
```

`fabricSupplier` is the important one. It decides **which order file a line
belongs in** — BUZ for Skins2Go, the Verosol form for Verosol — and lets the
BUZ export take only the lines it can actually order instead of guessing from
the fabric name.

Entry becomes: pick supplier → pick range → pick colour, with the BUZ
catalogue driving the list for Skins2Go. `fabricColour` is generated from the
three for display. Free text stays available as an escape hatch for anything
not in a catalogue.

The export then reads `fabricCode` directly and never guesses. The resolver
survives only as a **backfill** for old rows and as the importer's best guess.

- **Pro:** no migration required — old rows keep working through the existing
  resolver, new rows are exact. Curtains unaffected until a curtain catalogue
  exists. Reversible.
- **Con:** two representations coexist for a while; the picker is real UI work
  and must stay fast for someone entering 20 lines on site.

### C. Full replacement
Drop `fabricColour`, migrate everything to structured fields.

- **Pro:** one representation, no ambiguity.
- **Con:** needs a migration for data that is 20% unparseable, touches every
  read site including curtain pricing, and there's no catalogue for curtain
  fabrics to migrate *into*. Would strand the free-text cases with nowhere to
  go. **Not recommended.**

---

## Recommended plan (option B, phased)

Each phase is independently useful and shippable — stop after any one.

**Phase 1 — Stop the bleeding** *(done)*
Export refuses with a readable reason; `RB09` and the CONTROLTYPE strings fixed.

**Phase 2 — Schema + backfill, no UI** (small)
Add the four optional fields. Write a one-off backfill that runs the existing
resolver over all rows and fills them where confident, leaving the rest null.
From the audit: ~49% of roller lines fill automatically, the rest stay as they
are. Nothing changes for the user yet.
*Checkpoint: how many rows filled, and did anything fill wrongly?*

**Phase 3 — Picker on the measure sheet** (medium — the bulk of the work)
Supplier → range → colour, catalogue-driven, with free text still allowed.
Writes all four fields plus the display string. This is where the real UX risk
sits: it has to be faster than typing, on a phone, on site, or it won't get
used and the data won't improve.
*Checkpoint: use it on one real job before rolling it out.*

**Phase 4 — Export reads the code, and only Skins2Go lines** (small)
`buzExport` prefers `fabricCode`, and filters on
`fabricSupplier === 'skins2go'` rather than "is a roller blind". The resolver
becomes the fallback for rows that predate the picker. This is what makes a
mixed-supplier sheet safe.

**Phase 5 — Verosol as its own channel** (medium)
Not "add Verosol to the BUZ export" — Verosol doesn't use BUZ. This is a
second export path producing the Verosol order form, selected by
`fabricSupplier`, reusing the same measure-sheet data. A `buz-to-verosol`
workflow already exists and is the obvious starting point. Worth doing: ~19%
of roller lines are Verosol, and those jobs get no export help at all today.

**Not in scope:** curtain fabrics. There's no catalogue to drive a picker from,
and `resolveFabricPricePerM` already works off the price library. Revisit only
if a curtain fabric library appears.

---

## Risks

| Risk | Mitigation |
|---|---|
| Picker is slower than typing → ignored on site | Free text always available; test on a real job at Phase 3 before committing |
| Backfill fills a row *wrongly* (worse than blank — orders wrong fabric) | Only fill unambiguous matches; the resolver already refuses opacity ambiguity. Review the Phase 2 diff before applying |
| Catalogue goes stale as BUZ adds fabrics | Re-run the capture (documented in `docs/buz/`); treat the JSON as a snapshot with a date, which it carries |
| Two representations drift apart | Generate `fabricColour` from the structured fields whenever they're present, never the reverse |

## Open questions

1. ~~Is Verosol long-term?~~ **Answered:** both suppliers are in use and only
   Skins2Go uses BUZ, so supplier has to be first-class rather than inferred.
2. Who enters measure sheets — you, or installers on site? Determines how much
   the picker can ask for.
3. Should a roller-blind line be *blocked* from saving without a resolvable
   fabric, or just flagged? Blocking fixes the 20% junk, but will be resented
   if someone genuinely doesn't know the fabric yet ("Kirra tbc" is a real
   value in the data).
