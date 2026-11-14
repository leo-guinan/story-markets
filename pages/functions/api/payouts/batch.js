import { currentPatron, ensureAuthSchema } from "../../_shared/auth.js";
import { ensureFundingSchema, ARTWORK_CREATORS, randomId } from "../../_shared/funding.js";

const HOLD_DAYS = 7;
const OPERATOR = "leo_guinan";
function isoDaysAgo(days) { return new Date(Date.now() - days * 86400000).toISOString(); }

export async function onRequestPost({ request, env }) {
  await ensureAuthSchema(env.STORY_MARKETS_LEDGER); await ensureFundingSchema(env.STORY_MARKETS_LEDGER);
  const operator = await currentPatron(request, env);
  if (!operator || operator.x_username.toLowerCase() !== OPERATOR) return Response.json({ error: "operator_required" }, { status: 403 });
  let body = {}; try { body = await request.json(); } catch {}
  const execute = body.execute === true;
  if (execute && body.confirm_phrase !== "EXECUTE_PAYOUT_BATCH") return Response.json({ error: "confirmation_required" }, { status: 422 });
  const db = env.STORY_MARKETS_LEDGER;
  const cutoff = isoDaysAgo(HOLD_DAYS);
  const rows = await db.prepare(`SELECT a.id, a.artwork_id, a.amount_cents, a.created_at FROM support_allocations a WHERE a.status='allocated' AND a.created_at <= ? AND a.id NOT IN (SELECT allocation_id FROM payout_items)`).bind(cutoff).all();
  const candidates = [];
  for (const row of rows.results || []) {
    const creator_handle = ARTWORK_CREATORS[row.artwork_id] || "";
    const creator = creator_handle ? await db.prepare("SELECT p.id, cpa.stripe_account_id, cpa.charges_enabled, cpa.payouts_enabled FROM patrons p LEFT JOIN creator_payout_accounts cpa ON cpa.patron_id=p.id WHERE p.x_username=?").bind(creator_handle).first() : null;
    candidates.push({ ...row, creator_handle, stripe_account_id: creator?.stripe_account_id || null, charges_enabled: creator?.charges_enabled || 0, payouts_enabled: creator?.payouts_enabled || 0, eligible: Boolean(creator?.stripe_account_id && creator?.charges_enabled && creator?.payouts_enabled) });
  }
  if (!execute) return Response.json({ mode: "preview", hold_days: HOLD_DAYS, cutoff, candidates, total_cents: candidates.filter(x=>x.eligible).reduce((n,x)=>n+Number(x.amount_cents),0) });
  if (!env.STRIPE_SECRET_KEY) return Response.json({ error: "payment_not_configured" }, { status: 503 });
  const batchId = randomId("batch");
  await db.prepare("INSERT INTO payout_batches (id,cutoff_at,status,total_cents,created_at) VALUES (?,?,?,?,?)").bind(batchId,cutoff,"processing",0,new Date().toISOString()).run();
  let total = 0, sent = 0, held = 0;
  for (const item of candidates) {
    const itemId = randomId("payout");
    if (!item.eligible) { await db.prepare("INSERT INTO payout_items (id,batch_id,allocation_id,creator_handle,amount_cents,status,created_at) VALUES (?,?,?,?,?,?,?)").bind(itemId,batchId,item.id,item.creator_handle,item.amount_cents,"held",new Date().toISOString()).run(); held++; continue; }
    const form = new URLSearchParams({ amount: String(item.amount_cents), currency: "usd", destination: item.stripe_account_id, "metadata[allocation_id]": item.id, "metadata[batch_id]": batchId, "transfer_group": batchId });
    const response = await fetch("https://api.stripe.com/v1/transfers", { method: "POST", headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
    if (!response.ok) { await db.prepare("INSERT INTO payout_items (id,batch_id,allocation_id,creator_handle,amount_cents,status,created_at) VALUES (?,?,?,?,?,?,?)").bind(itemId,batchId,item.id,item.creator_handle,item.amount_cents,"held",new Date().toISOString()).run(); held++; continue; }
    const transfer = await response.json();
    await db.prepare("INSERT INTO payout_items (id,batch_id,allocation_id,creator_handle,amount_cents,status,stripe_transfer_id,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(itemId,batchId,item.id,item.creator_handle,item.amount_cents,"sent",transfer.id,new Date().toISOString()).run();
    total += item.amount_cents; sent++;
  }
  const status = held ? (sent ? "partial" : "held") : "sent";
  await db.prepare("UPDATE payout_batches SET status=?,total_cents=?,executed_at=? WHERE id=?").bind(status,total,new Date().toISOString(),batchId).run();
  return Response.json({ mode: "execute", batch_id: batchId, status, sent_items: sent, held_items: held, total_cents: total });
}
