import { authenticate, decryptSecret, encryptSecret, getBearerToken, maskSecret } from './security.js';

const MAX_BODY = 32_000;
const MAX_PROMPT = 12_000;
const PROVIDERS = Object.freeze({
  openrouter: {
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultCredentialLabel: 'OpenRouter key',
    headers: { 'http-referer': 'https://story.markets', 'x-title': 'story.markets Future Radio' },
  },
  hashference: {
    endpoint: 'https://hashference.com/v1/chat/completions',
    defaultCredentialLabel: 'Hashference key',
    headers: {},
  },
});

function getProviderConfig(provider) {
  return typeof provider === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, provider) ? PROVIDERS[provider] : null;
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const allowed = new Set((env.ALLOWED_ORIGIN || 'https://story.markets').split(',').map((value) => value.trim()).filter(Boolean));
  if (env.ENVIRONMENT === 'development') {
    allowed.add('http://localhost:5173');
    allowed.add('http://127.0.0.1:5173');
  }
  return allowed.has(origin);
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY) throw new Error('Request too large');
  const raw = await request.text();
  if (raw.length > MAX_BODY) throw new Error('Request too large');
  try { return JSON.parse(raw); } catch { throw new Error('Invalid JSON'); }
}

function isDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function requireDb(env) {
  if (!env.DB) throw new Error('Database is not configured');
  return env.DB;
}

