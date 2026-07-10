# Maintenance Lane — coupling, cognitive load, and debt

_Opened 2026-07-06. Single source of truth for cross-cutting cleanup: common
things wrongly coupled to `apps/refarm`, oversized files, and process debt — so we
never stop at the end of a feature to "figure out what to clean" or let sujeira
pile up._

## Operating policy (Arthur)

1. **Don't wait for a second consumer to feel the pain.** The conservative
   "no second consumer yet → defer" rule is too slow. If a common thing is
   coupled to `apps/refarm` (or reimplemented worse elsewhere), we resolve it when
   we see it — with room to discuss case by case. A finding may still be parked,
   but by agreement, not by a blanket rule.
2. **Centralize instead of editing the same thing in N places.** When a fix would
   touch several near-identical sites, first extract the shared piece, then apply
   once (proven this session: `health-commands.ts`, `renderCapabilityError`,
   `env_lock` → `test_support`, `makeProcessCache`).
3. **Grow a big file → shrink it in the same pass.** When the next feature adds to
   an already-large file, slice its size down while we're in there — don't schedule
   a separate "split files" sweep. Cognitive load is paid down opportunistically,
   where we already have the file open.
4. **When to stop and pull from this lane** (Claude proposes, Arthur decides):
   - a feature is about to add >~150 lines to a file already >800 lines → split first;
   - a fix would touch ≥3 near-identical sites → centralize first;
   - a coupling/debt item here sits directly under the file we're editing → fold it in;
   - otherwise finish the feature; do NOT pre-emptively detour for unrelated debt.

## Coupling debt (from the 2026-07-06 liveness-ping audit + since)

