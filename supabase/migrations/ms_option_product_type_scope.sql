-- A custom measure-sheet option can now say which product types it belongs to.
--
-- Until now an option added in Settings was global, and getMsOptions() returned
-- a product type's `options` override INSTEAD of the merged list — so an option
-- added for a field that any type overrides (Curtain and Roller Blind both
-- override operationType) silently never appeared on that type. The Settings
-- copy promised "your additions apply to every measure sheet", which was not
-- true for exactly the products where track and motor options matter most.
--
-- NULL or empty = every product type, which is what every existing row means.
alter table public.measure_sheet_options
  add column if not exists product_type_ids text[];

comment on column public.measure_sheet_options.product_type_ids is
  'Product type ids this option is offered on. NULL/empty = all types.';

-- PostgREST caches the schema; without this the new column is invisible to the
-- API and the app's writes to it are silently dropped.
notify pgrst, 'reload schema';
