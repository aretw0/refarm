# Sovereign auth + multi-tenant workspaces

> Status: design (2026-07-24). Operator direction (Arthur): "what stops another device from
> entering my node? I need guaranteed isolation + authentication of one or more allowed users,
> with different workspaces or collectives (me and my wife) — mind our architecture and journey,
> the multi-surface blocks." Workspace model chosen: **personal isolated + shared collective**.

## Verified posture today (grounded, not guessed)

- **Network:** Tailscale (WireGuard) authenticates devices and excludes the internet — the ONLY
  gate today. A naked public cloudflared tunnel bypassed it (now closed).
- **App layer:** the sidecar router (`packages/tractor/src/sidecar/mod.rs:1542`) has **no auth
  middleware** — only opt-in CORS (`mod.rs:1573`). Any device that reaches `/efforts` drives the farm.
- **Multi-tenancy:** one daemon = one boot-time `namespace` (`mod.rs:158`, from `--namespace` /
  `REFARM_NAMESPACE`, `main.rs:49`), immutable. No per-user isolation.

So: internet-isolation YES (Tailscale, tunnel closed); per-user auth + workspace isolation NO.
That gap is this spec.

## Threat model (defense in depth — three trust boundaries)

1. **Internet** → excluded by Tailscale + no open tunnels. External reach later = an *authenticated*
   tunnel (Cloudflare Access), never open.
2. **A device on the tailnet that isn't authorized** (or a proxy hop) → the **app-auth gate** below.
   This is the layer the operator is asking for: the tailnet is a *network* gate, not an *identity* gate.
3. **A shared physical device** (someone picks up the phone) → the hub's per-user session (a later axis).

## Assimilate, don't reinvent

**From rcdc5 (`packages/scraper-playwright/src/core/`) — the PATTERN, not the mechanism.** rcdc5 is a
*client* of corporate SSO (Keycloak/SerproID via Playwright); there is no server gate to lift. Reuse:
(1) a **persistent per-device credential** restored at boot, validated cheaply (its `auth-state.json` +
`restoreAuthState`); (2) the **"401 ⇒ re-present credential, don't discard in-flight work"** loop
(`isRecoverableAuthHttpStatus`, `waitForReauthentication`); (3) the **device-approval enrollment ritual**
(its QR "approve on an already-trusted device" = "add my spouse's laptop"). Drop: Keycloak/OIDC, the
SerproID broker, corporate CA/VPN, browser impersonation. Personal scale = one locally-validated device
credential, not a federated IdP.

**Refarm blocks the gate sits on (all already exist):**
- `identity-contract-v1` — `deriveFromSession(session) → identity` (`src/types.ts:73`), deterministic
  (`in-memory.ts:62`: same session bytes → same identity = multi-device recovery). **The gate interface.**
- `silo` (`packages/silo/src/`) — the local credential vault (POSIX 0700/0600; Ed25519 master key via
  heartwood; declared upgrade path to passkey/secure-enclave). **Where a device credential lives.**
- `authorization-contract-v1` + `wallet` (`packages/wallet/src/consent.ts`, `apps/me/.../me-wallet.ts`) —
  purpose/scope/expiry consent (`authorize → present → verify → revoke`). The "decide before anything is
  shared" surface. Governs per-action disclosure ON TOP of the access gate.
- `TokenAuthError` (`apps/refarm/src/credentials/token-auth-error.ts`) — failure vocabulary
  (expired | invalid | revoked + rotation guidance). Reuse as the body of the daemon's 401.

## The layered architecture

### Layer 1 — network (have it)
Daemon tailnet-only (loopback + tailnet). **Never a naked public tunnel again.** External reach =
authenticated tunnel.

### Layer 2 — the app-auth gate (Slice 1 — answers "what stops another device")
An axum `from_fn` auth layer on the sidecar router, added exactly where CORS is (`mod.rs:1573`), and on
the `/sync` WS upgrade:
- The client presents a **per-device credential** (a high-entropy secret provisioned into `silo` at
  enrollment), as `Authorization: Bearer <cred>` (HTTP) / a subprotocol or first-frame token (WS).
