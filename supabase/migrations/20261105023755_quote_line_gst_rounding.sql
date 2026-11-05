-- Preserve explicitly imported line-rounded GST without changing existing quotes.
CREATE OR REPLACE FUNCTION public.quote_public_line_items(p_line_items jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',                  li->>'id',
      'type',                li->>'type',
      'choiceGroupId',       li->'choiceGroupId',
      'choiceRequired',      coalesce((li->>'choiceRequired')::boolean, false),
      'location',            li->>'location',
      'productNameSnapshot', li->>'productNameSnapshot',
      'displayName',         nullif(li->>'displayName', ''),
      'description',         li->>'description',
      'customerNotes',       li->>'customerNotes',
      'quantity',            coalesce(nullif(nullif(li->>'quantity','')::numeric, 0), 1),
      'widthMm',             li->'widthMm',
      'dropMm',              li->'dropMm',
      'taxable',             (li->>'taxable') is distinct from 'false',
      'gstRounding',         case when li->>'gstRounding' = 'line' then 'line' else 'subtotal' end,
      'recommended',         coalesce(nullif(li->>'recommended', '')::boolean, false),
      'preselected',         coalesce(nullif(li->>'preselected', '')::boolean, false),
      'discountPercent',     case when li ? 'unitCostPrice'
                                  then coalesce(nullif(li->>'discountPercent','')::numeric, 0) else 0 end,
      'discountAmount',      case when li ? 'unitCostPrice'
                                  then coalesce(nullif(li->>'discountAmount','')::numeric, 0) else 0 end,
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
$function$;

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

  -- Only explicitly opted-in imported quotes use per-line GST rounding.
  IF COALESCE(v_q.includes_gst, true) AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_q.line_items) li WHERE li->>'gstRounding' = 'line'
  ) THEN
    SELECT COALESCE(SUM(ROUND(quote_line_net_unit(li)
      * COALESCE(NULLIF(NULLIF(li->>'quantity','')::numeric, 0), 1)
      * v_factor * COALESCE(v_q.gst_rate,10) / 100, 2)), 0)
    INTO v_gst
    FROM jsonb_array_elements(v_items) li
    WHERE (li->>'taxable') IS DISTINCT FROM 'false'
      AND (li->>'type' IN ('Required','Part')
        OR (li->>'type' IN ('Optional','Multiple Choice') AND v_selected ? (li->>'id')));
  END IF;

  UPDATE quotes SET
    total_sell  = ROUND(v_subtotal, 2),
    gst_amount  = ROUND(v_gst, 2),
    grand_total = ROUND(v_subtotal + v_gst, 2),
    updated_at  = now()
  WHERE id = p_quote_id;
END;
$function$;
