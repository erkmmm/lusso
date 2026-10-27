# BUZ `EXTBL` (External Blind) — complete option schema

Source: BUZ portal → Sales → Product Catalogue → External Blind (`GetQuestions`
form), Skins2Go, 2026-10-27, portal v4.8.345. Captured from the live form's own
`<select>` elements — full domains, not just what one order used.

**37 fields total.** Order 113073.A exposed only 21; the rest are conditional.

## The `Type` gate
`Type` is the top-level selector and changes which fields apply:
**Deep Channel · Pivot Arm · Straight Drop · Wire Guide · Zipscreen**

Order 113073.A used **Zipscreen**. Note the product string on the cart reads
`EXTBL Zipscreen OUTLOOK MODE ZERO Chalk` — `Zipscreen` there is this Type value,
not part of the fabric name.

## Fabric cascade (3 fields)
`Type` → `Fabric Brand` → `Colour / Type`.
Full map in `buz-extbl-fabric-map.json`.

## Measurement (5 fields)
Location (text) · Quantity (number) · Width (mm) (number) ·
**Left Drop (mm)** (number) · **Right Drop (mm)** (text)

Two drops, for raked/sloped openings. ROLL has a single `Drop (mm)`.

## Headbox & installation (6 fields)
**Installation Type** (12): Box 120 · Box 120 Semi · Open Square PC · Open Square SS ·
Open Round · Open Round SS · Box 160 · Open 160 End Plates Only · Box 190 ·
Open 190 Stainless Bracket · Open 190 Powdercoated Bracket · Top/Face Fix Bracket S100
**Tube Type** (4): 78mm · 110mm · 130mm · 130mm (Use when over 6.8m wide and 3.2 drop)
**HeadBox / Bracket Colour** (10): Black · White · Monument · Surfmist ·
Woodlands Grey · Classic Cream · Paperbark · Zinc Brackets · Stainless Steel · Custom
**HeadBox / Bracket Custom Colour** — searchable free text
**Bracket Fix Orientation** (2): Face Fix · Top Fix

## Side guides (4 fields)
**Side Guide Fix** (11): Recess · FF 120 L fixing rail · FF 160 / 190 L fixing rail ·
Fixing Rail · Suit F56 Rail 3.2mm x 4m Kit · Suit F56 Rail 4mm Hardware Side/Face Fit- 4m ·
Suit F56 Rail 4mm Hardware Floor Fit- 4m · Suit F72 Rail 3.2mm x 4m Kit ·
Suit F72 Rail 4mm Hardware Side/Face Fit- 4m · Suit F72 Rail 4mm Hardware Floor Fit- 4m ·
Suit 110mm Powdercoated Bracket F72 Rail 4mm Hardware Floor Fit- 4m
**Side Guide Colour** (10): Black · White · Monument · Surfmist · Woodlands Grey ·
Classic Cream · Paperbark · Ebony · Cream · Custom
**Side Guide Custom Colour** — searchable free text
**Side Finish** (2): Zip No.6 · Welded