- The gate: `deriveFromSession(cred) → identity`; check the identity is in the **allow-list**; else
  `401` with the `TokenAuthError` vocabulary (invalid / expired / revoked + how to re-enroll).
- **The operator's own host tools are provisioned a credential at setup** (from `silo`), so the local
  CLI + hub keep working; remote devices must enroll. (No "trust loopback" shortcut — a proxy hop is
  loopback, so socket-address trust would let a tunnel bypass the gate. Trust the credential, not the socket.)
- Client half: farm-client, apps/me (via the same-origin proxy), and the apps/refarm web-serve proxy
  forward the credential. 401 is recoverable (re-present; don't drop in-flight efforts).

### Layer 3 — identity → workspace (Slice 2 — personal + collective)
- A **workspace registry** in SidecarState (injected like the existing `with_registry`, `mod.rs:247`):
  identity → allowed workspaces. Personal scale = a tiny map: `you → {personal-you, collective-casa}`,
  `spouse → {personal-spouse, collective-casa}`.
- The request selects a workspace via `X-Refarm-Workspace`, **constrained to the identity's allow-list**
  (never open a raw client string — `:memory:`/arbitrary maps to a DB file = path injection).
- The gate resolves `identity + selected-workspace → namespace` and carries it as a request extension
  (`Extension<ResolvedWorkspace>`). The 8 `NativeStorage::open(&state.namespace)` sites in `mod.rs`
  (925, 1057, 1102, 1190, 1331, 1376, 1423, 1477) + 2 in `dispatch.rs` (719, 737) read the per-request
  namespace via a helper; `state.namespace` demotes to the default/fallback.

### Enrollment (the rcdc5 ritual, personal-scale)
Add a new device: from an already-trusted device, approve the newcomer → a credential is minted into the
newcomer's `silo`, its derived identity added to the allow-list, mapped to the chosen workspace(s). (A QR
or a short code over the mesh; the *ritual*, not Keycloak.)

## Build slices (each atomic, gated; §8 — packages/tractor)
1. **The gate** (Layer 2): credential → identity → 401. The direct answer to the operator's question.
   Bearer-secret-in-silo v1; Ed25519 request-signing is the hardening upgrade. Clients forward the credential.
2. **Identity → workspace** (Layer 3): namespace-per-request + the registry. Storage isolation.
3. **Full workspace isolation** (the larger axis — see risks): streams/efforts/plugins/sync per-workspace.
4. **Enrollment ritual** + the hub's per-user session (Layer 3 threat) + wallet-consent on sensitive actions.

## Risks / gotchas (from the survey)
- **Namespace isolation ≠ full workspace isolation.** `NativeStorage::open(namespace)` isolates the
  SQLite store, but `streams_dir`/`results_dir` (`mod.rs:213`), the in-memory `efforts` map, `plugin_channels`,
  `event_router`, `plugin_registry` are base-dir/daemon-global. Full isolation is a second, larger axis (Slice 3).
- **Sync is single-namespace at boot** (`NativeSync::new(storage, &args.namespace)`, `main.rs:819`) — a
  multi-workspace daemon needs per-workspace sync or CRDT cross-pollinates. Design Slice 2/3 around this.
- **Breaking change:** zero app-auth exists today; a 401 gate breaks apps/refarm + apps/me until they
  forward a credential. Ship the gate and the client credential together; the gate rides the same-origin
  proxy (ADR-088), never exposing the raw sidecar.
- **Out-of-process readers** (`refarm health`, `readers.rs`) resolve namespace from args/env and are blind
  to per-request workspaces — a coherence gap to design around (they operate on the default namespace).
- **Naming:** `config/src/workspace-namespaces-config` already exists but is BUILD-tooling directory
  declarations, not tenant isolation. Do not overload the name.
- **Never trust a client-supplied namespace/secret string** — map identity → an allow-listed namespace only.

## Non-goals (v1)
Federated IdP / corporate SSO; hardware-backed credentials (silo declares the upgrade path — later);
fine-grained per-plugin capability tokens (the wallet-consent layer handles per-action disclosure on top).
