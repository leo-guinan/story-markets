export async function onRequestGet({ request, env }) {
  const pathname = new URL(request.url).pathname;
  const prefix = "/media/";
  if (!pathname.startsWith(prefix)) return new Response("not found", { status: 404 });
  const key = pathname.slice(prefix.length);
  if (!key || key.includes("..")) return new Response("not found", { status: 404 });
  const object = await env.STORY_MARKETS_VIDEOS.get(key);
  if (!object) return new Response("not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=300");
  return new Response(object.body, { headers });
}
