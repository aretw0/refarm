// Unified config-node contract — the Rust port of packages/config/src/config-node.js.
//
// The sovereign `.refarm/config.json` becomes a graph node (`SovereignConfig`) that
// replicates CRDT-wide. This module produces the SAME `sovereign.config.node.v1`
// shape the TS encoder defines, so a node written by the tractor round-trips
// through the TS `configFromNode` and (for the same config) computes the SAME
// `revision` digest. Secrets are redacted before the config ever enters the node
// or its hash — the old writer leaked a raw MODEL_* env map across devices.
//
// The graph seam: `store_node(id, type_, …)` writes `type_` to the sqlite `type`
// column, which `query_nodes` and the reaper filter on — NOT the payload's
// `@type`. So the payload carries the full TS contract (schema/kind/id/…) while
// `type_` stays "SovereignConfig" (queryable, kept by the reaper). `@type`/`@id`
// mirror fields are added so a payload-level reader still sees JSON-LD.

use serde_json::Value;
use std::path::{Path, PathBuf};

/// The neutral, brand-free env var naming the sovereign DIRECTORY — the SAME
/// key the TS config package reads (`SOVEREIGN_DIR_SELECTOR_KEY` in packages/config).
/// The substrate has no default: the host/app sets it (e.g. ".refarm"), and both the
/// Rust host and the TS stack read it, so they agree on the config path without
/// either hardcoding a brand dir (the RS↔TS lockstep, now via injection).
pub(crate) const SOVEREIGN_DIR_SELECTOR_KEY: &str = "SOVEREIGN_DIR";
/// Where this node's declarations live — the DIRECTORY THAT CONTAINS the sovereign dir.
///
/// Injected the same way and for the same reason as `SOVEREIGN_DIR`: the node is told,
/// once, and every subsystem reads the same answer instead of each asking the OS where
/// the process happens to be standing. `main()` sets it from `--refarm-dir`, which the
/// node already carries and already threads to its auth policy and Scarecrow.
///
/// Unset means "nobody told me", and the resolution continues down the chain below rather
/// than dropping straight to the process cwd. Setting it is what turns a scope inherited from
/// someone's last `cd` into one the node was given.
pub(crate) const SOVEREIGN_BASE_KEY: &str = "SOVEREIGN_BASE";
/// The sovereign DIRECTORY itself (`~/.refarm`), whose PARENT is the base. Read as step 2 of
/// the chain for one reason only: the TypeScript `declaredBase()` reads it there, and this
/// function is that function's Rust half. A resolver that agrees with its twin on three of
/// four steps is not a shared contract, it is two contracts that look alike (ISS-028).
pub(crate) const REFARM_HOME_KEY: &str = "REFARM_HOME";
/// The config file name inside the sovereign config dir (fixed substrate convention,
/// matches TS `CONFIG_FILE_NAME`).
pub(crate) const CONFIG_FILE_NAME: &str = "config.json";

/// WHICH STEP produced the base, so a caller can never label one this function did not take —
/// the same witness `declaredBaseWithOrigin()` returns in TS, and for the same reason: the
/// label was wrong there for months after a step changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DeclaredBaseOrigin {
    SovereignBase,
    RefarmHome,
    EnvHome,
    OsHome,
}

/// `path.dirname()`'s exact semantics, which `Path::parent()` does NOT share:
///   TS `dirname("/a/b")` = "/a"      Rust `Path::new("/a/b").parent()` = Some("/a")   ✓
///   TS `dirname(".refarm")` = "."    Rust `.parent()` = Some("")                      ✗
///   TS `dirname("/")` = "/"          Rust `.parent()` = None                          ✗
///
/// The two disagreements are exactly the relative and rootless cases ISS-028 names. Left to
/// `Path::parent()`, a relative `REFARM_HOME=.refarm` resolves to `""` here and `"."` in TS —
/// two different directories from one declaration, which is the whole failure this chain
/// exists to prevent.
fn dirname_like_ts(path: &Path) -> PathBuf {
    match path.parent() {
        Some(parent) if parent.as_os_str().is_empty() => PathBuf::from("."),
        Some(parent) => parent.to_path_buf(),
        None => path.to_path_buf(),
    }
}

