# Refarm.dev Domain Cutover (Cloudflare + GitHub Pages)

Status: planning-ready

## Goal
Move public access from `https://aretw0.github.io/refarm/` to `https://refarm.dev/` with low risk and rollback.

## Preconditions
- `Deploy to Refarm.dev` is green on `main`.
- Astro base-path guard is in place (`check-astro-base-links.mjs`).
- Current fallback URL remains healthy.

## Phase 1 — Repo readiness (no DNS switch yet)
1. Set repository variables:
   - `REFARM_ASTRO_BASE=/`
   - `REFARM_ASTRO_SITE=https://refarm.dev/`
2. Add `apps/dev/public/CNAME` with:
   - `refarm.dev`
3. Open PR and validate CI.

## Phase 2 — Cloudflare DNS
1. Point apex `refarm.dev` to GitHub Pages endpoints (current GitHub recommended records).
2. Point `www` to `refarm.dev` (or choose opposite canonical, but keep one canonical).
3. SSL/TLS:
   - Full (strict)
   - Always Use HTTPS = ON

## Phase 3 — Activation
1. Merge Phase 1 PR.
2. Wait propagation and verify:
   - `https://refarm.dev/`
   - `/streams`, `/surfaces`, `/plugins`, `/graph`, `/shed`
3. Keep GitHub Pages URL as fallback during transition window.

## Rollback
- Remove/disable `CNAME` and restore:
  - `REFARM_ASTRO_BASE=/refarm/`
  - `REFARM_ASTRO_SITE=https://aretw0.github.io/refarm/`
- Re-deploy `main`.

## Post-cutover checks
- No off-base absolute links in generated HTML.
- Canonical URL points to `https://refarm.dev/`.
- Sync workflow remains green (`Sync develop ← main`).
