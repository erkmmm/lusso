# BUZ option vocabulary — observed from live order

Source: BUZ portal (Skins2Go), order **113073.A** — Lusso (Callan Fox)
Captured: 2026-10-27 · portal v4.8.345
14 lines: 11 × `ROLL`, 3 × `EXTBL`

Values below are only those present on this order. Option **names and their order**
are the product's schema and should be complete; **value lists** are a partial
sample of each option's domain.

---

## Group code `ROLL` — roller blind
Product string: `ROLL <Range> <Light control> <Colour>`
e.g. `ROLL Shaw Palm Beach (New) Blockout Quill`
     `ROLL Shaw Palm Beach (New) Light Filtering Melody`

22 options, in schema order:

| # | Option | Values seen | Priced |
|---|--------|-------------|--------|
| 1 | Location | free text (room label) | |
| 2 | Quantity | 1 | |
| 3 | Width (mm) | integer mm | |
| 4 | Drop (mm) | integer mm | |
| 5 | Sizes | Opening | |
| 6 | Control Type | Acmeda RB09 | +$4.94 |
| 7 | Controls | Left, Right | |
| 8 | Roll Direction | Frontroll / Rev, Backroll / Std | |
| 9 | Assist Option | N/A | |
| 10 | Bottom Trim | D30 Bump | +$5.39 |
| 11 | Rail Colour | White | |
| 12 | Control Option | Plastic White | **-$2.50** |
| 13 | Chain Length (mm) | 1000, 750 | |
| 14 | Fit | Face | |
| 15 | Chain Tension Colour | Clear | |
| 16 | Bracketing | Single | |
| 17 | Control & Bracket Colour | Pure White | |
| 18 | Bracket Covers | Yes, No | +$1.25 |
| 19 | Pelmet Type | N/A, Acmeda Cassette, Acmeda Casstte with Side Guides | +$161.00 |
| 20 | Surcharge | N/A | |
| 21 | Pelmet Colour | White | |
| 22 | Pelmet Brackets | Face Fit | |

Note: "Acmeda Cass**t**te with Side Guides" is spelled that way in BUZ (typo is
theirs). Match it exactly or the import will fail.

---

## Group code `EXTBL` — external blind / Zipscreen
Product string: `EXTBL Zipscreen <System> <Colour>`
e.g. `EXTBL Zipscreen OUTLOOK MODE ZERO Chalk`

21 options, in schema order:

| # | Option | Values seen | Priced |
|---|--------|-------------|--------|
| 1 | Location | free text | |
| 2 | Quantity | 1 | |
| 3 | Width (mm) | integer mm | |
| 4 | **Left Drop (mm)** | integer mm | |
| 5 | Installation Type | Box 120 | +$295.02 |
| 6 | Tube Type | 78mm | +$103.75 |
| 7 | HeadBox / Bracket Colour | White | |
| 8 | Side Guide Fix | FF 120 L fixing rail | +$82.49 |
| 9 | Side Guide Colour | White | |
| 10 | Side Finish | Zip No.6 | +$14.55 |
| 11 | Control Type | Spring | +$93.73 |
| 12 | Control Side | Left | |
| 13 | Control Option | N/A | |
| 14 | Bottom Rail Type | F56 | +$123.83 |
| 15 | Bottom Rail Colour | White | |
| 16 | Weight Bar Seal | N/A | |
| 17 | Weightbar Lock | N/A | |
| 18 | Handle Option | Zipscreen Weight Bar Handle | +$6.14 |
| 19 | Weightbar Ballast | Single Ballast | +$42.32 |
| 20 | Delivery Option | Delivery Local Run | |
| 21 | Extra description | free text | |

---

## Cross-group notes

- `Drop (mm)` on ROLL is `Left Drop (mm)` on EXTBL — not interchangeable.
- "N/A" is the literal null value, not blank.
- `Fit` (ROLL) = Face; EXTBL uses `Installation Type` instead.
- Only EXTBL exposes `Delivery Option` and `Extra description`. Free-text notes
  seen: "please rail road the fabric Palm Beach Quill",
  "Fabric to be Palm Beach colour Quill".
- Line-level discount: ROLL 20%, EXTBL 15%. Priced options carry the same
  discount as their parent line, except `Control Option` (-$2.50 at 0%).
- Line "Amount" = item amount + priced options, which is why it diverges from
  Item Amount x Qty on the cart screen.