/// `dirname_like_ts`, reachable from the binary. The daemon settles SOVEREIGN_BASE before any
/// declaration is read, and it must use the SAME semantics this resolver does — `Path::parent()`
/// answers `None` at the filesystem root where `path.dirname()` answers `/`, and that difference
/// is what let a root-level sovereign dir leave the variable unset (ISS-023).
pub fn dirname_like_ts_public(path: &Path) -> PathBuf {
    dirname_like_ts(path)
}

/// The resolved base, reachable from the binary — so the node descriptor publishes what this node
/// ACTUALLY resolved rather than an empty string from an unset variable.
pub fn declared_base_public() -> PathBuf {
    declared_base()
}

/// PURE. The chain itself, over injected lookups — so every step is assertable without
/// mutating this process's environment. `std::env::set_var` is global to the test binary, and
/// `cargo test` runs tests in parallel: an env-mutating test for a resolver every other test
/// reads is a race, not a test.
///
/// Step for step the same chain as `declaredBaseWithOrigin()` in packages/config/src/index.js.
/// Kept in that order deliberately: the two are one contract with two implementations, and the
/// only thing making them one is that both are written down and both are tested.
pub(crate) fn resolve_declared_base<F>(
    get_env: F,
    os_home: Option<PathBuf>,
) -> Option<(PathBuf, DeclaredBaseOrigin)>
where
    F: Fn(&str) -> Option<String>,
{
    let non_empty = |key: &str| {
        get_env(key)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    if let Some(base) = non_empty(SOVEREIGN_BASE_KEY) {
        return Some((PathBuf::from(base), DeclaredBaseOrigin::SovereignBase));
    }
    if let Some(home) = non_empty(REFARM_HOME_KEY) {
        return Some((
            dirname_like_ts(Path::new(&home)),
            DeclaredBaseOrigin::RefarmHome,
        ));
    }
    // HOME then USERPROFILE, the same pair and the same order as the TS step 3.
    if let Some(home) = non_empty("HOME").or_else(|| non_empty("USERPROFILE")) {
        return Some((PathBuf::from(home), DeclaredBaseOrigin::EnvHome));
    }
    // THE CHAIN ENDS HERE, exactly where the TypeScript one ends (ISS-023).
    //
    // There used to be a fifth step: the process's current directory. It was NAMED rather than
    // silent, which was an improvement and not a fix — the TS resolver has no such step, so on a
    // machine where nothing above answers the two implementations returned different bases and
    // the node rooted itself in whatever directory a shell last `cd`-ed to.
    //
    // `None` is the honest answer: nothing told this node where its declarations live. A node
    // that cannot resolve its base cannot function, and refusing at the edge is better than
    // operating out of an invented one — which is the entire subject of this axis.
    os_home.map(|home| (home, DeclaredBaseOrigin::OsHome))
}

/// The impure edge: today's environment, this OS's home, this process's directory.
pub(crate) fn declared_base_with_origin() -> (PathBuf, DeclaredBaseOrigin) {
    // PANICS, and says which four things it asked. Reached only when SOVEREIGN_BASE, REFARM_HOME,
    // HOME/USERPROFILE and the OS home are ALL absent — a machine on which nothing can tell this
    // node where it lives. Falling back to the working directory here is what ISS-023 was about:
    // it turns "nobody told me" into a confident wrong answer that every later read inherits.
    resolve_declared_base(|key| std::env::var(key).ok(), dirs::home_dir()).expect(
        "no base could be resolved: none of SOVEREIGN_BASE, REFARM_HOME, HOME, USERPROFILE or the \
         OS home answered. Declare one — the node will not guess from its working directory.",
    )
}

/// The base this node's declarations resolve against: what it was TOLD, or — failing that —
/// the operator's home, and only as a last resort where the process is standing. One place
/// decides, so `spawnEnv`, connections, surfaces and plugin grants cannot answer from
/// different directories on the same node.
pub(crate) fn declared_base() -> PathBuf {
    declared_base_with_origin().0
}

/// Resolve `<base>/<configDir>/config.json`, reading the config dir from the injected
/// selector env. Returns None when the selector is unset — the substrate has NO
/// default, so an unset selector means "no sovereign config path" (the caller then
/// behaves as if the file is absent), never a silent brand-dir fallback. Mirrors the
/// TS `sovereignConfigRelativePath`, kept in lockstep.
pub(crate) fn sovereign_config_path(base: &Path) -> Option<PathBuf> {
    let dir = std::env::var(SOVEREIGN_DIR_SELECTOR_KEY).ok()?;
    let dir = dir.trim();
    if dir.is_empty() {
        return None;
    }
    Some(base.join(dir).join(CONFIG_FILE_NAME))
}

pub(crate) const CONFIG_NODE_SCHEMA: &str = "sovereign.config.node.v1";
pub(crate) const CONFIG_NODE_KIND: &str = "sovereign/config";
pub(crate) const CONFIG_NODE_DEFAULT_ID: &str = "urn:sovereign:config:workspace";
pub(crate) const CONFIG_NODE_REDACTION: &str = "<redacted>";
/// The graph `type_` column value — kept "SovereignConfig" so query_nodes + the
/// reaper allowlist (node_reap KEEP type) are unchanged.
pub(crate) const CONFIG_NODE_GRAPH_TYPE: &str = "SovereignConfig";

/// Mirrors CONFIG_NODE_REDACTION_KEY_PATTERNS (config-node.js:10-20), pre-lowered
/// so the case-insensitive substring match is a plain `contains`.
const REDACTION_KEY_PATTERNS: &[&str] = &[
    "accesstoken",
    "apikey",
    "clientsecret",
    "credential",
    "password",
    "privatekey",
    "refreshtoken",
    "secret",
    "token",
];

fn should_redact_key(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    REDACTION_KEY_PATTERNS.iter().any(|p| k.contains(p))
}

/// Mirrors CONFIG_NODE_DEVICE_LOCAL_KEYS (config-node.js), pre-lowered. A field is
/// device-local — never enters the replicated node — iff its value names a filesystem
/// path, an executable/allowlist, this device's endpoint/identity, or how/whether THIS
/// host launches (the canonical VS Code `machine` scope). MUST stay byte-identical with
/// the TS list or the cross-stack node digest diverges. Guarded by
/// scripts/ci/check-config-node-keys.mjs.
const DEVICE_LOCAL_KEYS: &[&str] = &[
    "autostart",
    "engine",
    "hostpath",
    "model_fs_root",
    "model_shell_allowlist",
    "path",
    "peerid",
    "sidecarurl",
];

/// Exact key-name match (not substring — unlike secret redaction), case-insensitive.
fn should_drop_key(key: &str) -> bool {
    let k = key.to_ascii_lowercase();
    DEVICE_LOCAL_KEYS.iter().any(|d| k == *d)
}

/// Redact secret-valued keys AND strip device-local keys recursively (mirror
/// redactValue, config-node.js). Objects recurse key-by-key; arrays recurse by index
/// with the index as a path segment (`credentials.0.token`).
///
/// Device-local BEFORE secret: a device-local key (exact-name match) is REMOVED with its
/// whole subtree (not `<redacted>` — a machine value has no portable form). A key whose
/// lowercased name CONTAINS a secret pattern is replaced by CONFIG_NODE_REDACTION and its
/// subtree is NOT walked. A container emptied by the strip is pruned (returned as None) so
/// it can't survive as an orphan `{}` — matching the TS DROP sentinel, so the digest
/// stays byte-identical across stacks.
///
/// Returns the projected value + (sorted redacted paths, sorted device-local paths).
fn redact_config(config: &Value) -> (Value, Vec<String>, Vec<String>) {
    // None = "this container became empty because the strip removed its only contents".
    fn visit(
        cur: &Value,
        path: &mut Vec<String>,
        redacted: &mut Vec<String>,
        dropped: &mut Vec<String>,
    ) -> Option<Value> {
        match cur {
            Value::Array(items) => Some(Value::Array(
                items
                    .iter()
                    .enumerate()
                    .map(|(i, item)| {
                        path.push(i.to_string());
                        // Array elements are positional; a dropped element still holds
                        // its slot as null (arrays don't prune, matching TS map()).
                        let v = visit(item, path, redacted, dropped).unwrap_or(Value::Null);
                        path.pop();
                        v
                    })
                    .collect(),
            )),
            Value::Object(map) => {
                let mut obj = serde_json::Map::new();
                let mut saw_entry = false;
                let mut dropped_device_local_here = false;
                for (key, child) in map {
                    saw_entry = true;
                    path.push(key.clone());
                    if should_drop_key(key) {
                        dropped.push(path.join("."));
                        dropped_device_local_here = true;
                    } else if should_redact_key(key) {
                        obj.insert(key.clone(), Value::String(CONFIG_NODE_REDACTION.into()));
                        redacted.push(path.join("."));
                    } else if let Some(v) = visit(child, path, redacted, dropped) {
                        obj.insert(key.clone(), v);
                    } else {
                        dropped.push(path.join("."));
                        dropped_device_local_here = true;
                    }
                    path.pop();
                }
                // Prune ONLY when the strip emptied it; a legitimately-empty device-global
                // object (nothing device-local removed) is preserved as-is.
                if saw_entry && dropped_device_local_here && obj.is_empty() {
                    None
                } else {
                    Some(Value::Object(obj))
                }
            }
            other => Some(other.clone()),
        }
    }
    let mut redacted_paths = Vec::new();
    let mut dropped_paths = Vec::new();
    let projected = visit(
        config,
        &mut Vec::new(),
        &mut redacted_paths,
        &mut dropped_paths,
    )
    .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    redacted_paths.sort(); // mirrors redactedPaths: redactions.sort()
    dropped_paths.sort(); // mirrors deviceLocalPaths: dropped.sort()
    (projected, redacted_paths, dropped_paths)
}

/// A single JSON leaf encoded to match `JSON.stringify` (config-node.js:32).
/// Strings/bools/null match serde_json directly (both RFC 8259). Numbers are the
/// one real divergence: serde emits an integer-valued float as `10.0` while JS
/// (one number type) emits `10`. Normalize integer-valued finite f64 to the
/// no-decimal form so the digest byte-matches the TS side — otherwise a decimal
/// budget like `{"openai":10}` would compute a DIFFERENT revision per stack and
/// defeat the unification.
fn json_leaf(value: &Value) -> String {
    match value {
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                i.to_string()
            } else if let Some(u) = n.as_u64() {
                u.to_string()
            } else if let Some(f) = n.as_f64() {
                if f.is_finite() && f.fract() == 0.0 && f.abs() < 9.007_199_254_740_992e15 {
                    // integer-valued float within JS safe-integer range → `10`, not `10.0`
                    format!("{}", f as i64)
                } else {
                    // serde_json uses shortest round-tripping (Ryū/grisu), matching
                    // V8 for the decimal magnitudes a config carries.
                    n.to_string()
                }
            } else {
                n.to_string()
            }
        }
        // String/Bool/Null: serde_json's encoding equals JSON.stringify.
        other => other.to_string(),
    }
}

