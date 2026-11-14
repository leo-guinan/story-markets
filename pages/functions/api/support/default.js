import { currentPatron, ensureAuthSchema } from "../../_shared/auth.js";
import { ensureFundingSchema, TOPUP_AMOUNTS } from "../../_shared/funding.js";

export async function onRequestPost({ request, env }) {
  await ensureAuthSchema(env.STORY_MARKETS_LEDGER); await ensureFundingSchema(env.STORY_MARKETS_LEDGER);
  const patron = await currentPatron(request, env); if (!patron) return Response.json({ error: "login_required" }, { status: 401 });
  let body; try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const cents = Number(body.default_support_cents);
  if (!Number.isInteger(cents) || !TOPUP_AMOUNTS.includes(cents)) return Response.json({ error: "unsupported_amount", allowed_cents: TOPUP_AMOUNTS }, { status: 422 });
  await env.STORY_MARKETS_LEDGER.prepare("UPDATE patrons SET default_support_cents=?, updated_at=? WHERE id=?").bind(cents, new Date().toISOString(), patron.id).run();
  return Response.json({ saved: true, default_support_cents: cents });
}
