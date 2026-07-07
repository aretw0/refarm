# Agent leg (#6) — follow-on decisions & seams

**Status:** decisions locked 2026-07-07, verified at source. Records what was
built, what was deliberately deferred, and the seams left for the surfaces
(TUI/Web) so none of it is re-litigated later.

The agent leg (#6) makes a plugin capability reachable by the agent as a tool:
declare once → CLI / REPL / HTTP / **AGENT**. It shipped in four commits
(`b343e586` TS projection, `3325585a` WIT `capability-tools` + shared
`PluginRegistry` + host impl + `get_plugin_api` unblocked, `3de4dadc` guest
dispatch arm, `f122a574` harness). This doc covers the strengthening pass that
followed.

## The live path is Rust — the TS projection is a web-surface seam

The **authoritative** agent-tool path is entirely in the Rust host + WASM guest:

- The guest calls `capability-tools.list-tools(provider)` (`packages/agent/src/tools.rs`)
  to get the plugin tool schemas, concatenated with its built-ins.
- The host renders those schemas in `render_tool_schema`
  (`packages/tractor/src/host/host_effects_bridge/capability_tools.rs`), enumerating
  every LOADED dispatchable plugin verb from the `PluginRegistry`.
- A model tool-call for an unrecognized name routes through the guest's
  `dispatch_tool` `other =>` arm → host `invoke_tool` → the target plugin's
  dispatch, under **that plugin's** grant.

The TS `agent-projector.ts` (`packages/cli/src/capabilities/`) is a **parallel,
pure "capability → tool schema" projection that is NOT on this live path**. It is
kept as the **web-surface seam**: the pure, TS-testable projection a future
browser / introspection endpoint (an HTTP surface listing the agent's tools for a
UI) would call — exactly the role `http-projector.ts` plays for the HTTP transport.

- It is deliberately **not re-exported from `capabilities/index.ts`** so nothing
  wires it onto the live path by accident. Import it directly when the web surface
  needs it.
- The `CapabilityAgentTransport { tool?, toolName? }` bucket (`types.ts`) is the
  opt-in + model-facing hints that projector reads — a seam contract, **not** a
  switch on the live guest path (a plugin verb reaches the agent by being loaded,
  no descriptor needs to set `transports.agent`).
- **Deliberate schema divergence:** the TS projector derives a rich per-arg schema
  with `required` (good for a human-facing web list); the live Rust
  `render_tool_schema` emits a fixed `{args: string[]}` shape (a plugin verb's real
  arg shape is opaque to the host today). **Do not "fix" the divergence by wiring
  the TS projector into the guest** — if a future slice teaches the host a plugin's
  per-arg schema, that is where they converge.

## setActiveTools → grant-derived — DEFERRED (not a gate)

pi has a per-run `setActiveTools` allow/exclude. The refarm equivalent was
considered and **deferred**, because it is **not a security gate** — the
load-time A/B/G grant already fully covers both axes:

- **Listability** composes at load: a revoked/untrusted plugin never loads →
  `register()` never runs → it is absent from the registry → `dispatchable_verbs()`
  cannot return it (`unregister` removes it on teardown).
- **Invocability** re-composes at call-time under the **target's** authority:
  `invoke_tool` re-resolves against the live registry and dispatches to the target
  plugin running in its own store/linker/grant. The agent lends no authority.

`CrossPluginAccess` deliberately carries **no grant data** (`{registry,
event_router, plugin_channels}` only) — there is nothing at list-time to "derive"
from. An active-tools list would only *narrow an already-safe set*: pure operator
ergonomics, not protection, with no consumer demand today.

**If it is ever built** (notes so it isn't re-litigated):

- It is a **device-local operator preference** (like `approvedPermissions` /
  `MODEL_SHELL_ALLOWLIST`), NOT converged. A field on `RefarmCliConfig`
  (`apps/refarm/src/commands/config-shared.ts`), e.g. `agentToolsAllow?/
  agentToolsDeny?: string[]` keyed by `<key>_<verb>`.
- The filter is **host-side (Rust)** in `capability_tools.rs` → cheap, **no
  `agent.wasm` rebuild** (the guest just concatenates a pre-rendered list).
- It **must filter BOTH `list_tools` AND `invoke_tool`**, or the model could invoke
  by name a tool it was never shown — a cosmetic gate is the trap.

## promptSnippet / promptGuidelines — the real payoff (building now)

pi lets a tool inject a usage snippet into the system prompt. The refarm
equivalent teaches the model that plugin tools **route to plugins** and how their
args are shaped — under-explained by the flat `{args: string[]}` schema alone.

- **Slice 1 (building):** a new WIT fn `list-tool-prompts() -> list<string>` on the
  `capability-tools` interface (a snippet lands in the `system` string, a different
  sink than `list-tools`' schema array — so a parallel fn, not an overload). The
  host synthesizes one guidance line per dispatchable verb from the same
  `dispatchable_verbs()` it already iterates (no manifest change). The guest appends
  the joined snippets in `resolve_system_prompt()` (`packages/agent/src/runtime/policy.rs`),
  mirroring the existing `task_context_for_prompt()` clause. §8 (WIT + guest) → one
  `agent.wasm` rebuild.
- **Slice 2 (LATER):** plugin-declared per-verb prose. Wider blast radius (manifest
  schema + `RuntimePluginCapabilities` + `PluginCapabilityProfile`/`DispatchableVerb`
  + `register()` signature). Its snippet lookup is the natural first consumer of
  `PluginRegistry::profile()` (currently `#[cfg(test)]`-gated). Gated on a plugin
  wanting to declare one.

## get_plugin_api — unblocked, awaiting a WASM SPI provider (LATER)

`get_plugin_api` now resolves `api:<name>` against the registry
(`plugin_providing_api`), no longer a stub. But **no loaded WASM plugin declares a
provided API into the registry** today: `providesApi` entries exist only on the
agent guest and a JS-worker plugin, neither of which runs the Rust WASM
`register()` path. It correctly awaits the first SPI-provider WASM plugin; the
contract is pinned by the `plugin_providing_api_matches_the_api_convention` unit
test. No fixture needed until a real provider exists.

## Genuinely-later, tracked elsewhere (not agent-leg loose ends)

- Phase-3 linker composition (`HostEffectsHandle.component/.store`, HANDOFF Tarefa
  2B/2C).
- `build_anthropic_body` / `build_openai_body` non-streaming test shims.
- `get_identity` anonymous-guest stub.