/// Byte-identical to the JS `canonicalJson()` (config-node.js:22-33): recursively
/// key-sorted objects, arrays in order, leaves via `json_leaf`. This is the ONLY
/// correct digest input — `serde_json::to_string` would differ in number
/// formatting and diverge from the TS revision.
///
/// `pub(crate)` (re-exported as `crate::host::canonical_json`) because the config
/// node's revision is no longer the only digest this crate takes over arbitrary
/// JSON: `sidecar::scenario` hashes a dispatch's request shape, and it must sort
/// keys the same way, format numbers the same way, and stay reproducible from the
/// TS side the same way. A second canonicaliser is exactly how two digests over
/// "the same" JSON drift apart.
pub(crate) fn canonical_json(value: &Value) -> String {
    match value {
        Value::Array(items) => {
            let inner: Vec<String> = items.iter().map(canonical_json).collect();
            format!("[{}]", inner.join(","))
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let inner: Vec<String> = keys
                .iter()
                .map(|k| {
                    format!(
                        "{}:{}",
                        Value::String((*k).clone()),
                        canonical_json(&map[*k])
                    )
                })
                .collect();
            format!("{{{}}}", inner.join(","))
        }
        leaf => json_leaf(leaf),
    }
}

fn sha256_hex(s: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(s.as_bytes()))
}

