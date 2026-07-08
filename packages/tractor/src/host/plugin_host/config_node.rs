// Unified config-node contract — the Rust port of packages/config/src/config-node.js.
//
// The sovereign `.refarm/config.json` becomes a graph node (`RefarmConfig`) that
// replicates CRDT-wide. This module produces the SAME `refarm.config.node.v1`
// shape the TS encoder defines, so a node written by the tractor round-trips
// through the TS `configFromNode` and (for the same config) computes the SAME
// `revision` digest. Secrets are redacted before the config ever enters the node
// or its hash — the old writer leaked a raw MODEL_* env map across devices.
//
// The graph seam: `store_node(id, type_, …)` writes `type_` to the sqlite `type`
// column, which `query_nodes` and the reaper filter on — NOT the payload's
// `@type`. So the payload carries the full TS contract (schema/kind/id/…) while
// `type_` stays "RefarmConfig" (queryable, kept by the reaper). `@type`/`@id`
// mirror fields are added so a payload-level reader still sees JSON-LD.

use serde_json::Value;

pub(crate) const CONFIG_NODE_SCHEMA: &str = "refarm.config.node.v1";
pub(crate) const CONFIG_NODE_KIND: &str = "refarm/config";
pub(crate) const CONFIG_NODE_DEFAULT_ID: &str = "urn:refarm:config:workspace";
pub(crate) const CONFIG_NODE_REDACTION: &str = "<redacted>";
/// The graph `type_` column value — kept "RefarmConfig" so query_nodes + the
/// reaper allowlist (node_reap KEEP type) are unchanged.
pub(crate) const CONFIG_NODE_GRAPH_TYPE: &str = "RefarmConfig";

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
fn canonical_json(value: &Value) -> String {
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