export async function handleApi(request, env, authenticateFn = authenticate, fetchFn = fetch) {
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  const cors = origin && allowedOrigin(request, env) ? {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'Authorization, Content-Type',
    'vary': 'Origin',
  } : {};
  if (!allowedOrigin(request, env)) return json({ error: 'Origin not allowed' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (url.pathname === '/api/health' && request.method === 'GET') return json({ status: 'ok', service: 'story.markets creator API' }, 200, cors);
  if (!url.pathname.startsWith('/api/')) return null;

  const token = getBearerToken(request);
  if (!token) return json({ error: 'Authentication required' }, 401, cors);
  let ownerId;
  try { ownerId = await authenticateFn(request, env); }
  catch (error) {
    const configError = String(error?.message || '').includes('not configured');
    return json({ error: configError ? 'Authentication service is not configured' : 'Invalid or expired session' }, configError ? 503 : 401, cors);
  }
  if (!ownerId) return json({ error: 'Invalid or expired session' }, 401, cors);

  let db;
  try { db = requireDb(env); }
  catch { return json({ error: 'Storage is not configured' }, 503, cors); }

  try {
    if (url.pathname === '/api/export' && request.method === 'GET') {
      const [narratives, generations, credentials] = await Promise.all([
        db.prepare('SELECT id, title, premise, status, created_at, updated_at, parent_id, is_main, structural_value, structural_label, structural_deadline, structural_basis FROM narratives WHERE owner_id = ? ORDER BY created_at ASC').bind(ownerId).all(),
        db.prepare('SELECT id, narrative_id, credential_id, provider, model, prompt, status, output, provider_request_id, usage_json, failure_code, created_at, completed_at FROM generations WHERE owner_id = ? ORDER BY created_at ASC').bind(ownerId).all(),
        db.prepare('SELECT id, provider, label, masked_secret, status, created_at, revoked_at FROM provider_credentials WHERE owner_id = ? ORDER BY created_at ASC').bind(ownerId).all(),
      ]);
      return json({
        schema: 'story-markets.workspace-export.v1',
        exported_at: new Date().toISOString(),
        narratives: narratives.results || [],
        generations: generations.results || [],
        credentials: credentials.results || [],
      }, 200, { ...cors, 'content-disposition': 'attachment; filename="story-markets-export.json"' });
    }

    if (url.pathname === '/api/narratives' && request.method === 'GET') {
      const [narrativeResult, rollup] = await Promise.all([
        db.prepare('SELECT id, title, premise, status, created_at, updated_at, parent_id, is_main, structural_value, structural_label, structural_deadline, structural_basis FROM narratives WHERE owner_id = ? AND status != ? ORDER BY updated_at DESC LIMIT 100').bind(ownerId, 'archived').all(),
        db.prepare(`WITH RECURSIVE descendants(id) AS (
          SELECT id FROM narratives WHERE owner_id = ? AND is_main = 1 AND status != ?
          UNION ALL
          SELECT child.id FROM narratives child JOIN descendants parent ON child.parent_id = parent.id WHERE child.owner_id = ? AND child.status != ?
        )
        SELECT COALESCE(SUM(CASE WHEN narrative.is_main = 0 THEN COALESCE(narrative.structural_value, 0) ELSE 0 END), 0) AS structural_rollup_value
        FROM descendants JOIN narratives narrative ON narrative.id = descendants.id WHERE narrative.owner_id = ?`).bind(ownerId, 'archived', ownerId, 'archived', ownerId).first(),
      ]);
      const results = narrativeResult.results || [];
      const structuralRollupValue = Math.max(0, Number(rollup?.structural_rollup_value) || 0);
      return json({ narratives: results.map((narrative) => Number(narrative.is_main) === 1 ? { ...narrative, structural_rollup_value: structuralRollupValue } : narrative) }, 200, cors);
    }

    if (url.pathname === '/api/narratives' && request.method === 'POST') {
      const body = await readJson(request);
      const title = typeof body.title === 'string' ? body.title.trim() : '';
      const premise = typeof body.premise === 'string' ? body.premise.trim() : '';
      const parentId = typeof body.parentId === 'string' && body.parentId.trim() ? body.parentId.trim() : null;
      const isMain = body.isMain === true;
      const rawStructuralValue = body.structuralValue;
      const structuralValueProvided = rawStructuralValue !== null && rawStructuralValue !== undefined && rawStructuralValue !== '';
      const structuralValue = typeof rawStructuralValue === 'number' ? rawStructuralValue : typeof rawStructuralValue === 'string' && /^\d+$/.test(rawStructuralValue) ? Number(rawStructuralValue) : null;
      const structuralLabel = typeof body.structuralLabel === 'string' ? body.structuralLabel.trim() : '';
      const structuralDeadline = typeof body.structuralDeadline === 'string' ? body.structuralDeadline.trim() : '';
      if (!title || title.length > 120 || !premise || premise.length > 3000) return json({ error: 'Title (1–120 chars) and premise (1–3000 chars) are required' }, 400, cors);
      if (structuralValueProvided && (!Number.isSafeInteger(structuralValue) || structuralValue < 1)) return json({ error: 'Structural values must be positive safe integers' }, 400, cors);
      if (isMain && (parentId || !Number.isSafeInteger(structuralValue) || structuralValue < 1 || !structuralLabel || structuralLabel.length > 80 || !isDateOnly(structuralDeadline))) return json({ error: 'A main narrative needs a positive integer structural target, label, and valid deadline, and cannot have a parent' }, 400, cors);
      if (!parentId && !isMain && structuralValue !== null) return json({ error: 'A structural contribution must be attached to a parent narrative' }, 400, cors);
      let parent = null;
      if (parentId) {
        parent = await db.prepare('SELECT id, structural_basis FROM narratives WHERE id = ? AND owner_id = ? AND status != ?').bind(parentId, ownerId, 'archived').first();
        if (!parent) return json({ error: 'Parent narrative not found' }, 404, cors);
        if (structuralValue !== null && parent.structural_basis !== 'untyped_scalar') return json({ error: 'The parent has no compatible structural roll-up basis' }, 409, cors);
      }
      if (isMain) {
        const existing = await db.prepare('SELECT id FROM narratives WHERE owner_id = ? AND is_main = 1 LIMIT 1').bind(ownerId).first();
        if (existing) return json({ error: 'This account already has a main narrative' }, 409, cors);
      }
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const structuralBasis = isMain || parent?.structural_basis === 'untyped_scalar' ? 'untyped_scalar' : null;
      await db.prepare('INSERT INTO narratives (id, owner_id, title, premise, status, created_at, updated_at, parent_id, is_main, structural_value, structural_label, structural_deadline, structural_basis) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, ownerId, title, premise, 'private_draft', now, now, parentId, isMain ? 1 : 0, structuralValue, isMain ? structuralLabel : null, isMain ? structuralDeadline : null, structuralBasis).run();
      return json({ narrative: { id, title, premise, status: 'private_draft', created_at: now, updated_at: now, parent_id: parentId, is_main: isMain, structural_value: structuralValue, structural_label: isMain ? structuralLabel : null, structural_deadline: isMain ? structuralDeadline : null, structural_basis: structuralBasis } }, 201, cors);
    }

    if (url.pathname === '/api/credentials' && request.method === 'GET') {
      const { results = [] } = await db.prepare('SELECT id, provider, label, masked_secret, status, created_at FROM provider_credentials WHERE owner_id = ? AND status = ? ORDER BY created_at DESC').bind(ownerId, 'active').all();
      return json({ credentials: results }, 200, cors);
    }

    if (url.pathname === '/api/credentials' && request.method === 'POST') {
      if (!env.CREDENTIALS_ENCRYPTION_KEY) return json({ error: 'Credential encryption is not configured' }, 503, cors);
      const body = await readJson(request);
      const provider = body.provider;
      const providerConfig = getProviderConfig(provider);
      const secret = body.apiKey;
      const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) : '';
      if (!providerConfig) return json({ error: 'Unsupported provider' }, 400, cors);
      if (typeof secret !== 'string' || secret.trim() !== secret || secret.length < 8 || secret.length > 4096) return json({ error: 'API key must be 8–4096 characters with no surrounding whitespace' }, 400, cors);
      const encrypted = await encryptSecret(secret, env.CREDENTIALS_ENCRYPTION_KEY);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const safeLabel = label || providerConfig.defaultCredentialLabel;
      await db.prepare('INSERT INTO provider_credentials (id, owner_id, provider, label, masked_secret, encrypted_secret, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, ownerId, provider, safeLabel, maskSecret(secret), JSON.stringify(encrypted), 'active', now).run();
      return json({ credential: { id, provider, label: safeLabel, masked_secret: maskSecret(secret), status: 'active', created_at: now } }, 201, cors);
    }

    const credentialDelete = url.pathname.match(/^\/api\/credentials\/([0-9a-f-]{36})$/i);
    if (credentialDelete && request.method === 'DELETE') {
      const now = new Date().toISOString();
      const result = await db.prepare('UPDATE provider_credentials SET status = ?, encrypted_secret = NULL, revoked_at = ? WHERE id = ? AND owner_id = ? AND status = ?').bind('revoked', now, credentialDelete[1], ownerId, 'active').run();
      if (!result.meta?.changes) return json({ error: 'Credential not found' }, 404, cors);
      return json({ revoked: true, id: credentialDelete[1] }, 200, cors);
    }

    if (url.pathname === '/api/generations' && request.method === 'GET') {
      const { results = [] } = await db.prepare('SELECT id, narrative_id, provider, model, status, output, provider_request_id, usage_json, failure_code, created_at, completed_at FROM generations WHERE owner_id = ? ORDER BY created_at DESC LIMIT 50').bind(ownerId).all();
      return json({ generations: results }, 200, cors);
    }

    if (url.pathname === '/api/generations' && request.method === 'POST') {
      if (!env.CREDENTIALS_ENCRYPTION_KEY) return json({ error: 'Credential encryption is not configured' }, 503, cors);
      const body = await readJson(request);
      const narrativeId = typeof body.narrativeId === 'string' ? body.narrativeId : '';
      const credentialId = typeof body.credentialId === 'string' ? body.credentialId : '';
      const model = typeof body.model === 'string' ? body.model.trim() : '';
      const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
      if (!narrativeId || !credentialId || !model || model.length > 160 || /[\s<>"']/.test(model) || !prompt || prompt.length > MAX_PROMPT) return json({ error: 'Valid narrative, credential, model slug, and prompt (up to 12,000 chars) are required' }, 400, cors);
      const narrative = await db.prepare('SELECT id, title, premise FROM narratives WHERE id = ? AND owner_id = ? AND status = ?').bind(narrativeId, ownerId, 'private_draft').first();
      if (!narrative) return json({ error: 'Private draft narrative not found' }, 404, cors);
      const credential = await db.prepare('SELECT id, provider, encrypted_secret FROM provider_credentials WHERE id = ? AND owner_id = ? AND status = ?').bind(credentialId, ownerId, 'active').first();
      const providerConfig = getProviderConfig(credential?.provider);
      if (!credential?.encrypted_secret || !providerConfig) return json({ error: 'Active provider key not found' }, 404, cors);
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      await db.prepare('INSERT INTO generations (id, owner_id, narrative_id, credential_id, provider, model, prompt, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, ownerId, narrativeId, credentialId, credential.provider, model, prompt, 'running', createdAt).run();
      try {
        const apiKey = await decryptSecret(JSON.parse(credential.encrypted_secret), env.CREDENTIALS_ENCRYPTION_KEY);
        const providerResponse = await fetchFn(providerConfig.endpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', ...providerConfig.headers },
          body: JSON.stringify({ model, max_tokens: 2048, messages: [
            { role: 'system', content: `You are helping develop a Future Radio narrative. Narrative title: ${narrative.title}\nPremise: ${narrative.premise}\nTreat these as working material. Return a useful draft, not a claim of approval or canon.` },
            { role: 'user', content: prompt },
          ] }),
          signal: AbortSignal.timeout(45_000),
        });
        const providerBody = await providerResponse.json().catch(() => ({}));
        if (!providerResponse.ok) {
          const code = providerResponse.status === 401 ? 'provider_auth_failed' : providerResponse.status === 429 ? 'provider_rate_limited' : `provider_http_${providerResponse.status}`;
          await db.prepare('UPDATE generations SET status = ?, failure_code = ?, provider_request_id = ?, completed_at = ? WHERE id = ? AND owner_id = ?').bind('failed', code, providerResponse.headers.get('x-request-id') || providerBody?.id || null, new Date().toISOString(), id, ownerId).run();
          return json({ error: 'Provider request failed; no automatic retry was attempted', generationId: id, code }, 502, cors);
        }
        const output = providerBody?.choices?.[0]?.message?.content;
        if (typeof output !== 'string' || !output.trim()) throw new Error('empty_provider_output');
        const requestId = providerResponse.headers.get('x-request-id') || providerBody?.id || null;
        const usage = providerBody?.usage && typeof providerBody.usage === 'object' ? JSON.stringify({ prompt_tokens: providerBody.usage.prompt_tokens ?? null, completion_tokens: providerBody.usage.completion_tokens ?? null, total_tokens: providerBody.usage.total_tokens ?? null, cost: providerBody.usage.cost ?? null }) : null;
        const completedAt = new Date().toISOString();
        await db.prepare('UPDATE generations SET status = ?, output = ?, provider_request_id = ?, usage_json = ?, completed_at = ? WHERE id = ? AND owner_id = ?').bind('succeeded', output, requestId, usage, completedAt, id, ownerId).run();
        return json({ generation: { id, narrative_id: narrativeId, provider: credential.provider, model, status: 'succeeded', output, provider_request_id: requestId, usage_json: usage, created_at: createdAt, completed_at: completedAt } }, 201, cors);
      } catch (error) {
        const code = error?.name === 'TimeoutError' ? 'provider_timeout' : error?.message === 'empty_provider_output' ? 'empty_provider_output' : 'provider_request_failed';
        await db.prepare('UPDATE generations SET status = ?, failure_code = ?, completed_at = ? WHERE id = ? AND owner_id = ?').bind('failed', code, new Date().toISOString(), id, ownerId).run();
        return json({ error: 'Generation failed; no automatic retry was attempted', generationId: id, code }, 502, cors);
      }
    }

    return json({ error: 'Not found' }, 404, cors);
  } catch (error) {
    const message = error?.message === 'Request too large' ? error.message : error?.message === 'Invalid JSON' ? error.message : 'Request failed';
    const status = message === 'Request too large' ? 413 : message === 'Invalid JSON' ? 400 : 500;
    return json({ error: message }, status, cors);
  }
}

export { getBearerToken };
