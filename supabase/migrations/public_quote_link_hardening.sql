-- ─────────────────────────────────────────────────────────────────────────────
-- Public quote links: capability tokens + a sanitised payload.
--
-- Before this, /quotes/:id/preview was protected by nothing at all. Quote ids
-- are sequential (qnt-1, qnt-4, qnt-7580 …), and get_public_quote /
-- track_quote_event are SECURITY DEFINER granted to anon — so with the publish-
-- able key that ships in the frontend bundle, anyone could walk the id space and
--   * read every quote ever written, including unitCostPrice, labourCost,
--     marginPercent, supplier and internalNotes on every line, and
--   * accept or decline any of them, recomputing totals, advancing the job and
--     firing the staff notification email.
--
-- Two fixes, both needed:
--   1. Capability token. Every quote already had a populated `public_token`
--      column that no code ever used; the link now carries it and the RPCs
--      require it. Knowing an id is no longer enough.
--   2. Sanitised payload. Even a legitimate customer could open devtools and
--      read our cost and margin on every line of their own quote, because the
--      RPC returned quotes.*. The public read now returns a hand-picked
--      projection with sell prices only.
--
-- The legacy 1-arg / 3-arg signatures stay in place here so live quote pages
-- keep working until the frontend ships; revoking anon on them is a separate
-- step (see public_quote_link_hardening_lockdown.sql) run straight afterwards.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Token column ──────────────────────────────────────────────────────────
-- Already present and fully backfilled, but never constrained. Belt and braces
-- so a row can't be written without one.
update public.quotes
   set public_token = gen_random_uuid()::text
 where public_token is null or length(public_token) < 20;

alter table public.quotes alter column public_token set default gen_random_uuid()::text;
alter table public.quotes alter column public_token set not null;
create unique index if not exists quotes_public_token_key on public.quotes (public_token);

-- ── 2. Columns the customer's own device could never see ─────────────────────
-- These three were in EXCLUDE_COLUMNS on the client — stripped before every
-- write because no column existed. Staff saw them from localStorage; the
-- customer, who has no localStorage, got a quote with no site address, the
-- generic default terms instead of the ones written for them, and sizes that
-- stayed hidden however the "Show dimensions to client" box was set.
alter table public.quotes add column if not exists site_address          text;
alter table public.quotes add column if not exists terms_and_conditions  text;
alter table public.quotes add column if not exists show_sizes_to_client  boolean not null default false;

-- ── 3. Gross (pre-discount) unit price ───────────────────────────────────────
-- quote_line_net_unit already encodes the pricing rules; splitting the gross
-- step out lets the public payload show "was $X, now $Y" without shipping the
-- cost basis, and keeps one source of truth for the arithmetic.
create or replace function public.quote_line_gross_unit(li jsonb)
returns numeric
language plpgsql
immutable
as $$
DECLARE
  v_cost    numeric := COALESCE(NULLIF(li->>'unitCostPrice','')::numeric, 0);
  v_labour  numeric := COALESCE(NULLIF(li->>'labourCost','')::numeric, 0);
  v_margin  numeric := COALESCE(NULLIF(li->>'marginPercent','')::numeric, 0);
  v_rate    numeric := COALESCE(NULLIF(li->>'pricePerSqm','')::numeric, 0);
  v_width   numeric := COALESCE(NULLIF(li->>'widthMm','')::numeric, 0);
  v_drop    numeric := COALESCE(NULLIF(li->>'dropMm','')::numeric, 0);
  v_area    numeric;
BEGIN
  -- Legacy / imported model: no cost basis, price is unitPrice + labour.
  IF NOT (li ? 'unitCostPrice') THEN
    RETURN COALESCE(NULLIF(li->>'unitPrice','')::numeric, 0) + v_labour;
  END IF;

  -- A manual sell price always wins — including a deliberate 0.
  IF li->>'manualSellPrice' IS NOT NULL AND li->>'manualSellPrice' <> '' THEN
    RETURN (li->>'manualSellPrice')::numeric;
  END IF;

  v_area := CASE WHEN v_width > 0 AND v_drop > 0 THEN v_width * v_drop / 1000000 ELSE 0 END;
  IF v_rate > 0 AND v_area > 0 THEN
    RETURN v_rate * v_area;                          -- size-based ($/m²)
  ELSIF v_margin < 100 THEN
    RETURN (v_cost + v_labour) / (1 - v_margin / 100);
  ELSE
    RETURN v_cost + v_labour;
  END IF;
END;
$$;

-- Re-express the net unit in terms of the gross, so the two can never drift.
-- The legacy early-return is preserved exactly: an imported line has its
-- discount baked into the price already, and applying discountPercent on top
-- would silently restate the totals on ~3,600 historical quotes.
create or replace function public.quote_line_net_unit(li jsonb)
returns numeric
language plpgsql
immutable
as $$
DECLARE
  v_gross numeric := public.quote_line_gross_unit(li);
  v_pct   numeric := COALESCE(NULLIF(li->>'discountPercent','')::numeric, 0);
  v_amt   numeric := COALESCE(NULLIF(li->>'discountAmount','')::numeric, 0);
