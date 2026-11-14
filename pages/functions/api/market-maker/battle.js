import { currentPatron, ensureAuthSchema, randomToken, sha256 } from "../../_shared/auth.js";
import { MARKET_MAKER_PROPOSALS } from "../../_shared/marketMaker.js";

const schema = `
CREATE TABLE IF NOT EXISTS market_battles (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL UNIQUE,
  challenger_handle TEXT NOT NULL,
  challenged_handle TEXT NOT NULL,
  challenge_tweet_id TEXT,
  status TEXT NOT NULL DEFAULT 'invited',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  accepted_at TEXT,
  rejected_at TEXT
);
CREATE TABLE IF NOT EXISTS market_battle_events (
  id TEXT PRIMARY KEY,
  battle_id TEXT NOT NULL,
  actor_handle TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
`;

const BATTLE_CONFIG = {
  "ai-production-vs-human-disempowerment": { challengeTweetId: "2113691977623511435" },
  "garcia-story-instinct-vs-factory-iteration": { challengeTweetId: "2113754582954463384" },
};
const DEFAULT_BATTLE_ID = "ai-production-vs-human-disempowerment";

async function ensure(db) {
  await ensureAuthSchema(db);
  for (const statement of schema.split(";").map(part => part.trim()).filter(Boolean)) await db.prepare(statement).run();
}
function getProposal(id) { return MARKET_MAKER_PROPOSALS.find(item => item.id === id); }
function safeReturnPath(value) { return /^\/market-maker\/battle\/[a-z0-9-]+\/?$/.test(value || "") ? value : `/market-maker/battle/${DEFAULT_BATTLE_ID}/`; }
async function ensureBattle(db, proposal, battleId) {
  const config = BATTLE_CONFIG[battleId];
  const now = new Date().toISOString();
  await db.prepare("INSERT OR IGNORE INTO market_battles (id, proposal_id, challenger_handle, challenged_handle, challenge_tweet_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'invited', ?, ?)").bind(battleId, proposal.id, proposal.side_a.handle.toLowerCase(), proposal.side_b.handle.toLowerCase(), config.challengeTweetId, now, now).run();
  return db.prepare("SELECT * FROM market_battles WHERE id = ?").bind(battleId).first();
}

export async function onRequestGet({ request, env }) {
  await ensure(env.STORY_MARKETS_LEDGER);
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || DEFAULT_BATTLE_ID;
  const config = BATTLE_CONFIG[id];
  const proposal = getProposal(id);
  if (!proposal || !config) return Response.json({ error: "battle_not_found" }, { status: 404 });
  const battle = await ensureBattle(env.STORY_MARKETS_LEDGER, proposal, id);
  const patron = await currentPatron(request, env);
  const viewer = patron ? { handle: patron.x_username.toLowerCase(), name: patron.x_name } : null;
  return Response.json({ battle: { ...battle, challenge_url: `https://x.com/leo_guinan/status/${config.challengeTweetId}`, proposal, viewer, can_respond: viewer?.handle === battle.challenged_handle, can_manage: viewer?.handle === battle.challenger_handle } });
}

export async function onRequestPost({ request, env }) {
  await ensure(env.STORY_MARKETS_LEDGER);
  const patron = await currentPatron(request, env);
  if (!patron) return Response.json({ error: "login_required" }, { status: 401 });
  const payload = await request.json().catch(() => ({}));
  const battleId = String(payload.battle_id || "");
  const config = BATTLE_CONFIG[battleId];
  if (!config) return Response.json({ error: "battle_not_found" }, { status: 404 });
  const proposal = getProposal(battleId);
  const battle = await ensureBattle(env.STORY_MARKETS_LEDGER, proposal, battleId);
  const actor = patron.x_username.toLowerCase();
  const action = String(payload.action || "");
  if (actor !== battle.challenged_handle && actor !== battle.challenger_handle) return Response.json({ error: "creator_not_in_battle" }, { status: 403 });
  if (action === "accept") {
    if (actor !== battle.challenged_handle) return Response.json({ error: "challenged_creator_only" }, { status: 403 });
    if (battle.status !== "invited") return Response.json({ error: "battle_not_open", status: battle.status }, { status: 409 });
    const now = new Date().toISOString();
    await env.STORY_MARKETS_LEDGER.prepare("UPDATE market_battles SET status = 'accepted', accepted_at = ?, updated_at = ? WHERE id = ? AND status = 'invited'").bind(now, now, battleId).run();
    await env.STORY_MARKETS_LEDGER.prepare("INSERT INTO market_battle_events (id, battle_id, actor_handle, action, note, created_at) VALUES (?, ?, ?, 'accept', ?, ?)").bind(randomToken(12), battleId, actor, String(payload.note || "").trim() || null, now).run();
    return Response.json({ saved: true, status: "accepted" });
  }
  if (action === "reject") {
    if (actor !== battle.challenged_handle) return Response.json({ error: "challenged_creator_only" }, { status: 403 });
    if (battle.status !== "invited") return Response.json({ error: "battle_not_open", status: battle.status }, { status: 409 });
    const now = new Date().toISOString();
    await env.STORY_MARKETS_LEDGER.prepare("UPDATE market_battles SET status = 'rejected', rejected_at = ?, updated_at = ? WHERE id = ? AND status = 'invited'").bind(now, now, battleId).run();
    await env.STORY_MARKETS_LEDGER.prepare("INSERT INTO market_battle_events (id, battle_id, actor_handle, action, note, created_at) VALUES (?, ?, ?, 'reject', ?, ?)").bind(randomToken(12), battleId, actor, String(payload.note || "").trim() || null, now).run();
    return Response.json({ saved: true, status: "rejected" });
  }
  return Response.json({ error: "unsupported_action" }, { status: 400 });
}

export { safeReturnPath };
