export async function forwardCreatorRequest({ request, env }) {
  if (!env.CREATOR_STUDIO) {
    return new Response('Creator service unavailable', {
      status: 503,
      headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  try {
    return await env.CREATOR_STUDIO.fetch(request);
  } catch {
    return new Response('Creator service unavailable', {
      status: 503,
      headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' },
    });
  }
}
