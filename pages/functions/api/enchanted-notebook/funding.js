import { ensureDirectSupportSchema, ENCHANTED_NOTEBOOK_PROJECT } from "../../_shared/funding.js";

export async function onRequestGet({ request, env }) {
  const project = new URL(request.url).searchParams.get("project") || ENCHANTED_NOTEBOOK_PROJECT;
  if (project !== ENCHANTED_NOTEBOOK_PROJECT) return Response.json({ error: "unknown_project" }, { status: 400 });
  const db = env.STORY_MARKETS_LEDGER;
  await ensureDirectSupportSchema(db);
  const row = await db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS funded_cents, COUNT(*) AS payment_count FROM direct_support_events WHERE project=? AND status='paid' AND currency='usd'").bind(project).first();
  return Response.json({ project, funded_cents: Number(row?.funded_cents || 0), payment_count: Number(row?.payment_count || 0), target_cents: null, currency: "usd" }, { headers: { "Cache-Control": "no-store" } });
}
