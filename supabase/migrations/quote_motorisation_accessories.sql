-- ─────────────────────────────────────────────────────────────────────────────
-- Motorisation accessories, server side.
--
-- Remotes and chargers are DERIVED from whichever motors a quote currently has
-- live (see src/lib/motorisationAccessories.js — this is the paired SQL copy,
-- and the two have to be changed together). The browser can show them, but it
-- cannot be the one that records them: acceptance is persisted by
-- track_quote_event under the anon key, and the customer's device has no
-- writable copy of the quote. So the rule has to exist here too, or an accepted
-- quote's grand_total and its Xero invoice would both be short the handsets.
--
-- Materialising happens inside quote_recompute_totals, which track_quote_event
-- calls in exactly one place: the moment a quote is accepted. That is the right
-- moment — up to then the accessories change with every click, and from then on
-- the purchase order, the Xero invoice and the installer's paperwork all read
-- line_items and know nothing about the rule. It is idempotent regardless:
-- every derived line carries "autoAddedBy": "motorisation", and resolving
-- strips the previous pass before computing the next.
--
-- The rule:
--   * one remote per room with a motor in it — 1-Channel where that room has a
--     single blind, otherwise 15-Channel (NOT the 5-Channel; customers get
--     lost on its channel switch)
--   * one charger per 4 BATTERY blinds for the whole job, rounded up. A
--     hardwired motor takes none — there is nothing to charge.
--
-- And two places it deliberately stands aside:
--   * the quote already names a remote or a charger as a line of its own (an
--     imported Quotient job, or a staff member who quick-added one) — adding
--     another on top bills the same handset twice
--   * the motorised lines carry no location — the rule is per room, and an
--     import with the room baked into the product name has none to count
-- ─────────────────────────────────────────────────────────────────────────────


-- Prices are NOT written here. Each accessory maps to a priced item by
-- item_code (Settings → Priced Items), and the quote carries its own snapshot
-- of those prices in `quotes.motorisation_presets`, captured on save. Snapshot
-- rather than a live lookup for the same reason productNameSnapshot exists:
-- the price a customer was shown must not move under them because someone
-- edited the item afterwards. A re-price reaches a quote the next time it is
-- saved. Where a quote has no snapshot, both runtimes fall back to the same
-- constants, so they cannot disagree.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS motorisation_presets jsonb;
-- PostgREST caches the schema; without this the new column is silently
-- stripped from every write and hydration wipes it back out.
NOTIFY pgrst, 'reload schema';

-- Fallback prices, matching ACCESSORY_FALLBACKS in the JS exactly.
CREATE OR REPLACE FUNCTION public.quote_accessory_fallbacks()
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT '{
    "wifiHub":  {"name":"Acmeda Automate WiFi Hub",           "description":"Acmeda Automate Pulse WiFi Hub",                                 "price":340},
    "charger":  {"name":"Wall Charger 4m USB to Micro Cable", "description":"Acmeda Li-ion Charger to charge battery operated roller blinds", "price":38},
    "remote1":  {"name":"1 Channel Remote Control – White",   "description":"1 Channel Wire Free Remote Control White",                       "price":88},
    "remote5":  {"name":"5 Channel Remote Control – White",   "description":"5 Channel Wire Free Remote Control White",                       "price":95},
    "remote15": {"name":"15 Channel Remote Control – White",  "description":"15 Channel Wire Free Remote Control White",                      "price":85}
  }'::jsonb;
$$;

-- One role's preset: the quote's snapshot where it has one, the constant
-- otherwise. Mirrors withFallbackPresets() in the JS.
CREATE OR REPLACE FUNCTION public.quote_accessory_preset(p_presets jsonb, p_role text)
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    NULLIF(COALESCE(p_presets, '{}'::jsonb) -> p_role, 'null'::jsonb),
    public.quote_accessory_fallbacks() -> p_role);
$$;

-- One derived accessory, in quote line-item shape. Mirrors accessoryLine() in
-- the JS: deterministic id, priced-item link, and a sortOrder past every real
-- line so accessories read last.
CREATE OR REPLACE FUNCTION public.quote_accessory_line(
  p_kind text, p_preset jsonb, p_room text, p_qty integer, p_sort integer
) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'id', 'auto-motorisation-' || p_kind || '-' ||
          COALESCE(NULLIF(btrim(regexp_replace(lower(p_room), '[^a-z0-9]+', '-', 'g'), '-'), ''), 'job'),
    'autoAddedBy', 'motorisation',
    'autoKind',    p_kind,
    'type',        'Part',
    'choiceGroupId', NULL,
    'choiceRequired', false,
    'location',    p_room,
    'productTypeId', '',
    'productNameSnapshot', p_preset->>'name',
    'description', p_preset->>'description',
    'quantity',    p_qty,
    'widthMm', '', 'dropMm', '', 'fabricColour', '',
    'control', '', 'returnSide', '', 'motorSide', '', 'fixing', '',
    'heading', '', 'hem', '', 'trackColour', '', 'baseBarColour', '',
    'trackBaseBarColour', '', 'baseBarType', '', 'chainColour', '', 'trackType', '',
    'attachedLining', false,
    -- Linked to the price library like any other line, so the margin on a
    -- remote is the real one rather than 100% of a $0 cost.
    'pricedItemId',    p_preset->'pricedItemId',
    'unitCostPrice',   COALESCE((p_preset->>'cost')::numeric, 0),
    'labourCost',      COALESCE((p_preset->>'labourCost')::numeric, 0),
    'marginPercent',   COALESCE((p_preset->>'marginPercent')::numeric, 0),
    'manualSellPrice', (p_preset->>'price')::numeric,
    'discountPercent', '', 'discountAmount', '',
    'supplier', 'Acmeda',
    'taxable', true,
    'customerNotes', '', 'internalNotes', '',
    'sortOrder',   100000 + p_sort,
    'measureSheetLineItemId', NULL
  );