BEGIN
  IF NOT (li ? 'unitCostPrice') THEN RETURN v_gross; END IF;
  IF v_pct > 0 THEN RETURN v_gross - (v_gross * v_pct / 100); END IF;
  IF v_amt > 0 THEN RETURN v_gross - LEAST(v_amt, v_gross);   END IF;
  RETURN v_gross;
END;
$$;

-- ── 4. Line items, with the cost basis stripped ──────────────────────────────
-- manualSellPrice carries the server-computed gross so the browser's
-- linePricing() takes its manual-override branch and lands on exactly the same
-- figures it would have computed from the costs — same numbers, no costs.
create or replace function public.quote_public_line_items(p_line_items jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',                  li->>'id',
      'type',                li->>'type',
      'choiceGroupId',       li->'choiceGroupId',
      'choiceRequired',      coalesce((li->>'choiceRequired')::boolean, false),
      'location',            li->>'location',
      'productNameSnapshot', li->>'productNameSnapshot',
      'description',         li->>'description',
      'customerNotes',       li->>'customerNotes',
      'quantity',            coalesce(nullif(nullif(li->>'quantity','')::numeric, 0), 1),
      'widthMm',             li->'widthMm',
      'dropMm',              li->'dropMm',
      'taxable',             (li->>'taxable') is distinct from 'false',
      -- A legacy/imported line has its discount already baked into the price
      -- and quote_line_net_unit deliberately skips the discount step for it, so
      -- send the net with no discount fields — otherwise the browser would
      -- deduct it a second time and disagree with the server's totals.
      'discountPercent',     case when li ? 'unitCostPrice'
                                  then coalesce(nullif(li->>'discountPercent','')::numeric, 0) else 0 end,
      'discountAmount',      case when li ? 'unitCostPrice'
                                  then coalesce(nullif(li->>'discountAmount','')::numeric, 0) else 0 end,
      -- sell side only
      'manualSellPrice',     case when li ? 'unitCostPrice'
                                  then public.quote_line_gross_unit(li)
                                  else public.quote_line_net_unit(li) end,
      'unitCostPrice',       0,
      'labourCost',          0,
      'marginPercent',       0
    ) order by ord
  ), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_line_items) = 'array'
                                 then p_line_items else '[]'::jsonb end)
       with ordinality as t(li, ord);
$$;

-- ── 5. The public read ───────────────────────────────────────────────────────
-- camelCase keys so the page can use the result as-is; fromDb()'s snake→camel
-- pass isn't involved, which also sidesteps the includes_gst acronym-tail case.
create or replace function public.get_public_quote(p_id text, p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',                  q.id,
    'quoteNumber',         q.quote_number,
    'status',              q.status,
    'title',               q.title,
    'siteAddress',         q.site_address,
    'salesperson',         q.salesperson,
    'introMessage',        q.intro_message,
    'termsAndConditions',  q.terms_and_conditions,
    'expiryDate',          q.expiry_date,
    'depositType',         q.deposit_type,
    'depositValue',        q.deposit_value,
    'discountType',        q.discount_type,
    'discountValue',       q.discount_value,
    'discountLabel',       q.discount_label,
    'includesGST',         coalesce(q.includes_gst, true),
    'gstRate',             coalesce(q.gst_rate, 10),
    'showSizesToClient',   coalesce(q.show_sizes_to_client, false),
    'planSnapshot',        q.plan_snapshot,
    'selectedLineItemIds', coalesce(q.selected_line_item_ids, '[]'::jsonb),
    'firstOpenedAt',       q.first_opened_at,
    'createdAt',           q.created_at,
    'lineItems',           public.quote_public_line_items(q.line_items)
  )
  from public.quotes q
  where q.id = p_id
    and q.deleted_at is null
    and q.public_token = p_token;
$$;

-- ── 6. Who the quote is for ──────────────────────────────────────────────────
-- `customers` is not readable with the anon key, and the customer's device has
-- no local copy — so every real customer was greeted as "Valued customer" and
-- accepted with an empty name and email attached. Name/email/phone only, and
-- only behind the same token.
create or replace function public.get_public_quote_customer(p_id text, p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone)
  from public.quotes q
  join public.customers c on c.id = q.customer_id
  where q.id = p_id
    and q.deleted_at is null
    and q.public_token = p_token;
$$;

-- ── 7. The public write, behind the same token ───────────────────────────────
-- Delegates to the existing 3-arg body once the token checks out, so the
-- acceptance logic stays in exactly one place.
create or replace function public.track_quote_event(
  p_quote_id text, p_event_type text, p_metadata jsonb, p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
DECLARE
  v_ok boolean;
BEGIN
  SELECT true INTO v_ok FROM public.quotes
   WHERE id = p_quote_id AND deleted_at IS NULL AND public_token = p_token;
  IF NOT COALESCE(v_ok, false) THEN
    RETURN '{"ok":false,"error":"unauthorized"}'::jsonb;
  END IF;
  RETURN public.track_quote_event(p_quote_id, p_event_type, p_metadata);
END;
$$;

-- ── 8. Grants ────────────────────────────────────────────────────────────────
grant execute on function public.get_public_quote(text, text)          to anon, authenticated;
grant execute on function public.get_public_quote_customer(text, text) to anon, authenticated;
grant execute on function public.track_quote_event(text, text, jsonb, text) to anon, authenticated;
