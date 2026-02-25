/**
 * story.markets intake Worker
 * Accepts POST /api/submit → sends to Marvin's Moltline inbox
 * Deployed to Cloudflare Workers
 */

const MOLTLINE_ADDR = '0x775027D7c320bc849923a5ef23cB233cdbD2cc6f';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': 'https://story.markets',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (url.pathname === '/api/submit' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { project, token, story, contact, timestamp } = body;

        // Validate
        if (!project || !story) {
          return new Response(JSON.stringify({ error: 'project and story required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // Format the story stake submission
        const submission = {
          type: 'story_stake_submission',
          project: project?.trim(),
          token: token?.trim(),
          story: story?.trim(),
          contact: contact?.trim() || null,
          timestamp: timestamp || new Date().toISOString(),
          source: 'story.markets'
        };

        // Store in KV (env.SUBMISSIONS must be bound in wrangler.toml)
        const key = `submission:${Date.now()}:${Math.random().toString(36).slice(2,8)}`;
        if (env.SUBMISSIONS) {
          await env.SUBMISSIONS.put(key, JSON.stringify(submission), {
            expirationTtl: 60 * 60 * 24 * 90 // 90 days
          });
        }

        // Log to console (visible in Cloudflare dashboard)
        console.log('STORY STAKE RECEIVED:', JSON.stringify(submission));

        return new Response(JSON.stringify({ 
          success: true, 
          message: 'Story stake received. Marvin is writing your entry.',
          id: key
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });

      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid request', details: e.message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // Health check
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok', service: 'story.markets intake' }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    return new Response('Not found', { status: 404 });
  }
};
