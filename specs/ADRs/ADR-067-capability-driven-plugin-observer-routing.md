# ADR-067: Capability-Driven Plugin Observer Routing

**Status**: Accepted  
**Date**: 2026-06-01  
**Deciders**: Arthur Silva  
**Related**: Barn/Scarecrow evolution work (package-owned policy implementation and plugin lifecycle), ADR-050 (Zig/WASM agent-tool host strategy)

---

## Context

After implementing Scarecrow Step 3 (structured observation hooks in `core.rs`)
and Step 4 (audit subscriber + policy plugin routing), the initial implementation
routed `agent-tool:*` TelemetryBus events to plugins by checking whether the
plugin's id started with `"@refarm/scarecrow"`.

This created two problems:

1. **Semantic coupling in the wrong layer** — `packages/tractor` (the host)
   should not know the name of any specific observer plugin. The Tractor is a
   general-purpose WASM host; "Scarecrow" is the name of one implementation.
   Hardcoding a prefix string couples an architectural mechanism to a deployment
   artifact name.

2. **Implicit, not intentional** — any plugin accidentally named
   `@refarm/scarecrow-*` would silently become an observer. There is no contract
   that a plugin *promises* to handle observation events.

---

## Decision

**Plugin routing for `agent-tool:*` events is driven by an explicit capability
declaration in the plugin manifest.**

A plugin opts into receiving agent-tool events by declaring in its `plugin.json`:

```json
{
  "capabilities": {
    "provides": ["observe-agent-tools"]
  }
}
```

The tractor reads `capabilities.provides` from the manifest at plugin load time
(deserialised into `RuntimePluginManifest.capabilities.provides`), propagates
the list through `PluginInstanceHandle.provides`, and populates a dedicated
`observer_channels` map in `TractorNative` for any plugin that includes the
capability string.

The constant `tractor::observer::CAP_OBSERVE_AGENT_TOOLS = "observe-agent-tools"`
is the single stable contract between plugin authors and the host router.

---

## Consequences

**Positive:**

- **No plugin names in the host** — `packages/tractor` is agnostic about who
  implements observation policy; it only checks the declared capability.
- **Intentional opt-in** — a plugin must explicitly declare the capability; there
  is no accidental enrollment.
- **Multiple observers** — any number of plugins can declare the capability and
  all will receive events. A "strict" Scarecrow and a "logging-only" Scarecrow
  can coexist.
- **Consistent with the broader plugin contract** — `capabilities.provides` is
  already part of the `PluginManifest` schema (JavaScript side); the Rust
  `RuntimePluginManifest` now reads the same field.
- **Testable by contract** — `capability_constant_is_stable` test in
  `env_and_runtime.rs` guards against silent string drift between the constant
  in code and what plugin authors write in manifests.

**Negative / Trade-offs:**

- **Plugin must be loaded before it can observe** — there is no retroactive
  event delivery; events that occur before the observer plugin is loaded are
  only written to the audit file, not delivered to the plugin.
- **Requires manifest alongside WASM** — the tractor already warns when a
  `plugin.json` is absent, but a plugin that has no manifest will silently not
  receive events even if it exports the appropriate `on-event` handler. This is
  consistent with the existing manifest-required policy.

---

## Alternatives Considered

### A. Name-prefix matching (rejected)

`if plugin_id.starts_with("@refarm/scarecrow")` — the original implementation.
Rejected because it couples the host to specific deployment artifact names and
is implicit rather than contractual.

### B. New WIT interface (`scarecrow-bridge`)

Define a new WIT import/export for policy plugins. This would allow richer
bidirectional communication (e.g., plugin calling back to block an operation)
but requires new WIT definitions, `bindgen!` expansion, and plugin recompilation.
Deferred as a future evolution once the audit-and-log use case is validated.
The `on-event` mechanism in the existing `integration` WIT interface is
sufficient for Step 4.

### C. Dedicated capability registry

A runtime registry mapping capability → list of plugin ids, queried at dispatch
time. More flexible than the current `observer_channels` map but adds
indirection. Not needed until capability routing is required for more than
one observation dimension.

---

## Implementation Notes

- `packages/tractor/src/observer.rs` — audit subscriber, `CAP_OBSERVE_AGENT_TOOLS`
  constant, `forward_to_observers` (no filtering, sends to all observer_channels)
- `packages/tractor/src/lib.rs` — `TractorNative.observer_channels`, populated
  in `register_for_events` based on `PluginInstanceHandle.provides`
- `packages/tractor/src/host/instance.rs` — `PluginInstanceHandle.provides`
- `packages/tractor/src/host/plugin_host/env_and_runtime.rs` —
  `RuntimePluginCapabilities`, deserialized from `plugin.json`; 4 unit tests
  in `capability_tests` module

The reference Scarecrow implementation will live in `packages/scarecrow` and
declare `"observe-agent-tools"` in its manifest — no special treatment in the
host required.
