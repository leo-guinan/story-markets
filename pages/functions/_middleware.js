const blockedFiles = new Set([
  "/wrangler.toml",
  "/wrangler",
  "/readme.md",
  "/readme",
  "/package.json",
  "/package-lock.json",
  "/.dev.vars",
  "/.env",
  "/.gitignore",
  "/market-maker-latest.json",
  "/market-maker-seed-slate-2026-10-23.json",
  "/market-maker/first-battle-publication-draft.json",
  "/data/future-radio/candidates.json",
  "/data/future-radio/source-receipt.json",
  "/data/future-radio/thumbnail-experiment.json",
  "/index.before-landing-pass",
  "/index.before-landing-pass.html",
  "/index.before-single-episode-pass",
  "/index.before-single-episode-pass.html",
  "/index.no-scroll",
  "/index.no-scroll.html",
  "/index.single-episode-pass",
  "/index.single-episode-pass.html",
  "/index.v.mainbattle2",
  "/index.v.mainbattle2.html",
]);

const blockedPrefixes = ["/.wrangler", "/.git", "/functions/", "/scripts/", "/data/future-radio/transcripts/"];

function isBlocked(pathname) {
  let normalized = pathname;
  try {
    normalized = decodeURIComponent(pathname);
  } catch {
    // Keep the encoded path; it will not match a private filename accidentally.
  }
  normalized = normalized.replaceAll("\\", "/").replace(/\/{2,}/g, "/").toLowerCase();
  return blockedFiles.has(normalized)
    || blockedPrefixes.some((prefix) => normalized.startsWith(prefix))
    || /(^|\/)index\.v\d+(?:\.html)?$/.test(normalized);
}

export async function onRequest({ request, next }) {
  if (isBlocked(new URL(request.url).pathname)) {
    return new Response("Not Found", {
      status: 404,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  }
  return next();
}
