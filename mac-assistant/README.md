# Lusso quote assistant - Mac pilot

A signed-in Lusso staff member starts a job from **Quote with AI**. A local service reads the current job/sheet through that staff member's Supabase session and starts Claude Code's Chrome integration. Claude prepares a BUZ/FHA draft and a Lusso draft, or returns questions. No cloud browser or new subscription is configured.

## Start

1. Use Node 20+ and the installed Claude Code CLI. Existing Claude account/usage applies.
2. Open `connect.command` (installed on Jett's Desktop as **Connect Lusso AI Browser.command**). Sign in through Claude Code and use `/chrome` to connect the installed Chrome extension. The operator must complete account login and approve site permissions. Never disable permissions globally.
3. Sign in to Lusso, BUZ and FHA in Chrome. Confirm the same Chrome profile is connected.
4. Open `start.command` (Desktop: **Start Lusso Quote Assistant.command**) and keep it running. It reads only the public Supabase connection settings from the project's `.env.local`. It never saves passwords or Lusso access tokens.
5. Open a project in Lusso, choose **Quote with AI**, then **Check connection**. Allow Chrome's local-network prompt for the Lusso site if required. Select the exact sheet and start a quote.

The service binds only to `127.0.0.1:53146`, accepts only the production Lusso origin and local development origins, verifies a real Supabase session and active staff profile on every request, and gives each operator access only to their own requests. Only one Chrome task runs at a time. Built-in shell/edit/read tools are disabled for the quoting process. Browser site permissions remain controlled by Claude in Chrome.

## Boundaries

Supplier work stays in reversible drafts/quotations. Never send, order, pay, accept terms, modify global prices/settings, or change a sent/accepted quote. Reuse matching drafts; ask when several exist. Preserve margins, overrides and documents. Ask about missing specifications together. Labour comes from existing settings or an explicit answer, never a historic job. Quote completion is independently verified against the actual server-side draft's job, status and total.

`needs_input` keeps the same Claude session so replies continue existing supplier work. If the sheet changes while waiting, the assistant refuses continuation until the operator starts a fresh request from the updated sheet. Stop does not delete supplier or CRM drafts. A restart marks interrupted work as needing attention; review saved drafts before continuing.

Local run records are in `~/Library/Application Support/Lusso Quote Assistant/` with private file permissions. They contain request instructions, assistant messages and draft references, not login credentials. Treat them as internal business records.

## Validation

`node --test scripts/mac-quote-assistant.test.mjs scripts/quote-assistant.test.mjs`

The integration test uses a fake browser agent and Supabase test server; it does not log in to suppliers or create live quotes. A real supplier quotation must be piloted after the operator connects Claude Code/Chrome. A signed-in Claude account is not a guarantee the Chrome extension is connected; the first task reports permission/connection issues instead of claiming success.
