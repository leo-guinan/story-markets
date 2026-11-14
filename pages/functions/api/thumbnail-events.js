const schema = `
CREATE TABLE IF NOT EXISTS thumbnail_experiment_events (
  event_id TEXT PRIMARY KEY,
  experiment TEXT NOT NULL,
  story_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  event_type TEXT NOT NULL,
  battle_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_thumbnail_events_lookup
  ON thumbnail_experiment_events (experiment, story_id, variant, event_type, created_at);
`;

const allowedStories = new Set(["energy-paintbrush", "annalea-lab", "vibecamp-grant", "bloom-party"]);
const allowedVariants = new Set(["a", "b"]);
const allowedEvents = new Set(["impression", "video_play"]);
const experiment = "movie-thumbnail-2026-11-13";

async function ensure(db) {
  for (const statement of schema.split(";").map((s) => s.trim()).filter(Boolean)) await db.prepare(statement).run();
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "GET,POST,OPTIONS" } });
}

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => null);
  const eventId = String(body?.event_id || "");
  const storyId = String(body?.story_id || "");
  const variant = String(body?.variant || "");
  const eventType = String(body?.event_type || "");
  const battleId = String(body?.battle_id || "");
  const sessionId = String(body?.session_id || "");
  if (!/^[a-zA-Z0-9_-]{12,100}$/.test(eventId) || !allowedStories.has(storyId) || !allowedVariants.has(variant) || !allowedEvents.has(eventType) || !/^[a-zA-Z0-9_-]{4,100}$/.test(battleId) || !/^[a-zA-Z0-9_-]{8,100}$/.test(sessionId)) return json({ error: "invalid_event" }, 400);
  const db = env.STORY_MARKETS_LEDGER;
  await ensure(db);
  await db.prepare("INSERT OR IGNORE INTO thumbnail_experiment_events (event_id, experiment, story_id, variant, event_type, battle_id, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(eventId, experiment, storyId, variant, eventType, battleId, sessionId, new Date().toISOString()).run();
  return json({ ok: true, event_id: eventId });
}

export async function onRequestGet({ env }) {
  const db = env.STORY_MARKETS_LEDGER;
  await ensure(db);
  const rows = await db.prepare("SELECT story_id, variant, event_type, COUNT(*) AS count FROM thumbnail_experiment_events WHERE experiment=? GROUP BY story_id, variant, event_type ORDER BY story_id, variant, event_type").bind(experiment).all();
  return json({ experiment, rows: (rows.results || []).map((row) => ({ story_id: row.story_id, variant: row.variant, event_type: row.event_type, count: Number(row.count || 0) })), note: "Exposure and video-start counts are observational. No thumbnail winner is declared." });
}