$$;

-- Drop any previously derived accessory lines. Safe on any quote.
CREATE OR REPLACE FUNCTION public.quote_without_auto_accessories(p_line_items jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    (SELECT jsonb_agg(li ORDER BY ord)
       FROM jsonb_array_elements(p_line_items) WITH ORDINALITY e(li, ord)
      WHERE li->>'autoAddedBy' IS DISTINCT FROM 'motorisation'),
    '[]'::jsonb);
$$;

-- The accessory lines a quote needs, given what is selected.
CREATE OR REPLACE FUNCTION public.quote_motorisation_lines(
  p_line_items jsonb, p_selected jsonb, p_presets jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_base        jsonb := public.quote_without_auto_accessories(p_line_items);
  v_sel         jsonb := COALESCE(p_selected, '[]'::jsonb);
  v_out         jsonb := '[]'::jsonb;
  v_battery     numeric := 0;
  v_sort        integer := 0;
  v_has_remote  boolean := false;
  v_has_charger boolean := false;
  r             record;
  -- Track / operation types that ARE a motor: a motorised curtain is named by
  -- its track, so these mirror OPERATION_WORDS in src/lib/describeLine.js.
  c_motor_tracks text[] := ARRAY['oslo 84 (240v)','e6 arc 240 rts','m6 - 240 wt','cherubini 240v',
                                 'oslo 83 (battery)','li-ion motor 1.1','li-ion motor 2.0','li-ion motor 3.0'];
  c_batt_tracks  text[] := ARRAY['oslo 83 (battery)','li-ion motor 1.1','li-ion motor 2.0','li-ion motor 3.0'];
BEGIN
  IF jsonb_typeof(v_base) <> 'array' OR jsonb_array_length(v_base) = 0 THEN
    RETURN '[]'::jsonb;
  END IF;

  -- Stand aside where the quote already names the accessory itself; deriving
  -- another on top bills the same handset twice. Checked across the whole
  -- quote rather than per room: imported accessory lines carry no location, so
  -- there is no honest way to tell which room one was meant for.
  SELECT
    bool_or(h ~ '\yremotes?\y|\yhandsets?\y'),
    bool_or(h ~ '\ychargers?\y|\ycharging\y')
  INTO v_has_remote, v_has_charger
  FROM (
    SELECT lower(concat_ws(' ', li->>'productNameSnapshot', li->>'displayName', li->>'description')) AS h
      FROM jsonb_array_elements(v_base) li
  ) e;

  FOR r IN
    WITH items AS (
      SELECT e.li, (e.ord - 1) AS i,
             btrim(regexp_replace(COALESCE(e.li->>'location',''), '\s+', ' ', 'g')) AS loc_full,
             lower(concat_ws(' ', e.li->>'productNameSnapshot', e.li->>'displayName', e.li->>'description')) AS hay,
             lower(btrim(regexp_replace(COALESCE(e.li->>'trackType',''), '\s+', ' ', 'g'))) AS track
        FROM jsonb_array_elements(v_base) WITH ORDINALITY e(li, ord)
    ),
    -- A trailing one- or two-letter word is a window reference ("Office 1 A"),
    -- but only once something else shares the room — otherwise "Unit A" loses
    -- half its name. Same two-pass tally groupByRoom() does in the JS.
    split AS (
      SELECT *,
             CASE WHEN loc_full ~ '^.+\s+[A-Za-z]{1,2}$'
                  THEN btrim(regexp_replace(loc_full, '\s+[A-Za-z]{1,2}$', ''))
                  ELSE NULL END AS base
        FROM items
    ),
    keyed AS (
      SELECT *, lower(COALESCE(NULLIF(base, ''), NULLIF(loc_full, ''), 'general')) AS k1 FROM split
    ),
    tally AS (SELECT k1, count(*) AS n FROM keyed GROUP BY k1),
    roomed AS (
      SELECT k.*,
             CASE WHEN COALESCE(k.base, '') <> '' AND t.n >= 2 THEN k.base
                  ELSE k.loc_full END AS room_raw
        FROM keyed k JOIN tally t USING (k1)
    ),
    motors AS (
      SELECT upper(left(room_raw, 1)) || substr(room_raw, 2) AS room,
             GREATEST(1, COALESCE(NULLIF(NULLIF(li->>'quantity','')::numeric, 0), 1)) AS qty,
             (hay ~ 'battery|wire[-\s]?free|wirefree|li-?ion' OR track = ANY(c_batt_tracks)) AS is_battery,
             i
        FROM roomed
       -- A line with no location can't be counted per room, and the rule is
       -- per room. Imported Quotient jobs carry the room inside the product
       -- name and nothing in `location`, so every motor on a 200-window job
       -- would land in one bucket and take a single handset.
       WHERE loc_full <> ''
         AND li->>'type' <> 'Part'
         AND (li->>'type' = 'Required' OR v_sel ? (li->>'id'))
         -- A part, a bare motor or a service call can name-drop motorisation
         -- without being a motorised blind.
         AND NOT (hay ~ '\yremote\y|\yhandset\y|\ycharger\y|\yhub\y|battery pack|\ybracket|\yclips?\y|\ymotor\y|\yservice\y|warranty|call[-\s]?out|repair|freight|delivery|labou?r')
         AND (hay ~ 'motoris|motorized|battery[-\s]?operat|wire[-\s]?free|wirefree|hard[-\s]?wired'
              OR track = ANY(c_motor_tracks))
         AND hay ~ 'blind|curtain|sheer|drape|shade|awning|screen|shutter|roman|venetian|vertical|roller|track|pelmet|ziptrak|zip\s?screen|glidescreen'
    )
    SELECT room,
           SUM(qty)                           AS blinds,
           SUM(qty) FILTER (WHERE is_battery) AS battery_blinds
      FROM motors
     GROUP BY room
     ORDER BY MIN(i)
  LOOP
    IF NOT v_has_remote THEN
      -- The 5-Channel is deliberately skipped: people get lost on its channel
      -- switch, so a room with more than one motor takes the 15-Channel.
      v_out := v_out || jsonb_build_array(
        public.quote_accessory_line(
          'remote',
          public.quote_accessory_preset(p_presets, CASE WHEN r.blinds = 1 THEN 'remote1' ELSE 'remote15' END),
          r.room, 1, v_sort));
      v_sort := v_sort + 1;
    END IF;
    v_battery := v_battery + COALESCE(r.battery_blinds, 0);
  END LOOP;

  -- Chargers are whole-job: one is carried from blind to blind, which is why
  -- this is not one per blind.
  IF v_battery > 0 AND NOT v_has_charger THEN
    v_out := v_out || jsonb_build_array(
      public.quote_accessory_line(
        'charger', public.quote_accessory_preset(p_presets, 'charger'),
        'Whole job', CEIL(v_battery / 4.0)::integer, v_sort));
  END IF;

  RETURN v_out;
END;
$$;

-- A quote's line items with its accessories resolved onto the end. Idempotent.
CREATE OR REPLACE FUNCTION public.quote_with_motorisation(
  p_line_items jsonb, p_selected jsonb, p_presets jsonb DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT public.quote_without_auto_accessories(p_line_items)
       || public.quote_motorisation_lines(p_line_items, p_selected, p_presets);
$$;

-- The presets snapshot carries cost price, labour and margin so a derived
-- remote is costed like any other line. None of that may reach the customer's
-- browser — quote_public_line_items already zeroes exactly those three fields
-- on every line, and sending them here instead would walk straight around it.
CREATE OR REPLACE FUNCTION public.quote_public_motorisation_presets(p_presets jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p_presets) <> 'object' THEN NULL ELSE
    (SELECT jsonb_object_agg(role, jsonb_build_object(
       'name',        preset->>'name',
       'description', preset->>'description',
       'price',       preset->'price'))
       FROM jsonb_each(p_presets) AS e(role, preset)
      WHERE jsonb_typeof(preset) = 'object')
  END;
$$;

-- ─── Totals, resolving accessories first ─────────────────────────────────────
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
  v_selected := COALESCE(v_q.selected_line_item_ids, '[]'::jsonb);

  -- Remotes and chargers follow the motors that are live. Written back to
  -- line_items, not just counted, because the purchase order, the Xero invoice
  -- and the installer's paperwork all read line_items and know nothing about
  -- the rule. Idempotent, so a quote can pass through here any number of times.
  v_items := quote_with_motorisation(v_q.line_items, v_selected, v_q.motorisation_presets);
  IF v_items IS DISTINCT FROM v_q.line_items THEN
    UPDATE quotes SET line_items = v_items WHERE id = p_quote_id;
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

-- The customer's device derives the accessories too, as they toggle options,
-- so it needs the same snapshot. priced_items is staff-only (is_active_user),
-- which is why this travels on the quote payload rather than being looked up.
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
    'lineItems',           public.quote_public_line_items(q.line_items)
  )
  from public.quotes q
  where q.id = p_id
    and q.deleted_at is null
    and q.public_token = p_token;
$function$;
