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

/// Redact secret-valued keys recursively (mirror redactValue, config-node.js:56-86).
/// Objects recurse key-by-key; arrays recurse by index with the index as a path
/// segment (`credentials.0.token`); a key whose lowercased name CONTAINS any
/// pattern is replaced by CONFIG_NODE_REDACTION and its subtree is NOT walked.
/// Returns the redacted value + the sorted list of redacted paths.
fn redact_config(config: &Value) -> (Value, Vec<String>) {
    fn visit(cur: &Value, path: &mut Vec<String>, out: &mut Vec<String>) -> Value {
        match cur {
            Value::Array(items) => Value::Array(
                items
                    .iter()
                    .enumerate()
                    .map(|(i, item)| {
                        path.push(i.to_string());
                        let v = visit(item, path, out);
                        path.pop();
                        v
                    })
                    .collect(),
            ),
            Value::Object(map) => {
                let mut obj = serde_json::Map::new();
                for (key, child) in map {
                    path.push(key.clone());
                    if should_redact_key(key) {
                        obj.insert(key.clone(), Value::String(CONFIG_NODE_REDACTION.into()));
                        out.push(path.join("."));
                    } else {
                        let v = visit(child, path, out);
                        obj.insert(key.clone(), v);
                    }
                    path.pop();
                }
                Value::Object(obj)
            }
            other => other.clone(),
        }
    }
    let mut paths = Vec::new();
    let redacted = visit(config, &mut Vec::new(), &mut paths);
    paths.sort(); // mirrors redactedPaths: redactions.sort()
    (redacted, paths)
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
    let (redacted, redacted_paths) = redact_config(config);
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
            "source":        source,
        },
        "boundaries": [
            "node data is redacted before hashing or graph handoff",
            "runtime secrets stay outside graph-portable config nodes",
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
