# Declared Connections — Host Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Tractor's host a shared, operator-declared connection engine — one live process per declared name, several claimants, readiness decided by a **probe**, output published as `stream:v1` frames — so an interactive login like the Serpro VPN is established once and reused.

**Architecture:** The engine is a new part of the existing flattened `host_effects_bridge` module, so it inherits every private guard (`enforce_shell_allowlist`, `enforce_spawn_env`, `enforce_spawn_cwd`, the `MAX_*` caps) without changing a single visibility. Connections are declared in `.refarm/config.json` and read through the existing hardened reader. Nothing is exposed to WASM plugins here — the WIT surface, the permission, and the operator CLI are separate plans.

**Tech Stack:** Rust, tokio, `regex` (new dependency), `serde_json`, the existing `NativeSync` graph store.

Design spec: [`docs/superpowers/specs/2026-07-28-declared-connections-shared-sessions-design.md`](../specs/2026-07-28-declared-connections-shared-sessions-design.md)

## Global Constraints

- **Source is truth.** Never edit generated artifacts (CLAUDE.md §1).
- **Rust build economy** (CLAUDE.md §7, ~8GB RAM): use `cargo check --quiet -p tractor` and
  `cargo test --lib <filter> --quiet`. **Never** run bare `cargo test`. **Never** run
  `cargo component build` in this plan.
- **No WASM component involved.** Tests construct plain Rust values, mirroring
  `packages/tractor/src/host/host_effects_bridge_tests/fs_shell_core.rs`.
- **Do not touch `packages/plugin-manifest/**`, `.github/workflows/**`, `.project/**`** — protected
  surfaces (CLAUDE.md §8), reserved for Plan 2.
- **Do not add a WIT interface, a `Permission` variant, or a CLI command here** — Plans 2 and 3.
- **Readiness is the probe, never a pattern** (design D1b). Patterns govern only `notices` and the
  probe's `expect`. A missed notice must never change an outcome.
- **The probe is structured argv, never a shell.** Reject `sh`/`bash`-style wrappers at parse time
  (by basename, so `/bin/sh` is caught too): allowing `sh -c` in the allowlist allows everything.
  A probe that genuinely needs composition must **declare that intent and ask the operator**
  (design D1c) — a path not implemented in this plan, so `probe.shell` is rejected with a message
  naming the decision rather than silently downgraded to "not up".
- **Regex engine:** Rust `regex` crate only. No lookahead, lookbehind, or backreferences.
- **No prompt answering in this plan.** A declaration containing `prompts` is rejected at parse time.
- **Commit trailers:** end every commit message with the two lines this repo uses — copy them from
  `git log -1 --format=%B`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/tractor/Cargo.toml` | add the `regex` dependency |
| `packages/tractor/src/host/host_effects_bridge.rs` | add three `include!` lines |
| `.../host_effects_bridge/connection_decl.rs` | declaration type, config parsing, validation |
| `.../host_effects_bridge/connection_frames.rs` | publish `stream:v1` chunk + session observations |
| `.../host_effects_bridge/connection_engine.rs` | the probe loop, the registry, the process adapter |
| `packages/tractor/src/host/host_effects_bridge_tests.rs` | add three `include!` lines |
| `.../host_effects_bridge_tests/connection_decl.rs` | declaration/parsing tests |
| `.../host_effects_bridge_tests/connection_frames.rs` | frame-publishing tests |
| `.../host_effects_bridge_tests/connection_engine.rs` | probe-loop and registry tests |

House style, confirmed in the codebase: a multi-file module is a `foo.rs` containing only `include!`
lines (`packages/tractor/src/host/host_effects_bridge.rs`); its tests are wired by
`#[cfg(test)] #[path = "../host_effects_bridge_tests.rs"] mod tests;` at
`host_effects_bridge/policy_and_fs.rs:787-789`; that test file is itself a list of `include!` lines.
All included files share ONE flattened module, so every private helper is in scope.

---

### Task 1: Connection declarations — parse and validate

**Files:**
- Modify: `packages/tractor/Cargo.toml`
- Create: `packages/tractor/src/host/host_effects_bridge/connection_decl.rs`
- Modify: `packages/tractor/src/host/host_effects_bridge.rs`
- Modify: `packages/tractor/src/host/host_effects_bridge_tests.rs`
- Test: `packages/tractor/src/host/host_effects_bridge_tests/connection_decl.rs`

**Interfaces:**
- Consumes: `read_refarm_config_value_at(base: &Path) -> Result<Option<serde_json::Value>, String>` —
  the existing hardened reader at `host_effects_bridge/policy_and_fs.rs:92`, private to this same
  flattened module and therefore callable directly.
- Produces:
  - `pub(crate) struct Probe { run: Vec<String>, expect: Option<regex::Regex> }`
  - `pub(crate) struct NoticeRule { pattern: regex::Regex, message: String }`
  - `pub(crate) enum Linger { Operator, Idle { ms: u64 } }`
  - `pub(crate) struct ConnectionDeclaration { name: String, establish: Vec<String>, env: Vec<(String, String)>, cwd: Option<String>, probe: Probe, probe_interval_ms: u64, ready_timeout_ms: u32, notices: Vec<NoticeRule>, linger: Linger }`
  - `pub(crate) fn parse_connections(cfg: &serde_json::Value) -> Result<std::collections::HashMap<String, ConnectionDeclaration>, String>`
  - `pub(crate) fn resolve_connections(base: &std::path::Path) -> Result<std::collections::HashMap<String, ConnectionDeclaration>, String>`

**Why filesystem-only, never the replicated node:** `resolve_trusted_plugins` reads fs ∩ node because
trust is a deny axis. A connection is not: it names a command that runs on *this* machine, so
honouring a declaration replicated from another device would let that device introduce a command
here.

- [ ] **Step 1: Add the `regex` dependency**

In `packages/tractor/Cargo.toml`, under `[dependencies]`, beside `serde_json`:

```toml
regex = "1"
```

- [ ] **Step 2: Wire the module and its tests**

Append to `packages/tractor/src/host/host_effects_bridge.rs`:

```rust
include!("host_effects_bridge/connection_decl.rs");
```

Append to `packages/tractor/src/host/host_effects_bridge_tests.rs`:

```rust
include!("host_effects_bridge_tests/connection_decl.rs");
```

- [ ] **Step 3: Write the failing tests**

Create `packages/tractor/src/host/host_effects_bridge_tests/connection_decl.rs`:

```rust
// Connection declaration parsing — the operator's catalog of long-lived connections.
// Pure over serde_json::Value: no filesystem, no process.

#[cfg(test)]
mod connection_decl_tests {
    use super::*;

    fn one(json: serde_json::Value) -> Result<ConnectionDeclaration, String> {
        parse_connections(&serde_json::json!({ "connections": { "c": json } }))
            .map(|mut m| m.remove("c").expect("declaration present"))
    }

    fn vpn() -> serde_json::Value {
        serde_json::json!({
            "establish": ["serpro-vpn", "connect"],
            "probe": { "run": ["ip", "-br", "link", "show", "ovpntun0"], "expect": "UP" }
        })
    }

    #[test]
    fn parses_a_minimal_declaration_with_defaults() {
        let decl = one(vpn()).unwrap();
        assert_eq!(decl.name, "c");
        assert_eq!(decl.establish, vec!["serpro-vpn".to_string(), "connect".to_string()]);
        assert_eq!(decl.probe.run[0], "ip");
        assert!(decl.probe.expect.as_ref().unwrap().is_match("ovpntun0 UP <POINTOPOINT>"));
        assert_eq!(decl.probe_interval_ms, DEFAULT_PROBE_INTERVAL_MS);
        assert_eq!(decl.ready_timeout_ms, DEFAULT_READY_TIMEOUT_MS);
        assert!(decl.notices.is_empty());
        assert!(matches!(decl.linger, Linger::Operator));
    }

    #[test]
    fn absent_connections_block_yields_an_empty_catalog() {
        assert!(parse_connections(&serde_json::json!({})).unwrap().is_empty());
    }

    #[test]
    fn a_probe_without_expect_succeeds_on_exit_code_alone() {
        let decl = one(serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["true"] }
        }))
        .unwrap();
        assert!(decl.probe.expect.is_none());
    }

    #[test]
    fn parses_notices_intervals_timeout_and_idle_linger() {
        let decl = one(serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["true"] },
            "probeIntervalMs": 250,
            "readyTimeoutMs": 5000,
            "notices": [{ "pattern": "Conectando", "message": "aprove o push" }],
            "linger": { "idleMs": 60000 }
        }))
        .unwrap();
        assert_eq!(decl.probe_interval_ms, 250);
        assert_eq!(decl.ready_timeout_ms, 5000);
        assert_eq!(decl.notices[0].message, "aprove o push");
        assert!(matches!(decl.linger, Linger::Idle { ms: 60000 }));
    }

    #[test]
    fn rejects_an_empty_establish_argv() {
        let err = one(serde_json::json!({
            "establish": [], "probe": { "run": ["true"] }
        }))
        .unwrap_err();
        assert!(err.contains("establish must be a non-empty array"), "unexpected: {err}");
    }

    #[test]
    fn rejects_a_missing_probe() {
        // Readiness IS the probe. Without one there is no way to know a connection is up,
        // and falling back to output matching is the ad-hoc coupling this design removes.
        let err = one(serde_json::json!({ "establish": ["bin"] })).unwrap_err();
        assert!(err.contains("probe is required"), "unexpected: {err}");
    }

    #[test]
    fn rejects_a_shell_wrapper_in_the_probe() {
        // `sh -c "... | grep -q UP"` is argv-shaped but reintroduces the shell: allowing
        // `sh` in the allowlist allows everything.
        for shell in ["sh", "bash", "zsh", "/bin/sh", "/usr/bin/env"] {
            let err = one(serde_json::json!({
                "establish": ["bin"],
                "probe": { "run": [shell, "-c", "ip link | grep UP"] }
            }))
            .unwrap_err();
            assert!(
                err.contains("probe must not invoke a shell"),
                "expected a shell rejection for {shell}, got: {err}"
            );
        }
    }

    #[test]
    fn rejects_legacy_ready_and_fail_patterns_loudly() {
        // An older config must not be silently half-honoured: a leftover `ready` would
        // look like it still decides readiness when the probe now does.
        for key in ["ready", "fail"] {
            let err = one(serde_json::json!({
                "establish": ["bin"],
                "probe": { "run": ["true"] },
                key: "whatever"
            }))
            .unwrap_err();
            assert!(
                err.contains("readiness is decided by `probe`"),
                "expected a rejection for {key}, got: {err}"
            );
        }
    }

    #[test]
    fn rejects_prompts_because_no_answer_path_exists_yet() {
        let err = one(serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["true"] },
            "prompts": [{ "pattern": "Senha: ", "label": "pw", "answer": { "askHuman": "senha" } }]
        }))
        .unwrap_err();
        assert!(err.contains("prompts are not supported yet"), "unexpected: {err}");
    }

    #[test]
    fn rejects_an_uncompilable_pattern_without_panicking() {
        let err = one(serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["true"], "expect": "([" }
        }))
        .unwrap_err();
        assert!(err.contains("invalid regex"), "unexpected: {err}");
    }

    #[test]
    fn rejects_an_oversized_pattern() {
        let long = "a".repeat(MAX_CONNECTION_PATTERN_LEN + 1);
        let err = one(serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["true"], "expect": long }
        }))
        .unwrap_err();
        assert!(err.contains("pattern exceeds max length"), "unexpected: {err}");
    }

    #[test]
    fn rejects_too_many_connections() {
        let mut conns = serde_json::Map::new();
        for i in 0..=MAX_CONNECTIONS {
            conns.insert(
                format!("c{i}"),
                serde_json::json!({ "establish": ["bin"], "probe": { "run": ["true"] } }),
            );
        }
        let err = parse_connections(&serde_json::json!({ "connections": conns })).unwrap_err();
        assert!(err.contains("too many connections"), "unexpected: {err}");
    }

    #[test]
    fn rejects_too_many_notice_rules() {
        let notices: Vec<_> = (0..=MAX_CONNECTION_NOTICES)
            .map(|i| serde_json::json!({ "pattern": format!("n{i}"), "message": "m" }))
            .collect();
        let err = one(serde_json::json!({
            "establish": ["bin"], "probe": { "run": ["true"] }, "notices": notices
        }))
        .unwrap_err();
        assert!(err.contains("too many notice rules"), "unexpected: {err}");
    }

    #[test]
    fn rejects_a_non_object_connections_block() {
        let err = parse_connections(&serde_json::json!({ "connections": [] })).unwrap_err();
        assert!(err.contains("connections must be an object"), "unexpected: {err}");
    }
}
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cargo test --lib connection_decl --quiet`
Expected: FAIL to compile — the types and `parse_connections` do not exist.

- [ ] **Step 5: Write the implementation**

Create `packages/tractor/src/host/host_effects_bridge/connection_decl.rs`:

```rust
// Connection declarations — the operator's catalog of long-lived, shared connections.
//
// A connection is a long-lived interactive process (a VPN client holding a tunnel, a
// logged-in session), declared by the OPERATOR in `.refarm/config.json`. Nothing else may
// introduce one. Same doctrine as `workspace run`'s `commands` allowlist: an operation
// catalog, never a shell.
//
// READINESS IS THE PROBE. The host does not decide a connection is up by matching a string
// in its output — it asks the system, exactly as `browser-driver`'s `awaitLoginDetected`
// polls a `LoginProbe`. rcdc5's own adapter already treats `ovpntun0` state as the truth
// and the console line as a mere flow signal.
//
// Read from the FILESYSTEM ONLY, never from the replicated config node: a connection names
// a command that runs HERE, so honouring one that arrived over CRDT would let another
// device introduce a command on this machine.

use std::collections::HashMap;
use std::path::Path;

pub(crate) const DEFAULT_READY_TIMEOUT_MS: u32 = 120_000;
pub(crate) const DEFAULT_PROBE_INTERVAL_MS: u64 = 1_000;
pub(crate) const MAX_CONNECTIONS: usize = 32;
pub(crate) const MAX_CONNECTION_NOTICES: usize = 16;
pub(crate) const MAX_CONNECTION_PATTERN_LEN: usize = 512;
pub(crate) const MAX_CONNECTION_NAME_LEN: usize = 128;

/// Binaries that would smuggle a shell back in through the probe. `sh -c "…"` is
/// argv-shaped but interprets a command string, so allowing it in the allowlist allows
/// everything. `env` is here for the same reason (`env sh -c …`).
const SHELL_LIKE: &[&str] = &["sh", "bash", "zsh", "dash", "ksh", "fish", "env", "eval", "command"];

/// What happens to a live connection once its last claim is released.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Linger {
    /// Stay up until the operator drops it or the host shuts down (the default).
    /// Re-establishing costs a human interruption (a phone approval); holding costs
    /// nearly nothing, and that asymmetry decides the default.
    Operator,
    /// Fall after this idle window with no claims.
    Idle { ms: u64 },
}

/// How the host asks the SYSTEM whether the connection is genuinely up. Success is exit
/// code 0 AND, when `expect` is set, the output matching it. Both cases matter for a
/// tunnel: a missing interface exits non-zero, an existing-but-down one exits zero and
/// prints `DOWN`.
#[derive(Debug, Clone)]
pub(crate) struct Probe {
    pub(crate) run: Vec<String>,
    pub(crate) expect: Option<regex::Regex>,
}

/// A point in the output that should surface a message to the human. Cosmetic by design:
/// a missed notice never changes an outcome.
#[derive(Debug, Clone)]
pub(crate) struct NoticeRule {
    pub(crate) pattern: regex::Regex,
    pub(crate) message: String,
}

/// One operator-declared connection.
#[derive(Debug, Clone)]
pub(crate) struct ConnectionDeclaration {
    pub(crate) name: String,
    /// The argv that brings the connection up and HOLDS it.
    pub(crate) establish: Vec<String>,
    pub(crate) env: Vec<(String, String)>,
    pub(crate) cwd: Option<String>,
    pub(crate) probe: Probe,
    pub(crate) probe_interval_ms: u64,
    pub(crate) ready_timeout_ms: u32,
    pub(crate) notices: Vec<NoticeRule>,
    pub(crate) linger: Linger,
}

fn compile_pattern(raw: &str, field: &str, name: &str) -> Result<regex::Regex, String> {
    if raw.len() > MAX_CONNECTION_PATTERN_LEN {
        return Err(format!(
            "connection '{name}': {field} pattern exceeds max length ({MAX_CONNECTION_PATTERN_LEN})"
        ));
    }
    regex::Regex::new(raw).map_err(|e| format!("connection '{name}': {field} invalid regex: {e}"))
}

fn string_array(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|s| s.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

fn parse_probe(name: &str, value: &serde_json::Value) -> Result<Probe, String> {
    let probe_value = value.get("probe").ok_or_else(|| {
        format!("connection '{name}': probe is required — readiness is decided by a probe, not by output")
    })?;

    let run = string_array(probe_value.get("run"));
    if run.is_empty() {
        return Err(format!("connection '{name}': probe.run must be a non-empty array of strings"));
    }

    // Reject shell wrappers by the BINARY NAME, ignoring any directory, so `/bin/sh`
    // is caught as well as `sh`.
    let binary = std::path::Path::new(&run[0])
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&run[0]);
    if SHELL_LIKE.contains(&binary) {
        return Err(format!(
            "connection '{name}': probe must not invoke a shell ('{binary}') — use structured argv \
             with an `expect` pattern. If the check genuinely needs composition, a future \
             `probe.shell` + `probe.reason` declares that intent and asks the operator to grant it \
             (design D1c); it is not supported yet."
        ));
    }

    // D1c: a composing probe must ASK, never be silently allowed. Until the approval path
    // exists, declaring one is a clear error naming the decision — not a silent downgrade
    // to "not up", which would read as a broken tunnel instead of a withheld permission.
    if probe_value.get("shell").is_some() {
        return Err(format!(
            "connection '{name}': probe.shell requires an operator grant, which is not implemented \
             yet (design D1c) — use structured `probe.run` with `expect` for now"
        ));
    }

    let expect = match probe_value.get("expect").and_then(|v| v.as_str()) {
        Some(raw) => Some(compile_pattern(raw, "probe.expect", name)?),
        None => None,
    };

    Ok(Probe { run, expect })
}

fn parse_one(name: &str, value: &serde_json::Value) -> Result<ConnectionDeclaration, String> {
    if name.is_empty() || name.len() > MAX_CONNECTION_NAME_LEN {
        return Err(format!("connection name '{name}' has invalid length"));
    }

    // A leftover `ready`/`fail` from an earlier config shape must fail loudly: half-honouring
    // it would look like output still decides readiness when the probe now does.
    for legacy in ["ready", "fail"] {
        if value.get(legacy).is_some() {
            return Err(format!(
                "connection '{name}': `{legacy}` is no longer supported — readiness is decided by `probe`"
            ));
        }
    }

    // A prompt rule needs an answer path, which does not exist yet. Accepting it silently
    // would let a login hang forever waiting for an answer nobody can give.
    if value.get("prompts").is_some() {
        return Err(format!(
            "connection '{name}': prompts are not supported yet — remove the `prompts` block"
        ));
    }

    let establish = string_array(value.get("establish"));
    if establish.is_empty() {
        return Err(format!(
            "connection '{name}': establish must be a non-empty array of strings"
        ));
    }

    let probe = parse_probe(name, value)?;

    let notice_values = value.get("notices").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    if notice_values.len() > MAX_CONNECTION_NOTICES {
        return Err(format!(
            "connection '{name}': too many notice rules (max {MAX_CONNECTION_NOTICES})"
        ));
    }
    let mut notices = Vec::with_capacity(notice_values.len());
    for nv in &notice_values {
        let raw = nv
            .get("pattern")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("connection '{name}': notice pattern is required"))?;
        let message = nv
            .get("message")
            .and_then(|v| v.as_str())
            .ok_or_else(|| format!("connection '{name}': notice message is required"))?
            .to_string();
        notices.push(NoticeRule { pattern: compile_pattern(raw, "notice", name)?, message });
    }

    let env: Vec<(String, String)> = value
        .get("env")
        .and_then(|v| v.as_object())
        .map(|o| o.iter().filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string()))).collect())
        .unwrap_or_default();

    let cwd = value.get("cwd").and_then(|v| v.as_str()).map(str::to_string);

    let ready_timeout_ms = value
        .get("readyTimeoutMs")
        .and_then(|v| v.as_u64())
        .map(|v| v.min(u32::MAX as u64) as u32)
        .unwrap_or(DEFAULT_READY_TIMEOUT_MS);

    let probe_interval_ms = value
        .get("probeIntervalMs")
        .and_then(|v| v.as_u64())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_PROBE_INTERVAL_MS);

    let linger = match value.get("linger") {
        None => Linger::Operator,
        Some(serde_json::Value::String(s)) if s == "operator" => Linger::Operator,
        Some(v) => match v.get("idleMs").and_then(|x| x.as_u64()) {
            Some(ms) => Linger::Idle { ms },
            None => {
                return Err(format!(
                    "connection '{name}': linger must be \"operator\" or {{ idleMs: <number> }}"
                ))
            }
        },
    };

    Ok(ConnectionDeclaration {
        name: name.to_string(),
        establish,
        env,
        cwd,
        probe,
        probe_interval_ms,
        ready_timeout_ms,
        notices,
        linger,
    })
}

/// Parse the `connections` block. An absent block is an empty catalog (not an error); a
/// present-but-malformed block fails shut.
pub(crate) fn parse_connections(
    cfg: &serde_json::Value,
) -> Result<HashMap<String, ConnectionDeclaration>, String> {
    let Some(block) = cfg.get("connections") else {
        return Ok(HashMap::new());
    };
    let Some(obj) = block.as_object() else {
        return Err("connections must be an object".to_string());
    };
    if obj.len() > MAX_CONNECTIONS {
        return Err(format!("too many connections declared (max {MAX_CONNECTIONS})"));
    }
    let mut out = HashMap::with_capacity(obj.len());
    for (name, value) in obj {
        out.insert(name.clone(), parse_one(name, value)?);
    }
    Ok(out)
}

/// Resolve the catalog from `.refarm/config.json` under `base`. Absent file ⇒ empty
/// catalog. Malformed file ⇒ error, matching the hardened reader's fail-shut posture.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn resolve_connections(
    base: &Path,
) -> Result<HashMap<String, ConnectionDeclaration>, String> {
    match read_refarm_config_value_at(base)? {
        Some(cfg) => parse_connections(&cfg),
        None => Ok(HashMap::new()),
    }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test --lib connection_decl --quiet`
