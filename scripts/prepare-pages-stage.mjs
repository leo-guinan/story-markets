import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagesRoot = path.resolve(process.env.STORY_MARKETS_PAGES_DIR || path.join(repoRoot, 'pages'));
const scratchRoot = path.resolve(process.env.STORY_MARKETS_STAGE_TMPDIR || os.tmpdir());
const staticExtensions = new Set(['.html', '.css', '.js', '.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.ico', '.mp3', '.mp4', '.m4a', '.wav', '.ogg', '.webm', '.woff', '.woff2', '.ttf', '.otf']);
const mediaExtensions = new Set(['.mp3', '.mp4', '.m4a', '.wav', '.ogg', '.webm']);
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif', '.ico']);
const blockedPaths = new Set([
  'index.before-landing-pass.html',
  'index.before-single-episode-pass.html',
  'index.no-scroll.html',
  'index.single-episode-pass.html',
  'index.v.mainbattle2.html',
  'market-maker/first-battle-publication-draft.json',
]);
const blockedIndexVersion = /(^|\/)index\.v\d+(?:\.html)?$/i;

async function ensureCopy(sourceRoot, stageRoot, relativePath) {
  const source = path.join(sourceRoot, relativePath);
  const destination = path.join(stageRoot, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

async function copyMatchingTree(sourceRoot, stageRoot, relativePath, extensions) {
  const sourceDirectory = path.join(sourceRoot, relativePath);
  const entries = await readdir(sourceDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const childRelative = path.posix.join(relativePath, entry.name);
    if (blockedPaths.has(childRelative) || blockedIndexVersion.test(childRelative)) continue;
    const source = path.join(sourceRoot, childRelative);
    if (entry.isDirectory()) {
      await copyMatchingTree(sourceRoot, stageRoot, childRelative, extensions);
    } else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
      await ensureCopy(sourceRoot, stageRoot, childRelative);
    }
  }
}

export async function preparePagesStage(sourceRoot = pagesRoot) {
  await mkdir(scratchRoot, { recursive: true });
  const stageRoot = await mkdtemp(path.join(scratchRoot, 'story-markets-pages-stage-'));
  try {
    const requiredFiles = [
      'index.html',
      'assets/artist-home.css',
      'assets/fathom-events.js',
      'battles/index.html',
      'stories/index.html',
      'data/future-radio/stories.json',
      'patronage/index.html',
      'market-maker/index.html',
      'market-maker/garcia-public-reply-receipt.json',
      'share/index.html',
      'gallery/index.html',
      'profile/index.html',
    ];
    for (const relativePath of requiredFiles) {
      const info = await stat(path.join(sourceRoot, relativePath));
      if (!info.isFile()) throw new Error(`Required public Pages file is not a regular file: ${relativePath}`);
    }

    await ensureCopy(sourceRoot, stageRoot, 'index.html');
    for (const directory of ['assets', 'media']) {
      await copyMatchingTree(sourceRoot, stageRoot, directory, directory === 'media' ? mediaExtensions : staticExtensions);
    }
    for (const directory of ['battles', 'stories', 'patronage', 'market-maker', 'share', 'gallery', 'profile']) {
      await copyMatchingTree(sourceRoot, stageRoot, directory, new Set(['.html', ...imageExtensions]));
    }
    await ensureCopy(sourceRoot, stageRoot, 'data/future-radio/stories.json');
    await ensureCopy(sourceRoot, stageRoot, 'market-maker/garcia-public-reply-receipt.json');

    const paths = [];
    async function collect(directory = stageRoot, prefix = '') {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const relative = path.posix.join(prefix, entry.name);
        if (entry.isDirectory()) await collect(path.join(directory, entry.name), relative);
        else if (entry.isFile()) paths.push(relative);
      }
    }
    await collect();
    paths.sort();
    const hash = createHash('sha256');
    let totalBytes = 0;
    for (const relative of paths) {
      const bytes = await readFile(path.join(stageRoot, relative));
      if (bytes.byteLength > 25 * 1024 * 1024) throw new Error(`Pages asset exceeds 25 MiB: ${relative} (${bytes.byteLength} bytes)`);
      totalBytes += bytes.byteLength;
      hash.update(relative);
      hash.update('\0');
      hash.update(bytes);
      hash.update('\0');
    }
    const forbidden = paths.filter((relative) => /(^|\/)(?:\.wrangler|\.git|functions|scripts|docs|transcripts)(\/|$)/i.test(relative)
      || /(?:source-receipt|candidates|thumbnail-experiment|first-battle-publication-draft|market-maker-latest|seed-slate|readme|wrangler\.toml|package(?:-lock)?\.json|\.dev\.vars|\.env)/i.test(relative)
      || blockedPaths.has(relative)
      || blockedIndexVersion.test(relative));
    if (forbidden.length) throw new Error(`Private or working files entered the public Pages stage: ${forbidden.join(', ')}`);

    return { stageRoot, fileCount: paths.length, totalBytes, sha256: hash.digest('hex'), files: paths };
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const stage = await preparePagesStage();
    console.log(JSON.stringify({ stageRoot: stage.stageRoot, fileCount: stage.fileCount, totalBytes: stage.totalBytes, sha256: stage.sha256 }));
    console.log(`STAGE_ROOT=${stage.stageRoot}`);
  } catch (error) {
    console.error(`Pages staging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
