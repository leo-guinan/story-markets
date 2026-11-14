# Cloudflare Pages source

This directory is the tracked source tree for the `story-markets` Pages project. It contains the static site, Pages Functions, and the project bindings in `wrangler.toml`. Do not add Wrangler local state, credentials, drafts, or private source material here.

The static upload is staged separately because the Pages root also contains server-side Functions and project configuration. From the repository root:

```sh
node scripts/prepare-pages-stage.mjs
# Use the STAGE_ROOT printed by the script.
PAGES_CONTEXT="$(mktemp -d "${TMPDIR:-/tmp}/story-markets-pages-context.XXXXXX")"
cp -R pages/functions "$PAGES_CONTEXT/functions"
cp pages/wrangler.toml "$PAGES_CONTEXT/wrangler.toml"
npx wrangler pages deploy "$STAGE_ROOT" --cwd "$PAGES_CONTEXT" \
  --project-name story-markets --branch main \
  --commit-hash "$(git rev-parse HEAD)" --commit-dirty true
rm -rf "$PAGES_CONTEXT"
```

The temporary context keeps Wrangler from picking up the separate Worker config at the repository root. It contains only the Pages Functions and Pages bindings copied from this tracked source; the staged directory remains public static files only. After deployment, verify the immutable Pages URL and both custom domains, including the Creator routes and fail-closed unauthenticated API. Deployments publish to Cloudflare Pages; they do not require a Git push.
