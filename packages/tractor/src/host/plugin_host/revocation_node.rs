// Revocation tombstones — monotonic security state (G).
//
// A revocation must be a fact that a stale, concurrently-writing device cannot
// undo. The config node (`urn:refarm:config:workspace`) is a single whole-value
// LWW register: encoding a revocation as an ABSENCE there (removing an id from
// `trusted_plugins`) loses to a concurrent higher-Lamport whole-node write —
// "absence loses to presence", so a revoked grant resurrects. For security, DENY
// must dominate ALLOW regardless of clock.
//
// So each revocation is its OWN Loro node (`urn:refarm:revocation:<pluginId>` or
// `…:<pluginId>:<cap>`), type `RevocationTombstone`. A node ADD is a first-class
// monotonic CRDT op — a competing whole-config write in a DIFFERENT map key cannot
// un-add it. Tombstones are add-only (union across devices), and the grant
// resolution subtracts them AFTER the fs ∩ node merge (B): a revoked id/cap is
// removed and no concurrent presence brings it back. The dual of B's
// deny-dominates intersection: presence of a tombstone on EITHER side wins.

use serde_json::Value;
use std::collections::{HashMap, HashSet};

pub(crate) const REVOCATION_NODE_TYPE: &str = "RevocationTombstone";
const REVOCATION_NODE_PREFIX: &str = "urn:refarm:revocation:";

// The build/id functions below are the WRITE side of the tombstone contract — the host
// materializes an operator's add-only revocation list into per-revocation tombstone
// nodes at load (`materialize_revocation_tombstones`), and the READ side (collect +
// subtract) enforces them.

/// The node id for revoking an entire plugin identity (all its capabilities).
pub(crate) fn revocation_node_id(plugin_id: &str) -> String {
    format!("{REVOCATION_NODE_PREFIX}{plugin_id}")
}

/// The node id for revoking a single capability of a plugin.
pub(crate) fn capability_revocation_node_id(plugin_id: &str, capability: &str) -> String {
    format!("{REVOCATION_NODE_PREFIX}{plugin_id}:{capability}")
}

/// Build a `RevocationTombstone` node payload. `capability = None` revokes the whole
/// plugin identity; `Some(cap)` revokes just that capability.
pub(crate) fn build_revocation_tombstone_payload(
    plugin_id: &str,
    capability: Option<&str>,
) -> Value {
    match capability {
        None => serde_json::json!({
            "@type": REVOCATION_NODE_TYPE,
            "kind": "plugin",
            "pluginId": plugin_id,
        }),
        Some(cap) => serde_json::json!({
            "@type": REVOCATION_NODE_TYPE,
            "kind": "capability",
            "pluginId": plugin_id,
            "capability": cap,
        }),
    }
}

/// The revoked sets collected from all `RevocationTombstone` nodes in the graph.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct Tombstones {
    /// Plugin ids revoked entirely — no capability of these may be granted.
    pub plugins: HashSet<String>,
    /// Per-plugin revoked capabilities (a subset of that plugin's caps).
    pub capabilities: HashMap<String, HashSet<String>>,
}

/// Parse the revoked sets from the payloads of every `RevocationTombstone` node.
/// Malformed tombstones are skipped (a tombstone is a security add; a broken one is
/// simply not honored, never an error that opens a grant).
pub(crate) fn tombstones_from_payloads<'a>(payloads: impl Iterator<Item = &'a str>) -> Tombstones {
    let mut out = Tombstones::default();
    for payload in payloads {
        let Ok(node) = serde_json::from_str::<Value>(payload) else {
            continue;
        };
        let Some(plugin_id) = node.get("pluginId").and_then(Value::as_str) else {
            continue;
        };
        match node.get("capability").and_then(Value::as_str) {
            Some(cap) => {
                out.capabilities
                    .entry(plugin_id.to_string())
                    .or_default()
                    .insert(cap.to_string());
            }
            None => {
                out.plugins.insert(plugin_id.to_string());
            }
        }
    }
    out
}

/// Collect all revocation tombstones from the replicated graph. Read from the sync
/// read model by node type — the same query the reaper/audit paths use.
pub(crate) fn collect_tombstones(sync: &crate::sync::NativeSync) -> Tombstones {
    let Ok(rows) = sync.query_nodes(REVOCATION_NODE_TYPE) else {
        // A read failure means "no tombstone signal available" — never silently opens
        // a grant beyond what the fs ∩ node merge already allows; it just can't tighten.
        return Tombstones::default();
    };
    tombstones_from_payloads(rows.iter().map(|r| r.payload.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(plugin_id: &str, capability: Option<&str>) -> String {
        build_revocation_tombstone_payload(plugin_id, capability).to_string()
    }

    #[test]
    fn node_ids_distinguish_plugin_from_capability() {
        assert_eq!(revocation_node_id("vault"), "urn:refarm:revocation:vault");
        assert_eq!(
            capability_revocation_node_id("vault", "network:outbound"),
            "urn:refarm:revocation:vault:network:outbound"
        );
    }

    #[test]
    fn collects_plugin_and_capability_tombstones() {
        let ts = tombstones_from_payloads(
            [
                payload("quality", None),
                payload("vault", Some("network:outbound")),
                payload("vault", Some("shell:spawn")),
            ]
            .iter()
            .map(String::as_str),
        );
        assert!(ts.plugins.contains("quality"));
        assert_eq!(
            ts.capabilities.get("vault"),
            Some(&HashSet::from(["network:outbound".to_string(), "shell:spawn".to_string()]))
        );
    }

    #[test]
    fn malformed_tombstone_is_skipped_not_an_error() {
        let ts = tombstones_from_payloads(
            ["not json", r#"{"@type":"RevocationTombstone"}"#, payload("ok", None).as_str()]
                .iter()
                .copied(),
        );
        // The broken ones don't open anything; the valid one is honored.
        assert_eq!(ts.plugins, HashSet::from(["ok".to_string()]));
    }
}
