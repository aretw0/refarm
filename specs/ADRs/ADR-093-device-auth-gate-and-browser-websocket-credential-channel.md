# ADR-093: Device auth gate + browser/WebSocket credential channel

## Status

**Accepted** for the CLI/HTTP gate (shipped 2026-07-24) and for the `/sync` WebSocket credential
handshake (shipped 2026-07-29: `daemon::WsServer` gates the upgrade itself via `accept_hdr_async`,
and `packages/sync-loro/src/browser-sync-client.ts` can offer a token). **Proposed** for the
browser hub's OWN token bootstrap/persistence (`apps/me` reading `?token=`, `localStorage`,
attaching `Authorization` to `/efforts`) — the server- and client-library-side gates this ADR
described now exist; wiring the hub itself to use them is the remaining piece.

## Context

Until 2026-07-24 the daemon had no app-layer auth: any device reaching the sidecar (`:42001`) or
the CRDT sync WS (`:42000`) could drive the farm — only Tailscale gated the node. The operator
requires an identity gate above the network so another device cannot enter, with per-user
workspaces (personal isolated + shared collective). See
`docs/superpowers/specs/2026-07-24-sovereign-auth-workspaces-design.md`.

The **CLI/HTTP half is done**: an opt-in `from_fn` gate on the sidecar
(`packages/tractor/src/sidecar/auth.rs`) rejects any request without a valid
`Authorization: Bearer <token>` whose SHA-256 is enrolled in `REFARM_AUTH_POLICY`; `farm-client`
carries `FARM_TOKEN`; `refarm auth enroll` mints tokens. Fail-closed, opt-in (unset ⇒ off).

The **open decision** is how the **browser hub** (`apps/me`) authenticates, because it hits BOTH:
- the sidecar HTTP (`/efforts`, via the same-origin `refarm web serve` proxy), and
- the CRDT sync WebSocket (`wss://<origin>/sync`, proxied to `daemon::WsServer`, `main.rs:561`).

The forcing constraint: **a browser cannot set an `Authorization` header on a WebSocket**
(the WHATWG WebSocket API exposes no header control). So the WS credential must ride a
browser-reachable channel. Until `/sync` is gated, a public tunnel still leaks the CRDT even
with the HTTP gate on — so the hub cannot be safely remote until this is decided and built.

## Decision

**One bearer credential per device; three delivery channels, one policy.**

1. **CLI HTTP** (shipped): `Authorization: Bearer <FARM_TOKEN>`.
2. **Hub HTTP**: `apps/me` sends `Authorization: Bearer <token>` on its `/efforts` fetches
   (`me-chat.ts`), the browser analog of `FARM_TOKEN`. The token is read from a client-side store
   (`localStorage["refarm.token"]`), **bootstrapped once** from a `?token=<t>` query param that the
   hub reads on load, persists, then strips from the URL (`history.replaceState`) so it is not left
   in the address bar / back-stack. The `refarm web serve` proxy already forwards `Authorization`.
3. **`/sync` WebSocket**: the credential rides the **`Sec-WebSocket-Protocol` subprotocol** — the
   browser offers `["refarm-sync-v1", "bearer.<token>"]`; `daemon::WsServer` validates the
   `bearer.<token>` value against the SAME `REFARM_AUTH_POLICY` at the **handshake** (fail-closed,
   before any frame) and echoes back the accepted `refarm-sync-v1` protocol. The `refarm web serve`
   `/sync` proxy forwards the `Sec-WebSocket-Protocol` request header (it already forwards handshake
   headers). Same opt-in/fail-closed posture as the sidecar gate: no policy ⇒ no WS gate.

The policy is shared: the same `parse_policy`/`authenticate` (sha256-of-token → enrolled?) the
sidecar uses; the WS gate must not diverge. Authorization (which workspace) stays Slice 2.

## Consequences

### Positive

- The hub becomes safely remote: with the gate on, both HTTP and `/sync` reject an unenrolled
  device, so a public (or Cloudflare-Access) tunnel exposes nothing to a credential-less visitor.
- Subprotocol auth is checked at the handshake — fail-closed before any CRDT byte flows, unlike a
  first-frame token.
- One credential, one policy, one enroll flow across CLI + browser; revoke a device by removing its
  hash. Multi-device recovery aligns with `identity:v1 deriveFromSession` later.

### Negative

- `localStorage` is XSS-reachable — a hub XSS could exfiltrate the token. Mitigation: the hub is a
  strict CSP, cross-origin-isolated, self-authored surface; hardening path = short-lived tokens +
  rotation, or a service-worker-held credential. Recorded, not blocking for personal scale.
- The bootstrap `?token=` briefly places the token in a URL (stripped immediately, but it may hit
  server logs at the tunnel edge for that one request). Acceptable for enrollment over a trusted
  transport; note it.
- The WS subprotocol embeds the token in the `Sec-WebSocket-Protocol` header — it does NOT appear in
  the URL/logs (better than `?token=` for the WS), but proxies must forward the header (verified for
  `web serve`).

## Alternatives Considered

- **`?token=` on the `/sync` URL** — simplest, browser-compatible, but the token leaks into URLs,
  proxy logs, and the CRDT connection's referer surface. Rejected as the primary WS channel; kept
  only as the HTTP *bootstrap* (one request, stripped) where the alternative (a login form) is
  heavier than warranted for personal scale.
- **First-frame token** (send the credential as the first WS message) — works, but the connection is
  accepted BEFORE auth, so it is not fail-closed at the handshake and complicates the server state
  machine. Rejected.
- **mTLS / client certificates** — strong, but browser client-cert UX is hostile and it is
  corporate-scale machinery the personal farm does not want (see the rcdc5 lesson in the spec).
  Rejected for v1; the silo hardware-backed envelope is the eventual upgrade path.

## Operationalization

- First BDD red scenario: with a policy set, a browser hub opened WITHOUT a stored token cannot
  chat (`/efforts` 401) nor sync (`/sync` handshake rejected); opened with `?token=<enrolled>` once,
  it chats and syncs, and the token is gone from the URL.
- First TDD red contract (Rust): `daemon::WsServer` handshake with no/invalid `bearer.<token>`
  subprotocol ⇒ rejected; valid ⇒ accepted with `refarm-sync-v1` echoed. Pure validator reuses
  `sidecar::auth::AuthPolicy::authenticate`.
- First TDD red contract (TS): `apps/me` credential module — read/persist/strip bootstrap token;
  attach `Authorization` to `/efforts`; offer the `Sec-WebSocket-Protocol` on the sync socket.
- First DDD green slice: the `/sync` WS gate (§8) mirroring the sidecar's opt-in `from_fn`.
- Verification commands: `cargo test --lib sidecar::auth`; a Playwright hub smoke over a
  credential-gated `web serve` (no token → blocked; token → chat + sync); `refarm auth enroll`.
