import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('../creator/src/App.jsx', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
const workerConfig = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');

describe('same-origin Creator Studio mounting contract', () => {
  it('sends every Creator API call through its non-conflicting path prefix', () => {
    const apiCalls = [...appSource.matchAll(/api\(([\'"`])([^\'"`]+)\1/g)].map((match) => match[2]);
    expect(apiCalls.length).toBeGreaterThan(0);
    expect(apiCalls.every((path) => path.startsWith('/creator-api/'))).toBe(true);
  });

  it('builds static assets under a namespaced prefix and proxies the API prefix locally', () => {
    expect(viteConfig).toMatch(/base:\s*['"]\/creator-assets\/['"]/);
    expect(viteConfig).toMatch(/proxy:\s*\{\s*['"]\/creator-api['"]:/);
  });

  it('runs the Creator Worker first only for the namespaced Creator paths', () => {
    expect(workerConfig).toMatch(/run_worker_first\s*=\s*\["\/creator\*"\]/);
    expect(workerConfig).toMatch(/pattern\s*=\s*"story\.markets\/creator\*"/);
    expect(workerConfig).toMatch(/pattern\s*=\s*"www\.story\.markets\/creator\*"/);
  });
});
