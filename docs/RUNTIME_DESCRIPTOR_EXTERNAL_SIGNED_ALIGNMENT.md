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
- Keep trust mode default: **`repository-derived`**.
- Add strict-manual override for sensitive envs.
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

- Which endpoint is canonical now (A/B/C)?
- Which trust mode for prod defaults?
- What revocation SLA must be met?
- Should runtime auto-resolve by default, or remain explicit by descriptor URL?
