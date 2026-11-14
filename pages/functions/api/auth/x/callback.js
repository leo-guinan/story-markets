import { currentPatron, encrypt, ensureAuthSchema, randomToken, sessionCookie, sha256 } from "../../../_shared/auth.js";

const redirect = (path) => Response.redirect(`https://story.markets${path}`, 302);

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || !env.X_CLIENT_ID || !env.X_CLIENT_SECRET || !env.X_TOKEN_ENCRYPTION_KEY) return redirect("/?login=failed");
  const db = env.STORY_MARKETS_LEDGER;
  await ensureAuthSchema(db);
  const stateRow = await db.prepare("SELECT code_verifier, return_to FROM x_auth_states WHERE state_hash = ? AND expires_at > ?").bind(await sha256(state), Math.floor(Date.now() / 1000)).first();
  if (!stateRow) return redirect("/?login=expired");
  await db.prepare("DELETE FROM x_auth_states WHERE state_hash = ?").bind(await sha256(state)).run();

  const basic = btoa(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`);
  const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, grant_type: "authorization_code", client_id: env.X_CLIENT_ID, redirect_uri: "https://story.markets/api/auth/x/callback", code_verifier: stateRow.code_verifier })
  });
  if (!tokenResponse.ok) return redirect("/?login=token_failed");
  const tokens = await tokenResponse.json();
  const profileResponse = await fetch("https://api.x.com/2/users/me?user.fields=name,username", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  if (!profileResponse.ok) return redirect(`/?login=profile_failed&status=${profileResponse.status}`);
  const profile = (await profileResponse.json()).data;
  if (!profile?.id || !profile.username) return redirect("/?login=profile_failed");

  const now = new Date().toISOString();
  const patronId = `patron_${randomToken(16)}`;
  const accessToken = await encrypt(tokens.access_token, env.X_TOKEN_ENCRYPTION_KEY);
  const refreshToken = tokens.refresh_token ? await encrypt(tokens.refresh_token, env.X_TOKEN_ENCRYPTION_KEY) : null;
  await db.prepare(`
    INSERT INTO patrons (id, x_user_id, x_username, x_name, x_access_token, x_refresh_token, created_at, updated_at, public_badge)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(x_user_id) DO UPDATE SET x_username=excluded.x_username, x_name=excluded.x_name, x_access_token=excluded.x_access_token, x_refresh_token=excluded.x_refresh_token, updated_at=excluded.updated_at
  `).bind(patronId, profile.id, profile.username, profile.name || profile.username, accessToken, refreshToken, now, now).run();
  const patron = await db.prepare("SELECT id FROM patrons WHERE x_user_id = ?").bind(profile.id).first();
  const sessionToken = randomToken(32);
  await db.prepare("INSERT INTO sessions (session_hash, patron_id, expires_at, created_at) VALUES (?, ?, ?, ?)").bind(await sha256(sessionToken), patron.id, Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, now).run();
  const returnTo = /^\/market-maker(?:\/battle\/[a-z0-9-]+\/?)?\/?$/.test(stateRow.return_to || "") ? stateRow.return_to : "/";
  const configured = Boolean((await db.prepare("SELECT patronage_configured FROM patrons WHERE id=?").bind(patron.id).first())?.patronage_configured);
  const location = configured ? returnTo : `/patronage/?return_to=${encodeURIComponent(returnTo)}`;
  return new Response(null, { status: 302, headers: { Location: `https://story.markets${location}`, "Set-Cookie": sessionCookie(sessionToken) } });
}
