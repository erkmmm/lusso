-- measure_sheet_options had SELECT, INSERT and DELETE policies but no UPDATE.
-- Nothing ever updated a row — the UI could only add an option or remove one —
-- so the gap stayed invisible until options gained a product-type scope, which
-- edits an existing row. The upsert resolved to an UPDATE and RLS refused it,
-- leaving the change correct in local storage and silently absent from the
-- server: exactly the shape of bug that looks like "it worked on my phone".
--
-- Mirrors the other three policies: any active user, same as adding or deleting.
create policy mso_update on public.measure_sheet_options
  for update
  using      ((select public.is_active_user()))
  with check ((select public.is_active_user()));
