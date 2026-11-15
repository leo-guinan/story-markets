import { describe, expect, it } from 'vitest';
import { encryptSecret, decryptSecret, maskSecret, getBearerToken } from '../worker/security.js';

const testKey = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe('credential security', () => {
  it('encrypts provider secrets so plaintext is not present and round-trips', async () => {
    const encrypted = await encryptSecret('sk-or-v1-private-example', testKey);
    expect(JSON.stringify(encrypted)).not.toContain('sk-or-v1-private-example');
    expect(await decryptSecret(encrypted, testKey)).toBe('sk-or-v1-private-example');
  });
  it('uses a fresh nonce for each encryption', async () => {
    const a = await encryptSecret('same-key', testKey);
    const b = await encryptSecret('same-key', testKey);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });
  it('rejects invalid key material and tampered ciphertext', async () => {
    await expect(encryptSecret('secret', 'bad')).rejects.toThrow();
    const encrypted = await encryptSecret('secret-1', testKey);
    encrypted.ciphertext = `${encrypted.ciphertext.slice(0, -4)}AAAA`;
    await expect(decryptSecret(encrypted, testKey)).rejects.toThrow();
  });
  it('masks secrets and extracts only a Bearer token', () => {
    expect(maskSecret('sk-secret-12345')).toBe('••••••••2345');
    expect(getBearerToken(new Request('https://x', { headers: { authorization: 'Bearer token-value' } }))).toBe('token-value');
    expect(getBearerToken(new Request('https://x', { headers: { authorization: 'Basic abc' } }))).toBeNull();
  });
});
