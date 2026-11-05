-- Apply before releasing the document-style quote builder.
-- Only customer-facing prose belongs in this column. Costs and private notes
-- remain excluded by the existing token-protected public projection.
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS text_items jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS price_display text NOT NULL DEFAULT 'all' CHECK (price_display IN ('all', 'item-totals', 'quote-total'));
COMMENT ON COLUMN public.quotes.text_items IS 'Customer-facing text blocks: id, heading, body, placement (before/after prices).';

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
    'priceDisplay',        q.price_display,
    'textItems',           coalesce(q.text_items, '[]'::jsonb),
    'documents',           coalesce(q.documents, '[]'::jsonb),
    'lineItems',           public.quote_public_line_items(q.line_items)
  )
  from public.quotes q
  where q.id = p_id
    and q.deleted_at is null
    and q.public_token = p_token;
$function$;
