import { ensureFutureRadioSchema, FUTURE_RADIO_PROJECT } from "../../_shared/funding.js";

const TARGET_CENTS = 300000;

export async function onRequestGet({ env }) {
  const db = env.STORY_MARKETS_LEDGER;
  await ensureFutureRadioSchema(db);
  const row = await db.prepare(
    "SELECT COALESCE(SUM(amount_cents), 0) AS funded_cents, COUNT(*) AS payment_count FROM future_radio_support WHERE project = ? AND status = 'paid' AND currency = 'usd'"
  ).bind(FUTURE_RADIO_PROJECT).first();
  const fundedCents = Number(row?.funded_cents || 0);
  return Response.json({
    project: FUTURE_RADIO_PROJECT,
    funded_cents: fundedCents,
    target_cents: TARGET_CENTS,
    payment_count: Number(row?.payment_count || 0),
    currency: "usd",
  }, { headers: { "Cache-Control": "no-store" } });
}
