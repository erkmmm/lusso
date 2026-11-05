# Quotient-style quote builder

Implemented on `feat/quotient-style-builder`, based on `cb17ec8`, in the isolated worktree `/private/tmp/lusso-quotient-builder`. The main checkout and live deployment are unchanged.

## Behaviour

- Quotient-style toolbar, customer/from panel, overview/activity/settings and continuous editable quote document.
- Inline custom item names, descriptions, quantities and unit prices. A quote-specific name does not rename its source library product or change its measured product type.
- Explicit Save to Price Library dialog creates a new reusable item. Duplicate names are blocked, including inactive records. Base costs, labour, margin, pricing method and supplier carry across; measurements, discounts, quantities and private notes do not.
- Customer-facing text blocks before/after prices, with move/delete controls. Rooms and openings can be reordered without separating choice groups or changing window references.
- Price visibility settings apply to customer preview and PDF: all prices/quantities, item totals, or quote total only.
- Save Now stays in the editor. Preview uses the same name stamping and conflict check as saving.
- Preview & Send is portalled to the body with its own opaque quote background. Translucent quote panels no longer reveal the editor behind them. Email sending behaviour is unchanged.
- Customer title, custom names and text blocks are retained in the exported PDF.

## Release order

1. Reconcile/cherry-pick this branch with other active work. Changes are concentrated in QuoteBuilder, two customer presentation files and new components/helpers.
2. Apply `supabase/migrations/20261105_quote_builder_text_items.sql` before deploying the frontend. It adds `text_items` and `price_display`, and preserves the token check and existing public field projection.
3. Deploy through the usual release workflow. No migration, merge or deployment has been performed here.

The temporary offline preview harness (`quote-preview.html`, `quote-preview.jsx`) is intentionally uncommitted. It uses synthetic seed data and has no Supabase credentials. Run Vite on port 5181 and open `/quote-preview.html` to inspect it.

## Validation

- Production Vite build passes (existing bundle-size/dynamic-import warnings).
- 27 tests pass across quote-builder items, selection progress, motorisation accessories and customer quote addresses.
- New components/helpers and QuoteBuilder pass ESLint. CustomerQuotePage has a pre-existing static-components lint finding for NavList; no new lint findings were introduced.
- Browser checks: custom name save/reload; new custom item creation and library reuse; duplicate prevention; customer preview hides line prices in quote-total mode; phone width 390px has no horizontal overflow.
- Actual PDF exported from the synthetic quote: custom names and text survive, quote-total mode omits individual prices. Its rendered page was visually checked.
- Preview background checked in the browser: opaque background colour, opacity 1, fixed viewport coverage, portal parent BODY. No customer emails were sent during testing.