/// Build the unified config node payload from the parsed sovereign config
/// (mirror createConfigNode, config-node.js:94-117). `data` is the REDACTED
/// sovereign config — never the raw derived MODEL_* env map (the old leak).
pub(crate) fn build_config_node_payload(config: &Value, source: &str) -> Value {
    let (redacted, redacted_paths, device_local_paths) = redact_config(config);
    let digest = sha256_hex(&canonical_json(&redacted));

    serde_json::json!({
        // JSON-LD mirror so a payload-level reader still sees @type/@id.
        "@type": CONFIG_NODE_GRAPH_TYPE,
        "@id":   CONFIG_NODE_DEFAULT_ID,
        // TS contract, verbatim:
        "schema":   CONFIG_NODE_SCHEMA,
        "kind":     CONFIG_NODE_KIND,
        "id":       CONFIG_NODE_DEFAULT_ID,
        "revision": format!("sha256:{digest}"),
        "data":     redacted,
        "evidence": {
            "hashAlgorithm": "sha256",
            "configDigest":  digest,
            "redactedPaths": redacted_paths,
            "deviceLocalPaths": device_local_paths,
            "source":        source,
        },
        "boundaries": [
            "node data is redacted before hashing or graph handoff",
            "runtime secrets stay outside graph-portable config nodes",
            "device-local fields (paths, endpoints, per-host launch/exec) never replicate",
            "host policy owns which config node revisions may be activated",
        ],
    })
}