Expected: PASS, 14 tests.

- [ ] **Step 7: Check the crate**

Run: `cargo check --quiet -p tractor`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/tractor/Cargo.toml \
        packages/tractor/src/host/host_effects_bridge.rs \
        packages/tractor/src/host/host_effects_bridge/connection_decl.rs \
        packages/tractor/src/host/host_effects_bridge_tests.rs \
        packages/tractor/src/host/host_effects_bridge_tests/connection_decl.rs
git commit -m "feat(tractor): parse operator-declared connections, readiness by probe"
```

---

### Task 2: Publish connection frames on `stream:v1`

**Files:**
- Create: `packages/tractor/src/host/host_effects_bridge/connection_frames.rs`
- Modify: `packages/tractor/src/host/host_effects_bridge.rs`
- Modify: `packages/tractor/src/host/host_effects_bridge_tests.rs`
- Test: `packages/tractor/src/host/host_effects_bridge_tests/connection_frames.rs`

**Interfaces:**
- Consumes: `crate::streaming::observations::{StreamChunkObservationDraft, StreamSessionObservationDraft, stream_chunk_observation_id, stream_chunk_observation_node, stream_session_observation_id, stream_session_observation_node}`; `NativeSync::store_node(&self, id: &str, type_: &str, parent: Option<&str>, payload: &str, source: Option<&str>)` — call shape copied verbatim from `packages/tractor/src/host/wasi_bridge/model_stream_events.rs:550-568`.
- Produces:
  - `pub(crate) fn connection_stream_ref(name: &str) -> String`
  - `pub(crate) struct ConnectionFramePublisher`
  - `impl ConnectionFramePublisher { pub(crate) fn new(name: &str, now_ns: u64) -> Self; pub(crate) fn notice(&mut self, sync: &NativeSync, message: &str, now_ns: u64) -> Result<(), String>; pub(crate) fn terminal(&mut self, sync: &NativeSync, reason: &str, detail: &str, now_ns: u64) -> Result<(), String>; pub(crate) fn last_sequence(&self) -> u32 }`

`payload_kind` is a `String` and `metadata` a `serde_json::Value` on the Rust draft
(`packages/tractor/src/streaming/observations.rs:1-22`), so `"notice"` and the terminal kinds are
**data, not schema** — nothing in `streaming/` changes.

- [ ] **Step 1: Wire the module and its tests**

Append to `packages/tractor/src/host/host_effects_bridge.rs`:

```rust
include!("host_effects_bridge/connection_frames.rs");
```

Append to `packages/tractor/src/host/host_effects_bridge_tests.rs`:

```rust
include!("host_effects_bridge_tests/connection_frames.rs");
```

- [ ] **Step 2: Write the failing tests**

Create `packages/tractor/src/host/host_effects_bridge_tests/connection_frames.rs`:

```rust
// Connection frames — every observed transition becomes a stream:v1 chunk on the
// connection's stream_ref, plus one StreamSession per connection instance.

#[cfg(test)]
mod connection_frames_tests {
    use super::*;
    use crate::{NativeStorage, NativeSync};

    fn sync() -> NativeSync {
        let storage = NativeStorage::open(":memory:").unwrap();
        NativeSync::new(storage, ":memory:").unwrap()
    }

