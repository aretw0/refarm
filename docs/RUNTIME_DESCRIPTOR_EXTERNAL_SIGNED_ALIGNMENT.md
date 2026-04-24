# Runtime Descriptor External-Signed — Alignment & Rollout Plan

## Objective

Close the `external-signed` path with a **public, stable, and revocable** descriptor distribution channel,
without introducing premature infra complexity.

Current status:
- ✅ Descriptor schema/integrity/provenance baseline (`T-RUNTIME-21`)
- ✅ Distribution policy + trust modes (`T-RUNTIME-22`, `T-RUNTIME-23`)
- 🔲 Public endpoint and runtime resolution defaults (`T-RUNTIME-24`)

---

## Decision Gates (need explicit answers)

1. **Canonical public endpoint**
   - A. GitHub Release Assets
   - B. Project CDN
   - C. Object storage bucket (S3/R2/GCS)

2. **Environment policy**
   - A. `repository-derived` default everywhere
   - B. `repository-derived` in dev/staging + `strict-manual` in prod
   - C. `strict-manual` everywhere

3. **Revocation SLA**
   - A. immediate/hotfix
   - B. within 24h
   - C. next release cycle

4. **Resolution strategy in runtime install**
   - A. derive descriptor endpoint from repo + release tag conventions
   - B. consume explicit endpoint from plugin metadata
   - C. hybrid (metadata override + convention fallback)

### Decision Record (2026-04-24)

- ✅ **Canonical public endpoint (Gate 1): A — GitHub Release Assets**
- ✅ **Environment policy (Gate 2): B — `repository-derived` in dev/staging + `strict-manual` in prod**
- ✅ **Revocation SLA (Gate 3): B — within 24h**
- ✅ **Resolution strategy (Gate 4): C — hybrid (auto-resolve by convention + explicit metadata override)**

---

## Option Matrix

| Option | Pros | Cons | Tooling Cost | Recommendation |
|---|---|---|---|---|
| GitHub Release Assets | Already available, auditable, cheap rollout | URL conventions and release/tag coupling | Low/Medium | **Best immediate path** |
| CDN | Fast global delivery, cache control | Infra ownership + invalidation strategy | Medium/High | Phase 2 |
| Bucket (S3/R2/GCS) | Flexible and scriptable | Access control + lifecycle management | Medium | Phase 2 |

---

## Recommended Path (phased)

### Phase 1 (now)
- Canonical endpoint: **GitHub Release Assets**.
- Keep trust mode default: **`repository-derived`** for dev/staging.
- Use **`strict-manual`** in production-sensitive environments.
- Publish descriptor bundle per release with versioned manifest + revocation template.

### Phase 2 (optional)
- Add CDN or bucket mirror.
- Keep GitHub Releases as source-of-truth fallback until mirror proves stable.

---

## Proposed Atomic Slices (Option A focus)

1. Confirm endpoint decision + policy in ADR/decision block.
2. Define release asset naming convention (`runtime-descriptor-bundle-<release>.json|zip`).
3. Add workflow step to attach bundle manifest/files to GitHub Release assets.
4. Add workflow verification that published releases contain required descriptor assets.
5. Add fallback behavior when bundle is missing (warn/fail by env profile).
6. Define runtime resolver inputs (repo, plugin id/version, release tag).
7. Implement resolver helper for GitHub Release assets.
8. Add resolver unit tests (happy path + missing asset + malformed manifest).
9. Wire resolver into `installPlugin` external-signed path (optional URL auto-resolve).
10. Add explicit opt-out to force manual URL.
11. Implement revocation list fetch + local cache behavior.
12. Add runtime block behavior for revoked descriptors.
13. Add docs/playbook for rollback incident handling.
14. Add CI smoke for release descriptor end-to-end path.
15. Add governance checkpoint (`.project` verification + handoff).

---

## Minimal Inputs Required from Product/Platform

Resolved in this alignment session:
- Endpoint: **GitHub Release Assets**
- Trust policy: **hybrid by environment** (`repository-derived` dev/staging, `strict-manual` prod)
- Revocation SLA: **within 24h**
- Resolution strategy: **hybrid auto-resolve + explicit override**

---

## Revocation SLA (`<24h`) — Operational Meaning

The SLA here is a **security response target**, not system uptime.

- **What is covered:** time between confirmed descriptor compromise/misconfiguration and published revocation artifact + communication.
- **Target:** publish revocation update within **24 hours**.

Suggested timeline:

1. **T+0h → T+2h**: triage + confirm impact (descriptor hash / affected plugins/releases).
2. **T+2h → T+8h**: generate/publish revocation update (bundle revocation list + replacement descriptor when available).
3. **T+8h → T+24h**: propagate, force reinstall guidance, and incident communication.

If risk is critical, treat as hotfix and act immediately (faster than SLA target).
