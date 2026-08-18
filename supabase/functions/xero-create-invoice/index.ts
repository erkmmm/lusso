import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

function toBase64(str: string): string {
  const bytes = new TextEncoder().encode(str)
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

async function safeJson(res: Response): Promise<{ data: any; raw: string }> {
  const raw = await res.text()
  try { return { data: JSON.parse(raw), raw } } catch { return { data: null, raw } }
}

function xeroErrors(data: any): string {
  if (data?.Elements?.length) {
    const errs: string[] = []
    for (const el of data.Elements) {
      if (el.ValidationErrors?.length) errs.push(...el.ValidationErrors.map((e: any) => e.Message))
    }
    if (errs.length) return errs.join('; ')
  }
  if (data?.Invoices?.[0]?.ValidationErrors?.length)
    return data.Invoices[0].ValidationErrors.map((e: any) => e.Message).join('; ')
  if (data?.Invoices?.[0]?.HasErrors) {
    const inv = data.Invoices[0]
    const msgs: string[] = []
    if (inv.ValidationErrors?.length) msgs.push(...inv.ValidationErrors.map((e: any) => e.Message))
    if (inv.LineItems) for (const li of inv.LineItems) {
      if (li.ValidationErrors?.length) msgs.push(...li.ValidationErrors.map((e: any) => `Line item: ${e.Message}`))
    }
    if (msgs.length) return msgs.join('; ')
  }
  return data?.Message ?? 'Unknown Xero error'
}

// ── Pricing — a faithful port of src/store/data.js ────────────────────────────
// calcItemPricing() / linePricing() / computeQuoteTotals() are the single source
// of truth for what a customer accepted. This function MUST agree with them to
// the cent, so the logic below mirrors them exactly rather than approximating.

const round = (n: number, dp = 4) => Math.round((n + Number.EPSILON) * 10 ** dp) / 10 ** dp

function calcItemPricing(
  unitCostPrice: any, labourCost: any, marginPercent: any, manualSellPrice: any,
  pricePerSqm: any, areaSqm: number,
) {
  const cost      = Number(unitCostPrice) || 0
  const labour    = Number(labourCost)    || 0
  const margin    = Number(marginPercent) || 0
  const totalCost = cost + labour
  const marginSell = margin < 100 ? totalCost / (1 - margin / 100) : totalCost
  const rate    = Number(pricePerSqm) || 0
  const area    = Number(areaSqm)     || 0
  const sqmSell = (rate > 0 && area > 0) ? rate * area : null
  const calcSell  = sqmSell != null ? sqmSell : marginSell
  const hasManual = manualSellPrice !== '' && manualSellPrice !== null && manualSellPrice !== undefined
  return hasManual ? Number(manualSellPrice) : calcSell
}

/** Per-unit sell price, gross and net of the per-line discount. */
function linePricing(li: any) {
  const qty = Number(li.quantity) || 1

  // Legacy / imported model (old unitPrice + labourCost, no cost basis).
  if (li.unitCostPrice === undefined) {
    const grossUnit = (Number(li.unitPrice) || 0) + (Number(li.labourCost) || 0)
    return { qty, grossUnit, perUnitDiscount: 0, netUnit: grossUnit, discPct: 0 }
  }

  const w = Number(li.widthMm) || 0
  const d = Number(li.dropMm)  || 0
  const areaSqm = (w > 0 && d > 0) ? (w * d / 1_000_000) : 0
  const grossUnit = calcItemPricing(
    li.unitCostPrice, li.labourCost, li.marginPercent, li.manualSellPrice, li.pricePerSqm, areaSqm,
  )

  const discPct = Number(li.discountPercent) || 0
  const discAmt = Number(li.discountAmount)  || 0
  const perUnitDiscount = discPct > 0 ? grossUnit * (discPct / 100)
                        : discAmt > 0 ? Math.min(discAmt, grossUnit)
                        : 0
  return { qty, grossUnit, perUnitDiscount, netUnit: grossUnit - perUnitDiscount, discPct }
}

/**
 * Line description in the house style: "<Location> - <Product>" on the first
 * line, then the product blurb and fabric underneath. Matches the invoices
 * Lusso already sends (see INV-2359) rather than dumping every spec field
 * pipe-separated — the measure sheet is where the full specs belong.
 */
function buildDescription(li: any): string {
  const product = li.productNameSnapshot || 'Window Treatment'

  // Imported (Quotient) quotes already bake the room into productNameSnapshot
  // — "Master Bedroom - Lusso Reverse pleat sheer curtain" — so only prefix the
  // location when it is a separate field and isn't already in the name.
  const loc = (li.location || '').trim()
  const head = loc && !product.startsWith(loc) ? `${loc} - ${product}` : product

  // Deliberately NOT li.description: on imported quotes that field holds the
  // internal Quotient code ("CURT Reverse", "REM 1", "SERV Scaffold Hire"),
  // which must never reach a customer's invoice. Only customer-meaningful
  // specs go on the second line, and it's omitted entirely when there are none.
  const detail = [
    li.fabricColour ? `Fabric: ${li.fabricColour}` : '',
    li.heading      || '',
    li.control && li.control !== 'N/A' ? `${li.control} operation` : '',
    li.fixing       ? `${li.fixing} fix` : '',
  ].filter(Boolean).join(', ')

  return detail ? `${head}\n${detail}` : head
}

async function getToken(admin: ReturnType<typeof createClient>) {
  const { data: intg } = await admin.from("xero_integrations").select("*").eq("status","active").maybeSingle()
  if (!intg) return null
  if (new Date(intg.token_expires_at).getTime() - Date.now() > 5 * 60 * 1000)
    return { accessToken: intg.access_token, tenantId: intg.tenant_id, intg }
  const creds = toBase64(`${Deno.env.get("XERO_CLIENT_ID")}:${Deno.env.get("XERO_CLIENT_SECRET")}`)
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { Authorization: `Basic ${creds}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: intg.refresh_token }),
  })
  const { data: t, raw } = await safeJson(res)
  if (!res.ok || !t?.access_token) {
    await admin.from("xero_integrations").update({ status: "error" }).eq("id", intg.id)
    throw new Error(`Token refresh failed — reconnect Xero in Settings. (${raw.slice(0,150)})`)
  }
  await admin.from("xero_integrations").update({
    access_token: t.access_token, refresh_token: t.refresh_token ?? intg.refresh_token,
    token_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", intg.id)
  return { accessToken: t.access_token, tenantId: intg.tenant_id, intg }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors })
  if (req.method !== "POST") return json({ error: "POST required" }, 405)
  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) return json({ error: "Unauthorized" }, 401)
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } })
    const admin   = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return json({ error: "Unauthorized" }, 401)
    const { data: profile } = await supabase.from("profiles").select("role,status,display_name").eq("id", user.id).single()

    const { quoteId } = await req.json()
    if (!quoteId) return json({ error: "quoteId required" }, 400)

    const { data: quote } = await admin.from("quotes").select("*").eq("id", quoteId).single()
    if (!quote)                      return json({ error: "Quote not found" }, 404)
    if (quote.status !== "Accepted") return json({ error: "Quote must be Accepted before invoicing" }, 400)
    if (quote.xero_invoice_id)       return json({ error: "Invoice already created", xeroInvoiceId: quote.xero_invoice_id }, 409)

    const [{ data: customer }, { data: job }] = await Promise.all([
      admin.from("customers").select("*").eq("id", quote.customer_id).single(),
      admin.from("jobs").select("job_number, install_date").eq("id", quote.job_id).maybeSingle(),
    ])
    if (!customer) return json({ error: "Customer not found" }, 404)

    const token = await getToken(admin)
    if (!token) return json({ error: "Xero not connected — go to Settings and connect first" }, 400)
    const { intg } = token
    const settings = intg.settings ?? {}

    const xh = {
      Authorization: `Bearer ${token.accessToken}`,
      "Xero-tenant-id": token.tenantId,
      "Content-Type": "application/json",
      Accept: "application/json",
    }

    // Resolve or create Xero contact
    let xeroContactId = customer.xero_contact_id
    if (!xeroContactId) {
      const sr = await fetch(`https://api.xero.com/api.xro/2.0/Contacts?where=EmailAddress=="${encodeURIComponent(customer.email ?? '')}"`, { headers: xh })
      const { data: sd, raw: sraw } = await safeJson(sr)
      if (!sr.ok) return json({ error: `Contact search failed: ${xeroErrors(sd) || sraw.slice(0,200)}` }, 502)
      if (sd?.Contacts?.length) {
        xeroContactId = sd.Contacts[0].ContactID
      } else {
        const cr = await fetch("https://api.xero.com/api.xro/2.0/Contacts", {
          method: "POST", headers: xh,
          body: JSON.stringify({ Contacts: [{ Name: customer.name, EmailAddress: customer.email ?? "" }] }),
        })
        const { data: cd, raw: craw } = await safeJson(cr)
        if (!cr.ok) return json({ error: `Contact creation failed: ${xeroErrors(cd) || craw.slice(0,200)}` }, 502)
        xeroContactId = cd?.Contacts?.[0]?.ContactID
        if (xeroContactId) await admin.from("customers").update({
          xero_contact_id: xeroContactId, xero_contact_name: customer.name,
          xero_last_synced_at: new Date().toISOString(),
        }).eq("id", customer.id)
      }
    }
    if (!xeroContactId) return json({ error: "Could not resolve Xero contact" }, 400)

    // ── Which lines did the customer actually accept? ────────────────────────
    // Mirrors computeQuoteTotals(): Required + Part always, plus any Optional /
    // Multiple Choice line the customer ticked on the public quote page.
    const allItems: any[] = quote.line_items ?? []
    const selectedIds: string[] = Array.isArray(quote.selected_line_item_ids) ? quote.selected_line_item_ids : []
    const isActive = (li: any) =>
      li.type === 'Required' ||
      li.type === 'Part' ||
      ((li.type === 'Optional' || li.type === 'Multiple Choice') && selectedIds.includes(li.id))

    const invoiceItems  = allItems.filter(isActive)
    const excludedItems = allItems.filter((li: any) => !isActive(li))
    if (invoiceItems.length === 0) return json({ error: "This quote has no invoiceable line items." }, 400)

    // ── Tax treatment ────────────────────────────────────────────────────────
    // The app stores ex-GST line prices and ADDS GST on top
    // (grand_total = total_sell + gst_amount), which is Xero's EXCLUSIVE mode.
    // `includes_gst` means "this quote charges GST", NOT "prices include GST".
    const chargesGst   = quote.includes_gst !== false
    const taxableType  = settings.defaultTaxType || 'OUTPUT'
    const freeType     = settings.defaultGstFreeTaxType || 'EXEMPTOUTPUT'
    const taxTypeFor   = (li: any) => (chargesGst && li.taxable !== false) ? taxableType : freeType

    // Lusso's invoices quote GST-inclusive prices and show "INCLUDES GST 10%"
    // rather than adding GST as a separate line (see INV-2359). The app stores
    // ex-GST prices, so gross each taxable amount up on the way out: the unit
    // price shown changes, the invoice total does not.
    const gstRate   = Number(quote.gst_rate) || 10
    const incFactor = 1 + gstRate / 100
    const toInclusive = (amount: number, taxable: boolean) =>
      (chargesGst && taxable) ? amount * incFactor : amount

    const accountCode = settings.defaultAccountCode ? String(settings.defaultAccountCode) : null

    // ── Build line items, carrying per-line discounts through to Xero ────────
    let grossSubtotal = 0    // ex-GST, before the quote-level discount
    let taxableSubtotal = 0

    const lineItems: any[] = invoiceItems.map((li: any) => {
      const { qty, grossUnit, perUnitDiscount, netUnit, discPct } = linePricing(li)
      const taxable = li.taxable !== false
      grossSubtotal += netUnit * qty
      if (chargesGst && taxable) taxableSubtotal += netUnit * qty

      const item: any = {
        Description: buildDescription(li),
        Quantity:    qty,
        UnitAmount:  round(toInclusive(grossUnit, taxable)),
        TaxType:     taxTypeFor(li),
      }
      // Show the discount on the invoice rather than silently netting it off.
      // DiscountRate is unambiguous in the Xero API; a fixed per-unit amount is
      // expressed as its equivalent rate so LineAmount stays exact.
      if (perUnitDiscount > 0 && grossUnit > 0) {
        item.DiscountRate = round(discPct > 0 ? discPct : (perUnitDiscount / grossUnit) * 100)
      }
      if (accountCode) item.AccountCode = accountCode
      if (li.xeroItemCode) item.ItemCode = li.xeroItemCode
      return item
    })

    // ── Quote-level discount ─────────────────────────────────────────────────
    // Xero has no invoice-level discount, so it becomes negative line(s). The
    // app reduces the taxable base proportionally, so when a quote mixes taxable
    // and GST-free lines the discount is split the same way — otherwise the GST
    // on the Xero invoice wouldn't match the accepted quote.
    const discountType  = quote.discount_type ?? 'None'
    const discountValue = Number(quote.discount_value) || 0
    const quoteDiscount = discountType === 'Percentage'   ? grossSubtotal * (discountValue / 100)
                        : discountType === 'Fixed Amount' ? Math.min(discountValue, grossSubtotal)
                        : 0

    if (quoteDiscount > 0 && grossSubtotal > 0) {
      const label       = quote.discount_label || (discountType === 'Percentage' ? `Discount (${discountValue}%)` : 'Discount')
      const taxableShare = taxableSubtotal / grossSubtotal
      const onTaxable    = quoteDiscount * taxableShare
      const onFree       = quoteDiscount - onTaxable

      if (onTaxable > 0.005) {
        const l: any = { Description: label, Quantity: 1, UnitAmount: -round(toInclusive(onTaxable, true), 2), TaxType: taxableType }
        if (accountCode) l.AccountCode = accountCode
        lineItems.push(l)
      }
      if (onFree > 0.005) {
        const l: any = { Description: onTaxable > 0.005 ? `${label} (GST free items)` : label, Quantity: 1, UnitAmount: -round(onFree, 2), TaxType: freeType }
        if (accountCode) l.AccountCode = accountCode
        lineItems.push(l)
      }
    }

    // What the customer accepted — used to verify Xero agrees.
    const expectedSubtotal = grossSubtotal - quoteDiscount
    const discountFactor   = grossSubtotal > 0 ? (1 - quoteDiscount / grossSubtotal) : 1
    const expectedGst      = chargesGst ? taxableSubtotal * discountFactor * ((Number(quote.gst_rate) || 10) / 100) : 0
    const expectedTotal    = round(expectedSubtotal + expectedGst, 2)

    // ── Terms / payment notes ────────────────────────────────────────────────
    // A description-only line: Xero renders it as free text with no amount. It
    // must carry Description alone — adding Quantity/UnitAmount/TaxType would
    // make it a real (and, with an invalid tax code, rejected) line.
    const pay = settings.paymentDetails ?? {}
    const noteLines: string[] = []
    if (job?.install_date) {
      const formatted = new Date(job.install_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
      noteLines.push(`Installation scheduled: ${formatted}`)
      noteLines.push('')
    }
    noteLines.push('To place your order')
    noteLines.push('Please request any changes necessary and confirm your acceptance of this invoice.')
    noteLines.push('')
    noteLines.push(settings.termsOfTrade || 'Terms of Trade: 50% Deposit, 50% payment on booking of installation.')
    noteLines.push('Orders for custom built product cannot be cancelled.')
    noteLines.push('')
    noteLines.push('Direct Deposit')
    noteLines.push(`BSB: ${pay.bsb || '014 527'}`)
    noteLines.push(`Account: ${pay.accountNumber || '498 279 909'}`)
    noteLines.push(`Name: ${pay.accountName || 'Lusso Fashion for Windows'}`)
    noteLines.push('')
    noteLines.push('Credit Card Payment')
    noteLines.push('Please call to make a credit card payment. We accept Visa & Mastercard.')
    noteLines.push(`Amex attracts a ${pay.amexSurchargePercent ?? 2.5}% surcharge.`)
    if (excludedItems.length > 0) {
      noteLines.push('')
      const optNames = excludedItems.map((li: any) => li.location || li.productNameSnapshot || 'item').join(', ')
      noteLines.push(`Optional items not included: ${optNames}. Contact us to add these.`)
    }
    lineItems.push({ Description: noteLines.join('\n') })

    // Opening description-only line naming the quote this invoice came from,
    // the way Lusso's existing invoices lead (see INV-2359). Added last but
    // placed first, so it sits above the items regardless of what came before.
    const businessName = settings.businessName || "Lusso Fashion for Windows"
    lineItems.unshift({
      Description: `${businessName} Quotation For ${customer.name}\nQuote Number: ${quote.quote_number}`,
    })

    // Quote and job often carry the same number, which produced "QNT-8849 |
    // QNT-8849" on the invoice. Dedupe rather than blindly joining.
    const reference = [...new Set([quote.quote_number, job?.job_number].filter(Boolean))].join(' | ')
    const dueDays   = Number(settings.defaultPaymentTermsDays ?? 30)
    const dueDate   = new Date(Date.now() + dueDays * 86400000).toISOString().split("T")[0]

    const invoicePayload = {
      Invoices: [{
        Type:            "ACCREC",
        Contact:         { ContactID: xeroContactId },
        LineAmountTypes: "Inclusive",
        LineItems:       lineItems,
        Date:            new Date().toISOString().split("T")[0],
        DueDate:         dueDate,
        Status:          settings.defaultInvoiceStatus ?? "DRAFT",
        Reference:       reference,
        Url:             `${Deno.env.get("LUSSO_APP_URL") ?? ""}/quotes/${quote.id}`,
        // Which template Xero renders the PDF with. The theme — not this
        // payload — decides whether an "Amount due" panel sits at the top and
        // where the due date appears, so pin it rather than inheriting whatever
        // the organisation's default happens to be.
        ...(settings.brandingThemeId ? { BrandingThemeID: settings.brandingThemeId } : {}),
      }]
    }

    const summary = `Inclusive, items=${lineItems.length}, expectedTotal=${expectedTotal}`

    const ir = await fetch("https://api.xero.com/api.xro/2.0/Invoices", { method: "POST", headers: xh, body: JSON.stringify(invoicePayload) })
    const { data: id_, raw: iraw } = await safeJson(ir)

    if (!ir.ok || !id_) {
      const em = id_ ? xeroErrors(id_) : iraw.slice(0,400)
      await admin.from("xero_sync_logs").insert({ action: "create_invoice", entity_type: "quote", entity_id: quoteId, status: "error", error_message: em, request_summary: summary, created_by: user.id })
      return json({ error: em, debug: { expectedTotal, itemCount: lineItems.length } }, 502)
    }
    if (id_.Invoices?.[0]?.HasErrors) {
      const em = xeroErrors(id_)
      await admin.from("xero_sync_logs").insert({ action: "create_invoice", entity_type: "quote", entity_id: quoteId, status: "error", error_message: em, request_summary: summary, created_by: user.id })
      return json({ error: em, debug: { expectedTotal } }, 502)
    }

    const inv = id_.Invoices[0]
    const now = new Date().toISOString()

    // ── Reconcile ────────────────────────────────────────────────────────────
    // An invoice that silently disagrees with the accepted quote is the worst
    // failure mode here, so surface any drift instead of trusting the maths.
    const xeroTotal = Number(inv.Total) || 0
    const variance  = round(xeroTotal - expectedTotal, 2)
    const mismatch  = Math.abs(variance) > 0.02

    await admin.from("quotes").update({
      xero_invoice_id:         inv.InvoiceID,
      xero_invoice_number:     inv.InvoiceNumber,
      xero_invoice_status:     inv.Status,
      xero_invoice_url:        `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${inv.InvoiceID}`,
      xero_invoice_created_at: now,
      xero_invoice_created_by: profile?.display_name ?? user.email ?? "Admin",
      xero_last_synced_at:     now,
      updated_at:              now,
    }).eq("id", quoteId)

    await admin.from("xero_sync_logs").insert({
      action: "create_invoice", entity_type: "quote", entity_id: quoteId,
      xero_entity_id: inv.InvoiceID,
      status: mismatch ? "warning" : "success",
      error_message: mismatch ? `Invoice total ${xeroTotal} differs from accepted quote total ${expectedTotal} by ${variance}` : null,
      request_summary: `Invoice ${inv.InvoiceNumber} for ${quote.quote_number} — total ${xeroTotal} (expected ${expectedTotal})`,
      created_by: user.id,
    })

    return json({
      success: true,
      xeroInvoiceId: inv.InvoiceID,
      xeroInvoiceNumber: inv.InvoiceNumber,
      xeroInvoiceStatus: inv.Status,
      xeroInvoiceUrl: `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${inv.InvoiceID}`,
      ...(mismatch ? { warning: `Xero invoice total is $${xeroTotal.toFixed(2)} but the accepted quote total is $${expectedTotal.toFixed(2)}. Please check the invoice before sending.` } : {}),
    })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } })
}
