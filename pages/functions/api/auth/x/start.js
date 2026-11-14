import { ensureAuthSchema, pkceChallenge, randomToken, sha256 } from "../../../_shared/auth.js";

export async function onRequestGet({ request, env }) {
  if (!env.X_CLIENT_ID || !env.X_CLIENT_SECRET || !env.X_TOKEN_ENCRYPTION_KEY) return new Response("X login is not configured", { status: 503 });
  const db = env.STORY_MARKETS_LEDGER;
  await ensureAuthSchema(db);
  try { await db.prepare("ALTER TABLE x_auth_states ADD COLUMN return_to TEXT NOT NULL DEFAULT '/'").run(); } catch {}
  await db.prepare("DELETE FROM x_auth_states WHERE expires_at <= ?").bind(Math.floor(Date.now() / 1000)).run();
  const state = randomToken(32);
  const verifier = randomToken(48);
  const requestUrl = new URL(request.url);
  const requestedReturn = requestUrl.searchParams.get("return_to") || "/";
  const returnTo = /^\/market-maker(?:\/battle\/[a-z0-9-]+\/?)?\/?$/.test(requestedReturn) ? requestedReturn : "/";
  await db.prepare("INSERT INTO x_auth_states (state_hash, code_verifier, return_to, expires_at) VALUES (?, ?, ?, ?)").bind(await sha256(state), verifier, returnTo, Math.floor(Date.now() / 1000) + 600).run();
  const url = new URL("https://x.com/i/oauth2/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.X_CLIENT_ID);
  url.searchParams.set("redirect_uri", "https://story.markets/api/auth/x/callback");
  url.searchParams.set("scope", "tweet.read users.read follows.read offline.access");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", await pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  return Response.redirect(url.toString(), 302);
}
