import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditSnapshotFromReport, compareAuditToBaseline } from './release-check-lib.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagesRoot = path.resolve(process.env.STORY_MARKETS_PAGES_DIR || path.join(repoRoot, 'pages'));


function run(label, command, args) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${label} failed with exit code ${result.status}`);
}


function pagesSourceCheck() {
  console.log(`\n== Local Pages source check (${pagesRoot}) ==`);
  const files = [
    'index.html',
    'assets/artist-home.css',
    'assets/fathom-events.js',
    'battles/index.html',
    'functions/_middleware.js',
    'functions/_shared/creatorProxy.js',
    'functions/creator/[[path]].js',
    'functions/creator-api/[[path]].js',
    'functions/creator-assets/[[path]].js',
    'functions/creator.html.js',
    'wrangler.toml',
  ];
  for (const file of files) {
    try { readFileSync(path.join(pagesRoot, file)); }
    catch { throw new Error(`Pages release input is missing: ${file}`); }
  }
  const landing = readFileSync(path.join(pagesRoot, 'index.html'), 'utf8');
  const landingCss = readFileSync(path.join(pagesRoot, 'assets/artist-home.css'), 'utf8');
  if (!landing.includes('href="/creator"')) throw new Error('Landing page does not link to /creator');
  if (!/artist payouts/i.test(landing) || !/not open/i.test(landing)) throw new Error('Landing page must preserve the current payout/grant availability disclosure');
  for (const token of ['color-scheme: dark', '--paper: #111411', '--coral: #dfbd76', '--green: #9fceb2', "'Instrument Serif'", "'DM Sans'", "'DM Mono'"]) {
    if (!landingCss.includes(token)) throw new Error(`Landing page is missing Creator Studio design token ${token}`);
  }
  const config = readFileSync(path.join(pagesRoot, 'wrangler.toml'), 'utf8');
  for (const expected of [
    'pages_build_output_dir',
    'compatibility_date = "2026-02-25"',
    '[[env.production.services]]',
    'binding = "CREATOR_STUDIO"',
    'service = "story-markets-creator"',
    '[[env.production.d1_databases]]',
    'database_name = "story-markets-ledger"',
    'database_id = "e8956d67-feaa-434c-bcf3-d8fc154315be"',
    '[[env.production.r2_buckets]]',
    'bucket_name = "story-markets-videos"',
  ]) {
    if (!config.includes(expected)) throw new Error(`Pages production config is missing ${expected}`);
  }
  const workerConfig = readFileSync(path.join(repoRoot, 'wrangler.toml'), 'utf8');
  if (!workerConfig.includes('ALLOWED_ORIGIN = "https://story.markets,https://www.story.markets"')) throw new Error('Worker origin allowlist does not include both production hosts');
  console.log('Pages source paths, Creator proxy routes, production bindings, CTA, and availability disclosure passed.');
}

async function auditCheck() {
  console.log('\n== Production dependency audit baseline ==');
  const result = spawnSync('npm', ['audit', '--omit=dev', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  let report;
  try { report = JSON.parse(result.stdout); }
  catch { throw new Error(`npm audit returned no parseable JSON (exit ${result.status}); network/registry errors block release`); }
  if (!report.metadata?.vulnerabilities || report.error) throw new Error('npm audit did not return a complete report; release is blocked');
  const baseline = JSON.parse(readFileSync(path.join(repoRoot, 'docs/dependency-audit-baseline.json'), 'utf8'));
  const comparison = compareAuditToBaseline(report, baseline);
  console.log(`Current audit: ${JSON.stringify(comparison.current.counts)}; reviewed baseline: ${JSON.stringify(baseline.counts)}.`);
  console.log(`Known baseline findings: ${comparison.current.findings.length}; new findings: ${comparison.newFindings.length}; critical: ${comparison.criticalFindings.length}.`);
  if (comparison.newFindings.length) {
    for (const finding of comparison.newFindings) console.error(`NEW ${finding.severity}: ${finding.name} ${finding.range} ${finding.via.join(', ')}`);
  }
  if (!comparison.ok) throw new Error('New or critical dependency findings block this release; review the risk register and update dependencies first.');
  console.log('Existing findings match the explicitly reviewed baseline; they remain open risks, not a clean audit.');
}

try {
  run('Unit and integration tests', 'npm', ['test', '--', '--reporter=dot']);
  run('TypeScript check', 'npm', ['run', 'typecheck']);
  run('Production asset build', 'npm', ['run', 'build']);
  pagesSourceCheck();
  run('Local Pages/Worker service-binding integration', 'node', ['scripts/pages-integration-smoke.mjs']);
  run('Cloudflare Worker production dry-run', 'npx', ['wrangler', 'deploy', '--env', 'production', '--dry-run']);
  await auditCheck();
  console.log('\nRelease preflight passed. Deploy the authorized Pages artifact, then run `npm run release:smoke`.');
} catch (error) {
  console.error(`\nRelease preflight failed: ${error.message}`);
  process.exitCode = 1;
}