/// The `revision` string a config node payload carries, if present. Used by the
/// read-before-write guard to skip an idempotent re-write (avoids re-committing
/// a byte-identical node on every plugin load → no CRDT broadcast churn).
pub(crate) fn payload_revision(payload: &str) -> Option<String> {
    serde_json::from_str::<Value>(payload)
        .ok()?
        .get("revision")?
        .as_str()
        .map(str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ---- declared_base: the chain, step for step against its TypeScript twin.
    // PURE, so no test here mutates this binary's environment: `set_var` is process-global and
    // `cargo test` runs in parallel, so an env-mutating test for a resolver every other test
    // reads is a race dressed as coverage.

    /// The declared injection wins over everything, including a present home.
    #[test]
    fn sovereign_base_wins_over_every_later_step() {
        let (base, origin) = resolve_declared_base(
            |key| match key {
                "SOVEREIGN_BASE" => Some("/declared".into()),
                "REFARM_HOME" => Some("/other/.refarm".into()),
                "HOME" => Some("/home/someone".into()),
                _ => None,
            },
            Some(PathBuf::from("/os/home"))).expect("a base resolves");
        assert_eq!(base, PathBuf::from("/declared"));
        assert_eq!(origin, DeclaredBaseOrigin::SovereignBase);
    }

    /// Step 2 — the step this resolver did not have. Before it existed, a node with a declared
    /// REFARM_HOME and no SOVEREIGN_BASE resolved to the process cwd, while TS resolved to the
    /// home's parent: one declaration, two directories, one of them whatever shell ran `cd`.
    #[test]
    fn refarm_home_resolves_to_its_parent_when_no_base_is_injected() {
        let (base, origin) = resolve_declared_base(
            |key| match key {
                "REFARM_HOME" => Some("/home/op/.refarm".into()),
                "HOME" => Some("/home/op".into()),
                _ => None,
            },
            Some(PathBuf::from("/os/home"))).expect("a base resolves");
        assert_eq!(base, PathBuf::from("/home/op"));
        assert_eq!(origin, DeclaredBaseOrigin::RefarmHome);
    }

    /// ISS-028 exactly: `Path::parent()` answers "" where `path.dirname()` answers ".", and
    /// None where it answers "/". Both cases come from a REFARM_HOME an operator can really
    /// type, and both used to make the two stacks disagree about one declaration.
    #[test]
    fn dirname_matches_the_typescript_semantics_on_relative_and_rootless_paths() {
        assert_eq!(dirname_like_ts(Path::new("/a/b")), PathBuf::from("/a"));
        assert_eq!(dirname_like_ts(Path::new(".refarm")), PathBuf::from("."));
        assert_eq!(dirname_like_ts(Path::new("/")), PathBuf::from("/"));
    }

    #[test]
    fn an_empty_or_whitespace_declaration_is_no_declaration_at_all() {
        let (base, origin) = resolve_declared_base(
            |key| match key {
                "SOVEREIGN_BASE" => Some("   ".into()),
                "REFARM_HOME" => Some("".into()),
                "HOME" => Some("/home/op".into()),
                _ => None,
            },
            None).expect("a base resolves");
        assert_eq!(base, PathBuf::from("/home/op"));
        assert_eq!(origin, DeclaredBaseOrigin::EnvHome);
    }

    #[test]
    fn userprofile_answers_where_home_is_absent() {
        let (base, origin) = resolve_declared_base(
            |key| (key == "USERPROFILE").then(|| "C:\\Users\\op".to_string()),
            None).expect("a base resolves");
        assert_eq!(base, PathBuf::from("C:\\Users\\op"));
        assert_eq!(origin, DeclaredBaseOrigin::EnvHome);
    }

    #[test]
    fn the_os_home_answers_before_the_current_directory_ever_does() {
        let (base, origin) =
            resolve_declared_base(|_| None, Some(PathBuf::from("/os/home"))).expect("a base resolves");
        assert_eq!(base, PathBuf::from("/os/home"));
        assert_eq!(origin, DeclaredBaseOrigin::OsHome);
    }

    /// THE CHAIN ENDS WHERE THE TYPESCRIPT ONE ENDS, and says nothing rather than guessing.
    ///
    /// There used to be a fifth step here: the process's current directory, named rather than
    /// silent. Naming it was an improvement and not a fix — the TS resolver has no such step, so
    /// on a machine where nothing above answers the two implementations returned DIFFERENT bases
    /// and this node rooted itself in whatever directory a shell last `cd`-ed to (ISS-023).
    #[test]
    fn nothing_declared_and_no_home_resolves_to_nothing_at_all() {
        assert_eq!(resolve_declared_base(|_| None, None), None);
    }

    /// The two inputs ISS-028 named as diverging between the languages, asserted against the
    /// values `path.dirname()` returns for them: `.refarm` -> `.`, `/` -> `/`. `Path::parent()`
    /// agrees with NEITHER on its own — it answers `Some("")` and `None` — which is why
    /// `dirname_like_ts` exists and why the daemon must use it too.
    #[test]
    fn a_relative_or_rootless_refarm_home_answers_what_dirname_answers() {
        let relative = resolve_declared_base(
            |key| (key == REFARM_HOME_KEY).then(|| ".refarm".to_string()),
            None,
        )
        .expect("a base resolves");
        assert_eq!(relative.0, PathBuf::from("."));
        assert_eq!(relative.1, DeclaredBaseOrigin::RefarmHome);

        let rootless = resolve_declared_base(
            |key| (key == REFARM_HOME_KEY).then(|| "/".to_string()),
            None,
        )
        .expect("a base resolves");
        assert_eq!(rootless.0, PathBuf::from("/"));
        assert_eq!(rootless.1, DeclaredBaseOrigin::RefarmHome);
    }

    /// The daemon settles SOVEREIGN_BASE through the SAME helper. `Path::parent()` on `/` is
    /// `None`, and the daemon used to skip setting the variable entirely in that case — leaving
    /// every later read to fall through the chain (ISS-023).
    #[test]
    fn the_daemon_helper_answers_for_a_root_level_sovereign_dir() {
        assert_eq!(dirname_like_ts_public(Path::new("/")), PathBuf::from("/"));
        assert_eq!(dirname_like_ts_public(Path::new("/home/op/.refarm")), PathBuf::from("/home/op"));
        assert_eq!(dirname_like_ts_public(Path::new(".refarm")), PathBuf::from("."));
    }

    fn data_of(payload: &Value) -> &Value {
        &payload["data"]
    }

    // Cross-stack known-answer: these digests are computed by the TS createConfigNode
    // (packages/config) over the SAME input. Pinning them here makes the "byte-identical
    // revision across stacks" claim a real test — it was previously only asserted by a
    // hand-mirror comment. If the Rust walk/canonicalization drifts from TS, this fails.
    #[test]
    fn revision_matches_ts_known_answer_for_integer_float_budget() {
        // The integer-valued-float case ({"openai":10}) is the one number-formatting
        // divergence json_leaf normalizes; it must hash identically to JS.
        let payload = build_config_node_payload(&json!({ "budgets": { "openai": 10 } }), "test");
        assert_eq!(
            payload["revision"],
            json!("sha256:6e16f0bf32a6254198cccfacb16b389d9c19d716bdebacc5be4e41c08dcac5df")
        );
    }

    #[test]
    fn strips_device_local_keys_from_the_node() {
        let payload = build_config_node_payload(
            &json!({
                "model": "gpt-4",
                "runtime": { "sidecarUrl": "http://127.0.0.1:42001" },
                "tractor": { "engine": "rust" },
                "autostart": "always",
                "MODEL_FS_ROOT": "/workspaces/refarm",
                "MODEL_SHELL_ALLOWLIST": "ls,cat",
                "peerId": "424242"
            }),
            "test",
        );
        let data = data_of(&payload);
        assert_eq!(data["model"], json!("gpt-4"));
        // device-local containers/keys removed, not placeholder'd:
        assert!(
            data.get("runtime").is_none(),
            "runtime pruned (only sidecarUrl)"
        );
        assert!(
            data.get("tractor").is_none(),
            "tractor pruned (only engine)"
        );
        assert!(data.get("autostart").is_none());
        assert!(data.get("MODEL_FS_ROOT").is_none());
        assert!(data.get("MODEL_SHELL_ALLOWLIST").is_none());
        assert!(data.get("peerId").is_none());
        // no "<redacted>" anywhere — device-local is dropped, not masked
        assert!(!serde_json::to_string(data)
            .unwrap()
            .contains(CONFIG_NODE_REDACTION));
    }

    #[test]
    fn two_layer_model_grant_converges_allowlist_stays_local() {
        // The user's capability GRANT rides the node (portable intent); the per-host
        // exec ALLOWLIST never does (machine fact). Proven on one payload.
        let payload = build_config_node_payload(
            &json!({
                "approvedPermissions": { "vault": ["shell:spawn"] },
                "MODEL_SHELL_ALLOWLIST": "cargo,rustc,wasm-tools"
            }),
            "test",
        );
        let data = data_of(&payload);
        assert_eq!(
            data["approvedPermissions"],
            json!({ "vault": ["shell:spawn"] })
        );
        assert!(data.get("MODEL_SHELL_ALLOWLIST").is_none());
    }

    #[test]
    fn two_devices_differing_only_in_device_local_converge() {
        let a = build_config_node_payload(
            &json!({
                "model": "gpt-4",
                "approvedPermissions": { "vault": ["fs:read"] },
                "runtime": { "sidecarUrl": "http://127.0.0.1:42001" },
                "autostart": "always"
            }),
            "device-a",
        );
        let b = build_config_node_payload(
            &json!({
                "model": "gpt-4",
                "approvedPermissions": { "vault": ["fs:read"] },
                "runtime": { "sidecarUrl": "http://127.0.0.1:47777" },
                "autostart": "never"
            }),
            "device-b",
        );
        // Identical device-GLOBAL config → identical revision, despite different endpoints.
        assert_eq!(a["revision"], b["revision"]);
    }

    #[test]
    fn secret_still_redacted_after_device_local_strip() {
        // The device-local pass must not disturb the existing secret redaction.
        let payload = build_config_node_payload(
            &json!({ "providers": { "github": { "accessToken": "s3cr3t" } } }),
            "test",
        );
        assert_eq!(
            data_of(&payload)["providers"]["github"]["accessToken"],
            json!(CONFIG_NODE_REDACTION)
        );
    }
}
