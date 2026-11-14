import { currentPatron, ensureAuthSchema } from "../_shared/auth.js";

export async function onRequestGet({ request, env }) {
  await ensureAuthSchema(env.STORY_MARKETS_LEDGER);
  const patron = await currentPatron(request, env);
  return Response.json({ authenticated: Boolean(patron), patron: patron ? { username: patron.x_username, name: patron.x_name, public_badge: Boolean(patron.public_badge), patronage_configured: Boolean(patron.patronage_configured), patronage: patron.patronage_configured ? { budget_cents: patron.patronage_budget_cents, view_period: patron.patronage_view_period, view_limit: patron.patronage_view_limit, support_limit_cents: patron.patronage_support_limit_cents } : null } : null });
}
