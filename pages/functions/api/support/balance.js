import { currentPatron, ensureAuthSchema } from "../../_shared/auth.js";
import { ensureFundingSchema, DEFAULT_SUPPORT_CENTS } from "../../_shared/funding.js";

export async function onRequest({ request, env }) {
  await ensureAuthSchema(env.STORY_MARKETS_LEDGER); await ensureFundingSchema(env.STORY_MARKETS_LEDGER);
  const patron = await currentPatron(request, env);
  if (!patron) return Response.json({ error: "login_required" }, { status: 401 });
  const db = env.STORY_MARKETS_LEDGER;
  const topups = await db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM account_topups WHERE patron_id=? AND status='paid'").bind(patron.id).first();
  const spent = await db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS cents FROM support_allocations WHERE patron_id=? AND status='allocated'").bind(patron.id).first();
  const pref = await db.prepare("SELECT default_support_cents FROM patrons WHERE id=?").bind(patron.id).first();
  const balance = Math.max(0, Number(topups?.cents || 0) - Number(spent?.cents || 0));
  return Response.json({ balance_cents: balance, default_support_cents: Number(pref?.default_support_cents || DEFAULT_SUPPORT_CENTS), currency: "usd" });
}
