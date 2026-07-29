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
// `Path` is already in scope here: this file is `include!`d into the flattened
// `host_effects_bridge` module, which imports it via `core.rs`'s
// `use std::path::{Path, PathBuf};`. A second `use std::path::Path;` would collide (E0252).

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

/// Read an argv-shaped field STRICTLY. Skipping a non-string entry would silently run a
/// DIFFERENT argv than the operator declared (`["ovpnctl", 5, "connect"]` becomes
/// `ovpnctl connect`), which is the same silent rewrite this file already refuses for
/// `prompts`, `ready`/`fail` and `probe.shell`. An absent field is still an empty argv —
/// the caller decides whether emptiness is an error.
fn string_array(
    value: Option<&serde_json::Value>,
    field: &str,
    name: &str,
) -> Result<Vec<String>, String> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    let Some(items) = value.as_array() else {
        return Err(format!("connection '{name}': {field} must be an array of strings"));
    };
    let mut out = Vec::with_capacity(items.len());
    for (i, item) in items.iter().enumerate() {
        let Some(s) = item.as_str() else {
            return Err(format!(
                "connection '{name}': {field}[{i}] must be a string — a non-string entry would \
                 be dropped and run a different command than the one declared"
            ));
        };
        out.push(s.to_string());
    }
    Ok(out)
}

/// Read an optional string field STRICTLY: a non-string value must not degrade to "absent".
fn optional_string(
    value: Option<&serde_json::Value>,
    field: &str,
    name: &str,
) -> Result<Option<String>, String> {
    match value {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(format!("connection '{name}': {field} must be a string")),
    }
}

/// Read an optional integer field STRICTLY: a non-integer value must not silently fall back
/// to the default, which reads as "my timeout is being honoured" when it is not.
fn optional_u64(
    value: Option<&serde_json::Value>,
    field: &str,
    name: &str,
) -> Result<Option<u64>, String> {
    match value {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(v) => v
            .as_u64()
            .map(Some)
            .ok_or_else(|| format!("connection '{name}': {field} must be a non-negative integer")),
    }
}

fn parse_probe(name: &str, value: &serde_json::Value) -> Result<Probe, String> {
    let probe_value = value.get("probe").ok_or_else(|| {
        format!("connection '{name}': probe is required — readiness is decided by a probe, not by output")
    })?;

    let run = string_array(probe_value.get("run"), "probe.run", name)?;
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

    // A non-string `expect` must not degrade to "no expect at all": that would silently
    // weaken readiness to exit-code-only, the exact case the design calls out (an interface
    // that exists but is DOWN exits zero).
    let expect = match optional_string(probe_value.get("expect"), "probe.expect", name)? {
        Some(raw) => Some(compile_pattern(&raw, "probe.expect", name)?),
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

    let establish = string_array(value.get("establish"), "establish", name)?;
    if establish.is_empty() {
        return Err(format!(
            "connection '{name}': establish must be a non-empty array of strings"
        ));
    }

    let probe = parse_probe(name, value)?;

    // A non-array `notices` must not become an empty catalog: the operator would see no
    // announcements and no reason why.
    let notice_values = match value.get("notices") {
        None | Some(serde_json::Value::Null) => Vec::new(),
        Some(v) => v
            .as_array()
            .cloned()
            .ok_or_else(|| format!("connection '{name}': notices must be an array of rules"))?,
    };
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

    // A dropped env entry changes the environment the command runs in — `env` is part of
    // the declaration, not a best-effort hint.
    let env: Vec<(String, String)> = match value.get("env") {
        None | Some(serde_json::Value::Null) => Vec::new(),
        Some(v) => {
            let obj = v
                .as_object()
                .ok_or_else(|| format!("connection '{name}': env must be an object of strings"))?;
            let mut out = Vec::with_capacity(obj.len());
            for (k, v) in obj {
                let Some(s) = v.as_str() else {
                    return Err(format!("connection '{name}': env['{k}'] must be a string"));
                };
                out.push((k.clone(), s.to_string()));
            }
            out
        }
    };

    let cwd = optional_string(value.get("cwd"), "cwd", name)?;

    let ready_timeout_ms = optional_u64(value.get("readyTimeoutMs"), "readyTimeoutMs", name)?
        .map(|v| v.min(u32::MAX as u64) as u32)
        .unwrap_or(DEFAULT_READY_TIMEOUT_MS);

    let probe_interval_ms = match optional_u64(value.get("probeIntervalMs"), "probeIntervalMs", name)? {
        None => DEFAULT_PROBE_INTERVAL_MS,
        Some(0) => {
            return Err(format!(
                "connection '{name}': probeIntervalMs must be greater than 0"
            ))
        }
        Some(ms) => ms,
    };

    let linger = match value.get("linger") {
        None => Linger::Operator,
        Some(serde_json::Value::String(s)) if s == "operator" => Linger::Operator,
        Some(v) => match optional_u64(v.get("idleMs"), "linger.idleMs", name)? {
            Some(0) => Linger::Idle { ms: 0 },
            // A non-zero idle window PARSES today and then does nothing: `apply_linger`
            // only acts on `ms: 0`, deferring the real window to a sweeper that does not
            // exist. Accepting it silently is the same failure mode this file loudly
            // refuses for `prompts`, `ready`/`fail` and `probe.shell` — the operator would
            // believe the connection falls after the window when it never does.
            Some(ms) => {
                return Err(format!(
                    "connection '{name}': linger.idleMs = {ms} is not implemented yet — there is \
                     no idle sweeper, so a non-zero window would be silently ignored. Use \
                     \"operator\" (stay up) or {{ \"idleMs\": 0 }} (fall as soon as the last \
                     claim is released)."
                ))
            }
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
