import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../creator/src/App.jsx', import.meta.url), 'utf8');
const providerSource = readFileSync(new URL('../creator/src/main.jsx', import.meta.url), 'utf8');

describe('Privy identity and X account linking', () => {
  it('keeps wallet login as the only primary Privy login method', () => {
    expect(providerSource).toMatch(/loginMethods:\s*\['wallet'\]/);
    expect(providerSource).not.toMatch(/loginMethods:\s*\[[^\]]*['"]twitter['"]/);
  });

  it('links X to the authenticated Privy user through Privy account linking', () => {
    expect(appSource).toMatch(/useLinkAccount/);
    expect(appSource).toMatch(/linkTwitter/);
    expect(appSource).toMatch(/twitter_oauth/);
    expect(appSource).not.toContain('/api/auth/x/start');
  });

  it('shows X linking in the authenticated workspace, not as a separate login', () => {
    expect(appSource).toMatch(/if\s*\(!authenticated\)\s*return\s*<Login\s*\/>/);
    expect(appSource).toMatch(/<XAccountLink\s+user=\{user\}\s*\/>/);
  });
});
