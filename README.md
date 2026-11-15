# story.markets creator workspace

Local-first creator studio for the Future Radio narrative workflow. The public Pages landing and existing Pages API routes remain in place. The landing CTA opens `/creator`, Cloudflare's clean-URL form of the `creator.html` asset; Pages Functions proxy Creator paths to the Creator Worker through a production service binding. Creator assets use `/creator-assets/*`, and authenticated workspace requests use `/creator-api/*` so they do not shadow the site's existing `/api/*` endpoints.

## Shipped locally

- Privy wallet-only frontend configured for Quai Cyprus-1 (chain ID 9), with injected EVM wallet discovery intended to include Pelagus.
- Privy access-token validation in the Worker using the official `@privy-io/node` verifier. All creator APIs fail closed without a valid token.
- Private narrative drafts owned by the authenticated Privy DID. There is not yet a shared Future Radio catalog/import adapter, so existing canon is not silently exposed or duplicated into creator accounts.
- One main narrative per verified account, with owner-scoped child structures and recursive roll-up of additive descendant contributions. The main target uses a shared `untyped_scalar` basis and an optional deadline; it has no revenue, valuation, funding, or currency semantics. Contributions are additive inputs, not subtotals; child contributions are accepted only under a compatible parent basis.
- Owner-scoped JSON export for narratives and generation history, with masked credential metadata only; provider key values and ciphertext are excluded.
- Hashference (default) and OpenRouter API-key storage encrypted with AES-256-GCM under a server-side key; raw keys are never returned after save.
- User-initiated Chat Completions generation bound to a selected private narrative, using the selected provider key and its exact model ID; each request caps output at 2,048 tokens. Request ID, usage/cost when returned, output, status, and failure code are persisted. No retry on ambiguous failures.
- Key revocation removes encrypted material while retaining non-secret generation receipts. No wallet transactions, publishing, payments, staking or canon approval.

## Configure local secrets

The frontend reads `VITE_PRIVY_APP_ID` from `creator/.env.local` (ignored by Git). The Worker reads `PRIVY_APP_ID` and `CREDENTIALS_ENCRYPTION_KEY` from root `.dev.vars` (also ignored by Git). Privy access tokens are verified against Privy's public app JWKS endpoint; no app secret or verification key needs to be copied into the Worker environment. `PRIVY_VERIFICATION_KEY` remains an optional local override.

```ini
# .dev.vars
PRIVY_APP_ID=your_privy_app_id
CREDENTIALS_ENCRYPTION_KEY=base64_32_byte_key_material
```

Set the matching public app ID in `creator/.env.local` as `VITE_PRIVY_APP_ID=your_privy_app_id`. Generate a new encryption key locally with `openssl rand -base64 32`. Never use or expose the Privy app secret. Add `story.markets` and your local development origin to the Privy app's allowed origins and enable wallet login. The app keeps `loginMethods: ['wallet']` as its only primary sign-in method; after wallet authentication, the workspace uses Privy's `useLinkAccount().linkTwitter()` flow to attach X to that same Privy identity. Enable X/Twitter OAuth for account linking in the Privy dashboard before testing it. Do not add X to the primary login methods for this flow.

No `.dev.vars`, real API keys, or Privy secrets are included in this repository. Without this configuration, the sign-in screen explains what is missing and API routes return unauthenticated/configuration errors. There is no development auth bypass.

## Run locally

```sh
npm ci
npm run build
npx wrangler d1 migrations apply story-markets-creator-local --local
npm run dev:worker
```

Vite also reads `VITE_PRIVY_APP_ID` from `creator/.env.local`; for a one-off session, use:

```sh
VITE_PRIVY_APP_ID=your_privy_app_id npm run dev
```

Open `http://127.0.0.1:5173/creator.html`. Vite proxies `/creator-api/*` requests to the Worker at `127.0.0.1:8787`. The frontend and Worker app IDs must match. Test login with a wallet you control; no signing or transaction occurs until you click the login controls and Privy prompts you.

## Verify

```sh
npm test
npm run build
npm run typecheck
```

## Production release checks

```sh
npm run release:check
node scripts/prepare-pages-stage.mjs
# Copy the printed STAGE_ROOT path into STAGE_ROOT below.
STAGE_ROOT="/absolute/path/printed/by/prepare-pages-stage"
# Run this deploy command from ~/story.markets so Pages Functions are bundled.
npx wrangler pages deploy "$STAGE_ROOT" --project-name story-markets --branch main --commit-message "Enable Creator Studio via Pages service binding"
# Replace with Wrangler's immutable deployment URL.
DEPLOYMENT_URL="https://<deployment-id>.story-markets.pages.dev"
npm run release:smoke -- --base-url="$DEPLOYMENT_URL" --api-origin=https://story.markets
npm run release:smoke
```

Run `release:check` before every Pages/Worker deployment and `release:smoke` immediately after. The check runs the test suite, typecheck, production build, a clean Pages asset stage, local Pages-to-Worker service-binding tests, Worker production dry-run, and `npm audit --omit=dev` against the reviewed fingerprint baseline. It blocks new findings and any critical advisory while reporting the accepted baseline as still open. `prepare-pages-stage.mjs` emits an absolute temporary asset-root path; deploy that directory from this Pages project root so Functions are bundled, rather than uploading `.` (which contains non-public project material). The smoke checks the immutable deployment URL and both custom hosts, preserves public site routes/data/media, verifies the Creator HTML and bundle, confirms unauthenticated API access returns 401, and checks private paths remain 404. Full auth/X linking still requires a human-controlled wallet session. See `docs/deployment-risk-register.md` for the decision record, open risks, and remediation path.

## Production deployment status and limits

Production D1 `story-markets-creator` previously had migrations `0001` and `0002` applied; the new `0003_hashference_provider.sql` migration is local and has not been applied to production. Hashference support is not live until that migration and the matching Worker/frontend release are deployed and read back. The Creator Worker and its production secrets are deployed; production secret values are never included in source, logs, or receipts. The Privy app ID matches the local frontend configuration, but no authenticated production wallet session or X-link OAuth exchange has been verified. The app keeps wallet as the only primary sign-in method; X is linked to that identity. Pelagus acceptance is also unverified. The app does not perform wallet transactions, token approvals, publishing, payments, staking, or canon approval, and local Creator material remains private drafts.
