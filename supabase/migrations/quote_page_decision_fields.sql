-- ─────────────────────────────────────────────────────────────────────────────
-- Customer quote page: the three line-item fields the decision needs.
--
-- get_public_quote hands the browser a hand-picked projection rather than the
-- quotes row (see public_quote_link_hardening.sql), which is what keeps our
-- cost base and margin off the customer's device. The cost of that is that any
-- field the page wants has to be named here, and three were missing:
--
--   displayName  Already stamped on every line by the builder on save, and
--                already read by the page as `displayName || productNameSnapshot`
--                — but never projected. So a STAFF preview showed the composed
--                name ("Sheer linen curtain, wave fold", read from localStorage)
--                while the customer opening the same link on their own phone
--                silently fell all the way back to the raw product type:
--                "Curtain". The one reader who needs the name least got it, and
--                the one being asked to spend five figures did not.
--
--   recommended  Marks one line in a Multiple Choice group as the one we'd
--                actually put in. Set per line in the builder.
--
--   preselected  Marks an Optional line as ticked on first open. Still fully
--                untickable by the customer; it only moves the starting point.
--
-- Additive and behaviour-preserving: a line with none of them set projects
-- null / false, which is what every line written before today does, and the
-- page's existing fallbacks already handle that.
--
-- Applied to Lusso CRM (project wwompnqglvdxcmjquuzr) on 2026-10-28.
-- ─────────────────────────────────────────────────────────────────────────────

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
      -- The name the customer reads. nullif so a line saved with an empty
      -- string falls through to the snapshot rather than rendering blank.
      'displayName',         nullif(li->>'displayName', ''),
      'description',         li->>'description',
      'customerNotes',       li->>'customerNotes',
      'quantity',            coalesce(nullif(nullif(li->>'quantity','')::numeric, 0), 1),
      'widthMm',             li->'widthMm',
      'dropMm',              li->'dropMm',
      'taxable',             (li->>'taxable') is distinct from 'false',
      -- nullif before the cast: absent is null and empty string is '' , and
      -- ''::boolean raises rather than returning false.
      'recommended',         coalesce(nullif(li->>'recommended', '')::boolean, false),
      'preselected',         coalesce(nullif(li->>'preselected', '')::boolean, false),
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
