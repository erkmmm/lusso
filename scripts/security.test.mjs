// node --experimental-vm-modules scripts/security.test.mjs
// Execute the real edge handlers with a fake identity provider and no network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';
import { hasStaffAccess } from '../supabase/functions/_shared/staffAccess.ts';

for (const manager of [false, true]) {
  for (const active of [true, false, null]) {
    for (const allowed of [true, false, null]) {
      const client = { rpc: async name => ({ data: name === 'is_active_user' ? active : allowed, error: null }) };
      assert.equal(await hasStaffAccess(client, manager), active === true && allowed === true);
    }
  }
}
assert.equal(await hasStaffAccess({ rpc: async () => { throw Error('database unavailable'); } }), false);
assert.equal(await hasStaffAccess({ rpc: async () => ({ data: true, error: Error('query failed') }) }), false);

async function loadHandler(name, identity) {
  let handler;
  let effects = 0;
  const client = {
    auth: { getUser: async () => ({ data: { user: identity.valid ? { id: 'staff-test' } : null }, error: null }) },
    rpc: async name => ({ data: name === 'is_active_user' ? identity.active : name === 'is_account_manager' ? identity.manager : identity.employee, error: null }),
    from: () => { effects++; throw Error('Unauthorised database access'); },
  };
  const context = createContext({
    Request, Response, URL, URLSearchParams, TextEncoder, TextDecoder,
    console, crypto, atob, btoa, setTimeout,
    fetch: () => { effects++; throw Error('Unauthorised network request'); },
    Deno: {
      env: { get: key => key === 'SEO_REPO_TOKEN' ? undefined : 'test-only-value' },
      serve: fn => { handler = fn; },
    },
  });
  const cache = new Map();
  async function moduleFor(url) {
    if (cache.has(url)) return cache.get(url);
    let mod;
    if (url.startsWith('jsr:')) {
      mod = new SyntheticModule(url.includes('supabase-js') ? ['createClient'] : [], function () {
        if (url.includes('supabase-js')) this.setExport('createClient', () => client);
      }, { context });
    } else if (url.startsWith('npm:')) {
      mod = new SyntheticModule(['default'], function () { this.setExport('default', class {}); }, { context });
    } else {
      const source = await readFile(new URL(url), 'utf8');
      mod = new SourceTextModule(stripTypeScriptTypes(source), { context, identifier: url });
    }
    cache.set(url, mod);
    return mod;
  }
  const entry = await moduleFor(new URL(`../supabase/functions/${name}/index.ts`, import.meta.url).href);
  await entry.link((specifier, parent) => moduleFor(/^(jsr|npm):/.test(specifier) ? specifier : new URL(specifier, parent.identifier).href));
  await entry.evaluate();
  return { invoke: handler, effects: () => effects };
}

const endpoints = [
  'content-queue-status', 'content-queue-page', 'content-queue-permissions',
  'job-ai-chat', 'comms-suggest-reply', 'send-communication', 'content-write',
  'content-post-now', 'meta-oauth-start', 'xero-create-invoice', 'xero-connection',
  'marketing-send', 'push-send', 'web-enquiry-autoreply',
];
for (const endpoint of endpoints) {
  for (const identity of [
    { valid: false, active: false, employee: false, manager: false },
    { valid: true, active: false, employee: false, manager: false }, // pending
    { valid: true, active: false, employee: true, manager: true }, // suspended manager
    { valid: true, active: true, employee: false, manager: false }, // non-staff
  ]) {
    const harness = await loadHandler(endpoint, identity);
    const response = await harness.invoke(new Request('https://crm.test/function', {
      method: 'POST', headers: { Authorization: 'Bearer test-session', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'publish', jobId: 'test', enquiryId: 'test', channel: 'sms', to: '+61400000000', body: 'test' }),
    }));
    assert.equal(response.status, identity.valid ? 403 : 401, endpoint);
    assert.equal(harness.effects(), 0, `${endpoint}: denied requests must have no privileged effects`);
  }
  console.log(`PASS ${endpoint}: invalid, pending, suspended and non-staff denied without side effects`);
}

for (const action of ['publish', 'set-schedule', 'request-run', 'request-edit']) {
  const harness = await loadHandler('content-queue-status', { valid: true, active: true, employee: true, manager: false });
  const response = await harness.invoke(new Request('https://crm.test/function', {
    method: 'POST', headers: { Authorization: 'Bearer staff-session' }, body: JSON.stringify({ action }),
  }));
  assert.equal(response.status, 403, `${action} requires a manager`);
  assert.equal(harness.effects(), 0);
}
for (const manager of [false, true]) {
  const harness = await loadHandler('content-queue-status', { valid: true, active: true, employee: true, manager });
  const response = await harness.invoke(new Request('https://crm.test/function', {
    method: 'POST', headers: { Authorization: 'Bearer staff-session' },
    body: JSON.stringify({ action: manager ? 'publish' : 'status' }),
  }));
  assert.equal(response.status, 200, 'authorised callers reach configuration checks');
}
for (const method of ['POST', 'OPTIONS']) {
  const harness = await loadHandler('content-queue-status', {});
  const response = await harness.invoke(new Request('https://crm.test/function', { method }));
  assert.equal(response.status, method === 'OPTIONS' ? 200 : 401);
  assert.equal(harness.effects(), 0);
}
console.log('PASS manager-only publishing, approved staff reads, anonymous denial and CORS preflight');
