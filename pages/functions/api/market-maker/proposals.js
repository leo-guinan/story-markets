import { currentPatron, ensureAuthSchema, randomToken, sha256 } from "../../_shared/auth.js";
import { MARKET_MAKER_PROPOSALS } from "../../_shared/marketMaker.js";

const schema = `
CREATE TABLE IF NOT EXISTS market_maker_reviews (
  proposal_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'proposed',
  source_hash TEXT NOT NULL,
  review_note TEXT,
  reviewed_by TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS market_maker_consents (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL,
  creator_handle TEXT NOT NULL,
  evidence_url TEXT NOT NULL,
  note TEXT,
  source_hash TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE (proposal_id, creator_handle)
);
`;

async function ensure(db) {
  await ensureAuthSchema(db);
  for (const statement of schema.split(";").map(part => part.trim()).filter(Boolean)) await db.prepare(statement).run();
}

function proposal(id) { return MARKET_MAKER_PROPOSALS.find(item => item.id === id); }
function actorAllowed(patron) { return patron?.x_username?.toLowerCase() === "leo_guinan"; }
function jsonError(error, status = 400) { return Response.json({ error }, { status }); }

async function decorated(db, item) {
  const sourceHash = await sha256(JSON.stringify(item));
  const review = await db.prepare("SELECT proposal_id, status, source_hash, review_note, reviewed_by, updated_at FROM market_maker_reviews WHERE proposal_id = ?").bind(item.id).first();
  const consentRows = await db.prepare("SELECT creator_handle, evidence_url, note, source_hash, recorded_by, recorded_at FROM market_maker_consents WHERE proposal_id = ? ORDER BY creator_handle").bind(item.id).all();
  const consents = consentRows.results || [];
  const current = review?.source_hash === sourceHash ? review : { proposal_id: item.id, status: "proposed", source_hash: sourceHash, review_note: null, reviewed_by: null, updated_at: null };
  return { ...item, source_hash: sourceHash, review: current, consents, can_publish: current.status === "ready_to_publish" && consents.length === 2 };
}

export async function onRequestGet({ request, env }) {
  await ensure(env.STORY_MARKETS_LEDGER);
  const patron = await currentPatron(request, env);
  if (!actorAllowed(patron)) return jsonError("market_maker_login_required", 403);
  const requested = new URL(request.url).searchParams.get("id");
  const items = requested ? MARKET_MAKER_PROPOSALS.filter(item => item.id === requested) : MARKET_MAKER_PROPOSALS;
  if (!items.length) return jsonError("proposal_not_found", 404);
  return Response.json({ proposals: await Promise.all(items.map(item => decorated(env.STORY_MARKETS_LEDGER, item))), proposal_only: true });
}

export async function onRequestPost({ request, env }) {
  await ensure(env.STORY_MARKETS_LEDGER);
  const patron = await currentPatron(request, env);
  if (!actorAllowed(patron)) return jsonError("market_maker_login_required", 403);
  const payload = await request.json().catch(() => ({}));
  const item = proposal(String(payload.proposal_id || ""));
  if (!item) return jsonError("proposal_not_found", 404);
  const sourceHash = await sha256(JSON.stringify(item));
  if (payload.source_hash !== sourceHash) return jsonError("stale_proposal_payload", 409);
  const action = String(payload.action || "");
  const now = new Date().toISOString();
  const actor = patron.x_username.toLowerCase();
  const existing = await env.STORY_MARKETS_LEDGER.prepare("SELECT status FROM market_maker_reviews WHERE proposal_id = ?").bind(item.id).first();
  if (action === "review") {
    const note = String(payload.review_note || "").trim();
    if (note.length < 20) return jsonError("review_note_required");
    await env.STORY_MARKETS_LEDGER.prepare("INSERT OR REPLACE INTO market_maker_reviews (proposal_id, status, source_hash, review_note, reviewed_by, updated_at) VALUES (?, 'reviewed', ?, ?, ?, ?)").bind(item.id, sourceHash, note, actor, now).run();
    return Response.json({ saved: true, status: "reviewed", proposal_id: item.id });
  }
  if (action === "reject") {
    const note = String(payload.review_note || "").trim();
    if (note.length < 20) return jsonError("rejection_note_required");
    await env.STORY_MARKETS_LEDGER.prepare("INSERT OR REPLACE INTO market_maker_reviews (proposal_id, status, source_hash, review_note, reviewed_by, updated_at) VALUES (?, 'rejected', ?, ?, ?, ?)").bind(item.id, sourceHash, note, actor, now).run();
    return Response.json({ saved: true, status: "rejected", proposal_id: item.id });
  }
  if (action === "consent") {
    if (!existing || !["reviewed", "consent_pending", "ready_to_publish"].includes(existing.status)) return jsonError("review_required_first", 409);
    const handle = String(payload.creator_handle || "").toLowerCase();
    if (![item.side_a.handle.toLowerCase(), item.side_b.handle.toLowerCase()].includes(handle)) return jsonError("creator_not_in_proposal");
    const evidence = String(payload.evidence_url || "").trim();
    if (!/^https:\/\//i.test(evidence)) return jsonError("https_consent_evidence_required");
    const note = String(payload.note || "").trim();
    if (note.length < 10) return jsonError("consent_note_required");
    await env.STORY_MARKETS_LEDGER.prepare("INSERT OR REPLACE INTO market_maker_consents (id, proposal_id, creator_handle, evidence_url, note, source_hash, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(randomToken(12), item.id, handle, evidence, note, sourceHash, actor, now).run();
    const count = await env.STORY_MARKETS_LEDGER.prepare("SELECT COUNT(*) AS count FROM market_maker_consents WHERE proposal_id = ? AND source_hash = ?").bind(item.id, sourceHash).first();
    const next = Number(count?.count || 0) === 2 ? "ready_to_publish" : "consent_pending";
    await env.STORY_MARKETS_LEDGER.prepare("INSERT OR REPLACE INTO market_maker_reviews (proposal_id, status, source_hash, review_note, reviewed_by, updated_at) VALUES (?, ?, ?, COALESCE((SELECT review_note FROM market_maker_reviews WHERE proposal_id = ?), ''), COALESCE((SELECT reviewed_by FROM market_maker_reviews WHERE proposal_id = ?), ?), ?)").bind(item.id, next, sourceHash, item.id, item.id, actor, now).run();
    return Response.json({ saved: true, status: next, proposal_id: item.id });
  }
  return jsonError("unsupported_action");
}
