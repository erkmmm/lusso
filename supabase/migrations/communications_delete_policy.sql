-- Active staff can already INSERT and UPDATE communications; without a DELETE
-- policy RLS silently drops the delete (0 rows affected, no error), so the
-- Comms tab's delete button would appear to work and then the row reappears
-- on reload. Mirror the existing is_active_user() gate.
drop policy if exists "Authenticated users can delete communications" on public.communications;
create policy "Authenticated users can delete communications"
  on public.communications
  for delete
  to authenticated
  using ((select public.is_active_user()));

-- Web leads sit in the same inbox list as message threads, so deleting a
-- conversation has to be able to remove one too.
drop policy if exists "web_enquiries_delete_staff" on public.web_enquiries;
create policy "web_enquiries_delete_staff"
  on public.web_enquiries
  for delete
  to authenticated
  using ((select public.is_active_user()));
