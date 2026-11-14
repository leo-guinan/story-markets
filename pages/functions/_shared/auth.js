const encoder = new TextEncoder();

export function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToHex(value);
}

export async function sha256(value) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export function base64Url(buffer) {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function pkceChallenge(verifier) {
  return base64Url(await crypto.subtle.digest("SHA-256", encoder.encode(verifier)));
}

export async function encrypt(value, secret) {
  const keyBytes = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value));
  return `${base64Url(iv)}.${base64Url(ciphertext)}`;
}

export async function decrypt(value, secret) {
  const [ivPart, dataPart] = value.split(".");
  const decode = (part) => Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/") + "=="), (c) => c.charCodeAt(0));
  const keyBytes = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(ivPart) }, key, decode(dataPart));
  return new TextDecoder().decode(plaintext);
}

export function cookieValue(request, name) {
  const cookies = request.headers.get("Cookie") || "";
  return cookies.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || "";
}

export function sessionCookie(token, maxAge = 60 * 60 * 24 * 30) {
  return `story_session=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

export const authSchema = `
CREATE TABLE IF NOT EXISTS x_auth_states (
  state_hash TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS patrons (
  id TEXT PRIMARY KEY,
  x_user_id TEXT NOT NULL UNIQUE,
  x_username TEXT NOT NULL,
  x_name TEXT NOT NULL,
  x_access_token TEXT,
  x_refresh_token TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  public_badge INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS sessions (
  session_hash TEXT PRIMARY KEY,
  patron_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS support_attributions (
  session_id TEXT PRIMARY KEY,
  patron_id TEXT NOT NULL,
  film_key TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  claimed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS creator_videos (
  id TEXT PRIMARY KEY,
  creator_handle TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  tweet_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  in_battle INTEGER NOT NULL DEFAULT 0,
  uploaded_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
`;

export async function ensureAuthSchema(db) {
  for (const statement of authSchema.split(";").map((part) => part.trim()).filter(Boolean)) await db.prepare(statement).run();
  try { await db.prepare("ALTER TABLE patrons ADD COLUMN default_support_cents INTEGER NOT NULL DEFAULT 500").run(); } catch {}
  try { await db.prepare("ALTER TABLE patrons ADD COLUMN patronage_configured INTEGER NOT NULL DEFAULT 0").run(); } catch {}
  try { await db.prepare("ALTER TABLE patrons ADD COLUMN patronage_budget_cents INTEGER").run(); } catch {}
  try { await db.prepare("ALTER TABLE patrons ADD COLUMN patronage_view_period TEXT").run(); } catch {}
  try { await db.prepare("ALTER TABLE patrons ADD COLUMN patronage_view_limit INTEGER").run(); } catch {}
  try { await db.prepare("ALTER TABLE patrons ADD COLUMN patronage_support_limit_cents INTEGER").run(); } catch {}
  try { await db.prepare("ALTER TABLE patrons ADD COLUMN patronage_configured_at TEXT").run(); } catch {}
}

export async function currentPatron(request, env) {
  const raw = cookieValue(request, "story_session");
  if (!raw) return null;
  const db = env.STORY_MARKETS_LEDGER;
  const session = await db.prepare("SELECT patron_id FROM sessions WHERE session_hash = ? AND expires_at > ?").bind(await sha256(raw), Math.floor(Date.now() / 1000)).first();
  if (!session) return null;
  return db.prepare("SELECT id, x_user_id, x_username, x_name, public_badge, patronage_configured, patronage_budget_cents, patronage_view_period, patronage_view_limit, patronage_support_limit_cents FROM patrons WHERE id = ?").bind(session.patron_id).first();
}