Verified findings. Status: OPEN unless marked. "2nd consumer" column is context,
not a gate (see policy #1).

| # | Item | Where | Status | Note |
|---|---|---|---|---|
| C1 | `fetchWithTimeout` mis-homed | was `apps/refarm/src/commands/fetch-with-timeout.ts` | **DONE** (fa43c50c) | Subsumed by C2's repartition: the primitive moved to `@refarm.dev/root` (zero-dep, generic HTTP). The `probeHttpEndpoint` classifier dedup (model.ts ≡ runtime-readiness.ts) is a smaller residual follow-on. |
| C2 | sidecar HTTP client stuck in app | `sidecar-fetch.ts` | **DONE** (fa43c50c) | Split by DOMAIN, not into cli (Arthur: a CLI package is the wrong home for a network client). `fetch-with-timeout`→`@refarm.dev/root`; `sidecar-fetch`→NEW `@refarm.dev/sidecar-client`. context-provider-v1 migrated off its raw fetch. The 42001 bug was already fixed (f1e2a106 + f5b39c8c); this closed the relocation + the raw-fetch reimplementation. |
| C3 | `ProviderProbeReason` contract dup | `sidecar/mod.rs` (Rust) | **DONE** (a9825b78) | Rust probe reason literals hoisted into `PROBE_*` consts mirroring `EFFORT_*`. A `model-liveness-contract-v1` package still waits for a 2nd app speaking `/providers/liveness`. |
| C4 | config-node read-back: only sidecar-URL migrated | `runtime-config.ts` resolvers | **DONE** (1a1a08f1) | Propagated to autostart + engine via a centralized `resolveConfigValueAsync<T>`. Residual: the two other async resolvers could migrate their hot callers, but none is hot today. |

## Cognitive-load debt (oversized files)

Slice opportunistically per policy #3. Biggest first; the ones touched this session
are flagged — likely to grow again.

**TS (`apps/refarm/src`)** — `skill-capability.ts` 1077, **`model.ts` 1077** (grown by
liveness-ping; a prime split candidate — doctor/probe vs routing vs mutators),
`task.ts` 1058, `sessions.ts` 960, `agent-finish-plan.ts` 853, `workspace.ts` 851,
`config.ts` 845, `project.ts` 820, `chat.ts` 779, `task-support.ts` 756, `ask.ts` 755.

**Rust (`packages/tractor/src`)** — `fs_shell_core.rs` 1366 (test), `lib.rs` 1150,
**`sidecar/mod.rs` 1130** (grown by the liveness endpoint), `lsp_bridge.rs` 1073,
`env_and_runtime.rs` 1014, `core.rs` 957. (Memory `fatiamento-rust-tractor-padrao`
holds the verbatim-move slicing pattern; `fs_shell_core`/`sidecar` remained on its
"restam >1000" list.)

## Security debt

- **Plugin-id: traversal CLOSED (b9cd5d1b); the RS↔TS identity drift is the open
  debt.** `pluginIdToFsToken` (neutral, `@refarm.dev/config/plugin-identity`) is
  now the single filesystem-safe projection — the CLI install/read-back/sentinel
  route through it, traversal is contained + unit-proved. It is a purely LOCAL-fs
  projection: it never touches the wire (config.json / trusted_plugins carry the
  original `@refarm/agent`, which the Rust host reads), so this slice added no new
  cross-stack drift. But three id notions still disagree (Arthur: "cuidado com o
  drift RS↔TS"):
    1. TS `pluginIdToFsToken` — flatten `/`,`\`→`_`, drop `@` (fs segment).
    2. Rust `is_safe_plugin_id_token` (`policy_and_fs.rs:80`) — FORBIDS `@ / :`
       (gates the shell allowlist, not fs paths).
    3. Rust `manifest_runtime_plugin_id` (`env_and_runtime.rs:478`) — last `/`
       segment (`@refarm/agent`→`agent`), the trust-gate/runtime token.
  These were three ad-hoc projections of one identity. **CHARSET DRIFT CLOSED
  (854fb324):** the fs-safe charset now has a single source
  (`PLUGIN_ID_FS_SAFE_CHARS` + `PLUGIN_ID_MAX_LEN` in config/plugin-identity),
  `pluginIdRuntimeToken` is the DECLARED mirror of the Rust last-segment projection
  (no longer a third unrelated string), and `check-plugin-id-charset.mjs` (in
  `gate:full:colony`) fails on any RS↔TS divergence — verified it has teeth. The
  guard reads the existing inline Rust, so §8 stayed untouched. Remaining (optional,
  deferred): (a) golden-vector guard for the runtime projection's behavior (Target
  B); (b) naming the Rust charset as a const (§8 hardening, clean local rename, needs
  explicit approval); (c) the born-with-the-plugin id derivation per distribution
  (npm scope / GIT repo / p2p hash / local slug / runtime urn) — gated on the Barn.
  The canonical id contract (map wf_8431babc: free `name` + command-safe `id`) is
  the north; the low-level charset drift that "dificulta as coisas" is now locked.
- **Grant-enforcement foundation (the road to S2-strong).** Arthur's doctrine:
  support every possible grant, don't waste the effort, arrive at S2 strong, and
  eventually deliver the persona install-and-approve UX — "security down at the
  host so the multi-surface does it beautifully." **The persona install→approve→
  persist→enforce loop is now CLOSED end-to-end** (47a7a8d1 approve+persist,
  f05c556b host enforcement): `plugin approve` (an 8th tri-surface verb) persists
  `approvedPermissions` to the sovereign config; the host intersects declared ∩
  approved at load, so approving fewer capabilities really restricts — proved
  through the linker (a plugin declaring network:outbound but approved for only
  fs:read fails to link wasi:http). The gate trichotomy below is what gave the loop
  its teeth. All fed by the single `PermissionGrant::grants(cap)` decision point:
  - **Gate A — linker-omit** (`network:outbound`/wasi:http): DONE (e568eafc,
    proved e2e). Does NOT generalize — base WASI `add_to_linker_async` is
    monolithic (no `add_only_*` for fs/sockets).
  - **Gate B — context-scope** (`wasi:filesystem` preopens, `wasi:sockets`
    `socket_addr_check`, env): the import links, the capability is empty without
    the grant. **Filesystem DONE (7d3f9f55)** — the runtime-dir preopen is derived
    from the fs grant (`fs_preopen_perms`: none/read-only/read-write) instead of
    unconditional `all()`; built once in `load()` and threaded into both the
    component and P1 paths. Closes a LATENT hole (a future
    `wasi:filesystem`-importing plugin is scoped from day one; today's fs surface
    is host-fs at Gate C). Sockets (`net:socket` via `socket_addr_check`) rides the
    identical movement — add when a plugin needs it, not speculatively.
  - **Gate C — host-bridge per-call** (`host-fs`/`host-shell`): where integration
    plugins actually reach fs/shell. Was **the ACTIVE hole** — DONE (01146221).
    read/write/edit and spawn now gate on the declared capability via a centralized
    `enforce_permission(Permission)`, BESIDE (not replacing) the path/identity
    checks. Dev-permissive is a no-op; the agent declares all four so it's
    unaffected. Tests assert denial fails AT THE CAPABILITY GATE (right-reason).
    `HostSpawnHost::do_spawn` (host-effects.wasm's TCB mechanism import) is
    intentionally not gated — documented, not a silent bypass.
  - **Vocabulary (FATIA 1) — DONE (6bf43502).** Was free strings, no validation,
    two unrelated axes (effect `permissions[]` vs requires `capabilities.requires`).
    Now a closed Rust `enum Permission` (source of truth, +label/risk for the
    approval UX), a mirrored TS union, reject-unknown validation on both sides, and
    a drift guard (`check-permission-vocab.mjs`, wired into `gate:full:colony`,
    verified it has teeth). This is the single source every later grant + the S2
    approval ceremony builds on.
- **S1: `boot` silently discarded `config.security_mode` — DONE (eb9d2277).** boot
  now honors the configured posture; the Strict LOAD gate is seeded from the
  sovereign `trusted_plugins` allowlist (absent→permissive, `*`→all, listed→trust,
  configured-omits→deny). Production actually enforces Strict now. The trust model
  was unfinished at issuance; reconciled the sovereign way.
- **S2: Rust↔TS trust mirror drift (ADR-worthy, not yet done).** TS gates plugin
  LOAD on registry status (validated/active) and uses the trust-grant only for the
  trusted-fast execution-profile upgrade; Rust repurposed the grant as the load
  gate itself and has no registry-status concept. The S1 reconciliation kept Rust's
  load-gate semantics (+ the sovereign allowlist). Deciding whether Rust should
  mirror TS (registry-gated load) or TS should mirror Rust is a larger design call
  — wants an ADR. Also unbuilt: the promised `trust_grants` SQLite table
  (schema-migration-strategy.md:30) + a `refarm plugin trust` CLI for explicit,
  persisted, acknowledge-risk grants (the TS `system:security:trust-plugin-once`
  ceremony has no Rust equivalent).

## Anti-drift policy (type/vocabulary duplication — Arthur 2026-07-10: "proteção para crescer e escalar")

Duplicating a type/list across packages is often the RIGHT call (it avoids a runtime
dependency for one shape). The danger is not the duplication — it is duplication that
**drifts silently**, caught only when a human notices it in a diff. So the rule:

**Every intentional cross-package redeclaration ships with a sensor that turns drift into
a build error.** Two regimes — pick by the boundary:

1. **TS↔TS (pure type subset/mirror)** → a TYPE-LEVEL conformance test. Import the
   canonical type as a **type-only devDep** and assert the local shape stays assignable.
   Precedent: `packages/capabilities-v1/src/manifest-surface-conformance.test.ts`
   (ManifestExtensionSurface ⊂ plugin-manifest's ExtensionSurfaceDeclaration). A union +
   its value list → colocate the list at the type source with an exhaustiveness guard
   (`satisfies` + `Exclude<U, list[number]> extends never`). Precedent: `SURFACE_KEYS` in
   `apps/refarm/src/utils/composition.ts` (7397da1c).
2. **WIT / cross-language (Rust↔TS, WIT↔TS jco)** → a RUNTIME conformance fixture, NOT a
   type sensor. The boundary is a real serialization (json-ld-node string, jco camelCasing),
   so compile-time coupling is wrong ON PURPOSE. Precedent: `*.conformance.test.ts` (52 in
   the repo), `quality-checker-ref` (comment: "runtime conformance proves parity, not a
   compile-time coupling"), the tractor-ts `drift-prevention` wasi-imports test.

Audit done 2026-07-10 (~20 self-declared "mirror/subset"): the only unprotected pure TS↔TS
type redeclaration was ManifestExtensionSurface (now sensored) + SURFACE_KEYS (now guarded);
everything else is same-package (TS checks natively) or regime 2. When adding a new
redeclaration, add its sensor in the same commit — don't leave it for a future diff-catch.

## Process debt

- P0 (PRE-EXISTING, found 2026-07-09): `assertTaskSmokeBuildOrderIntegrity`
  (scripts/ci/subprocess-utils.mjs, git-hook 4a) FAILS at HEAD: `build order missing
  "packages/sidecar-client" required by "packages/context-provider-v1" via
  "@refarm.dev/sidecar-client"`. `sidecar-client` is a TS build (has tsconfig.build +
  build script) but absent from TASK_SMOKE_TS_BUILD_ORDER while a listed package
  depends on it — the exact ADR-066 invariant. Verified pre-existing (stash test), not
  from the enrichment-provider-ref work. NOT a 1-line fix: the check stops at the first
  gap, but at least TWO packages are missing — `sidecar-client` AND its dep
  `pressure-contract-v1` (both TS builds). A correct fix sweeps ALL missing TS-build
  packages + their order, not just the two this error surfaced; that's a own slice, not
  an in-passing fix. Provider-ref plugins (source/enrichment) are correctly ABSENT (leaf,
  nothing in the list depends on them).
- P1: markdown-lint warnings on memory files (MD032/MD033/MD041) are cosmetic
  false-positives; the memory harness doesn't render them. Not worth per-file
  fixing; noted so we stop re-flagging.
- P2: `apps/refarm/dist` is a gitignored TS-Strict artifact — rebuild after src
  edits (§2) before anything imports from `dist`; nothing to commit.
- P3: **`SidecarState` construction is decentralized** — 7 test call sites remount
  the same 8 fields by hand (`SidecarState::new(Arc::new(...), …, namespace)`), so
  every new field hurts in 7 places (the smell that surfaced when wiring reload).
  Fix: a centralized `SidecarState::for_test(base_dir, namespace)` (or a builder)
  that assembles the defaults once; migrate the call sites. Do it BYTE-NEUTRAL —
  the helper must produce the exact same state the manual construction did.
- P4: **Sidecar suite needs hardening against regression** (Arthur) — the sidecar
  is the critical path (efforts, sessions, plugin reload, dispatch). Before/while
  centralizing test construction (P3) and wiring real hot-reload, tighten coverage
  so a refactor there can't silently mask a regression. Track which endpoints have
  behavioral (not just status-code) assertions; fill the gaps.

## Abstract follow-ons

- **wac composition — HELD (not premature-forever, premature-now).** The one real
  composition pair (`host-effects.wasm ⊕ agent.wasm`) already works via native
  bindings; the "fake" is the correct working state, `load_host_effects` is dead
  code, nothing is blocked. Runtime plugin→plugin linking is an industry limit
  (memory `bytecodealliance-canon-vs-refarm`), not our bug. Revisit trigger: a
  SECOND effect-consumer or a real WASM-path sovereignty-parity requirement. When
  it comes, reach for `wasm-tools compose` (already installed) before adopting
  `wac`-the-CLI as a new dep.
- **grants wasi:http enforcement — end-to-end test gap — DONE (e568eafc).** Built
  the `http-plugin` fixture (exports integration + imports wasi:http/outgoing-handler,
  DCE-pinned) + `tests/http_grant.rs` (3-row matrix). The negative row asserts the
  failure is AT THE LINKER (`wasi:http/` + "was not found in the linker"), not the
  trust bail nor manifest validation — cannot pass for the wrong reason. Two
  toolchain gotchas documented in the fixture README: wasmtime does semver-compat
  import matching (@0.2.3 plugin ↔ @0.2.1 host linker resolves), and cargo-component
  0.21.x needs `wit-bindgen-rt` (not the umbrella `wit-bindgen`). The fixture
  references the CANONICAL refarm:plugin WIT directly (a vendored copy would trip
  `check:wit`/ADR-083 the moment it's tracked — caught before commit).
- **grants next interfaces.** The per-plugin-linker pattern generalizes: filesystem
  and sockets are the next WASI interfaces to gate per declared-grant, reusing the
  same seam (a linker variant chosen at load by `PermissionGrant::grants`).

## How to use this lane

- New coupling/oversized finding → add a row here (don't fix inline unless policy
  #4 says pull it now).
- Pulling an item → move it under a dated "## Done" section with the commit.
- This doc is the thing to read before deciding whether a detour is warranted, so
  cleanup is a deliberate choice against a known backlog, not end-of-feature
  archaeology.
