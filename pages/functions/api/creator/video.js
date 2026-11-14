import { currentPatron, ensureAuthSchema, randomToken } from "../../_shared/auth.js";

const CREATOR_HANDLES = new Set(["leo_guinan", "lobow_spark"]);
const MAX_BYTES = 100 * 1024 * 1024;
const tweetPattern = /^https:\/\/(?:x\.com|twitter\.com)\/[A-Za-z0-9_]+\/status\/\d+(?:\?.*)?$/;

function creatorAllowed(patron) {
  return patron && CREATOR_HANDLES.has(patron.x_username.toLowerCase());
}

function mediaUrl(row) {
  return row.tweet_url ? null : `/media/${row.object_key}`;
}

export async function onRequestGet({ request, env }) {
  await ensureAuthSchema(env.STORY_MARKETS_LEDGER);
  const query = new URL(request.url).searchParams;
  const creator = query.get("creator");
  const all = query.get("all") === "1";
  let statement = all
    ? "SELECT id, creator_handle, object_key, filename, content_type, size_bytes, tweet_url, sort_order, in_battle, uploaded_at, active FROM creator_videos"
    : "SELECT id, creator_handle, object_key, filename, content_type, size_bytes, tweet_url, sort_order, in_battle, uploaded_at, active FROM creator_videos WHERE active = 1 AND in_battle = 1";
  const bindings = [];
  if (creator) {
    statement += all ? " WHERE creator_handle = ?" : " AND creator_handle = ?";
    bindings.push(creator.toLowerCase());
  }
  statement += " ORDER BY sort_order ASC, uploaded_at DESC";
  const rows = await env.STORY_MARKETS_LEDGER.prepare(statement).bind(...bindings).all();
  return Response.json({ videos: (rows.results || []).map(row => ({ ...row, video_url: mediaUrl(row) })) });
}

export async function onRequestPost({ request, env }) {
  await ensureAuthSchema(env.STORY_MARKETS_LEDGER);
  const patron = await currentPatron(request, env);
  if (!creatorAllowed(patron)) return Response.json({ error: "creator_login_required" }, { status: 403 });
  const handle = patron.x_username.toLowerCase();
  const contentType = request.headers.get("content-type") || "";
  let payload = {};
  let form = null;
  if (contentType.includes("application/json")) payload = await request.json();
  else { form = await request.formData(); payload = { tweet_url: String(form.get("tweet_url") || "").trim() }; }

  if (payload.action === "reorder") {
    if (!Array.isArray(payload.items) || payload.items.length > 200) return Response.json({ error: "invalid_order" }, { status: 400 });
    for (const item of payload.items) {
      if (!item?.id || !Number.isInteger(item.sort_order)) return Response.json({ error: "invalid_order" }, { status: 400 });
      await env.STORY_MARKETS_LEDGER.prepare("UPDATE creator_videos SET sort_order = ? WHERE id = ? AND creator_handle = ?").bind(item.sort_order, String(item.id), handle).run();
    }
    return Response.json({ reordered: true });
  }

  if (payload.action === "set_battle") {
    const id = String(payload.id || "");
    if (!id || ![0, 1].includes(Number(payload.in_battle))) return Response.json({ error: "invalid_battle_state" }, { status: 400 });
    const inBattle = Number(payload.in_battle);
    if (inBattle) {
      await env.STORY_MARKETS_LEDGER.prepare("UPDATE creator_videos SET active = 0, in_battle = 0 WHERE creator_handle = ?").bind(handle).run();
      await env.STORY_MARKETS_LEDGER.prepare("UPDATE creator_videos SET active = 1, in_battle = 1 WHERE id = ? AND creator_handle = ?").bind(id, handle).run();
    } else {
      await env.STORY_MARKETS_LEDGER.prepare("UPDATE creator_videos SET active = 0, in_battle = 0 WHERE id = ? AND creator_handle = ?").bind(id, handle).run();
    }
    return Response.json({ battle_updated: true });
  }

  const tweetUrl = String(payload.tweet_url || "").trim();
  if (tweetUrl) {
    if (!tweetPattern.test(tweetUrl)) return Response.json({ error: "invalid_tweet_url" }, { status: 400 });
    const maxOrder = await env.STORY_MARKETS_LEDGER.prepare("SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM creator_videos WHERE creator_handle = ?").bind(handle).first();
    await env.STORY_MARKETS_LEDGER.prepare("UPDATE creator_videos SET active = 0, in_battle = 0 WHERE creator_handle = ?").bind(handle).run();
    await env.STORY_MARKETS_LEDGER.prepare("INSERT INTO creator_videos (id, creator_handle, object_key, filename, content_type, size_bytes, tweet_url, sort_order, in_battle, uploaded_at, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1)").bind(`tweet_${randomToken(12)}`, handle, `tweet_${randomToken(12)}`, "X post", "text/uri-list", 0, tweetUrl, Number(maxOrder?.max_order ?? -1) + 1, new Date().toISOString()).run();
    return Response.json({ saved: true, creator_handle: handle, tweet_url: tweetUrl });
  }

  const file = form?.get("video");
  if (!(file instanceof File)) return Response.json({ error: "tweet_url_required" }, { status: 400 });
  if (file.size < 1 || file.size > MAX_BYTES) return Response.json({ error: "video_file_too_large", max_bytes: MAX_BYTES }, { status: 413 });
  const type = file.type.toLowerCase();
  if (!['video/mp4', 'video/webm', 'video/quicktime'].includes(type)) return Response.json({ error: "unsupported_video_type" }, { status: 415 });
  const maxOrder = await env.STORY_MARKETS_LEDGER.prepare("SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM creator_videos WHERE creator_handle = ?").bind(handle).first();
  const objectKey = `creators/${handle}/${randomToken(16)}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  await env.STORY_MARKETS_VIDEOS.put(objectKey, file.stream(), { httpMetadata: { contentType: type, contentDisposition: `inline; filename="${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}"` } });
  await env.STORY_MARKETS_LEDGER.prepare("UPDATE creator_videos SET active = 0, in_battle = 0 WHERE creator_handle = ?").bind(handle).run();
  await env.STORY_MARKETS_LEDGER.prepare("INSERT INTO creator_videos (id, creator_handle, object_key, filename, content_type, size_bytes, tweet_url, sort_order, in_battle, uploaded_at, active) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 1, ?, 1)").bind(`video_${randomToken(12)}`, handle, objectKey, file.name.slice(0, 180), type, file.size, Number(maxOrder?.max_order ?? -1) + 1, new Date().toISOString()).run();
  return Response.json({ uploaded: true, creator_handle: handle, video_url: `/media/${objectKey}` });
}
