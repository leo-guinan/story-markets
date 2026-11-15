import { handleApi } from './api.js';

const LEGACY_SUBMISSION_ORIGIN = 'https://story.markets';
const CREATOR_API_PREFIX = '/creator-api';
const CREATOR_ASSET_PREFIX = '/creator-assets';

async function handleLegacySubmit(request, env) {
  const cors = { 'Access-Control-Allow-Origin': LEGACY_SUBMISSION_ORIGIN, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  try {
    const body = await request.json();
    const project = typeof body.project === 'string' ? body.project.trim() : '';
    const story = typeof body.story === 'string' ? body.story.trim() : '';
    if (!project || !story) return new Response(JSON.stringify({ error: 'project and story required' }), { status: 400, headers: { 'content-type': 'application/json', ...cors } });
    const submission = { type: 'story_stake_submission', project, token: typeof body.token === 'string' ? body.token.trim() : '', story, contact: typeof body.contact === 'string' ? body.contact.trim() || null : null, timestamp: new Date().toISOString(), source: 'story.markets' };
    const id = `submission:${crypto.randomUUID()}`;
    if (env.SUBMISSIONS) await env.SUBMISSIONS.put(id, JSON.stringify(submission), { expirationTtl: 60 * 60 * 24 * 90 });
    console.log('STORY STAKE RECEIVED:', JSON.stringify({ ...submission, contact: submission.contact ? '[redacted]' : null }));
    return new Response(JSON.stringify({ success: true, message: 'Story stake received.', id }), { status: 200, headers: { 'content-type': 'application/json', ...cors } });
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request' }), { status: 400, headers: { 'content-type': 'application/json', ...cors } });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/submit' && ['POST', 'OPTIONS'].includes(request.method)) return handleLegacySubmit(request, env);
    if (url.pathname.startsWith(`${CREATOR_API_PREFIX}/`)) {
      const apiUrl = new URL(request.url);
      apiUrl.pathname = `/api/${url.pathname.slice(CREATOR_API_PREFIX.length + 1)}`;
      return (await handleApi(new Request(apiUrl, request), env)) || new Response('Not found', { status: 404 });
    }
    if (url.pathname.startsWith('/api/')) return (await handleApi(request, env)) || new Response('Not found', { status: 404 });
    if (url.pathname.startsWith(`${CREATOR_ASSET_PREFIX}/`) && env.ASSETS) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = url.pathname.slice(CREATOR_ASSET_PREFIX.length);
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    if (url.pathname === '/api/health') return new Response(JSON.stringify({ status: 'ok', service: 'story.markets intake' }), { headers: { 'content-type': 'application/json' } });
    return new Response('Not found', { status: 404 });
  }
};
