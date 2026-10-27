# BUZ `ROLL` (Rollerblinds) — complete option schema

Source: BUZ portal → Sales → Product Catalogue → Rollerblinds (`GetQuestions` form),
Skins2Go, 2026-10-27, portal v4.8.345.
Captured from the live form's own `<select>` elements, so these are the **full
domains**, not just what one order used.

**34 fields total.** The order 113073.A only exposed 22 — the other 12 are
conditional and stay hidden until a triggering value is chosen.

## Cascading fabric selection (3 fields)
| Field | Type | Notes |
|---|---|---|
| Brand | select | Four Families, Louvolite, Louvolite - Discontinued, Quoting, Scottfree, Shaw, Texstyle, Uniline |
| Material Type | select | cascades off Brand |
| Colour | select | cascades off Material Type |

Shaw exposes 29 material types, including the two on this order:
`Palm Beach (New) Blockout`, `Palm Beach (New) Light Filtering`.
Full brand → material → colour map is in `buz-fabric-map.json`.

## Measurement (4 fields)
| Field | Type |
|---|---|
| Location | free text |
| Quantity | number |
| Width (mm) | number |
| Drop (mm) | number |
| Sizes | select — `Opening` (only value) |

## Control (7 fields)
**Control Type** (18):
Acmeda RB08 Std · Acmeda RB09 · Easy Spring AIR ·
Acmeda Automate Zero Li-ion Q Motor 0.7 / 1.1 / 2.0 ·
Acmeda Automate Li-ion Motor 6.0 ·
Acmeda Basics 5V Zero 1.1 RTS 1-Way Motor · Acmeda Basic 5V Zero 1.1 Wand Motor ·
Acmeda Automate E6 ARC 240 RTS · Acmeda Automate M6 - 240 WT ·
Somfy Sonesse 40 3/30 RTS · Somfy Sonesse 40 6/20 RTS ·
Somfy Sonesse 40 3/30 WT · Somfy Sonesse 40 6/20 WT ·
Somfy Altus 40 3/30 RTS · Somfy 30 Wirefree ·
Somfy 28 Wirefree RTS with External Battery

**Controls** (2): Left · Right
**Roll Direction** (2): Frontroll / Rev · Backroll / Std
**Assist Option** (3 unique): N/A · Spring Assist · Geared
**Chain Length (mm)** (13): Standard · 300 · 500 · 750 · 1000 · 1250 · 1500 ·
1750 · 2000 · 2250 · 2500 · 2750 · Other  *(plus a separate numeric field for "Other")*
**Chain Tension Colour** (3): Clear · White · Black

**Control Option** (30 unique) — domain is filtered by Control Type:
- *chain finishes:* Nickel Plated · 2. Stainless Steel · Plastic White ·
  Plastic Birch White · Plastic Black · Plastic Beige · Plastic Grey · Chainless
- *remotes:* No Remote · Basics 5CH Remote Control · PUSH Pro White · PUSH Pro Black ·
  PUSH 5 Channel White · PUSH 5 Channel Black · 15 Channel White · 15 Channel Black ·
  1 Channel White · 1 Channel Black · 1 Channel · 2 Channel · 5 Channel · 16 Channel
- *wall controls:* Paradigm 1 Ch / 2 Ch / 15 Ch Wall Controller · Surface Mount 5 Ch Wall Switch
- *wands:* Basic Magnetic Wand 600mm / 900mm / 1200mm · No Wand

## Hardware (8 fields)
**Bottom Trim** (6): Oval · D30 Bump · Smart Rail Fabric Wrap - FULL ·
Smart Rail Fabric Wrap - HALF · Smart Rail · Other
**Rail Colour** (9): Anodised Clear · White · Black · SandStone · Barley · Bone ·
Dune · Bronze Pearl · Closest Match
**Fit** (3): Reveal · Face · Ceiling
**Bracketing** (3): Single · Double · Existing Double Upgrade
**Bracket type** (5 unique): Acmeda Slim - Top Front · Acmeda Slim - Top Back ·
Acmeda Square · Acmeda Slimline-X Double Easy Lock LH/RH · Easy Spring AIR Slim Top Front
**Blind Position** (4 unique): Front (Roll Direction -Front / Rev Roll) ·
Back (Roll Direction -Back / Std Roll) · Back (Roll Direction -Front / Rev Roll) ·
Front (Roll Direction -Back / Std Roll)
**Bracket Covers** (2): No · Yes
**Control & Bracket Colour** (12 unique): Pure White · Sandstone · Black · Silver Grey ·
White / No covers · Black / No covers · White / White · Black / Black Covers ·
White / Sandstone Covers · White /Grey · White · Birch White

## Pelmet (7 fields)
**Pelmet Type** (7): N/A · Fashade Aluminium Pelmet · Acmeda FRS100 Standard Colour ·
Acmeda Pelmet95 Standard · Acmeda Pelmet95 Special · Acmeda Cassette ·
Acmeda Casstte with Side Guides
**Pelmet Colour** (7 unique): White · Birch · Black · Clear Anod · Clear Anodised ·
Sandstone · Custom
**Custom Pelmet Colour** — searchable free text
**Pelmet Width** — number
**Pelmet Returns** (4): N/A · Both · Left · Right
**Pelmet Return Size** — number
**Pelmet Brackets** (4 raw / 3 real): Recess · Extension · Face Fit · Face fit

## Other (3 fields)
**Surcharge** (2): N/A · Yes
**Extra Charge $** — free text
**Extra description** — free text

---

# Data-quality traps for the export map

These are real defects in BUZ's own option lists. The export has to reproduce
them exactly or the import will reject the row.

1. **`Acmeda Casstte with Side Guides`** — "Cassette" misspelled, but only in
   that one value. `Acmeda Cassette` directly above it is spelled correctly.
2. **`Pelmet Brackets` has both `Face Fit` and `Face fit`** — two separate
   options differing only in case. Order 113073.A used `Face Fit` (capital F).
3. **`Control & Bracket Colour` has both `White` and `Pure White`**, plus
   `White /Grey` with a missing space after the slash.
4. **`Pelmet Colour` has both `Clear Anod` and `Clear Anodised`.**
5. **Duplicate entries** appear in the raw option lists because the select holds
   the union across all Control Types and is filtered client-side: `Control Option`
   is 114 raw / 30 unique, `Chain Length` 85 / 13, `Control & Bracket Colour` 74 / 12,
   `Bracket type` 10 / 5, `Blind Position` 8 / 4, `Assist Option` 5 / 3.
   Validate against the **unique** set, but be aware the valid subset depends on
   Control Type.
6. **`N/A` is a literal selectable value**, not an empty string.
