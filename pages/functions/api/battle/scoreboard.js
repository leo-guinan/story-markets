const schema = `
CREATE TABLE IF NOT EXISTS battle_metrics (
  creator_handle TEXT PRIMARY KEY,
  impressions INTEGER,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payment_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  film_key TEXT NOT NULL,
  supporter_name TEXT NOT NULL,
  supporter_url TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  created_at TEXT NOT NULL
);
`;

const creators = [
  { handle: "leo_guinan", name: "Uncle Vibecoder", filmKey: "information_wars" },
  { handle: "lobow_spark", name: "Lobow Spark", filmKey: "youth_sports" },
];

async function ensure(db) {
  for (const statement of schema.split(";").map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
}

function tweetId(url) {
  const match = String(url || "").match(/\/status\/(\d+)/);
  return match?.[1] || null;
}

async function readImpressions(tweetUrl, bearer) {
  const id = tweetId(tweetUrl);
  if (!id || !bearer) return null;
  const response = await fetch(`https://api.x.com/2/tweets/${id}?tweet.fields=public_metrics`, { headers: { Authorization: `Bearer ${bearer}` } });
  if (!response.ok) return null;
  const body = await response.json();
  const impressions = body.data?.public_metrics?.impression_count;
  return Number.isInteger(impressions) ? impressions : null;
}

export async function onRequestGet({ env }) {
  const db = env.STORY_MARKETS_LEDGER;
  await ensure(db);
  const metrics = await db.prepare("SELECT creator_handle, impressions, updated_at FROM battle_metrics").all();
  const byHandle = new Map((metrics.results || []).map(row => [row.creator_handle, row]));
  const active = await db.prepare("SELECT creator_handle, tweet_url FROM creator_videos WHERE in_battle = 1 AND active = 1").all();
  const tweetByHandle = new Map((active.results || []).map(row => [row.creator_handle, row.tweet_url]));
  for (const creator of creators) {
    const impressions = await readImpressions(tweetByHandle.get(creator.handle), env.X_BEARER_TOKEN);
    if (impressions != null) {
      const now = new Date().toISOString();
      await db.prepare("INSERT OR REPLACE INTO battle_metrics (creator_handle, impressions, updated_at) VALUES (?, ?, ?)").bind(creator.handle, impressions, now).run();
      byHandle.set(creator.handle, { impressions, updated_at: now });
    }
  }
  const earnings = await db.prepare("SELECT film_key, COALESCE(SUM(amount_cents), 0) AS cents FROM payment_events WHERE status != 'refunded' GROUP BY film_key").all();
  const byFilm = new Map((earnings.results || []).map(row => [row.film_key, Number(row.cents || 0)]));
  return Response.json({
    battle: "battle_001",
    metric_definition: "Earnings-to-impressions conversion = paid USD divided by X impressions. Impressions are read from the current in-battle X post's public_metrics.impression_count.",
    creators: creators.map(creator => {
      const row = byHandle.get(creator.handle);
      const impressions = row?.impressions == null ? null : Number(row.impressions);
      const earningsCents = byFilm.get(creator.filmKey) || 0;
      return {
        handle: creator.handle,
        name: creator.name,
        tweet_url: tweetByHandle.get(creator.handle) || null,
        impressions,
        earnings_cents: earningsCents,
        earnings_usd: earningsCents / 100,
        conversion_rate: impressions && impressions > 0 ? earningsCents / impressions / 100 : null,
        metrics_updated_at: row?.updated_at || null,
      };
    }),
  });
}