    fn chunks(sync: &NativeSync, stream_ref: &str) -> Vec<serde_json::Value> {
        let mut found: Vec<serde_json::Value> = sync
            .query_nodes("StreamChunk", 1000)
            .unwrap_or_default()
            .iter()
            .filter_map(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            .filter(|n| n.get("stream_ref").and_then(|v| v.as_str()) == Some(stream_ref))
            .collect();
        found.sort_by_key(|n| n.get("sequence").and_then(|v| v.as_u64()).unwrap_or(0));
        found
    }

    #[test]
    fn stream_ref_is_derived_from_the_connection_name() {
        assert_eq!(
            connection_stream_ref("serpro-vpn"),
            "urn:tractor:stream:connection:serpro-vpn"
        );
    }

    #[test]
    fn a_notice_becomes_a_notice_chunk() {
        let sync = sync();
        let mut p = ConnectionFramePublisher::new("serpro-vpn", 1);
        p.notice(&sync, "aprove o push no celular", 2).unwrap();

        let found = chunks(&sync, &connection_stream_ref("serpro-vpn"));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0]["payload_kind"], "notice");
        assert_eq!(found[0]["content"], "aprove o push no celular");
        assert_eq!(found[0]["is_final"], false);
    }

    #[test]
    fn sequence_numbers_increase_strictly_across_frames() {
        let sync = sync();
        let mut p = ConnectionFramePublisher::new("c", 1);
        p.notice(&sync, "one", 2).unwrap();
        p.notice(&sync, "two", 3).unwrap();
        p.terminal(&sync, "ready", "", 4).unwrap();

        let seqs: Vec<u64> = chunks(&sync, &connection_stream_ref("c"))
            .iter()
            .map(|n| n["sequence"].as_u64().unwrap())
            .collect();
        assert_eq!(seqs, vec![1, 2, 3]);
        assert_eq!(p.last_sequence(), 3);
    }

    #[test]
    fn the_terminal_frame_is_final_and_carries_the_reason() {
        let sync = sync();
        let mut p = ConnectionFramePublisher::new("c", 1);
        p.terminal(&sync, "timeout", "probe never succeeded", 2).unwrap();

        let found = chunks(&sync, &connection_stream_ref("c"));
        assert_eq!(found.len(), 1);
        assert_eq!(found[0]["payload_kind"], "timeout");
        assert_eq!(found[0]["is_final"], true);
        assert_eq!(found[0]["content"], "probe never succeeded");
    }

    #[test]
    fn a_session_node_tracks_the_connection_instance() {
        let sync = sync();
        let mut p = ConnectionFramePublisher::new("c", 10);
        p.notice(&sync, "n", 11).unwrap();
        p.terminal(&sync, "ready", "", 12).unwrap();

        let raw = sync.get_node(&connection_stream_ref("c")).unwrap().unwrap();
        let node: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(node["@type"], "StreamSession");
        assert_eq!(node["stream_kind"], "connection");
        assert_eq!(node["status"], "completed");
        assert_eq!(node["last_sequence"], 2);
        assert_eq!(node["chunk_count"], 2);
    }

    #[test]
    fn a_session_is_active_until_a_terminal_frame() {
        // node_reap never sweeps a non-terminal StreamSession, so a live connection's
        // session must NOT be marked completed while it is still coming up.
        let sync = sync();
        let mut p = ConnectionFramePublisher::new("c", 10);
        p.notice(&sync, "n", 11).unwrap();

        let raw = sync.get_node(&connection_stream_ref("c")).unwrap().unwrap();
        let node: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(node["status"], "active");
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test --lib connection_frames --quiet`
Expected: FAIL to compile — `ConnectionFramePublisher` does not exist.

- [ ] **Step 4: Write the implementation**

Create `packages/tractor/src/host/host_effects_bridge/connection_frames.rs`:

```rust
// Connection frames — a connection's observable output, published on the EXISTING
// stream:v1 contract rather than a new one. The TS transports (sse/ws/file) and
// `stream-follower` already consume this shape, so a remote surface inherits both SSE and
// WebSocket without choosing.
//
// Raw process output is deliberately NOT published. Notices are the curated channel; a raw
// transcript is noise and one more surface for sensitive text to leave the host.

use crate::streaming::observations::{
    stream_chunk_observation_id, stream_chunk_observation_node, stream_session_observation_id,
    stream_session_observation_node, StreamChunkObservationDraft, StreamSessionObservationDraft,
};
use crate::sync::NativeSync;

/// The stream a connection publishes on. Stable and derivable, so any surface can
/// subscribe by name without asking the host for a handle.
pub(crate) fn connection_stream_ref(name: &str) -> String {
    format!("urn:tractor:stream:connection:{name}")
}

pub(crate) struct ConnectionFramePublisher {
    stream_ref: String,
    sequence: u32,
    chunk_count: u32,
    started_at_ns: u64,
}

impl ConnectionFramePublisher {
    pub(crate) fn new(name: &str, now_ns: u64) -> Self {
        Self {
            stream_ref: connection_stream_ref(name),
            sequence: 0,
            chunk_count: 0,
            started_at_ns: now_ns,
        }
    }

    pub(crate) fn last_sequence(&self) -> u32 {
        self.sequence
    }

    /// A human-facing message matched in the output (a push-approval wait, etc.).
    pub(crate) fn notice(
        &mut self,
        sync: &NativeSync,
        message: &str,
        now_ns: u64,
    ) -> Result<(), String> {
        self.chunk(sync, "notice", message, false, now_ns)?;
        self.session(sync, "active", None, now_ns)
    }

    /// The last frame of an attempt. `reason` is `ready` / `timeout` / `exit` / `error`.
    pub(crate) fn terminal(
        &mut self,
        sync: &NativeSync,
        reason: &str,
        detail: &str,
        now_ns: u64,
    ) -> Result<(), String> {
        self.chunk(sync, reason, detail, true, now_ns)?;
        let status = if reason == "ready" { "completed" } else { "failed" };
        self.session(sync, status, Some(now_ns), now_ns)
    }

    fn chunk(
        &mut self,
        sync: &NativeSync,
        payload_kind: &str,
        content: &str,
        is_final: bool,
        now_ns: u64,
    ) -> Result<(), String> {
        self.sequence += 1;
        self.chunk_count += 1;
        let draft = StreamChunkObservationDraft {
            stream_ref: self.stream_ref.clone(),
            sequence: self.sequence,
            payload_kind: payload_kind.to_string(),
            content: content.to_string(),
            is_final,
            timestamp_ns: now_ns,
            metadata: serde_json::json!({}),
        };
        let node_id = stream_chunk_observation_id();
        let node = stream_chunk_observation_node(&node_id, &draft);
        sync.store_node(&node_id, "StreamChunk", None, &node.to_string(), None)
            .map_err(|e| format!("store connection chunk: {e}"))?;
        Ok(())
    }

    fn session(
        &self,
        sync: &NativeSync,
        status: &str,
        completed_at_ns: Option<u64>,
        now_ns: u64,
    ) -> Result<(), String> {
        let draft = StreamSessionObservationDraft {
            stream_ref: self.stream_ref.clone(),
            stream_kind: "connection".to_string(),
            status: status.to_string(),
            started_at_ns: self.started_at_ns,
            updated_at_ns: now_ns,
            completed_at_ns,
            last_sequence: Some(self.sequence),
            chunk_count: self.chunk_count,
            metadata: serde_json::json!({}),
        };
        let node_id = stream_session_observation_id(&self.stream_ref);
        let node = stream_session_observation_node(&node_id, &draft);
        sync.store_node(&node_id, "StreamSession", None, &node.to_string(), None)
            .map_err(|e| format!("store connection session: {e}"))?;
        Ok(())
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test --lib connection_frames --quiet`
Expected: PASS, 6 tests.

If `query_nodes`/`get_node` differ in signature, read `packages/tractor/src/sync.rs` and adjust ONLY
the test helpers — the `store_node` call shape in the implementation is copied verbatim from
`model_stream_events.rs:560-567` and is correct.

- [ ] **Step 6: Commit**

```bash
git add packages/tractor/src/host/host_effects_bridge.rs \
        packages/tractor/src/host/host_effects_bridge/connection_frames.rs \
        packages/tractor/src/host/host_effects_bridge_tests.rs \
        packages/tractor/src/host/host_effects_bridge_tests/connection_frames.rs
git commit -m "feat(tractor): publish connection frames on the existing stream:v1 contract"
```

---

### Task 3: The probe loop

**Files:**
- Create: `packages/tractor/src/host/host_effects_bridge/connection_engine.rs`
- Modify: `packages/tractor/src/host/host_effects_bridge.rs`
- Modify: `packages/tractor/src/host/host_effects_bridge_tests.rs`
- Test: `packages/tractor/src/host/host_effects_bridge_tests/connection_engine.rs`

**Interfaces:**
- Consumes: `ConnectionDeclaration`, `NoticeRule` (Task 1); `ConnectionFramePublisher` (Task 2).
- Produces:
  - `pub(crate) enum EstablishOutcome { Ready, Timeout, Exit }`
  - `pub(crate) struct FlowProcess { pub(crate) chunks: tokio::sync::mpsc::Receiver<String>, pub(crate) stop: std::sync::Arc<tokio::sync::Notify> }`
  - `pub(crate) const MAX_CONNECTION_BUFFER: usize = 64 * 1024;`
  - `pub(crate) async fn establish(decl: &ConnectionDeclaration, process: &mut FlowProcess, probe: &mut (dyn FnMut() -> bool + Send), publisher: &mut ConnectionFramePublisher, sync: &NativeSync, now_ns: &(dyn Fn() -> u64 + Sync)) -> Result<EstablishOutcome, String>`

The probe is **injected as a closure** so the loop is unit-tested with no real command; Task 5
supplies the real one. The process is injected as a channel of output chunks, mirroring
`login-flow`'s `spec.spawn` injection (`packages/login-flow/src/index.ts:24-33`).

- [ ] **Step 1: Wire the module and its tests**

Append to `packages/tractor/src/host/host_effects_bridge.rs`:

```rust
include!("host_effects_bridge/connection_engine.rs");
```

Append to `packages/tractor/src/host/host_effects_bridge_tests.rs`:

```rust
include!("host_effects_bridge_tests/connection_engine.rs");
```

- [ ] **Step 2: Write the failing tests**

Create `packages/tractor/src/host/host_effects_bridge_tests/connection_engine.rs`:

```rust
// The connection probe loop. The probe decides readiness; output only produces notices.

#[cfg(test)]
mod connection_engine_tests {
    use super::*;
    use crate::{NativeStorage, NativeSync};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;
    use tokio::sync::{mpsc, Notify};

    fn sync() -> NativeSync {
        let storage = NativeStorage::open(":memory:").unwrap();
        NativeSync::new(storage, ":memory:").unwrap()
    }

    fn decl_from(json: serde_json::Value) -> ConnectionDeclaration {
        parse_connections(&serde_json::json!({ "connections": { "c": json } }))
            .unwrap()
            .remove("c")
            .unwrap()
    }

    fn base(extra: serde_json::Value) -> ConnectionDeclaration {
        let mut obj = serde_json::json!({
            "establish": ["bin"],
            "probe": { "run": ["true"] },
            "probeIntervalMs": 1,
            "readyTimeoutMs": 200
        });
        if let (Some(o), Some(e)) = (obj.as_object_mut(), extra.as_object()) {
            for (k, v) in e {
                o.insert(k.clone(), v.clone());
            }
        }
        decl_from(obj)
    }

    /// A process that emits `lines` and then STAYS OPEN (a held connection).
    fn holding(lines: &[&str]) -> (FlowProcess, mpsc::Sender<String>, Arc<Notify>) {
        let (tx, rx) = mpsc::channel(64);
        for line in lines {
            tx.try_send((*line).to_string()).unwrap();
        }
        let stop = Arc::new(Notify::new());
        (FlowProcess { chunks: rx, stop: stop.clone() }, tx, stop)
    }

    /// A process that emits `lines` and then ENDS.
    fn ending(lines: &[&str]) -> FlowProcess {
        let (tx, rx) = mpsc::channel(64);
        for line in lines {
            tx.try_send((*line).to_string()).unwrap();
        }
        drop(tx);
        FlowProcess { chunks: rx, stop: Arc::new(Notify::new()) }
    }

    fn clock() -> impl Fn() -> u64 + Sync {
        let c = std::sync::atomic::AtomicU64::new(0);
        move || c.fetch_add(1, Ordering::SeqCst)
    }

    /// A probe that fails `fail_times` times and then succeeds forever.
    fn probe_after(fail_times: u32) -> impl FnMut() -> bool + Send {
        let calls = AtomicU32::new(0);
        move || calls.fetch_add(1, Ordering::SeqCst) >= fail_times
    }

    #[tokio::test]
    async fn ready_when_the_probe_succeeds() {
        let sync = sync();
        let decl = base(serde_json::json!({}));
        let (mut proc_, _tx, _stop) = holding(&["▶ Conectando…\n"]);
        let mut probe = probe_after(0);
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();

        let out = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();
        assert!(matches!(out, EstablishOutcome::Ready));
    }

    #[tokio::test]
    async fn output_alone_never_makes_a_connection_ready() {
        // THE point of the probe: a process can claim success in its output and still not
        // be up. Only the probe decides.
        let sync = sync();
        let decl = base(serde_json::json!({ "readyTimeoutMs": 60 }));
        let (mut proc_, _tx, _stop) = holding(&["✅ VPN Serpro CONECTADA\n"]);
        let mut probe = || false;
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();

        let out = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();
        assert!(matches!(out, EstablishOutcome::Timeout), "the output lied; the probe did not");
    }

    #[tokio::test]
    async fn the_probe_is_retried_until_it_succeeds() {
        let sync = sync();
        let decl = base(serde_json::json!({}));
        let (mut proc_, _tx, _stop) = holding(&[]);
        let mut probe = probe_after(3);
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();

        let out = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();
        assert!(matches!(out, EstablishOutcome::Ready));
    }

    #[tokio::test]
    async fn a_never_succeeding_probe_times_out_and_stops_the_process() {
        let sync = sync();
        let decl = base(serde_json::json!({ "readyTimeoutMs": 60 }));
        let (mut proc_, _tx, stop) = holding(&[]);
        let observed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let watcher = {
            let stop = stop.clone();
            let observed = observed.clone();
            tokio::spawn(async move {
                stop.notified().await;
                observed.store(true, Ordering::SeqCst);
            })
        };
        tokio::task::yield_now().await;

        let mut probe = || false;
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();
        let out = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();

        assert!(matches!(out, EstablishOutcome::Timeout));
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert!(observed.load(Ordering::SeqCst), "a failed attempt must never leave the process running");
        watcher.abort();
    }

    #[tokio::test]
    async fn the_process_ending_before_the_probe_succeeds_settles_as_exit() {
        let sync = sync();
        let decl = base(serde_json::json!({}));
        let mut proc_ = ending(&["starting…\n", "gave up\n"]);
        let mut probe = || false;
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();

        let out = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();
        assert!(matches!(out, EstablishOutcome::Exit));
    }

    #[tokio::test]
    async fn a_notice_fires_once_per_occurrence() {
        let sync = sync();
        let decl = base(serde_json::json!({
            "notices": [{ "pattern": "Conectando", "message": "aprove o push" }],
            "readyTimeoutMs": 60
        }));
        let (mut proc_, _tx, _stop) = holding(&["Conectando…\n", "Conectando…\n"]);
        let mut probe = || false;
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();

        let _ = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();

        let notices = sync
            .query_nodes("StreamChunk", 1000)
            .unwrap_or_default()
            .iter()
            .filter_map(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            .filter(|n| n["payload_kind"] == "notice")
            .count();
        assert_eq!(notices, 1, "a notice fires once, not per matching chunk");
    }

    #[tokio::test]
    async fn a_notice_pattern_may_span_two_chunks() {
        // A pipe does not respect line boundaries, and login-flow documents that a prompt
        // may arrive with no trailing newline — so matching is over the accumulated buffer.
        let sync = sync();
        let decl = base(serde_json::json!({
            "notices": [{ "pattern": "Conectando", "message": "aprove o push" }],
            "readyTimeoutMs": 60
        }));
        let (mut proc_, _tx, _stop) = holding(&["Conec", "tando…"]);
        let mut probe = || false;
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();

        let _ = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();

        let notices = sync
            .query_nodes("StreamChunk", 1000)
            .unwrap_or_default()
            .iter()
            .filter_map(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            .filter(|n| n["payload_kind"] == "notice")
            .count();
        assert_eq!(notices, 1);
    }

    #[tokio::test]
    async fn the_accumulated_buffer_is_capped() {
        let sync = sync();
        let decl = base(serde_json::json!({
            "notices": [{ "pattern": "LATE-MARKER", "message": "m" }],
            "readyTimeoutMs": 60
        }));
        let filler = "x".repeat(MAX_CONNECTION_BUFFER);
        let (mut proc_, _tx, _stop) = holding(&[&filler, "LATE-MARKER"]);
        let mut probe = || false;
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();

        let _ = establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();

        let notices = sync
            .query_nodes("StreamChunk", 1000)
            .unwrap_or_default()
            .iter()
            .filter_map(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            .filter(|n| n["payload_kind"] == "notice")
            .count();
        assert_eq!(notices, 1, "the tail must stay matchable after a flood");
    }

    #[tokio::test]
    async fn a_terminal_frame_is_published_for_every_outcome() {
        let sync = sync();
        let decl = base(serde_json::json!({}));
        let (mut proc_, _tx, _stop) = holding(&[]);
        let mut probe = probe_after(0);
        let mut pubr = ConnectionFramePublisher::new("c", 0);
        let clk = clock();

        establish(&decl, &mut proc_, &mut probe, &mut pubr, &sync, &clk).await.unwrap();

        let finals: Vec<_> = sync
            .query_nodes("StreamChunk", 1000)
            .unwrap_or_default()
            .iter()
            .filter_map(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
            .filter(|n| n["is_final"] == true)
            .collect();
        assert_eq!(finals.len(), 1);
        assert_eq!(finals[0]["payload_kind"], "ready");
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test --lib connection_engine --quiet`
Expected: FAIL to compile — `establish`, `FlowProcess`, `EstablishOutcome` do not exist.

- [ ] **Step 4: Write the implementation**

Create `packages/tractor/src/host/host_effects_bridge/connection_engine.rs`:

```rust
// The connection probe loop — bring a declared connection up and decide readiness by
// ASKING THE SYSTEM, never by matching a string in the process's output.
//
// This mirrors `browser-driver`'s `awaitLoginDetected(probe, signals)`: the probe decides,
// the signals inform. Output here produces only human notices; a missed notice can never
// make a connection wrongly considered up or down.
//
// Both the process (a channel of output chunks) and the probe (a closure) are INJECTED, so
// this whole loop is unit-tested with no real process and no real command.

use std::sync::Arc;

use tokio::sync::{mpsc, Notify};
use tokio::time::{Duration, Instant};

use crate::sync::NativeSync;

/// Cap on the accumulated notice-match buffer. A chatty process must not grow host memory.
pub(crate) const MAX_CONNECTION_BUFFER: usize = 64 * 1024;

#[derive(Debug)]
pub(crate) enum EstablishOutcome {
    /// The probe succeeded. The process is LEFT RUNNING — it holds the connection.
    Ready,
    /// The probe never succeeded within `ready_timeout_ms`. The process was stopped.
    Timeout,
    /// The process ended before the probe succeeded. It is already gone.
    Exit,
}

/// A live process reduced to what the loop needs: raw output chunks in order, and a way to
/// stop it. Injectable — a test drives it with a channel.
pub(crate) struct FlowProcess {
    /// Raw stdout+stderr chunks. The channel closing means the process ended.
    pub(crate) chunks: mpsc::Receiver<String>,
    /// Notifying this stops the process and its group.
    pub(crate) stop: Arc<Notify>,
}

/// Keep the buffer bounded while preserving its TAIL, so a marker arriving after a flood is
/// still matchable.
fn push_bounded(buffer: &mut String, chunk: &str) {
    buffer.push_str(chunk);
    if buffer.len() > MAX_CONNECTION_BUFFER {
        let mut cut = buffer.len() - MAX_CONNECTION_BUFFER;
        while cut < buffer.len() && !buffer.is_char_boundary(cut) {
            cut += 1;
        }
        buffer.drain(..cut);
    }
}

/// Bring the connection up: poll the probe on its interval, publishing notices matched in
/// the output along the way, until the probe succeeds, the process ends, or the deadline
/// passes.
pub(crate) async fn establish(
    decl: &ConnectionDeclaration,
    process: &mut FlowProcess,
    probe: &mut (dyn FnMut() -> bool + Send),
    publisher: &mut ConnectionFramePublisher,
    sync: &NativeSync,
    now_ns: &(dyn Fn() -> u64 + Sync),
) -> Result<EstablishOutcome, String> {
    let mut buffer = String::new();
    let mut fired: Vec<bool> = vec![false; decl.notices.len()];
    let interval = Duration::from_millis(decl.probe_interval_ms.max(1));
    let deadline = Instant::now() + Duration::from_millis(decl.ready_timeout_ms.max(1) as u64);
    let mut ended = false;

    let outcome = loop {
        if probe() {
            break EstablishOutcome::Ready;
        }
        // The probe is the only authority, so an ended process is only decisive AFTER a
        // final probe: a connect command may exit once the tunnel is established by a
        // daemon it handed off to.
        if ended {
            break EstablishOutcome::Exit;
        }
        if Instant::now() >= deadline {
            break EstablishOutcome::Timeout;
        }

        // Drain whatever output arrived within this probe interval, publishing notices.
        let slice_end = Instant::now() + interval;
        loop {
            let remaining = slice_end.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            match tokio::time::timeout(remaining, process.chunks.recv()).await {
                Err(_) => break,          // interval elapsed — go probe again
                Ok(None) => {             // the process ended
                    ended = true;
                    break;
                }
                Ok(Some(chunk)) => {
                    push_bounded(&mut buffer, &chunk);
                    for (i, rule) in decl.notices.iter().enumerate() {
                        if !fired[i] && rule.pattern.is_match(&buffer) {
                            fired[i] = true;
                            publisher.notice(sync, &rule.message, now_ns())?;
                        }
                    }
                }
            }
        }
    };

    let (reason, detail) = match &outcome {
        EstablishOutcome::Ready => ("ready", String::new()),
        EstablishOutcome::Timeout => (
            "timeout",
            format!("probe did not succeed within {}ms", decl.ready_timeout_ms),
        ),
        EstablishOutcome::Exit => (
            "exit",
            "the establish process ended before the probe succeeded".to_string(),
        ),
    };
    publisher.terminal(sync, reason, &detail, now_ns())?;

    // Ready LEAVES the process running (it holds the connection). Anything else stops it —
    // a failed attempt must never leak a live process.
    if !matches!(outcome, EstablishOutcome::Ready) {
        process.stop.notify_waiters();
    }

    Ok(outcome)
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test --lib connection_engine --quiet`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/tractor/src/host/host_effects_bridge.rs \
        packages/tractor/src/host/host_effects_bridge/connection_engine.rs \
        packages/tractor/src/host/host_effects_bridge_tests.rs \
        packages/tractor/src/host/host_effects_bridge_tests/connection_engine.rs
git commit -m "feat(tractor): the connection probe loop — the system decides readiness"
```

---

### Task 4: The shared registry — claims, single-flight, linger

**Files:**
- Modify: `packages/tractor/src/host/host_effects_bridge/connection_engine.rs`
- Modify: `packages/tractor/src/host/host_effects_bridge_tests/connection_engine.rs`

**Interfaces:**
- Consumes: `establish`, `FlowProcess`, `EstablishOutcome` (Task 3); `ConnectionDeclaration`, `Linger` (Task 1).
- Produces:
  - `pub(crate) enum ConnectionStatus { Down, Connecting, Up, Failed }`
  - `pub(crate) struct Claim { pub(crate) id: u64, pub(crate) name: String }`
  - `pub(crate) struct ConnectionRegistry`
  - `impl ConnectionRegistry { pub(crate) fn new() -> Self; pub(crate) fn status(&self, name: &str) -> ConnectionStatus; pub(crate) fn spawn_count(&self, name: &str) -> u32; pub(crate) fn claim_count(&self, name: &str) -> usize; pub(crate) async fn ensure(&self, name: &str, owner: &str, decls: &HashMap<String, ConnectionDeclaration>, spawn: impl FnOnce(&ConnectionDeclaration) -> Result<FlowProcess, String>, probe: &mut (dyn FnMut() -> bool + Send), sync: &NativeSync, now_ns: &(dyn Fn() -> u64 + Sync)) -> Result<Claim, String>; pub(crate) fn release(&self, claim: &Claim); pub(crate) fn release_owner(&self, owner: &str) }`

`spawn_count` exists so a test can assert a second `ensure` performed **no second login** — the
load-bearing guarantee, because a second login is a second push on the operator's phone.

- [ ] **Step 1: Write the failing tests**

Append inside `mod connection_engine_tests`:

```rust
    fn catalog() -> std::collections::HashMap<String, ConnectionDeclaration> {
        parse_connections(&serde_json::json!({
            "connections": { "c": {
                "establish": ["bin"],
                "probe": { "run": ["true"] },
                "probeIntervalMs": 1,
                "readyTimeoutMs": 200
            }}
        }))
        .unwrap()
    }

    /// A spawner yielding a process that stays open — a held connection.
    fn holding_spawner() -> impl FnOnce(&ConnectionDeclaration) -> Result<FlowProcess, String> {
        |_decl| {
            let (tx, rx) = mpsc::channel(8);
            std::mem::forget(tx);
            Ok(FlowProcess { chunks: rx, stop: Arc::new(Notify::new()) })
        }
    }

    #[tokio::test]
    async fn ensure_establishes_a_down_connection_and_returns_a_claim() {
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let mut probe = probe_after(0);
        let clk = clock();

        let claim = reg
            .ensure("c", "plugin.a", &decls, holding_spawner(), &mut probe, &sync, &clk)
            .await
            .unwrap();

        assert_eq!(claim.name, "c");
        assert!(matches!(reg.status("c"), ConnectionStatus::Up));
        assert_eq!(reg.spawn_count("c"), 1);
    }

    #[tokio::test]
    async fn a_second_ensure_shares_it_and_performs_no_second_login() {
        // THE guarantee: a second login is a second push on the operator's phone.
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();

        let mut p1 = probe_after(0);
        let _a = reg.ensure("c", "plugin.a", &decls, holding_spawner(), &mut p1, &sync, &clk).await.unwrap();

        let mut p2 = || panic!("must not probe: the connection is already up");
        let b = reg
            .ensure("c", "plugin.b", &decls, |_| panic!("must not spawn a second process"), &mut p2, &sync, &clk)
            .await
            .unwrap();

        assert_eq!(b.name, "c");
        assert_eq!(reg.spawn_count("c"), 1);
        assert_eq!(reg.claim_count("c"), 2);
    }

    #[tokio::test]
    async fn releasing_one_claim_leaves_it_up_for_the_other() {
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();
        let mut p1 = probe_after(0);

        let a = reg.ensure("c", "plugin.a", &decls, holding_spawner(), &mut p1, &sync, &clk).await.unwrap();
        let mut p2 = || true;
        let _b = reg.ensure("c", "plugin.b", &decls, |_| panic!("no second spawn"), &mut p2, &sync, &clk).await.unwrap();

        reg.release(&a);
        assert!(matches!(reg.status("c"), ConnectionStatus::Up));
        assert_eq!(reg.claim_count("c"), 1);
    }

    #[tokio::test]
    async fn releasing_the_last_claim_under_operator_linger_keeps_it_up() {
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();
        let mut probe = probe_after(0);

        let a = reg.ensure("c", "plugin.a", &decls, holding_spawner(), &mut probe, &sync, &clk).await.unwrap();
        reg.release(&a);

        assert!(
            matches!(reg.status("c"), ConnectionStatus::Up),
            "operator linger is the default: re-establishing costs a human interruption"
        );
    }

    #[tokio::test]
    async fn unloading_a_plugin_releases_every_claim_it_held() {
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();
        let mut p1 = probe_after(0);

        let _a = reg.ensure("c", "plugin.a", &decls, holding_spawner(), &mut p1, &sync, &clk).await.unwrap();
        let mut p2 = || true;
        let _a2 = reg.ensure("c", "plugin.a", &decls, |_| panic!("no second spawn"), &mut p2, &sync, &clk).await.unwrap();

        reg.release_owner("plugin.a");
        assert_eq!(reg.claim_count("c"), 0, "a plugin cannot leak interest past its own lifetime");
    }

    #[tokio::test]
    async fn ensure_of_an_undeclared_name_names_the_missing_declaration() {
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();
        let mut probe = probe_after(0);

        let err = reg
            .ensure("nope", "plugin.a", &decls, holding_spawner(), &mut probe, &sync, &clk)
            .await
            .unwrap_err();
        assert!(err.contains("no connection named 'nope' is declared"), "unexpected: {err}");
    }

    #[tokio::test]
    async fn a_failed_attempt_leaves_it_failed_and_claimless() {
        let sync = sync();
        let decls = catalog();
        let reg = ConnectionRegistry::new();
        let clk = clock();
        let mut probe = || false;

        let err = reg
            .ensure("c", "plugin.a", &decls, holding_spawner(), &mut probe, &sync, &clk)
            .await
            .unwrap_err();

        assert!(err.contains("did not become ready"), "the reason must reach the caller: {err}");
        assert!(matches!(reg.status("c"), ConnectionStatus::Failed));
        assert_eq!(reg.claim_count("c"), 0);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --lib connection_engine --quiet`
Expected: FAIL to compile — `ConnectionRegistry` does not exist.

- [ ] **Step 3: Write the implementation**

Append to `packages/tractor/src/host/host_effects_bridge/connection_engine.rs`:

```rust
// ── The shared registry ──────────────────────────────────────────────────────
//
// A connection is a NAMED, HOST-OWNED, SHARED resource. Callers do not hold processes;
// they hold claims on a name. One live instance per declared name exists by construction —
// asking for a connection that is already up performs NO second login, which for the Serpro
// VPN means no second push on the operator's phone.

use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum ConnectionStatus {
    Down,
    Connecting,
    Up,
    Failed,
}

/// A caller's interest in a live connection.
#[derive(Debug, Clone)]
pub(crate) struct Claim {
    pub(crate) id: u64,
    pub(crate) name: String,
}

struct LiveConnection {
    status: ConnectionStatus,
    /// Stop handle for the held process; `None` once it is gone.
    stop: Option<Arc<Notify>>,
    /// (claim id, owner).
    claims: Vec<(u64, String)>,
    /// How many times a process was actually spawned — the sharing guarantee is asserted
    /// on this.
    spawn_count: u32,
    linger: Linger,
}

pub(crate) struct ConnectionRegistry {
    live: Mutex<HashMap<String, LiveConnection>>,
    next_claim_id: std::sync::atomic::AtomicU64,
}

impl ConnectionRegistry {
    pub(crate) fn new() -> Self {
        Self {
            live: Mutex::new(HashMap::new()),
            next_claim_id: std::sync::atomic::AtomicU64::new(1),
        }
    }

    pub(crate) fn status(&self, name: &str) -> ConnectionStatus {
        self.live
            .lock()
            .expect("connection registry poisoned")
            .get(name)
            .map(|c| c.status.clone())
            .unwrap_or(ConnectionStatus::Down)
    }

    pub(crate) fn spawn_count(&self, name: &str) -> u32 {
        self.live
            .lock()
            .expect("connection registry poisoned")
            .get(name)
            .map(|c| c.spawn_count)
            .unwrap_or(0)
    }

    pub(crate) fn claim_count(&self, name: &str) -> usize {
        self.live
            .lock()
            .expect("connection registry poisoned")
            .get(name)
            .map(|c| c.claims.len())
            .unwrap_or(0)
    }

    fn issue_claim(&self, name: &str, owner: &str) -> Claim {
        let id = self.next_claim_id.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let mut live = self.live.lock().expect("connection registry poisoned");
        if let Some(entry) = live.get_mut(name) {
            entry.claims.push((id, owner.to_string()));
        }
        Claim { id, name: name.to_string() }
    }

    /// Idempotent. Already up ⇒ a new claim and NO new login. Down ⇒ establish once.
    #[allow(clippy::too_many_arguments)]
    pub(crate) async fn ensure(
        &self,
        name: &str,
        owner: &str,
        decls: &HashMap<String, ConnectionDeclaration>,
        spawn: impl FnOnce(&ConnectionDeclaration) -> Result<FlowProcess, String>,
        probe: &mut (dyn FnMut() -> bool + Send),
        sync: &NativeSync,
        now_ns: &(dyn Fn() -> u64 + Sync),
    ) -> Result<Claim, String> {
        let decl = decls.get(name).ok_or_else(|| {
            format!("no connection named '{name}' is declared in .refarm/config.json")
        })?;

        // Fast path: already up. This is the whole point of sharing.
        if matches!(self.status(name), ConnectionStatus::Up) {
            return Ok(self.issue_claim(name, owner));
        }

        {
            let mut live = self.live.lock().expect("connection registry poisoned");
            let entry = live.entry(name.to_string()).or_insert_with(|| LiveConnection {
                status: ConnectionStatus::Down,
                stop: None,
                claims: Vec::new(),
                spawn_count: 0,
                linger: decl.linger.clone(),
            });
            entry.status = ConnectionStatus::Connecting;
            entry.spawn_count += 1;
        }

        let mut process = spawn(decl)?;
        let stop = process.stop.clone();
        let mut publisher = ConnectionFramePublisher::new(name, now_ns());
        let outcome = establish(decl, &mut process, probe, &mut publisher, sync, now_ns).await?;

        {
            let mut live = self.live.lock().expect("connection registry poisoned");
            let entry = live.get_mut(name).expect("entry inserted above");
            match outcome {
                EstablishOutcome::Ready => {
                    entry.status = ConnectionStatus::Up;
                    entry.stop = Some(stop);
                }
                EstablishOutcome::Timeout => {
                    entry.status = ConnectionStatus::Failed;
                    entry.stop = None;
                    return Err(format!(
                        "connection '{name}' did not become ready within {}ms",
                        decl.ready_timeout_ms
                    ));
                }
                EstablishOutcome::Exit => {
                    entry.status = ConnectionStatus::Failed;
                    entry.stop = None;
                    return Err(format!(
                        "connection '{name}' did not become ready: the establish process ended first"
                    ));
                }
            }
        }

        Ok(self.issue_claim(name, owner))
    }

    /// Drop one claim. Whether the connection itself falls is the DECLARATION's linger
    /// policy, never the caller's choice.
    pub(crate) fn release(&self, claim: &Claim) {
        let mut live = self.live.lock().expect("connection registry poisoned");
        if let Some(entry) = live.get_mut(&claim.name) {
            entry.claims.retain(|(id, _)| *id != claim.id);
            Self::apply_linger(entry);
        }
    }

    /// Release every claim held by an owner — called when a plugin is unloaded or revoked,
    /// so interest can never outlive its holder.
    pub(crate) fn release_owner(&self, owner: &str) {
        let mut live = self.live.lock().expect("connection registry poisoned");
        for entry in live.values_mut() {
            entry.claims.retain(|(_, o)| o != owner);
            Self::apply_linger(entry);
        }
    }

    /// `Linger::Operator` (the default) keeps a connection up once established:
    /// re-establishing costs a human interruption, holding costs nearly nothing. A
    /// non-zero `Idle` window is swept by the caller, not here.
    fn apply_linger(entry: &mut LiveConnection) {
        if !entry.claims.is_empty() {
            return;
        }
        if let Linger::Idle { ms: 0 } = entry.linger {
            if let Some(stop) = entry.stop.take() {
                stop.notify_waiters();
            }
            entry.status = ConnectionStatus::Down;
        }
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --lib connection_engine --quiet`
Expected: PASS, 16 tests (9 from Task 3 + 7 here).

- [ ] **Step 5: Commit**

```bash
git add packages/tractor/src/host/host_effects_bridge/connection_engine.rs \
        packages/tractor/src/host/host_effects_bridge_tests/connection_engine.rs
git commit -m "feat(tractor): shared connection registry — claims, single-flight, linger"
```

---

### Task 5: The real adapters — establish process and probe runner

**Files:**
- Modify: `packages/tractor/src/host/host_effects_bridge/connection_engine.rs`
- Modify: `packages/tractor/src/host/host_effects_bridge_tests/connection_engine.rs`

**Interfaces:**
- Consumes: `enforce_shell_allowlist`, `enforce_spawn_env`, `enforce_spawn_cwd`, `spawn_process`, `kill_process_group`, `HostEffectPolicy` — private helpers of this same flattened module (`host_effects_bridge/core.rs:215,303,334`).
- Produces:
  - `pub(crate) fn spawn_establish_process(decl: &ConnectionDeclaration, policy: &HostEffectPolicy) -> Result<FlowProcess, String>`
  - `pub(crate) async fn run_probe(decl: &ConnectionDeclaration, policy: &HostEffectPolicy) -> bool`

`run_probe` reuses `spawn_process` verbatim — the probe is an ordinary, guarded, timed spawn. It
returns `false` on any error rather than propagating: a probe that cannot run means "not up", and
the deadline in `establish` owns the failure.

- [ ] **Step 1: Write the failing tests**

Append inside `mod connection_engine_tests`:

```rust
    fn permissive_policy() -> HostEffectPolicy {
        HostEffectPolicy::default()
    }

    #[tokio::test]
    async fn the_probe_runner_reports_true_on_exit_zero() {
        let decl = base(serde_json::json!({ "probe": { "run": ["true"] } }));
        assert!(run_probe(&decl, &permissive_policy()).await);
    }

    #[tokio::test]
    async fn the_probe_runner_reports_false_on_a_nonzero_exit() {
        let decl = base(serde_json::json!({ "probe": { "run": ["false"] } }));
        assert!(!run_probe(&decl, &permissive_policy()).await);
    }

    #[tokio::test]
    async fn the_probe_runner_requires_expect_to_match_even_on_exit_zero() {
        // The real case: `ip link show` exits 0 for an interface that exists but is DOWN.
        let decl = base(serde_json::json!({
            "probe": { "run": ["echo", "ovpntun0 DOWN"], "expect": "\\bUP\\b" }
        }));
        assert!(!run_probe(&decl, &permissive_policy()).await);

        let decl_up = base(serde_json::json!({
            "probe": { "run": ["echo", "ovpntun0 UP"], "expect": "\\bUP\\b" }
        }));
        assert!(run_probe(&decl_up, &permissive_policy()).await);
    }

    #[tokio::test]
    async fn the_probe_runner_reports_false_for_a_missing_binary() {
        let decl = base(serde_json::json!({
            "probe": { "run": ["definitely-not-a-real-binary-xyz"] }
        }));
        assert!(!run_probe(&decl, &permissive_policy()).await, "a probe that cannot run means not up");
    }

    #[tokio::test]
    async fn the_establish_spawner_rejects_argv_outside_the_shell_allowlist() {
        let decl = base(serde_json::json!({ "establish": ["definitely-not-allowed"] }));
        let policy = HostEffectPolicy::new(
            Some(std::collections::HashSet::from(["echo".to_string()])),
            Ok(None),
            String::new(),
        );
        let err = spawn_establish_process(&decl, &policy).unwrap_err();
        assert!(
            err.contains("blocked"),
            "a declared connection is not an exemption from the allowlist: {err}"
        );
    }

    #[tokio::test]
    async fn the_establish_spawner_streams_a_real_process() {
        let decl = base(serde_json::json!({
            "establish": ["echo", "Conectando ao gateway"],
            "notices": [{ "pattern": "Conectando", "message": "aprove o push" }]
        }));
        let mut process = spawn_establish_process(&decl, &permissive_policy()).unwrap();
        let chunk = tokio::time::timeout(std::time::Duration::from_secs(5), process.chunks.recv())
            .await
            .expect("a chunk arrives")
            .expect("the stream is open");
        assert!(chunk.contains("Conectando"), "unexpected: {chunk}");
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --lib connection_engine --quiet`
Expected: FAIL to compile — `spawn_establish_process` and `run_probe` do not exist.

If `HostEffectPolicy::new` has a different signature, read
`packages/tractor/src/host/host_effects_bridge/policy_and_fs.rs:504-510` (it is `#[cfg(test)]`) and
match it exactly.

- [ ] **Step 3: Write the implementation**

Append to `packages/tractor/src/host/host_effects_bridge/connection_engine.rs`:

```rust
// ── The real adapters ────────────────────────────────────────────────────────
//
// Both reuse the SAME guards a batch `spawn` passes: a declared connection is another door
// in the same corridor, never an exemption from the machine's own policy.

/// Probe timeout. A health check that hangs must not stall the probe loop; the loop's own
/// deadline owns the overall failure.
const PROBE_TIMEOUT_MS: u32 = 5_000;

/// Ask the SYSTEM whether the connection is up. Success is exit code 0 AND, when `expect`
/// is declared, the combined output matching it. Any error means "not up" — a probe that
/// cannot run is not evidence of health.
pub(crate) async fn run_probe(decl: &ConnectionDeclaration, policy: &HostEffectPolicy) -> bool {
    let Ok((stdout, stderr, exit_code, timed_out)) = spawn_process(
        &decl.probe.run,
        &decl.env,
        decl.cwd.as_deref(),
        PROBE_TIMEOUT_MS,
        None,
        policy,
    )
    .await
    else {
        return false;
    };
    if timed_out || exit_code != 0 {
        return false;
    }
    let Some(expect) = decl.probe.expect.as_ref() else {
        return true;
    };
    let mut text = String::from_utf8_lossy(&stdout).to_string();
    text.push_str(&String::from_utf8_lossy(&stderr));
    expect.is_match(&text)
}

/// Spawn the establish argv and stream its merged stdout+stderr into a `FlowProcess`.
/// Unlike `spawn_process`, nothing here kills on a timeout: a connection is SUPPOSED to
/// outlive the call. The bounds are the probe loop's deadline, then the registry's
/// claim/linger policy, then the explicit stop signal.
pub(crate) fn spawn_establish_process(
    decl: &ConnectionDeclaration,
    policy: &HostEffectPolicy,
) -> Result<FlowProcess, String> {
    enforce_shell_allowlist(&decl.establish, policy)?;
    enforce_spawn_env(&decl.env)?;
    if let Some(dir) = decl.cwd.as_deref() {
        enforce_spawn_cwd(dir, policy)?;
    }

    let mut cmd = tokio::process::Command::new(&decl.establish[0]);
    cmd.args(&decl.establish[1..])
        .env_clear()
        .envs(decl.env.iter().map(|(k, v)| (k.as_str(), v.as_str())))
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null())
        // Own process group, so stopping the connection kills any grandchild it forked
        // instead of leaving an orphan reparented to init — the same reason
        // `spawn_process` does this.
        .process_group(0);
    if let Some(dir) = decl.cwd.as_deref() {
        cmd.current_dir(dir);
    }

    let mut child = cmd.spawn().map_err(|e| {
        format!("connection '{}': spawn({}): {e}", decl.name, decl.establish[0])
    })?;

    let (tx, rx) = tokio::sync::mpsc::channel::<String>(64);

    // Pump stdout and stderr into ONE ordered stream — a login's meaningful lines land on
    // either pipe and must be seen interleaved as they arrive.
    let mut readers: Vec<Box<dyn tokio::io::AsyncRead + Unpin + Send>> = Vec::new();
    if let Some(out) = child.stdout.take() {
        readers.push(Box::new(out));
    }
    if let Some(err) = child.stderr.take() {
        readers.push(Box::new(err));
    }
    for mut reader in readers {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut buf = [0u8; 4096];
            loop {
                match tokio::io::AsyncReadExt::read(&mut reader, &mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buf[..n]).to_string();
                        if tx.send(text).await.is_err() {
                            break;
                        }
                    }
                }
            }
        });
    }
    drop(tx);

    let stop = Arc::new(Notify::new());
    let stop_for_task = stop.clone();
    tokio::spawn(async move {
        stop_for_task.notified().await;
        kill_process_group(&mut child).await;
    });

    Ok(FlowProcess { chunks: rx, stop })
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --lib connection_engine --quiet`
Expected: PASS, 22 tests.

- [ ] **Step 5: Run the full connection suite and check the crate**

Run: `cargo test --lib connection --quiet`
Expected: PASS, 42 tests (14 + 6 + 22).

Run: `cargo check --quiet -p tractor`
Expected: no errors.

- [ ] **Step 6: Confirm no regression in the surrounding module**

Run: `cargo test --lib host_effects --quiet`
Expected: PASS — the pre-existing host-effect tests are untouched.

- [ ] **Step 7: Commit**

```bash
git add packages/tractor/src/host/host_effects_bridge/connection_engine.rs \
        packages/tractor/src/host/host_effects_bridge_tests/connection_engine.rs
git commit -m "feat(tractor): real establish spawner and probe runner for connections"
```

---

### Task 6: Document what shipped

**Files:**
- Modify: `docs/CONVERGENCE-LANE.md`
- Modify: `docs/decision-log.md`

- [ ] **Step 1: Move the corner in the lane**

Under the 2026-07-28 declared-connections bullet in `docs/CONVERGENCE-LANE.md`, append a sub-bullet
recording what shipped: the declaration catalog with probe-based readiness, the shared registry with
claims, `stream:v1` frames, the real adapters, and the test count from Task 5 Step 5. Note that the
WIT surface, the permission, and the operator CLI are the next two plans.

- [ ] **Step 2: Add the decision-log row**

In the `## In Progress` table of `docs/decision-log.md`:

| Topic | ADR | Owner | Status | Due | Evidence |
|---|---|---|---|---|---|
| Declared connections — shared, host-owned interactive sessions | — | Core | Engine shipped (host-internal, probe-based readiness); WIT surface + operator CLI pending | — | `packages/tractor/src/host/host_effects_bridge/connection_*.rs`, `docs/superpowers/specs/2026-07-28-declared-connections-shared-sessions-design.md` |

- [ ] **Step 3: Commit**

```bash
git add docs/CONVERGENCE-LANE.md docs/decision-log.md
git commit -m "docs: record the declared-connections engine in the lane and decision log"
```

---

## Follow-on plans (not this plan)

- **Plan 2 — the WIT surface.** `interface host-connection` in `packages/plugin-wit/wit/host.wit`,
  added to the `effect-capable` and `host-plugin` worlds; `Permission::ConnectionUse`
  (`RiskLevel::Medium`) with its `ALL`/`as_str`/`label`/`risk` entries and the count-guard bump at
  `packages/tractor/src/host/permission.rs:180-184`; the TS mirror in
  `packages/plugin-manifest/src/permission-vocab.js` and `index.d.ts`, plus
  `capabilities.requiresConnections` validation. **`packages/plugin-manifest/**` is a protected
  surface (CLAUDE.md §8) — that plan opens with an explicit operator confirmation step**, and
  `scripts/ci/check-permission-vocab.mjs` must pass. Shared conformance vectors with `login-flow`
  belong here, where both suites are in scope.
- **Plan 3 — the operator surface.** `refarm connection status --json`, the same payload inside
  `refarm status`, and a doctor finding for a declared connection whose binary does not resolve
  (design D12).
- **Plan 4 — the full `ovpnctl` map.** `resolve` (profile + certificate discovery, Serpro-specific,
  behind a new `serpro-vpn resolve --json` in rcdc5) → `establish` the resolved argv → the same
  probe. Cheap because the probe already owns correctness, so this only swaps plumbing.
- **Step 2 of the design — prompts.** The `prompt` frame, the control-plane answer call, and
  `promptTimeoutMs`; gated on the open question of resolving `secretRef` from Rust.

---

## Self-Review

**Spec coverage.** Step-1 scope maps to tasks: the `connections` block and validation → Task 1;
probe-based readiness (D1b) → Tasks 1, 3, 5; `notice` and terminal frames over `stream:v1` → Task 2;
the probe loop, buffer cap, notice-once semantics, ready timeout → Task 3; shared claims, idempotent
`ensure`, single-flight, linger, release-on-unload → Task 4; reuse of the existing spawn guards and
the held process → Task 5; docs → Task 6. Deferred with a named plan: the `connection:use`
permission and its TS mirror (Plan 2, protected surface), `refarm connection status` and the doctor
finding (Plan 3), and the shared conformance vectors (Plan 2, where the TS suite is in scope).
Design test items 1-11 and 13-15 are covered; item 12 (reject `prompts`) is Task 1.

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N". Every code step
carries actual code. Two steps name a fallback if a signature differs from what was read
(`HostEffectPolicy::new`, `query_nodes`/`get_node`) and say exactly what to do — verification
instructions, not placeholders.

**Type consistency.** `ConnectionDeclaration` (fields `establish`, `probe`, `probe_interval_ms`,
`ready_timeout_ms`, `notices`, `linger`), `Probe`, `NoticeRule`, `Linger`, `parse_connections`,
`resolve_connections` (Task 1) are used unchanged in Tasks 3-5.
`ConnectionFramePublisher::{new, notice, terminal, last_sequence}` (Task 2) are called with those
exact names in Tasks 3-4. `FlowProcess { chunks, stop }` and `EstablishOutcome { Ready, Timeout,
Exit }` (Task 3) are constructed identically in Tasks 4-5 — note there is no `Fail` variant, because
readiness is the probe's alone. `ConnectionRegistry::{new, ensure, release, release_owner, status,
spawn_count, claim_count}` (Task 4) — `claim_count` is used by Task 4's own tests.
`spawn_establish_process` and `run_probe` (Task 5) take `(&ConnectionDeclaration, &HostEffectPolicy)`
in both their definitions and their tests.
