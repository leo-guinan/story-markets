import { currentPatron, ensureAuthSchema } from "../../_shared/auth.js";
import { ensureFundingSchema } from "../../_shared/funding.js";

const CREATOR_HANDLES = new Set(["leo_guinan", "lobow_spark"]);
export async function onRequestPost({ request, env }) {
  await ensureAuthSchema(env.STORY_MARKETS_LEDGER); await ensureFundingSchema(env.STORY_MARKETS_LEDGER);
  const patron = await currentPatron(request, env);
  if (!patron) return Response.json({ error: "login_required" }, { status: 401 });
  if (!CREATOR_HANDLES.has(patron.x_username.toLowerCase())) return Response.json({ error: "creator_onboarding_required" }, { status: 403 });
  if (!env.STRIPE_SECRET_KEY) return Response.json({ error: "payment_not_configured" }, { status: 503 });
  const db = env.STORY_MARKETS_LEDGER;
  let account = await db.prepare("SELECT * FROM creator_payout_accounts WHERE patron_id=?").bind(patron.id).first();
  if (!account) {
    const createForm = new URLSearchParams({ type: "express", country: "US", "capabilities[transfers][requested]": "true", business_type: "individual", "metadata[patron_id]": patron.id });
    const response = await fetch("https://api.stripe.com/v1/accounts", { method: "POST", headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body: createForm });
    if (!response.ok) return Response.json({ error: "connect_account_unavailable" }, { status: 502 });
    const created = await response.json(); account = { stripe_account_id: created.id, charges_enabled: 0, payouts_enabled: 0 };
    await db.prepare("INSERT INTO creator_payout_accounts (patron_id,stripe_account_id,charges_enabled,payouts_enabled,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(patron.id, created.id, 0, 0, new Date().toISOString(), new Date().toISOString()).run();
  }
  const accountResponse = await fetch(`https://api.stripe.com/v1/accounts/${encodeURIComponent(account.stripe_account_id)}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  if (accountResponse.ok) {
    const live = await accountResponse.json(); account.charges_enabled = live.charges_enabled ? 1 : 0; account.payouts_enabled = live.payouts_enabled ? 1 : 0;
    await db.prepare("UPDATE creator_payout_accounts SET charges_enabled=?, payouts_enabled=?, updated_at=? WHERE patron_id=?").bind(account.charges_enabled, account.payouts_enabled, new Date().toISOString(), patron.id).run();
  }
  const origin = new URL(request.url).origin;
  const linkForm = new URLSearchParams({ account: account.stripe_account_id, refresh_url: `${origin}/profile/?payouts=retry`, return_url: `${origin}/profile/?payouts=complete`, type: "account_onboarding" });
  const linkResponse = await fetch("https://api.stripe.com/v1/account_links", { method: "POST", headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" }, body: linkForm });
  if (!linkResponse.ok) return Response.json({ error: "connect_link_unavailable" }, { status: 502 });
  const link = await linkResponse.json(); return Response.json({ onboarding_url: link.url, stripe_account_id: account.stripe_account_id, charges_enabled: account.charges_enabled, payouts_enabled: account.payouts_enabled });
}
