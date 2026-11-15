# Production deployment risk register and release controls

As of: 2026-11-14 (EST)
Target: Cloudflare Pages project `story-markets` and Worker `story-markets-creator` on `story.markets` / `www.story.markets`.

The user explicitly directed that we proceed because losing the current sign-in momentum is the larger near-term risk. That authorizes this initial deployment with known risks documented; it is not a claim that the system is security-cleared. Do not remove or weaken this record to make a release look clean.

## Current release record

- Status: deployment in progress; fill in deployment IDs, smoke-test results, and remaining gaps after the live readback.
- Previous Pages release: `dc6b3c4e-5cda-4a6c-8672-5f0c89514d36` (`https://dc6b3c4e.story-markets.pages.dev`).
- Creator production D1: `story-markets-creator`; both migrations were applied and Wrangler reported no pending migrations immediately before this release.
- The Creator routes are deliberately limited to `/creator*` on the apex and `www` hosts. Existing `/api/*`, `/assets/*`, and `/battles/*` remain Pages-owned.
- The public app offers wallet login as the only primary Privy login. X is linked after login to that Privy identity; it is not a separate sign-in method.
- No wallet transaction, token approval, publishing, payment, staking, or canon approval is part of this release. Creator material remains private drafts; it is not published canon.
- No production user authentication or authenticated API readback has yet been exercised. Do not represent the sign-in flow as verified until the manual verification listed below is completed.

## Risks and disposition

### R1 — Production dependency advisories (high, open)

The last `npm audit --omit=dev --json` returned 34 vulnerable package records: 18 high, 16 moderate, zero critical. These are package records, not necessarily 34 independent upstream CVEs. The exact package/range/advisory-path fingerprints are frozen in `docs/dependency-audit-baseline.json`. Same-major overrides for `ws`, `viem`, and `@walletconnect/utils` reduced the audit from 42 total / 23 high to the present baseline, but did not clear it.

High-severity affected package records include Privy/Farcaster, Reown/WalletConnect, `@wagmi/connectors`, `@coinbase/cdp-sdk`, `x402`, `abitype`, and `zod`. The direct Zod advisory is `GHSA-mrhx-c7xc-m3w5` (affected range `<4.6.6`). Broad `npm audit fix` was not used because it proposed incompatible major changes; previous compatibility probes found peer conflicts around Privy, Solana Kit, and Farcaster.

Disposition: proceed for this initial release at the user's explicit direction. `npm run release:check` allows only exact findings in the recorded baseline and blocks new package/advisory/path fingerprints or any critical finding. The report still says the audit is not clean. Remediate by testing compatible upstream updates in small groups, rerunning the complete release check, and allowing resolved entries to disappear from the next reviewed baseline. Never refresh the baseline merely to silence a new finding.

### R2 — Real Privy and X-link flow not verified (high, open)

Local checks confirmed the UI and Worker app IDs match; local browser smoke reached the wallet-only Privy login screen and the unauthenticated Creator API returned 401. No valid production wallet session, token verification, owner-scoped readback, or Privy X-link OAuth exchange has been completed. The X callback is Privy-managed at `https://auth.privy.io/api/v1/oauth/callback`; the app origin is `https://story.markets` (and `https://www.story.markets` for the new alias route).

Disposition: serve the sign-in screen now, but label login as unverified until a human-controlled wallet completes sign-in and the resulting account reads only its own workspace. Separately verify linking X from inside that authenticated account. Do not sign, transact, publish, or use a wallet outside the user-directed login flow.

### R3 — Provider-key encryption and recovery (high, open)

Provider API keys are encrypted with AES-256-GCM before D1 storage and masked on read. The production encryption key must exist only as a Worker secret; it is not recoverable from D1. Losing or replacing it without a deliberate re-encryption process makes already-stored provider keys unusable. No provider key has been entered into production at the last pre-release check.

The local Creator implementation now supports Hashference in addition to OpenRouter. Migration `0003_hashference_provider.sql` rebuilds the provider credential/generation tables to widen the provider constraint while preserving existing rows. Until that migration and the matching Worker/UI build are deployed and read back, Hashference is not available in production.

Disposition: use a fresh 32-byte production key, verify only its presence (never value), and document a controlled backup/rotation procedure before encouraging users to store provider keys. Do not copy key material into logs, source, deployment notes, or chat.

### R4 — D1 backup/restore and user-data recovery are not established (medium, open)

The production schema exists and the database was empty at the last pre-release check; a backup/restore drill and retention policy have not been verified. Once users create private drafts, loss or accidental deletion would matter even though the content is not public canon.

Disposition: before meaningful user data accumulates, enable/verify an appropriate D1 recovery mechanism and test a restore into a non-production database. Never test restore by overwriting production.

### R5 — Landing source provenance (medium, open)

The Pages source is `/Users/leoguinan/story.markets`, not the Creator Git repository. The deployment is therefore verified from local files but is not represented by a commit in that repository. The prior Pages release ID is retained above as a rollback reference.

Disposition: keep the source directory and exact deployment receipt; move the Pages source into version control in a separate authorized change. No commit or push is part of this release.

### R6 — Narrow route and alias behavior (medium, monitored)

Both apex and `www` need Creator routes because both hosts currently serve the Pages site. The Worker handles only `/creator*`; the Pages `/api/*`, `/assets/*`, battles, and landing behavior must remain untouched. The Worker API allowlist explicitly includes both HTTPS origins.

Disposition: `npm run release:check` validates the route dry-run and local Pages private-file middleware; `npm run release:smoke` checks both hosts, Creator assets, unauthenticated API denial, existing battles, and private-path 404s after each deployment.

## Repeatable release procedure

From the Creator repository:

1. Run `npm run release:check` before every Worker or Pages deployment. It runs unit/integration tests, typecheck, production build, a local Pages middleware/static smoke (including private-file 404s), Cloudflare Worker dry-run, and production-only npm audit baseline comparison.
2. Deploy only the intended Pages and Worker targets. Do not use `wrangler secret put` against a missing Worker; deploy the script first, then set secrets on the existing production Worker.
3. Run `npm run release:smoke` immediately after each production deployment. It checks apex and `www`, landing CTA/disclosure, battles, Creator HTML/JS/CSS, unauthenticated API 401, and protected paths.
4. Read back Cloudflare deployment status, the exact live routes, secret names only, D1 migration state, and HTTP results. A Pages `/creator` HTTP 200 without the Creator app title/assets is a failure, not a successful login release.
5. Keep the npm audit counts and finding fingerprints. New findings or any critical issue block later releases; existing findings remain visible and should be remediated rather than normalized away.

The commands are automated checks, not a substitute for the manual wallet/X test, backup drill, or security review above.
