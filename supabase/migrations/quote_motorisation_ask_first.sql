-- ─────────────────────────────────────────────────────────────────────────────
-- Motorisation accessories: ask before adding them.
--
-- Paired with src/lib/motorisationAccessories.js — the two have to be changed
-- together (see quote_motorisation_accessories.sql for the rule itself and why
-- it exists on both sides).
--
-- The rule used to add the handsets on its own. Two things were wrong with
-- that. A quote whose total carries $500 of accessories nobody agreed to is a
-- quote that gets corrected by the customer. And a DERIVED line cannot be
-- edited — the 15-Channel is right for most rooms and wrong for some, and
-- there was nowhere to put the correction, because the next pass recomputed
-- it from the motors.
--
-- So it is now a suggestion a person accepts in the quote editor, and
-- accepting MATERIALISES it: the accessories become ordinary line items on
-- the quote, editable and removable like any other. `motorisation_approval`
-- records the answer:
--
--   NULL       — a quote from before the ask. Still derives, exactly as it
--                did. Thousands of quotes are already out with handsets in
--                their totals; retiring the rule under them would move money
--                on quotes that have been sent, accepted and invoiced.
--   'pending'  — suggested, unanswered. Nothing is added, here or in the
--                browser. The editor says so before the quote is sent.
--   'added'    — accepted. The lines are real, so there is nothing left to
--                derive and an edit or a deletion sticks.
--   'declined' — left off on purpose.
--
-- Why the server has to honour it, not just the browser: acceptance is
-- persisted by track_quote_event under the anon key, and quote_recompute_totals
-- is what materialises. Gated only in the JS, a pending quote would sail
-- through the editor and the customer's page with no handsets and then grow
-- them at the one moment nobody is looking — on acceptance, straight into the
-- purchase order and the Xero invoice.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS motorisation_approval text;

-- PostgREST caches the schema; without this the new column is silently
-- stripped from every write and hydration wipes it back out.
NOTIFY pgrst, 'reload schema';

-- ─── Totals: derive only while the rule is still live ────────────────────────
--
-- The gate sits here rather than inside quote_with_motorisation deliberately.
-- quote_recompute_totals is the only caller that MATERIALISES, so this is the
-- one place a derived accessory can reach a customer's invoice — and the derive
-- helpers stay what the editor needs them to be: a straight answer to "what
-- would the rule suggest", which is also how the JS keeps
-- suggestMotorisationAccessories ungated.
CREATE OR REPLACE FUNCTION public.quote_recompute_totals(p_quote_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_q            quotes%ROWTYPE;
  v_selected     jsonb;
  v_items        jsonb;
  v_gross        numeric := 0;
  v_taxable      numeric := 0;
  v_qdisc        numeric := 0;
  v_factor       numeric := 1;
  v_subtotal     numeric;
  v_gst          numeric;
BEGIN
  SELECT * INTO v_q FROM quotes WHERE id = p_quote_id;
  IF NOT FOUND OR jsonb_typeof(v_q.line_items) <> 'array' THEN RETURN; END IF;

  -- The customer's answers where they have given them, the quote's defaults
  -- where they have not.
  v_selected := quote_effective_selected_ids(v_q.line_items,
                  COALESCE(v_q.selected_line_item_ids, '[]'::jsonb));

  -- Remotes and chargers follow the motors that are live, and are written back
  -- to line_items rather than just counted, because the purchase order, the
  -- Xero invoice and the installer's paperwork all read line_items and know
  -- nothing about the rule. Idempotent, so a quote can pass through here any
  -- number of times.
  --
  -- Unless a person has answered the ask. 'added' already put them on as real
  -- lines; 'pending' and 'declined' mean they are off this quote, and stay off
  -- through acceptance. Mirrors autoAccessoriesLive() in the JS.
  IF v_q.motorisation_approval IS NULL THEN
    v_items := quote_with_motorisation(v_q.line_items, v_selected, v_q.motorisation_presets);
    IF v_items IS DISTINCT FROM v_q.line_items THEN
      UPDATE quotes SET line_items = v_items WHERE id = p_quote_id;
    END IF;
  ELSE
    v_items := v_q.line_items;
  END IF;

  SELECT
    COALESCE(SUM(net * qty), 0),
    COALESCE(SUM(net * qty) FILTER (WHERE taxable), 0)
  INTO v_gross, v_taxable
  FROM (
    SELECT
      quote_line_net_unit(li) AS net,
      COALESCE(NULLIF(NULLIF(li->>'quantity','')::numeric, 0), 1) AS qty,
      (li->>'taxable') IS DISTINCT FROM 'false' AS taxable
    FROM jsonb_array_elements(v_items) li
    WHERE li->>'type' IN ('Required','Part')
       OR (li->>'type' IN ('Optional','Multiple Choice') AND v_selected ? (li->>'id'))
  ) s;

  v_qdisc := CASE
    WHEN v_q.discount_type = 'Percentage'   THEN v_gross * (COALESCE(v_q.discount_value,0) / 100)
    WHEN v_q.discount_type = 'Fixed Amount' THEN LEAST(COALESCE(v_q.discount_value,0), v_gross)
    ELSE 0 END;

  IF v_gross > 0 THEN v_factor := 1 - v_qdisc / v_gross; END IF;

  v_subtotal := v_gross - v_qdisc;
  v_gst := CASE WHEN COALESCE(v_q.includes_gst, true)
                THEN v_taxable * v_factor * (COALESCE(v_q.gst_rate, 10) / 100)
                ELSE 0 END;

  UPDATE quotes SET
    total_sell  = ROUND(v_subtotal, 2),
    gst_amount  = ROUND(v_gst, 2),
    grand_total = ROUND(v_subtotal + v_gst, 2),
    updated_at  = now()
  WHERE id = p_quote_id;
END;
$function$;

-- ─── The customer's copy carries the answer too ──────────────────────────────
--
-- The customer's device derives the accessories as they tick options, so it
-- needs to know whether it may. Without this the browser would price handsets
-- onto a pending quote that the server has correctly left off it, and the
-- total they accept would not be the total that gets invoiced.
CREATE OR REPLACE FUNCTION public.get_public_quote(p_id text, p_token text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'motorisationPresets', public.quote_public_motorisation_presets(q.motorisation_presets),
    'motorisationApproval', q.motorisation_approval,
    'documents',           coalesce(q.documents, '[]'::jsonb),
    'lineItems',           public.quote_public_line_items(q.line_items)
  )
  from public.quotes q
  where q.id = p_id
    and q.deleted_at is null
    and q.public_token = p_token;
$function$;
