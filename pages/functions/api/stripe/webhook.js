import { ensureFundingSchema, ensureFutureRadioSchema, ensureDirectSupportSchema, FUTURE_RADIO_PROJECT, STORY_MARKETS_CONTINUATION_PROJECT, ENCHANTED_NOTEBOOK_PROJECT } from "../../_shared/funding.js";

const FILMS = new Set(["youth_sports", "information_wars"]);

const schema = `
CREATE TABLE IF NOT EXISTS payment_events (
  event_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  film_key TEXT NOT NULL,
  supporter_name TEXT NOT NULL,
  supporter_url TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_events_film_status
  ON payment_events (film_key, status, created_at);
`;

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function verifyStripeSignature(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const parts = signature.split(",");
  const timestamp = parts.find((part) => part.startsWith("t="))?.slice(2);
  const signatures = parts.filter((part) => part.startsWith("v1=")).map((part) => part.slice(3));
  if (!timestamp || !signatures.length) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const expected = hex(digest);
  return signatures.some((candidate) => safeEqual(candidate, expected));
}

function customField(session, key) {
  const field = (session.custom_fields || []).find((item) => item.key === key);
  return field?.text?.value?.trim() || "";
}

function validPublicUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.length > 0;
  } catch {
    return false;
  }
}

async function ensureSchema(db) {
  for (const statement of schema.split(";").map((part) => part.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
}

export async function onRequestPost({ request, env }) {
  const rawBody = await request.text();
  const signature = request.headers.get("Stripe-Signature");
  if (!(await verifyStripeSignature(rawBody, signature, env.STRIPE_WEBHOOK_SECRET))) {
    return new Response("invalid signature", { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return Response.json({ received: true, ignored: true });
  }

  const session = event.data?.object;
  if (!session || session.payment_status !== "paid") {
    return Response.json({ received: true, ignored: true, reason: "not_paid" });
  }

  if (session.metadata?.kind === "account_topup") {
    const patronId = session.metadata?.patron_id || "";
    const amount = Number(session.amount_total || 0);
    if (!/^[-A-Za-z0-9_]{8,200}$/.test(patronId) || !Number.isInteger(amount) || amount < 1) return new Response("invalid account topup", { status: 422 });
    const db = env.STORY_MARKETS_LEDGER;
    await ensureFundingSchema(db);
    await db.prepare("INSERT OR IGNORE INTO account_topups (session_id,event_id,patron_id,amount_cents,currency,status,created_at) VALUES (?,?,?,?,?,?,?)").bind(session.id,event.id,patronId,amount,session.currency||"usd","paid",new Date((event.created||Math.floor(Date.now()/1000))*1000).toISOString()).run();
    return Response.json({ received: true, recorded: true, kind: "account_topup" });
  }

  if ([STORY_MARKETS_CONTINUATION_PROJECT, ENCHANTED_NOTEBOOK_PROJECT].includes(session.metadata?.project)) {
    const amount = Number(session.amount_total || 0);
    const currency = String(session.currency || "usd").toLowerCase();
    if (!session.id || !Number.isInteger(amount) || amount < 1 || currency !== "usd") return new Response("invalid direct support payment", { status: 422 });
    const db = env.STORY_MARKETS_LEDGER;
    await ensureDirectSupportSchema(db);
    const project = session.metadata.project;
    await db.prepare("INSERT OR IGNORE INTO direct_support_events (event_id,session_id,project,amount_cents,currency,status,created_at) VALUES (?,?,?,?,?,'paid',?)").bind(event.id, session.id, project, amount, currency, new Date((event.created || Math.floor(Date.now() / 1000)) * 1000).toISOString()).run();
    return Response.json({ received: true, recorded: true, kind: project });
  }

  if (session.metadata?.project === FUTURE_RADIO_PROJECT) {
    const amount = Number(session.amount_total || 0);
    const currency = String(session.currency || "usd").toLowerCase();
    if (!session.id || !Number.isInteger(amount) || amount < 1 || currency !== "usd") return new Response("invalid Future Radio payment", { status: 422 });
    const db = env.STORY_MARKETS_LEDGER;
    await ensureFutureRadioSchema(db);
    await db.prepare("INSERT OR IGNORE INTO future_radio_support (event_id,session_id,project,amount_cents,currency,status,created_at) VALUES (?,?,?,?,?,'paid',?)").bind(event.id, session.id, FUTURE_RADIO_PROJECT, amount, currency, new Date((event.created || Math.floor(Date.now() / 1000)) * 1000).toISOString()).run();
    return Response.json({ received: true, recorded: true, kind: "future_radio_support" });
  }

  let filmKey = session.metadata?.film_key || "";
  if (!filmKey && session.payment_link && env.STRIPE_SECRET_KEY) {
    const paymentLinkResponse = await fetch(`https://api.stripe.com/v1/payment_links/${encodeURIComponent(session.payment_link)}`, {
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` }
    });
    if (paymentLinkResponse.ok) {
      const paymentLink = await paymentLinkResponse.json();
      filmKey = paymentLink.metadata?.film_key || "";
    }
  }
  const supporterName = customField(session, "supporter_name");
  const supporterUrl = customField(session, "supporter_url");
  if (!FILMS.has(filmKey) || supporterName.length < 1 || supporterName.length > 120 || !validPublicUrl(supporterUrl) || supporterUrl.length > 500) {
    return new Response("paid session missing valid credit fields", { status: 422 });
  }

  const db = env.STORY_MARKETS_LEDGER;
  await ensureSchema(db);
  await db.prepare(`
    INSERT OR IGNORE INTO payment_events
      (event_id, session_id, film_key, supporter_name, supporter_url, amount_cents, currency, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_review', ?)
  `).bind(
    event.id,
    session.id,
    filmKey,
    supporterName,
    supporterUrl,
    Number(session.amount_total || 0),
    session.currency || "usd",
    new Date((event.created || Math.floor(Date.now() / 1000)) * 1000).toISOString()
  ).run();

  return Response.json({ received: true, recorded: true });
}
