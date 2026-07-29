-- Quote-level discount support for the quote builder + customer quote page.
--
-- The app stores an optional overall discount on a quote as camelCase fields
-- (discountType / discountValue / discountLabel). The write-through sync layer
-- (src/store/db.js) converts every non-excluded field to a snake_case column,
-- so without these columns the Supabase upsert fails for ANY quote that carries
-- a discount — the quote never syncs, and the public customer page
-- (get_public_quote = `select *`) can't reflect the discount.
--
-- Applied to Lusso CRM (project wwompnqglvdxcmjquuzr) on 2026-07-29.

alter table public.quotes add column if not exists discount_type  text;
alter table public.quotes add column if not exists discount_value numeric;
alter table public.quotes add column if not exists discount_label text;
