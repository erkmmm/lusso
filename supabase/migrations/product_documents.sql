-- Product reference documents: supplier spec sheets, install guides, warranty
-- and care instructions. The binary lives in the private `product-docs` bucket;
-- this table holds only the metadata and the link to what it describes.
--
-- SCOPE: what the document applies to.
--   'item'     → one priced item (priced_item_id)
--   'supplier' → every priced item from `supplier`, optionally narrowed to
--                `category`; a blank category means everything they supply
--   'type'     → a Lusso product type (product_type_id), for products that
--                aren't in the price library at all
--
-- Supplier range is the normal case: Verosol's P201.0 Duo Pleated Blind sheet
-- covers all 28 "Verosol / Pleated Blind" rows, one per fabric. Attaching per
-- priced item would mean filing the same PDF 28 times and re-filing it after
-- every price import.
--
-- Scope is stored, never inferred from which columns are filled — `supplier` is
-- also plain metadata on item- and type-scoped documents, and inferring from it
-- would silently widen those.
create table if not exists public.product_documents (
  id              text primary key,
  scope           text not null default 'item'
                    constraint product_documents_scope_check check (scope in ('item', 'supplier', 'type')),
  priced_item_id  text,
  product_type_id text,
  category        text,
  title           text not null,
  doc_type        text not null default 'spec',   -- spec | install | warranty | care | fabric | other
  supplier        text,
  product_code    text,
  version         text,
  issued          text,        -- free text: docs say "October 2017" or "2020-05"
  file_path       text not null,
  file_name       text,
  file_size       bigint,
  page_count      integer,
  -- Whether the PDF carried a text layer. A scanned spec sheet is still a
  -- perfectly good document, it just can't be searched by content — and the UI
  -- has to say so rather than let it be silently unfindable.
  has_text        boolean not null default false,
  text_chars      integer not null default 0,
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  deleted_at      timestamptz,
  created_by      text
);

create index if not exists product_documents_priced_item_idx  on public.product_documents (priced_item_id);
create index if not exists product_documents_product_type_idx on public.product_documents (product_type_id);
create index if not exists product_documents_supplier_idx     on public.product_documents (supplier);
create index if not exists product_documents_scope_idx        on public.product_documents (scope, supplier, category);
create index if not exists product_documents_live_idx         on public.product_documents (deleted_at);

-- Extracted text lives in its OWN table, keyed by document id.
--
-- It is deliberately not a column on product_documents: every table above syncs
-- wholesale into localStorage, and a handful of 40-page install manuals would
-- blow the quota for everything else. Searching inside documents is an online
-- query against this table; searching titles/suppliers/codes stays local and
-- works on site with no signal.
create table if not exists public.product_document_text (
  document_id text primary key references public.product_documents(id) on delete cascade,
  content     text not null default '',
  tsv         tsvector generated always as (to_tsvector('english', coalesce(content, ''))) stored,
  updated_at  timestamptz default now()
);

create index if not exists product_document_text_tsv_idx on public.product_document_text using gin (tsv);

alter table public.product_documents     enable row level security;
alter table public.product_document_text enable row level security;

-- Reference material every active staff member needs to read AND contribute to.
-- Deliberately not account-manager-gated like the price library: a salesperson
-- who finds a supplier's new spec sheet should be able to file it, or it never
-- gets filed. Deletes are soft (deleted_at), so nothing is actually destroyed.
drop policy if exists product_documents_select on public.product_documents;
drop policy if exists product_documents_write  on public.product_documents;
create policy product_documents_select on public.product_documents
  for select using ((select is_active_user()));
create policy product_documents_write on public.product_documents
  for all using ((select is_active_user())) with check ((select is_active_user()));

drop policy if exists product_document_text_select on public.product_document_text;
drop policy if exists product_document_text_write  on public.product_document_text;
create policy product_document_text_select on public.product_document_text
  for select using ((select is_active_user()));
create policy product_document_text_write on public.product_document_text
  for all using ((select is_active_user())) with check ((select is_active_user()));

-- Private bucket — internal reference material, signed URLs only, same as
-- takeoff plans. 25 MB covers a long illustrated install manual.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-docs', 'product-docs', false, 26214400,
  array['application/pdf','image/jpeg','image/png','image/webp',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists product_docs_select on storage.objects;
drop policy if exists product_docs_insert on storage.objects;
drop policy if exists product_docs_update on storage.objects;
drop policy if exists product_docs_delete on storage.objects;
create policy product_docs_select on storage.objects
  for select using (bucket_id = 'product-docs' and is_active_user());
create policy product_docs_insert on storage.objects
  for insert with check (bucket_id = 'product-docs' and is_active_user());
create policy product_docs_update on storage.objects
  for update using (bucket_id = 'product-docs' and is_active_user());
create policy product_docs_delete on storage.objects
  for delete using (bucket_id = 'product-docs' and is_active_user());

-- The app reads these columns immediately after the migration.
notify pgrst, 'reload schema';

-- ── Applied separately on 2026-09-07 for the already-deployed table ──────────
-- Kept so this file can also be replayed against a database created before the
-- scope model existed.
alter table public.product_documents
  add column if not exists category text,
  add column if not exists scope    text not null default 'item';

update public.product_documents
   set scope = 'type'
 where scope = 'item' and priced_item_id is null and product_type_id is not null;

alter table public.product_documents drop constraint if exists product_documents_scope_check;
alter table public.product_documents
  add constraint product_documents_scope_check check (scope in ('item', 'supplier', 'type'));

notify pgrst, 'reload schema';

-- ── Structured limits (applied 2026-09-07) ──────────────────────────────────
-- The numbers on the spec sheet, as data, so a measured opening is checked the
-- moment it is typed. Kept ON the document because that is where the numbers
-- come from: scope already decides which products a sheet covers, so limits
-- inherit that matching, and every warning can name and open its source.
--
--   { "widthMm": {"min":300,"max":3400}, "dropMm": {"min":200,"max":3200},
--     "maxAreaM2": 10,
--     "checks": [ { "severity":"error"|"warning",
--                   "when": {"spec":"control","is":"Cord Lock"} | null,
--                   "widthMm": {"max":2900} | {"over":2200},
--                   "message": "..." } ] }
--
-- severity separates "the supplier will reject this" from "allowed, but the
-- customer must be told" — the fabric-join case, which causes complaints
-- precisely because nobody knows to ask about it.
alter table public.product_documents
  add column if not exists limits jsonb;

notify pgrst, 'reload schema';
