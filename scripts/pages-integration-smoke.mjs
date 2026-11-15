import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { cp, copyFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparePagesStage } from './prepare-pages-stage.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagesRoot = path.resolve(process.env.STORY_MARKETS_PAGES_DIR || path.join(repoRoot, 'pages'));
const wrangler = path.join(repoRoot, 'node_modules', '.bin', 'wrangler');
const userAgent = 'story-markets-local-release-smoke/1.0';
const publicPageRoutes = [
  '/battles/',
  '/stories/',
  '/stories/attend-the-bloom-party/',
  '/stories/the-pro-ai-narrative/',
  '/stories/enchanted-notebook/',
  '/stories/arm-the-artists/',
  '/stories/the-annalea-cofounder-narrative/',
  '/patronage/',
  '/market-maker/',
  '/market-maker/battle/garcia-story-instinct-vs-factory-iteration/',
  '/market-maker/battle/ai-production-vs-human-disempowerment/',
  '/share/',
  '/share/lobow_spark/',
  '/share/leo_guinan/',
  '/gallery/',
  '/profile/',
];

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function launch(label, args, cwd) {
  const child = spawn(wrangler, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  return child;
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise((resolve) => child.once('close', resolve)), new Promise((resolve) => setTimeout(resolve, 3000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function request(base, pathname, headers = {}) {
  return fetch(new URL(pathname, base), {
    headers: { 'user-agent': userAgent, ...headers },
    redirect: 'follow',
    signal: AbortSignal.timeout(10000),
  });
}

async function waitFor(base, pathname, check, child, label) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`${label} exited early (${child.exitCode})`);
    try {
      const response = await request(base, pathname);
      const text = await response.text();
      if (check(response, text)) return { response, text };
    } catch { /* Wait for the local server to start. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${label} did not become ready within 20 seconds`);
}

let worker;
let pages;
let stageRoot;
let pagesProjectRoot;
try {
  const workerPort = await reservePort();
  worker = launch('creator-worker', ['dev', '--local', '--ip', '127.0.0.1', '--port', String(workerPort)], repoRoot);
  const workerBase = `http://127.0.0.1:${workerPort}`;
  const workerPage = await waitFor(workerBase, '/creator', (response, text) => response.status === 200 && text.includes('Future Radio Studio'), worker, 'local Creator Worker');

  const stage = await preparePagesStage(pagesRoot);
  stageRoot = stage.stageRoot;
  console.log(`[pages-stage] ${stage.fileCount} public files, ${stage.totalBytes} bytes, SHA-256 ${stage.sha256}`);
  pagesProjectRoot = await mkdtemp(path.join(path.dirname(stageRoot), 'story-markets-pages-dev-'));
  await cp(path.join(pagesRoot, 'functions'), path.join(pagesProjectRoot, 'functions'), { recursive: true });
  await copyFile(path.join(pagesRoot, 'wrangler.toml'), path.join(pagesProjectRoot, 'wrangler.toml'));
  const pagesPort = await reservePort();
  pages = launch('pages', [
    'pages', 'dev', stageRoot,
    '--ip', '127.0.0.1',
    '--port', String(pagesPort),
    '--compatibility-date', '2026-11-10',
    '--service', 'CREATOR_STUDIO=story-markets-creator-local',
  ], pagesProjectRoot);
  const pagesBase = `http://127.0.0.1:${pagesPort}`;
  const landing = await waitFor(pagesBase, '/', (response, text) => response.status === 200 && text.includes('href="/creator"'), pages, 'local Pages');
  if (!/artist payouts/i.test(landing.text) || !/not open/i.test(landing.text)) {
    const title = landing.text.match(/<title[^>]*>(.*?)<\/title>/i)?.[1] || '(missing)';
    throw new Error(`Landing page lost the availability disclosure (artist-payouts=${/artist payouts/i.test(landing.text)}, not-open=${/not open/i.test(landing.text)}, chars=${landing.text.length}, title=${title})`);
  }
  for (const [pathname, expectedType] of [['/assets/artist-home.css', 'text/css'], ['/assets/fathom-events.js', 'javascript']]) {
    const asset = await request(pagesBase, pathname);
    if (asset.status !== 200 || !(asset.headers.get('content-type') || '').includes(expectedType)) throw new Error(`Landing asset ${pathname} failed (${asset.status})`);
  }

  const creator = await request(pagesBase, '/creator');
  if (creator.status !== 200) throw new Error(`Pages /creator returned ${creator.status}`);
  const creatorHtml = await creator.text();
  if (!creatorHtml.includes('Future Radio Studio')) throw new Error('Pages /creator did not reach the Creator Worker through the service binding');
  const scriptPath = creatorHtml.match(/<script[^>]+src="([^"]+)"/i)?.[1];
  const stylePath = creatorHtml.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/i)?.[1];
  if (!scriptPath?.startsWith('/creator-assets/') || !stylePath?.startsWith('/creator-assets/')) throw new Error('Creator assets are not under the namespaced path');
  const [script, style] = await Promise.all([request(pagesBase, scriptPath), request(pagesBase, stylePath)]);
  if (script.status !== 200 || !/javascript|ecmascript/i.test(script.headers.get('content-type') || '')) throw new Error(`Creator script check failed (${script.status})`);
  if (style.status !== 200 || !(style.headers.get('content-type') || '').includes('text/css')) throw new Error(`Creator stylesheet check failed (${style.status})`);

  const origin = 'https://story.markets';
  const api = await request(pagesBase, '/creator-api/narratives', { origin });
  if (api.status !== 401) throw new Error(`${origin} unauthenticated API returned ${api.status}, expected 401`);
  if (api.headers.get('access-control-allow-origin') !== origin) throw new Error(`Creator API did not allow configured origin ${origin}`);
  const apiBody = await api.json();
  if (apiBody.error !== 'Authentication required') throw new Error('Unauthenticated API did not fail closed');
  const creatorAlias = await request(pagesBase, '/creator.html');
  if (creatorAlias.status !== 200 || !(await creatorAlias.text()).includes('Future Radio Studio')) throw new Error('Pages /creator.html did not reach the Creator Worker');
  for (const pathname of publicPageRoutes) {
    const response = await request(pagesBase, pathname);
    if (response.status !== 200) throw new Error(`Preserved Pages route ${pathname} returned ${response.status}`);
  }
  const stories = await request(pagesBase, '/data/future-radio/stories.json');
  if (stories.status !== 200 || !(await stories.json()).stories?.length) throw new Error('Public story catalog was not preserved');
  const publicReceipt = await request(pagesBase, '/market-maker/garcia-public-reply-receipt.json');
  if (publicReceipt.status !== 200) throw new Error(`Public reply receipt returned ${publicReceipt.status}`);
  const privatePaths = ['/.dev.vars', '/readme.md', '/package.json', '/functions/_middleware.js', '/scripts/', '/data/future-radio/source-receipt.json'];
  for (const pathname of privatePaths) {
    const response = await request(pagesBase, pathname);
    if (response.status !== 404) throw new Error(`Private Pages path ${pathname} returned ${response.status}, expected 404`);
  }
  console.log(`PASS local Pages service binding: landing/assets, Creator HTML+JS+CSS, API 401/CORS, ${publicPageRoutes.length} preserved public page routes plus public data, ${privatePaths.length} private-path 404s (direct Worker served ${workerPage.response.status}).`);
} catch (error) {
  console.error(`Local Pages/Worker integration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await stop(pages);
  await stop(worker);
  if (stageRoot) await rm(stageRoot, { recursive: true, force: true });
  if (pagesProjectRoot) await rm(pagesProjectRoot, { recursive: true, force: true });
}
