# ADR-064: Credential Error Enrichment Contract

**Status**: Accepted  
**Date**: 2026-05-12  
**Deciders**: Arthur Silva  
**Related**: ADR-063 (CLI OAuth Strategy), ADR-056 (Unified Refarm Host Boundary), ADR-062 (Cloudflare Provider Package)

---

## Context

Refarm stores provider credentials (GitHub PAT, Cloudflare API token) in the Silo. These tokens can expire, be revoked, or be invalid. When that happens, auth failures surface at runtime — during `provision`, `sow`, `chat`, or any other command that hits an authenticated API.

**Current situation:**

- `enrichCloudflareError` in `provision.ts` already does local error enrichment for Cloudflare, but only within that command.
- Token auth failures elsewhere produce raw, unhelpful errors (e.g., `401 Unauthorized`) with no guidance on what to do.
- The CLI, TUI, and WEB surfaces each handle errors independently, so a fix in one doesn't help the others.
- GitHub PAT expiry is not queryable via API — the only signal is a 401 at call time.
- Cloudflare token expiry IS queryable: `GET /user/tokens/verify` returns `expires_on`.

**The insight:**  
The problem is not "where to add a check command" — it's that auth errors lack enrichment at the credential layer. The rotation URL and human-readable reason need to travel with the error so that any surface can render them gracefully without duplicating logic.

---

## Decision

**We will define a `TokenAuthError` class at the credential/silo layer that carries structured context, and all surfaces render it uniformly.**

A `TokenAuthError` carries:

```typescript
class TokenAuthError extends Error {
  provider: "github" | "cloudflare"         // which credential failed
  reason: "expired" | "invalid" | "revoked" // why
  rotationUrl: string                        // exact URL to fix it
}
```

Rotation URLs per provider:

| Provider | Classic/API token URL | Fine-grained PAT URL |
|---|---|---|
| GitHub | `https://github.com/settings/tokens` | `https://github.com/settings/personal-access-tokens` |
| Cloudflare | `https://dash.cloudflare.com/profile/api-tokens` | — |

**Rendering contract per surface:**

- **CLI**: `chalk.red(err.message)` + `chalk.cyan(err.rotationUrl)` as clickable terminal link
- **TUI**: status pane banner with the rotation URL as an interactive link
- **WEB**: toast or alert banner with a "Rotate token →" button pointing to `rotationUrl`

Each surface receives the same `TokenAuthError`; rendering is the only thing that differs.

---

## Alternatives Considered

### Option A: Surface-specific error handling
Each command (provision, chat, sow) catches 401 and adds its own message.

**Cons:**
- Logic duplicated across surfaces
- Rotation URL needs to be updated in N places
- TUI and WEB have no benefit from CLI fixes

### Option B: Check command (`refarm doctor` / `refarm sow check`)
Proactive token expiry check before operations run.

**Cons:**
- Doesn't help when a token expires mid-session
- GitHub PAT expiry is not queryable anyway
- Adds a step the user must remember to run

### Option C (chosen): Enriched error at the credential layer
`TokenAuthError` produced where the failure is detected, consumed by any surface.

**Rationale**: Fixes the root cause (opaque errors), scales to all surfaces automatically, and is the same pattern already used by `enrichCloudflareError` — this just promotes it to a first-class contract.

---

## Consequences

**Positive:**

- A token expiry fix in one place benefits CLI, TUI, and WEB simultaneously
- The rotation URL is always correct and always present
- Proactive check (`refarm doctor`) becomes optional — it's a nice-to-have on top of this foundation, not a prerequisite
- Cloudflare expiry warning (days remaining) can be added to `refarm doctor` as an informational check, using the same `TokenAuthError` shape

**Negative:**

- Requires touching the silo/credentials layer, not just command handlers
- GitHub PAT expiry still cannot be proactively detected — only reactive (on 401)

**Risks:**

- Fine-grained vs classic GitHub PAT distinction: can be inferred from token prefix (`github_pat_` = fine-grained, `ghp_` = classic). Route to the correct URL accordingly. Risk: low.

---

## Implementation

**Affected components:**

- `packages/silo` or `apps/refarm/src/credentials/` — define `TokenAuthError`
- `@refarm.dev/infra-cloudflare` — throw `TokenAuthError` on `verify` failure instead of raw error
- `apps/refarm/src/commands/provision.ts` — replace `enrichCloudflareError` call with `TokenAuthError` catch
- CLI surface (`apps/refarm`) — add a top-level error handler that renders `TokenAuthError` gracefully
- TUI surface — render `TokenAuthError` as a dismissible banner with link
- WEB surface — render `TokenAuthError` as alert with "Rotate token →" CTA

**GitHub PAT prefix heuristic:**

```typescript
function githubRotationUrl(token: string): string {
  return token.startsWith("github_pat_")
    ? "https://github.com/settings/personal-access-tokens"
    : "https://github.com/settings/tokens";
}
```

**Cloudflare proactive expiry warning** (optional, for `refarm doctor`):

Call `GET https://api.cloudflare.com/client/v4/user/tokens/verify` during doctor check.  
If `expires_on` is within 30 days, emit a warning with the rotation URL.  
This is additive — the `TokenAuthError` contract handles the reactive case.

**Timeline**: Implement before the first TUI or WEB surface ships. Until then, the CLI error handler is the minimum viable implementation.

---

## References

- [Cloudflare Tokens API](https://developers.cloudflare.com/api/resources/user/subresources/tokens/methods/verify/)
- [GitHub PAT token formats](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github#githubs-token-formats)
- ADR-062: Cloudflare Provider Package
- ADR-063: CLI OAuth Strategy
