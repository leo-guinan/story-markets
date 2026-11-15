import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as appModule from '../creator/src/App.jsx';

const appSource = readFileSync(new URL('../creator/src/App.jsx', import.meta.url), 'utf8');
const providerSource = readFileSync(new URL('../creator/src/main.jsx', import.meta.url), 'utf8');

describe('Privy identity and X account linking', () => {
  it('offers wallet and X as primary Privy login methods', () => {
    expect(providerSource).toMatch(/loginMethods:\s*\['wallet',\s*'twitter'\]/);
    expect(appSource).toMatch(/Sign in with a wallet or X/);
    expect(appSource).not.toContain('X is not a separate sign-in path.');
  });

  it('recognizes an X-authenticated Privy user as already linked', () => {
    const account = { type: 'twitter_oauth', username: 'example' };
    const finder = appModule.findTwitterAccount;
    expect(finder).toBeTypeOf('function');
    expect(typeof finder === 'function' ? finder({ linkedAccounts: [account] }) : null).toBe(account);
  });

  it('shows actionable, sanitized X OAuth failures', () => {
    const format = appModule.formatXLinkError;
    expect(format).toBeTypeOf('function');
    if (typeof format !== 'function') return;
    expect(format('linked_to_another_user')).toMatch(/already linked to another Privy account/i);
    expect(format('twitter provider disabled')).toMatch(/enable Twitter/i);
    expect(format('opaque internal failure')).not.toContain('opaque internal failure');
  });

  it('links X to the authenticated Privy identity through Privy account linking', () => {
    expect(appSource).toMatch(/useLinkAccount/);
    expect(appSource).toMatch(/linkTwitter/);
    expect(appSource).toMatch(/twitter_oauth/);
    expect(appSource).toMatch(/formatXLinkError\(error\)/);
    expect(appSource).not.toContain('/api/auth/x/start');
  });

  it('shows X linked state or account linking inside the authenticated workspace', () => {
    expect(appSource).toMatch(/if\s*\(!authenticated\)\s*return\s*<Login\s*\/>/);
    expect(appSource).toMatch(/<XAccountLink\s+user=\{user\}\s*\/>/);
    expect(appSource).not.toContain('Your wallet remains the sign-in.');
  });
});
