const userAgent = 'story-markets-release-smoke/1.0';
const baseArg = process.argv.find((arg) => arg.startsWith('--base-url='))?.slice('--base-url='.length)
  || process.env.RELEASE_BASE_URL
  || 'https://story.markets';
const apiOriginArg = process.argv.find((arg) => arg.startsWith('--api-origin='))?.slice('--api-origin='.length);
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function get(base, pathname, extraHeaders = {}) {
  return fetch(new URL(pathname, base), {
    headers: { 'user-agent': userAgent, ...extraHeaders },
    redirect: 'follow',
    signal: AbortSignal.timeout(15000),
  });
}

async function verifyHost(base) {
  const origin = new URL(base).origin;
  const apiOrigin = apiOriginArg ? new URL(apiOriginArg).origin : origin;
  const root = await get(base, '/');
  assert(root.status === 200, `${origin}/ returned ${root.status}`);
  const rootHtml = await root.text();
  assert(rootHtml.includes('href="/creator"'), `${origin}/ is missing the Creator CTA`);
  assert(/artist payouts/i.test(rootHtml) && /not open/i.test(rootHtml), `${origin}/ lost the payout/grant availability disclosure`);

  for (const pathname of publicPageRoutes) {
    const response = await get(base, pathname);
    assert(response.status === 200, `${origin}${pathname} returned ${response.status}`);
  }
  const storyCatalog = await get(base, '/data/future-radio/stories.json');
  assert(storyCatalog.status === 200, `${origin}/data/future-radio/stories.json returned ${storyCatalog.status}`);
  assert((await storyCatalog.json()).stories?.length > 0, `${origin} story catalog is empty or malformed`);
  const publicReceipt = await get(base, '/market-maker/garcia-public-reply-receipt.json');
  assert(publicReceipt.status === 200, `${origin}/market-maker/garcia-public-reply-receipt.json returned ${publicReceipt.status}`);
  const soundtrack = await get(base, '/media/when-im-not-in-the-room.mp3');
  assert(soundtrack.status === 200, `${origin}/media/when-im-not-in-the-room.mp3 returned ${soundtrack.status}`);
  assert((soundtrack.headers.get('content-type') || '').includes('audio/mpeg'), `${origin} public soundtrack has unexpected content type`);
  const audioReader = soundtrack.body?.getReader();
  if (audioReader) {
    const firstAudioChunk = await audioReader.read();
    assert(!firstAudioChunk.done && firstAudioChunk.value.byteLength > 0, `${origin} public soundtrack has an empty body`);
    await audioReader.cancel();
  }

  const creator = await get(base, '/creator');
  assert(creator.status === 200, `${origin}/creator returned ${creator.status}`);
  assert((creator.headers.get('content-type') || '').includes('text/html'), `${origin}/creator is not HTML`);
  const creatorHtml = await creator.text();
  assert(creatorHtml.includes('Future Radio Studio'), `${origin}/creator did not serve the Creator app`);
  const scriptPath = creatorHtml.match(/<script[^>]+src="([^"]+)"/i)?.[1];
  const stylePath = creatorHtml.match(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/i)?.[1];
  assert(scriptPath?.startsWith('/creator-assets/'), `${origin}/creator script is not under /creator-assets/`);
  assert(stylePath?.startsWith('/creator-assets/'), `${origin}/creator stylesheet is not under /creator-assets/`);
  const [script, style] = await Promise.all([get(base, scriptPath), get(base, stylePath)]);
  assert(script.status === 200, `${origin}${scriptPath} returned ${script.status}`);
  assert((script.headers.get('content-type') || '').match(/javascript|ecmascript/i), `${origin}${scriptPath} is not JavaScript`);
  assert(style.status === 200, `${origin}${stylePath} returned ${style.status}`);
  assert((style.headers.get('content-type') || '').includes('text/css'), `${origin}${stylePath} is not CSS`);

  const api = await get(base, '/creator-api/narratives', { origin: apiOrigin });
  assert(api.status === 401, `${origin}/creator-api/narratives returned ${api.status}, expected unauthenticated 401`);
  assert(api.headers.get('access-control-allow-origin') === apiOrigin, `${origin}/creator-api did not allow configured origin ${apiOrigin}`);
  const apiBody = await api.json();
  assert(apiBody.error === 'Authentication required', `${origin}/creator-api/narratives did not fail closed`);

  const privatePaths = ['/.dev.vars', '/readme.md', '/package.json', '/wrangler.toml', '/functions/_middleware.js', '/scripts/', '/data/future-radio/source-receipt.json', '/data/future-radio/candidates.json', '/data/future-radio/thumbnail-experiment.json', '/market-maker-latest.json', '/market-maker/first-battle-publication-draft.json', '/index.v.mainbattle2.html'];
  for (const pathname of privatePaths) {
    const response = await get(base, pathname);
    assert(response.status === 404, `${origin}${pathname} returned ${response.status}, expected 404`);
  }
  console.log(`PASS ${origin}: landing+disclosure, ${publicPageRoutes.length} preserved public page routes/data/media, Creator HTML+JS+CSS, unauthenticated API 401 (${apiOrigin}), ${privatePaths.length} private-path 404s`);
}

try {
  const bases = [baseArg];
  if (new URL(baseArg).hostname === 'story.markets') bases.push('https://www.story.markets');
  for (const base of bases) await verifyHost(base);
  console.log('Production smoke checks passed. No authenticated session or user data was used.');
} catch (error) {
  console.error(`Production smoke failed: ${error.message}`);
  process.exitCode = 1;
}
