import { describe, expect, it } from 'vitest';
import CreatorWorker from '../worker/index.js';

describe('Creator Studio same-origin route integration', () => {
  it('routes the namespaced API through the authenticated creator API', async () => {
    const request = new Request('https://story.markets/creator-api/narratives?view=active');
    const response = await CreatorWorker.fetch(request, { ALLOWED_ORIGIN: 'https://story.markets', ENVIRONMENT: 'production' }, {});
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Authentication required' });
  });

  it('supports the www Creator host with the same fail-closed authentication', async () => {
    const request = new Request('https://www.story.markets/creator-api/narratives', {
      headers: { origin: 'https://www.story.markets' },
    });
    const response = await CreatorWorker.fetch(request, {
      ALLOWED_ORIGIN: 'https://story.markets,https://www.story.markets',
      ENVIRONMENT: 'production',
    }, {});
    expect(response.status).toBe(401);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://www.story.markets');
    expect(await response.json()).toEqual({ error: 'Authentication required' });
  });

  it('rewrites the private asset prefix to the Creator build asset path', async () => {
    let requestedUrl;
    const assets = { fetch: async (request) => { requestedUrl = new URL(request.url); return new Response('creator bundle'); } };
    const response = await CreatorWorker.fetch(new Request('https://story.markets/creator-assets/assets/creator.js?v=2'), { ASSETS: assets }, {});
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('creator bundle');
    expect(requestedUrl.pathname).toBe('/assets/creator.js');
    expect(requestedUrl.search).toBe('?v=2');
  });

  it('serves the Creator entry document from the same asset bundle', async () => {
    let requestedUrl;
    const assets = { fetch: async (request) => { requestedUrl = new URL(request.url); return new Response('<title>Future Radio Studio</title>', { headers: { 'content-type': 'text/html' } }); } };
    const response = await CreatorWorker.fetch(new Request('https://story.markets/creator.html'), { ASSETS: assets }, {});
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Future Radio Studio');
    expect(requestedUrl.pathname).toBe('/creator.html');
  });
});
