import { currentPatron, ensureAuthSchema } from "../../_shared/auth.js";

export async function onRequestPost({ request, env }) {
  await ensureAuthSchema(env.STORY_MARKETS_LEDGER);
  const patron = await currentPatron(request, env);
  if (!patron) return Response.json({ error: "login_required" }, { status: 401 });
  if (!env.STRIPE_SECRET_KEY) return Response.json({ error: "payment_not_configured" }, { status: 503 });
  let payload;
  try { payload = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const sessionId = typeof payload.session_id === "string" ? payload.session_id : "";
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return Response.json({ error: "invalid_session" }, { status: 400 });

  const sessionResponse = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  if (!sessionResponse.ok) return Response.json({ error: "session_not_found" }, { status: 404 });
  const session = await sessionResponse.json();
  if (session.payment_status !== "paid") return Response.json({ error: "payment_not_verified" }, { status: 409 });
  const paymentLinkResponse = session.payment_link ? await fetch(`https://api.stripe.com/v1/payment_links/${encodeURIComponent(session.payment_link)}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }) : null;
  const paymentLink = paymentLinkResponse?.ok ? await paymentLinkResponse.json() : null;
  const filmKey = paymentLink?.metadata?.film_key || "";
  if (!["youth_sports", "information_wars"].includes(filmKey)) return Response.json({ error: "unknown_film" }, { status: 422 });

  await env.STORY_MARKETS_LEDGER.prepare(`
    INSERT OR IGNORE INTO support_attributions (session_id, patron_id, film_key, amount_cents, currency, claimed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(session.id, patron.id, filmKey, Number(session.amount_total || 0), session.currency || "usd", new Date().toISOString()).run();
  const count = await env.STORY_MARKETS_LEDGER.prepare("SELECT COUNT(*) AS count FROM support_attributions WHERE patron_id = ?").bind(patron.id).first();
  return Response.json({ attributed: true, film_key: filmKey, badge: Number(count?.count || 0) >= 1 ? "early_patron" : null });
}
