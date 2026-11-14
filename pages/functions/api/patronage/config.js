import { currentPatron, ensureAuthSchema } from "../../_shared/auth.js";

const json = (body, status = 200) => Response.json(body, { status });

export async function onRequestGet({ request, env }) {
  await ensureAuthSchema(env.STORY_MARKETS_LEDGER);
  const patron = await currentPatron(request, env);
  if (!patron) return json({ error: "login_required" }, 401);
  return json({ configured: Boolean(patron.patronage_configured), patronage: patron.patronage_configured ? {
    budget_cents: patron.patronage_budget_cents,
    view_period: patron.patronage_view_period,
    view_limit: patron.patronage_view_limit,
    support_limit_cents: patron.patronage_support_limit_cents
  } : null });
}

export async function onRequestPost({ request, env }) {
  await ensureAuthSchema(env.STORY_MARKETS_LEDGER);
  const patron = await currentPatron(request, env);
  if (!patron) return json({ error: "login_required" }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const budget = Number(body.budget_cents);
  const supportLimit = Number(body.support_limit_cents);
  const viewLimit = Number(body.view_limit);
  const period = body.view_period;
  if (!Number.isInteger(budget) || budget < 500 || budget > 1000000) return json({ error: "budget_must_be_between_500_and_1000000_cents" }, 400);
  if (!Number.isInteger(supportLimit) || supportLimit < 0 || supportLimit > budget) return json({ error: "support_limit_must_not_exceed_budget" }, 400);
  if (!Number.isInteger(viewLimit) || viewLimit < 1 || viewLimit > 100) return json({ error: "view_limit_must_be_between_1_and_100" }, 400);
  if (period !== "daily" && period !== "weekly") return json({ error: "view_period_must_be_daily_or_weekly" }, 400);
  const now = new Date().toISOString();
  await env.STORY_MARKETS_LEDGER.prepare("UPDATE patrons SET patronage_configured=1, patronage_budget_cents=?, patronage_view_period=?, patronage_view_limit=?, patronage_support_limit_cents=?, patronage_configured_at=?, updated_at=? WHERE id=?").bind(budget, period, viewLimit, supportLimit, now, now, patron.id).run();
  return json({ saved: true, configured: true, patronage: { budget_cents: budget, view_period: period, view_limit: viewLimit, support_limit_cents: supportLimit } });
}