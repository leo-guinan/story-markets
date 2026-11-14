import { currentPatron, ensureAuthSchema } from "../../_shared/auth.js";
import { ensureFundingSchema, validAmount } from "../../_shared/funding.js";

export async function onRequestPost({ request, env }) {
  await ensureAuthSchema(env.STORY_MARKETS_LEDGER); await ensureFundingSchema(env.STORY_MARKETS_LEDGER);
  const patron = await currentPatron(request, env);
  if (!patron) return Response.json({ error: "login_required" }, { status: 401 });
  if (!env.STRIPE_SECRET_KEY) return Response.json({ error: "payment_not_configured" }, { status: 503 });
  let body; try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const amountCents = Number(body.amount_cents);
  if (!validAmount(amountCents)) return Response.json({ error: "unsupported_amount", allowed_cents: [500,1000,2500,5000,10000] }, { status: 422 });
  const origin = new URL(request.url).origin;
  const form = new URLSearchParams();
  form.set("mode", "payment"); form.set("success_url", `${origin}/?topup=success&session_id={CHECKOUT_SESSION_ID}`); form.set("cancel_url", `${origin}/?topup=cancelled`);
  form.set("line_items[0][price_data][currency]", "usd"); form.set("line_items[0][price_data][product_data][name]", "Story Markets account funding"); form.set("line_items[0][price_data][product_data][description]", "Non-refundable creator-support balance; allocations remain subject to platform payout policy."); form.set("line_items[0][price_data][unit_amount]", String(amountCents)); form.set("line_items[0][quantity]", "1");
  form.set("metadata[kind]", "account_topup"); form.set("metadata[patron_id]", patron.id); form.set("metadata[currency]", "usd");
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
  if (!response.ok) return Response.json({ error: "checkout_unavailable" }, { status: 502 });
  const session = await response.json();
  return Response.json({ checkout_url: session.url, session_id: session.id, amount_cents: amountCents });
}
