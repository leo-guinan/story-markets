function decodeBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Encryption key must be base64-encoded 32-byte key material');
  const decoded = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  if (decoded.length !== 32) throw new Error('Encryption key must decode to exactly 32 bytes');
  return decoded;
}

async function importAesKey(base64Key, usage) {
  return crypto.subtle.importKey('raw', decodeBase64(base64Key), { name: 'AES-GCM' }, false, [usage]);
}

function toBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function encryptSecret(secret, base64Key) {
  if (typeof secret !== 'string' || secret.length < 8 || secret.length > 4096) throw new Error('Credential must be between 8 and 4096 characters');
  const key = await importAesKey(base64Key, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret));
  return { version: 1, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

export async function decryptSecret(encrypted, base64Key) {
  if (!encrypted || encrypted.version !== 1 || typeof encrypted.iv !== 'string' || typeof encrypted.ciphertext !== 'string') throw new Error('Unsupported encrypted credential format');
  const key = await importAesKey(base64Key, 'decrypt');
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Uint8Array.from(atob(encrypted.iv), (c) => c.charCodeAt(0)) }, key, Uint8Array.from(atob(encrypted.ciphertext), (c) => c.charCodeAt(0)));
  return new TextDecoder().decode(plaintext);
}

export function maskSecret(secret) {
  if (typeof secret !== 'string' || !secret.length) return '••••••••';
  return `••••••••${secret.slice(-4)}`;
}

export function getBearerToken(request) {
  const value = request.headers.get('authorization') || '';
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(value);
  return match ? match[1] : null;
}

const privyJwksByApp = new Map();

async function getPrivyJwks(appId) {
  let jwks = privyJwksByApp.get(appId);
  if (!jwks) {
    const { createRemoteJWKSet } = await import('jose');
    jwks = createRemoteJWKSet(
      new URL(`https://auth.privy.io/v1/apps/${encodeURIComponent(appId)}/jwks.json`),
      {
        cacheMaxAge: 60 * 60 * 1000,
        cooldownDuration: 10 * 60 * 1000,
        headers: { 'privy-client': 'node:0.39.0' }, // Keep aligned with the pinned @privy-io/node version.
      },
    );
    privyJwksByApp.set(appId, jwks);
  }
  return jwks;
}

export async function authenticate(request, env) {
  const token = getBearerToken(request);
  if (!token) return null;
  if (!env.PRIVY_APP_ID) throw new Error('Privy authentication is not configured');
  const { verifyAccessToken } = await import('@privy-io/node');
  const verificationKey = env.PRIVY_VERIFICATION_KEY
    ? env.PRIVY_VERIFICATION_KEY.replace(/\\n/g, '\n')
    : await getPrivyJwks(env.PRIVY_APP_ID);
  const claims = await verifyAccessToken({ access_token: token, app_id: env.PRIVY_APP_ID, verification_key: verificationKey });
  if (!claims?.user_id || claims.app_id !== env.PRIVY_APP_ID || claims.issuer !== 'privy.io' || claims.expiration <= Math.floor(Date.now() / 1000)) return null;
  return claims.user_id;
}
