import { currentPatron, ensureAuthSchema } from "../../_shared/auth.js";
import { ensureFundingSchema, TOPUP_AMOUNTS, randomId, ARTWORK_CREATORS } from "../../_shared/funding.js";

export async function onRequestPost({ request, env }) {
  await ensureAuthSchema(env.STORY_MARKETS_LEDGER); await ensureFundingSchema(env.STORY_MARKETS_LEDGER);
  const patron = await currentPatron(request, env); if (!patron) return Response.json({ error: "login_required" }, { status: 401 });
  let body; try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const artworkId = typeof body.artwork_id === "string" ? body.artwork_id : "";
  const battleId = typeof body.battle_id === "string" ? body.battle_id : "";
  const key = typeof body.idempotency_key === "string" ? body.idempotency_key : "";
  const amount = Number(body.amount_cents);
  if (!/^[a-z0-9-]{3,100}$/.test(artworkId) || !/^[a-z0-9-]{3,100}$/.test(battleId) || !/^[A-Za-z0-9_-]{12,100}$/.test(key)) return Response.json({ error: "invalid_target_or_idempotency_key" }, { status: 422 });
  if (!ARTWORK_CREATORS[artworkId]) return Response.json({ error: "unknown_artwork" }, { status: 422 });
  if (!Number.isInteger(amount) || !TOPUP_AMOUNTS.includes(amount)) return Response.json({ error: "unsupported_amount", allowed_cents: TOPUP_AMOUNTS }, { status: 422 });
  const existing = await env.STORY_MARKETS_LEDGER.prepare("SELECT id, amount_cents, artwork_id FROM support_allocations WHERE idempotency_key=? AND patron_id=?").bind(key, patron.id).first();
  if (existing) return Response.json({ allocated: true, replay: true, allocation: existing });
  const topups = await env.STORY_MARKETS_LEDGER.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM account_topups WHERE patron_id=? AND status='paid'").bind(patron.id).first();
  const spent = await env.STORY_MARKETS_LEDGER.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM support_allocations WHERE patron_id=? AND status='allocated'").bind(patron.id).first();
  const balance = Number(topups?.cents || 0) - Number(spent?.cents || 0);
  if (balance < amount) return Response.json({ error: "insufficient_balance", balance_cents: Math.max(0, balance), required_cents: amount }, { status: 409 });
  const id = randomId("alloc");
  await env.STORY_MARKETS_LEDGER.prepare("INSERT INTO support_allocations (id,idempotency_key,patron_id,artwork_id,battle_id,amount_cents,currency,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(id,key,patron.id,artworkId,battleId,amount,"usd","allocated",new Date().toISOString()).run();
  return Response.json({ allocated: true, allocation: { id, artwork_id: artworkId, battle_id: battleId, amount_cents: amount, currency: "usd" }, balance_cents: balance - amount });
}
