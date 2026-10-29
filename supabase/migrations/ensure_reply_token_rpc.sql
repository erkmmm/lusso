-- Mint a reply token from a Cloudflare Pages Function, without a service key.
--
-- reply_tokens is service-role-only (RLS on, no policies), which is right: a
-- leaked token lets anyone post into a customer's job thread. The Supabase
-- edge functions hold the service key and mint tokens directly. The three
-- Pages Functions — quote, installer request, purchase order — do not, and
-- putting the service key in the Pages environment to give them one would hand
-- every one of those routes unrestricted read/write over the whole database to
-- solve a sixteen-character problem.
--
-- So the minting moves into the database behind a SECURITY DEFINER function
-- that the caller reaches with their own JWT, under the same is_active_user()
-- check the rest of the app uses. Staff get a token for a conversation they
-- could already see; nobody gets the table.
--
-- Enquiry tokens are deliberately not reachable here — web leads are answered
-- from the inbox, which goes through send-communication and the service key.

create or replace function public.ensure_reply_token(
  p_job_id      text default null,
  p_customer_id text default null
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_token text;
  v_role  text;
begin
  -- quote-notify runs with the service key and no signed-in user — the
  -- database itself calls it when a customer accepts a quote — so
  -- is_active_user() is false for it by definition. Letting the service role
  -- through the same door beats giving that function its own copy of this.
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');

  if not (public.is_active_user() or v_role = 'service_role') then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if p_job_id is null and p_customer_id is null then
    return null;
  end if;

  -- One token per conversation. The partial unique index is what guarantees
  -- that; this is the read that usually makes the insert unnecessary.
  select token into v_token
    from public.reply_tokens
   where enquiry_id is null
     and job_id is not distinct from p_job_id
     and customer_id is not distinct from p_customer_id
   limit 1;
  if v_token is not null then return v_token; end if;

  -- 24 hex characters — 96 bits. The token is a bearer key to a customer's
  -- thread, so it has to be unguessable, not merely unique. Two uuids
  -- concatenated so the slice never leans on one value's version nibble.
  v_token := substr(
    replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 24);

  begin
    insert into public.reply_tokens (token, job_id, customer_id)
    values (v_token, p_job_id, p_customer_id);
  exception when unique_violation then
    -- A concurrent send beat us to it: use theirs rather than failing a send.
    select token into v_token
      from public.reply_tokens
     where enquiry_id is null
       and job_id is not distinct from p_job_id
       and customer_id is not distinct from p_customer_id
     limit 1;
  end;

  return v_token;
end;
$$;

revoke all on function public.ensure_reply_token(text, text) from public, anon;
grant execute on function public.ensure_reply_token(text, text) to authenticated, service_role;

comment on function public.ensure_reply_token(text, text) is
  'Returns the stable q-<token> reply key for a job/customer conversation, creating it on first use. For the Pages Functions, which have no service key. Active staff only.';
