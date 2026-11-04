/**
 * Inbound-email threading checks.
 *
 *   node supabase/functions/comms-inbound/email.test.ts
 *
 * These three cases exist because of a real misfiling. A reply to a website
 * lead's auto-reply arrived with the correct enquiry token and still came out
 * attached to an unrelated customer — "Kay Burling" — and to that customer's
 * open job LUS-0003.
 *
 * Two causes, both covered below:
 *
 *   · the sender-email fallback was guarded on `!customerId`, and an
 *     enquiry-scoped token leaves customer_id null by design, so the fallback
 *     ran on every reply a web lead ever sent;
 *   · that fallback was `.limit(1)` with no `.order()`, so when one address
 *     sits on several customer records — which is normal here, builders and
 *     architects refer clients off one mailbox — the row it chose was
 *     arbitrary and did change between messages from the same sender.
 *
 * The Supabase client is stubbed rather than mocked at the network layer:
 * what needs asserting is which tables get consulted and what ends up on the
 * inserted row, and a recording stub says both directly.
 */

import { parseInboundEmail } from './email.ts'

let failures = 0
function check(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures++
    console.error(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}\n        actual   ${JSON.stringify(actual)}`)
  } else {
    console.log(`  ok    ${label}`)
  }
}

/**
 * A chainable stand-in for the supabase-js query builder.
 *
 * `rows[table]` is what a list-style await resolves to; `single[table]` is
 * what .maybeSingle() resolves to. Every call is recorded so a test can
 * assert that a table was never touched at all, which is the whole point of
 * the first case.
 */
function stubAdmin({ rows = {}, single = {} } = {}) {
  const calls = []
  const build = (table) => {
    const b = {}
    for (const m of ['select', 'eq', 'neq', 'is', 'ilike', 'limit', 'not', 'order', 'gte', 'update', 'insert', 'delete']) {
      b[m] = (...args) => { calls.push({ table, method: m, args }); return b }
    }
    b.maybeSingle = async () => ({ data: single[table] ?? null, error: null })
    // Awaiting the builder itself is the list form.
    b.then = (resolve) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve)
    return b
  }
  return {
    calls,
    from: (table) => { calls.push({ table, method: 'from', args: [] }); return build(table) },
    rpc: async () => ({ data: null, error: null }),
    tablesTouched: () => [...new Set(calls.map(c => c.table))],
    inserted: (table) => calls.find(c => c.table === table && c.method === 'insert')?.args?.[0] ?? null,
  }
}

const TOKEN_ADDR = 'q-y9zvpbwecyrysccx@reply.lusso.com.au'
const read = async (res) => JSON.parse(await res.text())

// ── 1. An enquiry token is authoritative and must stop the search dead ──────
console.log('\nenquiry-scoped token')
{
  const admin = stubAdmin({
    single: { reply_tokens: { job_id: null, customer_id: null, enquiry_id: 'ENQ-1' } },
    // Deliberately loaded: if the fallback runs, it finds these and the test
    // fails rather than quietly passing.
    rows: { customers: [{ id: 'KAY' }], jobs: [{ id: 'LUS-0003' }] },
  })

  const out = await read(await parseInboundEmail(admin, {
    kind: 'email', to: TOKEN_ADDR, from: 'hopkinsjett@gmail.com',
    subject: 'Re: Your Lusso enquiry', text: 'thanks for getting back to me',
  }))

  check('matched by token', out.matchedBy, 'token')
  check('no customer attached', out.customerId, null)
  check('no job attached', out.jobId, null)
  check('customers table never consulted', admin.tablesTouched().includes('customers'), false)
  check('jobs table never consulted', admin.tablesTouched().includes('jobs'), false)
  const row = admin.inserted('communications')
  check('row carries the enquiry only', [row.enquiry_id, row.customer_id, row.job_id], ['ENQ-1', null, null])
}

// ── 2. No token, exactly one customer on that address: still attach ─────────
// The fallback is not being removed, only confined. A customer composing a
// fresh email rather than replying must still land on their own record.
console.log('\nno token, one matching customer')
{
  const admin = stubAdmin({
    single: { reply_tokens: null },
    rows: { customers: [{ id: 'CUST-1' }], jobs: [{ id: 'JOB-1' }] },
  })

  const out = await read(await parseInboundEmail(admin, {
    kind: 'email', to: 'jobs@lusso.com.au', from: 'solo@example.org',
    subject: 'Quick question', text: 'are you open Saturday?',
  }))

  check('matched by sender email', out.matchedBy, 'sender_email')
  check('customer attached', out.customerId, 'CUST-1')
  check('their active job attached', out.jobId, 'JOB-1')
}

// ── 3. No token, several customers on that address: attach to nobody ────────
console.log('\nno token, ambiguous address')
{
  const admin = stubAdmin({
    single: { reply_tokens: null },
    // bayden@bgdarchitects.com is on three customer records in production.
    rows: { customers: [{ id: 'CLIENT-A' }, { id: 'CLIENT-B' }], jobs: [{ id: 'JOB-A' }] },
  })

  const out = await read(await parseInboundEmail(admin, {
    kind: 'email', to: 'jobs@lusso.com.au', from: 'bayden@bgdarchitects.com',
    subject: 'Mawarra St', text: 'can you quote the upstairs windows too',
  }))

  check('flagged ambiguous', out.matchedBy, 'ambiguous_sender_email')
  check('no customer guessed', out.customerId, null)
  // Guessing a customer and then that customer's job is how one wrong guess
  // became two.
  check('no job guessed', out.jobId, null)
  check('jobs never consulted without a customer', admin.tablesTouched().includes('jobs'), false)
  const row = admin.inserted('communications')
  check('message still recorded', row.body, 'can you quote the upstairs windows too')
}

console.log()
if (failures) { console.error(`${failures} check(s) FAILED`); process.exit(1) }
console.log('all inbound threading checks passed')