## Control & motorisation (9 fields)
**Control Type** (4): Spring · Motorised · Geared 5:1 · Geared 8:1
**Control Side** (2): Left · Right
**Motor Brand** (2): Acmeda Automate · Somfy
**Motor** (19): AUTOMATE ARC FT - Short (001) · AUTOMATE ARC FT - Long (012) ·
AUTOMATE FT Li-Ion 15Nm Motor · AUTOMATE ARC DCFT Motor & Battery Pack ·
AUTOMATE - AX30 Suit 110mm & 130mm Tube · AUTOMATE - AX50 Suit 110mm & 130mm Tube ·
Somfy Altus RTS 15/17 3M · Somfy Altus RTS 10/17 3M · Somfy Altus RTS 10/32 3M ·
Somfy Altus RTS 6/17 · Somfy Altus RTS 25/17 · Somfy Altus RTS 30/17 ·
Somfy Maestria RTS 10/17 · Somfy Maestria RTS 15/17 · Somfy Altus WT 15/17 ·
Somfy Extreme Maestria RTS 35/17 · Somfy Extreme Altus RTS 40/17 ·
Somfy Extreme Altus RTS 50/12 · Somfy Extreme GEMINI 25/17 WT
**Control Option** (8): N/A · 1000 - Black · 1500 - Black · 2000 - Black ·
1000 - Grey · 1500 - Grey · 2000 - Grey · External Pull Stick Adjustable W/Wall Clip
**Remote Option** (16): None · ACMEDA 15 Channel White/Black · PUSH 5 Channel White/Black ·
ACMEDA 1 Channel White/Black · PUSH Pro White/Black · Paradigm 1 Ch / 2 Ch / 15 Ch
Wall Controller · Surface Mount 5 Ch Wall Switch · SOMFY 16 / 5 / 1 Channel
**Extension Cable** (3): 1.5m USB-C Port Extension FT Li-Ion Motor ·
2.5m USB-C Port Extension FT Li-Ion Motor · N/A
**Charger** (3): Yes · No · Wall Charger & 4m USB to USB-C
**Solar Panel Option** (2): Outdoor Solar Panel for FT Li-Ion Motor · Not Required
**Sensor** (2): No Sensor · Automate Arc Solar Sun Wind Sensor

## Bottom rail (7 fields)
**Bottom Rail Type** (4): F56 · F72 · Pivot Arm Terminal Bar · Deep Channel Weight Bar
**Bottom Rail Colour** (10): Black · White · Monument · Surfmist · Woodlands Grey ·
Classic Cream · Paperbark · Ebony · Cream · Custom
**Bottom Rail Custom Colour** — searchable free text
**Weight Bar Seal** (7): N/A · Ultra Lock Seal V3 · Bubble Seal 8mm (Middle) ·
Double Bubble Push Seal 8mm (Both Sides) · F56 Bubble Seal 16mm ·
Bubble Push Seal 8mm (1 side) · F72 Bubble Push Seal 16mm
**Weightbar Lock** (10): N/A · Ultra Lock · SB07 Bolt Lock · F56 Loop Spring Kit ·
F56 Loop Strap Kit · F72 Loop Spring Kit · F72 Loop Strap Kit ·
F56 Flush Mount Strap Kit · F72 Flush Mount Strap Kit · Slide Stainless Lock Assembly Set
**Handle Option** (5): N/A · Zipscreen Weight Bar Handle · Polished Stainless Handle ·
2 x Zipscreen Weight Bar Handle · 2 x Polished Stainless Handle
**Weightbar Ballast** (3): `N/A - MUST CHOOSE THIS FOR SPRING CONTROL` ·
Single Ballast · Double Ballast

## Other (3 fields)
**Delivery Option** (3): Pickup · Delivery Local Run · Freight
**Extra Charge $** — free text
**Extra description** — free text

---

# EXTBL-specific traps

1. **`Weightbar Ballast` null value is not `N/A`** — it is the full string
   `N/A - MUST CHOOSE THIS FOR SPRING CONTROL`. A map that emits plain `N/A`
   here will fail, even though every other field on this product uses bare `N/A`.
   Order 113073.A used Control Type = Spring with `Single Ballast`.
2. **Two drop fields, with different input types** — `Left Drop (mm)` is a
   number input, `Right Drop (mm)` is a *text* input. An export writing a bare
   number to Right Drop is fine, but don't assume numeric validation.
3. **`Tube Type` has two entries beginning `130mm`** — bare `130mm` and
   `130mm (Use when over 6.8m wide and 3.2 drop)`. Prefix matching will pick
   the wrong one.
4. **Colour lists differ between headbox and side guide/bottom rail**: headbox
   has `Zinc Brackets` and `Stainless Steel`; side guide and bottom rail have
   `Ebony` and `Cream` instead. Don't share one colour map across all three.
5. **`Type` is a field, not part of the fabric name**, despite the cart's
   product string reading `EXTBL Zipscreen OUTLOOK MODE ZERO Chalk`.
