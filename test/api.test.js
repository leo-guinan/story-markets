import { describe, expect, it } from 'vitest';
import { handleApi } from '../worker/api.js';
import { decryptSecret, encryptSecret } from '../worker/security.js';

function env() { return { ALLOWED_ORIGIN: 'http://localhost:5173' }; }

describe('creator API authentication boundary', () => {
  it('rejects unauthenticated requests without touching storage', async () => {
    let touched = false;
    const response = await handleApi(new Request('https://story.markets/api/narratives'), {
      ...env(), DB: { prepare() { touched = true; throw new Error('must not query'); } },
    });
    expect(response.status).toBe(401);
    expect(touched).toBe(false);
  });
  it('does not allow cross-origin browser access', async () => {
    const response = await handleApi(new Request('https://story.markets/api/narratives', { headers: { origin: 'https://attacker.example' } }), env());
    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });
  it('encrypts a user key before D1 storage and never returns plaintext', async () => {
    let stored;
    const db = { prepare(sql) { return { bind(...values) { return { run: async () => { stored = { sql, values }; return { meta: { changes: 1 } }; } }; } }; } };
    const request = new Request('https://story.markets/api/credentials', { method: 'POST', headers: { origin: 'http://localhost:5173', authorization: 'Bearer demo-token', 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'openrouter', label: 'my key', apiKey: 'example-provider-key' }) });
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
    const response = await handleApi(request, { ...env(), DB: db, CREDENTIALS_ENCRYPTION_KEY: key }, async () => 'did:privy:user-a');
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(JSON.stringify(body)).not.toContain('example-provider-key');
    expect(body.credential.masked_secret).toBe('••••••••-key');
    expect(stored.values[1]).toBe('did:privy:user-a');
    expect(stored.values[5]).not.toContain('example-provider-key');
    expect(await decryptSecret(JSON.parse(stored.values[5]), key)).toBe('example-provider-key');
  });
  it('accepts a Hashference key and stores it encrypted under its provider identity', async () => {
    let stored;
    const db = { prepare(sql) { return { bind(...values) { return { run: async () => { stored = { sql, values }; return { meta: { changes: 1 } }; } }; } }; } };
    const request = new Request('https://story.markets/api/credentials', { method: 'POST', headers: { origin: 'http://localhost:5173', authorization: 'Bearer demo-token', 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'hashference', label: '', apiKey: 'example-provider-key' }) });
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
    const response = await handleApi(request, { ...env(), DB: db, CREDENTIALS_ENCRYPTION_KEY: key }, async () => 'did:privy:user-a');
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.credential.provider).toBe('hashference');
    expect(body.credential.label).toBe('Hashference key');
    expect(JSON.stringify(body)).not.toContain('example-provider-key');
    expect(stored.values[2]).toBe('hashference');
    expect(stored.values[5]).not.toContain('example-provider-key');
    expect(await decryptSecret(JSON.parse(stored.values[5]), key)).toBe('example-provider-key');
  });
  it('revokes an owned credential by deleting its encrypted secret', async () => {
    let mutation;
    const db = { prepare(sql) { return { bind(...values) { return { run: async () => { mutation = { sql, values }; return { meta: { changes: 1 } }; } }; } }; } };
    const request = new Request('https://story.markets/api/credentials/11111111-1111-4111-8111-111111111111', { method: 'DELETE', headers: { origin: 'http://localhost:5173', authorization: 'Bearer demo-token' } });
    const response = await handleApi(request, { ...env(), DB: db }, async () => 'did:privy:user-a');
    expect(response.status).toBe(200);
    expect(mutation.sql).toContain('encrypted_secret = NULL');
    expect(mutation.values[0]).toBe('revoked');
    expect(mutation.values[3]).toBe('did:privy:user-a');
  });
  it('exports an owner-scoped workspace bundle without credential ciphertext', async () => {
    const queries = [];
    const db = { prepare(sql) { return { bind(...values) { queries.push({ sql, values }); return { all: async () => ({ results:
      sql.includes('FROM narratives') ? [{ id: 'n-1', title: 'A thread', premise: 'Private premise', status: 'private_draft' }]
        : sql.includes('FROM generations') ? [{ id: 'g-1', narrative_id: 'n-1', prompt: 'Continue the scene', output: 'A private draft', status: 'succeeded' }]
          : [{ id: 'c-1', provider: 'openrouter', label: 'Writing', masked_secret: '••••••••tail', status: 'active' }],
    }) }; } }; } };
    const request = new Request('https://story.markets/api/export', { headers: { origin: 'http://localhost:5173', authorization: 'Bearer demo-token' } });
    const response = await handleApi(request, { ...env(), DB: db }, async () => 'did:privy:owner-a');
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('story-markets-export.json');
    expect(body.schema).toBe('story-markets.workspace-export.v1');
    expect(body.narratives[0].id).toBe('n-1');
    expect(body.generations[0].output).toBe('A private draft');
    expect(body.credentials[0].masked_secret).toBe('••••••••tail');
    expect(JSON.stringify(body)).not.toContain('encrypted_secret');
    expect(queries).toHaveLength(3);
    expect(queries.every((query) => query.values[0] === 'did:privy:owner-a')).toBe(true);
    expect(queries.map((query) => query.sql).join(' ')).not.toContain('encrypted_secret');
  });
  it('returns owner-scoped roll-up totals on main narratives', async () => {
    const queries = [];
    const db = { prepare(sql) { return { bind(...values) { queries.push({ sql, values }); return {
      all: async () => ({ results: [{ id: 'main-1', title: 'Survival', is_main: 1, structural_value: 1000000, structural_basis: 'untyped_scalar' }] }),
      first: async () => ({ structural_rollup_value: 250000 }),
    }; } }; } };
    const request = new Request('https://story.markets/api/narratives', { headers: { origin: 'http://localhost:5173', authorization: 'Bearer demo-token' } });
    const response = await handleApi(request, { ...env(), DB: db }, async () => 'did:privy:leo');
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.narratives[0].structural_rollup_value).toBe(250000);
    const rollupQuery = queries.find(({ sql }) => sql.includes('WITH RECURSIVE'));
    expect(rollupQuery).toBeTruthy();
    expect(rollupQuery.values.filter((value) => value === 'did:privy:leo')).toHaveLength(3);
  });
  it('creates the Survival main narrative with an untyped structural target', async () => {
    let inserted;
    const db = { prepare(sql) { return { bind(...values) { return {
      first: async () => sql.includes('is_main = 1') ? null : null,
      run: async () => { inserted = { sql, values }; return { meta: { changes: 1 } }; },
    }; } }; } };
    const request = new Request('https://story.markets/api/narratives', { method: 'POST', headers: { origin: 'http://localhost:5173', authorization: 'Bearer demo-token', 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Survival', premise: 'An untyped structural target; not revenue, valuation, or funding.', isMain: true, structuralValue: 1000000, structuralLabel: '$1M', structuralDeadline: '2026-11-30' }) });
    const response = await handleApi(request, { ...env(), DB: db }, async () => 'did:privy:leo');
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.narrative.title).toBe('Survival');
    expect(body.narrative.is_main).toBe(true);
    expect(body.narrative.structural_value).toBe(1000000);
    expect(body.narrative.structural_label).toBe('$1M');
    expect(body.narrative.structural_deadline).toBe('2026-11-30');
    expect(body.narrative.structural_basis).toBe('untyped_scalar');
    expect(inserted.sql).toContain('parent_id');
    expect(inserted.values[1]).toBe('did:privy:leo');
  });
  it('does not create a second main narrative for the same account', async () => {
    let inserted = false;
    const db = { prepare(sql) { return { bind() { return {
      first: async () => ({ id: 'existing-main' }),
      run: async () => { inserted = true; return { meta: { changes: 1 } }; },
    }; } }; } };
    const request = new Request('https://story.markets/api/narratives', { method: 'POST', headers: { origin: 'http://localhost:5173', authorization: 'Bearer demo-token', 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Another main', premise: 'Should not be created.', isMain: true, structuralValue: 1000000, structuralLabel: '$1M', structuralDeadline: '2026-11-30' }) });
    const response = await handleApi(request, { ...env(), DB: db }, async () => 'did:privy:leo');
    expect(response.status).toBe(409);
    expect(inserted).toBe(false);
  });
  it('attaches a child narrative to the verified owner main and inherits its untyped basis', async () => {
    const reads = [];
    let inserted;
    const db = { prepare(sql) { return { bind(...values) { return {
      first: async () => { reads.push({ sql, values }); return { id: 'main-1', structural_basis: 'untyped_scalar' }; },
      run: async () => { inserted = { sql, values }; return { meta: { changes: 1 } }; },
    }; } }; } };
    const request = new Request('https://story.markets/api/narratives', { method: 'POST', headers: { origin: 'http://localhost:5173', authorization: 'Bearer demo-token', 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Shelter', premise: 'A child narrative.', parentId: 'main-1', structuralValue: 250000 }) });
    const response = await handleApi(request, { ...env(), DB: db }, async () => 'did:privy:leo');
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.narrative.parent_id).toBe('main-1');
    expect(body.narrative.structural_value).toBe(250000);
    expect(body.narrative.structural_basis).toBe('untyped_scalar');
    expect(reads[0].values).toEqual(['main-1', 'did:privy:leo', 'archived']);
    expect(inserted.values[1]).toBe('did:privy:leo');
  });
  it('does not attach a child to another account narrative', async () => {
    let inserted = false;
    const db = { prepare() { return { bind() { return { first: async () => null, run: async () => { inserted = true; return { meta: { changes: 1 } }; } }; } }; } };
    const request = new Request('https://story.markets/api/narratives', { method: 'POST', headers: { origin: 'http://localhost:5173', authorization: 'Bearer demo-token', 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Shelter', premise: 'A child narrative.', parentId: 'foreign-main' }) });
    const response = await handleApi(request, { ...env(), DB: db }, async () => 'did:privy:other');
    expect(response.status).toBe(404);
    expect(inserted).toBe(false);
  });
  it('rejects an impossible structural deadline without creating a narrative', async () => {
    let touched = false;
    const db = { prepare() { touched = true; return { bind() { return { first: async () => null, run: async () => ({ meta: { changes: 1 } }) }; } }; } };
    const request = new Request('https://story.markets/api/narratives', { method: 'POST', headers: { origin: 'http://localhost:5173', authorization: 'Bearer demo-token', 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Bad date', premise: 'Invalid date fixture.', isMain: true, structuralValue: 1000000, structuralLabel: '$1M', structuralDeadline: '2026-13-30' }) });
    const response = await handleApi(request, { ...env(), DB: db }, async () => 'did:privy:leo');
    expect(response.status).toBe(400);
    expect(touched).toBe(false);
  });
  it('creates a new narrative as a private draft owned by the Privy DID', async () => {
    let inserted;
    const db = { prepare(sql) { return { bind(...values) { return { run: async () => { inserted = { sql, values }; return { meta: { changes: 1 } }; } }; } }; } };
    const request = new Request('https://story.markets/api/narratives', { method: 'POST', headers: { origin: 'http://localhost:5173', authorization: 'Bearer demo-token', 'content-type': 'application/json' }, body: JSON.stringify({ title: 'A draft', premise: 'A story in progress.' }) });
    const response = await handleApi(request, { ...env(), DB: db }, async () => 'did:privy:owner-a');
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.narrative.status).toBe('private_draft');
    expect(inserted.values[1]).toBe('did:privy:owner-a');
  });
  it('binds a generation to the owner narrative and persists a provider receipt', async () => {
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
    const encrypted = JSON.stringify(await encryptSecret('example-provider-key', key));
    const dbCalls = [];
    const db = { prepare(sql) { return { bind(...values) { return {
      first: async () => sql.includes('FROM narratives') ? { id: 'narrative-1', title: 'The Thread', premise: 'One light remains.' } : { id: 'credential-1', provider: 'openrouter', encrypted_secret: encrypted },
      run: async () => { dbCalls.push({ sql, values }); return { meta: { changes: 1 } }; },
    }; } }; } };
    let providerCall;
    const providerFetch = async (url, options) => { providerCall = { url, options }; return new Response(JSON.stringify({ id: 'provider-request-42', choices: [{ message: { content: 'A verified draft.' } }], usage: { prompt_tokens: 7, completion_tokens: 4, total_tokens: 11 } }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'provider-request-42' } }); };
    const request = new Request('https://story.markets/api/generations', { method: 'POST', headers: { origin: 'http://localhost:5173', authorization: 'Bearer demo-token', 'content-type': 'application/json' }, body: JSON.stringify({ narrativeId: 'narrative-1', credentialId: 'credential-1', model: 'provider/model-test', prompt: 'Write a brief opening.' }) });
    const response = await handleApi(request, { ...env(), DB: db, CREDENTIALS_ENCRYPTION_KEY: key }, async () => 'did:privy:owner-a', providerFetch);
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.generation.output).toBe('A verified draft.');
    expect(body.generation.provider_request_id).toBe('provider-request-42');
    expect(providerCall.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(providerCall.options.headers.authorization).toBe('Bearer example-provider-key');
    expect(JSON.parse(providerCall.options.body).max_tokens).toBe(2048);
    expect(JSON.parse(providerCall.options.body).messages[0].content).toContain('The Thread');
    expect(dbCalls.some((call) => call.sql.includes("SET status = ?") && call.values[0] === 'succeeded')).toBe(true);
  });
  it('routes a Hashference generation to its documented Chat Completions endpoint', async () => {
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
    const encrypted = JSON.stringify(await encryptSecret('example-provider-key', key));
    const dbCalls = [];
    const db = { prepare(sql) { return { bind(...values) { return {
      first: async () => sql.includes('FROM narratives') ? { id: 'narrative-1', title: 'The Thread', premise: 'One light remains.' } : { id: 'credential-1', provider: 'hashference', encrypted_secret: encrypted },
      run: async () => { dbCalls.push({ sql, values }); return { meta: { changes: 1 } }; },
    }; } }; } };
    let providerCall;
    const providerFetch = async (url, options) => { providerCall = { url, options }; return new Response(JSON.stringify({ id: 'hashference-request-42', choices: [{ message: { content: 'A Hashference draft.' } }], usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 } }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'hashference-request-42' } }); };
    const request = new Request('https://story.markets/api/generations', { method: 'POST', headers: { origin: 'http://localhost:5173', authorization: 'Bearer demo-token', 'content-type': 'application/json' }, body: JSON.stringify({ narrativeId: 'narrative-1', credentialId: 'credential-1', model: 'hashference-test-model', prompt: 'Write a brief opening.' }) });
    const response = await handleApi(request, { ...env(), DB: db, CREDENTIALS_ENCRYPTION_KEY: key }, async () => 'did:privy:owner-a', providerFetch);
    const body = await response.json();
    expect(response.status).toBe(201);
    expect(body.generation.provider).toBe('hashference');
    expect(body.generation.output).toBe('A Hashference draft.');
    expect(providerCall.url).toBe('https://hashference.com/v1/chat/completions');
    expect(providerCall.options.headers.authorization).toBe('Bearer example-provider-key');
    expect(providerCall.options.headers['http-referer']).toBeUndefined();
    expect(providerCall.options.headers['x-title']).toBeUndefined();
    expect(JSON.parse(providerCall.options.body).max_tokens).toBe(2048);
    expect(dbCalls.some((call) => call.sql.includes('INSERT INTO generations') && call.values[4] === 'hashference')).toBe(true);
  });
  it('records a provider rate-limit receipt and does not retry', async () => {
    const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
    const encrypted = JSON.stringify(await encryptSecret('example-provider-key', key));
    const dbCalls = [];
    const db = { prepare(sql) { return { bind(...values) { return {
      first: async () => sql.includes('FROM narratives') ? { id: 'narrative-1', title: 'The Thread', premise: 'One light remains.' } : { id: 'credential-1', provider: 'openrouter', encrypted_secret: encrypted },
      run: async () => { dbCalls.push({ sql, values }); return { meta: { changes: 1 } }; },
    }; } }; } };
    let providerCalls = 0;
    const providerFetch = async () => { providerCalls += 1; return new Response(JSON.stringify({ id: 'provider-body-id', error: { message: 'private provider detail' } }), { status: 429, headers: { 'content-type': 'application/json', 'x-request-id': 'provider-rate-id' } }); };
    const request = new Request('https://story.markets/api/generations', { method: 'POST', headers: { origin: 'http://localhost:5173', authorization: 'Bearer demo-token', 'content-type': 'application/json' }, body: JSON.stringify({ narrativeId: 'narrative-1', credentialId: 'credential-1', model: 'provider/model-test', prompt: 'Write a brief opening.' }) });
    const response = await handleApi(request, { ...env(), DB: db, CREDENTIALS_ENCRYPTION_KEY: key }, async () => 'did:privy:owner-a', providerFetch);
    const body = await response.json();
    expect(response.status).toBe(502);
    expect(body.code).toBe('provider_rate_limited');
    expect(JSON.stringify(body)).not.toContain('private provider detail');
    expect(providerCalls).toBe(1);
    expect(dbCalls.some((call) => call.sql.includes('provider_request_id = ?') && call.values[2] === 'provider-rate-id')).toBe(true);
  });
  it('does not call the provider when the narrative is not owned by the current user', async () => {
    const db = { prepare(sql) { return { bind() { return { first: async () => null }; } }; } };
    let called = false;
    const request = new Request('https://story.markets/api/generations', { method: 'POST', headers: { origin: 'http://localhost:5173', authorization: 'Bearer demo-token', 'content-type': 'application/json' }, body: JSON.stringify({ narrativeId: 'foreign-id', credentialId: 'credential-1', model: 'provider/model-test', prompt: 'No call.' }) });
    const response = await handleApi(request, { ...env(), DB: db, CREDENTIALS_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))) }, async () => 'did:privy:owner-b', async () => { called = true; return new Response('{}'); });
    expect(response.status).toBe(404);
    expect(called).toBe(false);
  });
  it('rejects a credential request when the user does not own the selected provider', async () => {
    const request = new Request('https://story.markets/api/credentials', { method: 'POST', headers: { origin: 'http://localhost:5173', authorization: 'Bearer demo-token', 'content-type': 'application/json' }, body: JSON.stringify({ provider: 'anthropic', label: '', apiKey: 'example-provider-key' }) });
    const response = await handleApi(request, { ...env(), CREDENTIALS_ENCRYPTION_KEY: btoa(String.fromCharCode(...new Uint8Array(32).fill(7))), DB: { prepare() { throw new Error('must not write unsupported providers'); } } }, async () => 'did:privy:user-a');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Unsupported provider' });
  });
});
