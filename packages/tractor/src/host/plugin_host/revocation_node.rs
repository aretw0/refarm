// Revocation tombstones — monotonic security state (G).
//
// A revocation must be a fact that a stale, concurrently-writing device cannot
// undo. The config node (`urn:sovereign:config:workspace`) is a single whole-value
// LWW register: encoding a revocation as an ABSENCE there (removing an id from
// `trusted_plugins`) loses to a concurrent higher-Lamport whole-node write —
// "absence loses to presence", so a revoked grant resurrects. For security, DENY
// must dominate ALLOW regardless of clock.
//
// So each revocation is its OWN Loro node (`urn:sovereign:revocation:<pluginId>` or
// `…:<pluginId>:<cap>`), type `RevocationTombstone`. A node ADD is a first-class
// monotonic CRDT op — a competing whole-config write in a DIFFERENT map key cannot
// un-add it. Tombstones are add-only (union across devices), and the grant
// resolution subtracts them AFTER the fs ∩ node merge (B): a revoked id/cap is
// removed and no concurrent presence brings it back. The dual of B's
// deny-dominates intersection: presence of a tombstone on EITHER side wins.

use serde_json::Value;
use std::collections::{HashMap, HashSet};

pub(crate) const REVOCATION_NODE_TYPE: &str = "RevocationTombstone";
const REVOCATION_NODE_PREFIX: &str = "urn:sovereign:revocation:";

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

/// The node id for the ANNULMENT (un-revoke) of a plugin/capability revocation. A
/// distinct key from the revoke node — the two are add-only siblings that survive as a
/// union, so the CRDT never has to pick between them; the read side nets them by seq.
pub(crate) fn annulment_node_id(plugin_id: &str, capability: Option<&str>) -> String {
    match capability {
        None => format!("{}#annul", revocation_node_id(plugin_id)),
        Some(cap) => format!("{}#annul", capability_revocation_node_id(plugin_id, cap)),
    }
}

/// Build a `RevocationTombstone` (revoke) node payload with a monotonic operator seq.
/// `capability = None` revokes the whole plugin identity; `Some(cap)` revokes just that
/// capability. The seq is the operator's per-id counter (NOT a clock) — un-revoke and
/// re-revoke bump it, and the read side compares max(revoke.seq) vs max(annul.seq).
pub(crate) fn build_revocation_tombstone_payload(
    plugin_id: &str,
    capability: Option<&str>,
    seq: u64,
) -> Value {
    match capability {
        None => serde_json::json!({
            "@type": REVOCATION_NODE_TYPE,
            "kind": "plugin",
            "pluginId": plugin_id,
            "seq": seq,
        }),
        Some(cap) => serde_json::json!({
            "@type": REVOCATION_NODE_TYPE,
            "kind": "capability",
            "pluginId": plugin_id,
            "capability": cap,
            "seq": seq,
        }),
    }
}

/// Build an ANNULMENT (un-revoke) node payload — `kind:"annulment"` — carrying the seq
/// the operator bumped for this un-revoke. Same node TYPE as the revoke, so one
/// `query_nodes(REVOCATION_NODE_TYPE)` returns both; `kind` discriminates. When the
/// annulment's seq >= the revoke's seq, the revocation is netted out (un-revoked).
pub(crate) fn build_revocation_annulment_payload(
    plugin_id: &str,
    capability: Option<&str>,
    seq: u64,
) -> Value {
    match capability {
        None => serde_json::json!({
            "@type": REVOCATION_NODE_TYPE,
            "kind": "annulment",
            "pluginId": plugin_id,
            "seq": seq,
        }),
        Some(cap) => serde_json::json!({
            "@type": REVOCATION_NODE_TYPE,
            "kind": "annulment",
            "pluginId": plugin_id,
            "capability": cap,
            "seq": seq,
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

/// A scope a revocation targets: a whole plugin, or one capability of it.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum RevocationScope {
    Plugin(String),
    Capability(String, String),
}

/// The max revoke-seq and max annul-seq observed for one scope across all its nodes.
#[derive(Debug, Default, Clone, Copy)]
struct SeqPair {
    revoke: Option<u64>,
    annul: Option<u64>,
}

/// Parse the NET-revoked sets from the payloads of every `RevocationTombstone` node.
///
/// Un-revoke is an ANNULMENT node (a distinct add-only sibling of the revoke node), so a
/// scope may have both a revoke fact and an annulment fact. The net decision is by the
/// operator's monotonic `seq` (NOT any clock): a scope is revoked iff
/// `max(revoke.seq) >= max(annul.seq)`. Ties → REVOKED (deny dominates, fail-safe). A
/// missing seq is treated as 0 (pre-annulment revoke nodes stay revoked — backward-
/// compatible). Malformed payloads are skipped: a broken annulment fails safe by NOT
/// annulling (deny stays), a broken revoke is simply not honored — neither opens a grant.
///
/// Because the decision is `argmax(seq)` over the converged UNION of add-only nodes,
/// every device computes the same net set regardless of sync order, wall-clock, or peer
/// id — no single-key LWW tie-break can resurrect a revoked grant.
pub(crate) fn tombstones_from_payloads<'a>(payloads: impl Iterator<Item = &'a str>) -> Tombstones {
    let mut seqs: HashMap<RevocationScope, SeqPair> = HashMap::new();

    for payload in payloads {
        let Ok(node) = serde_json::from_str::<Value>(payload) else {
            continue;
        };
        let Some(plugin_id) = node.get("pluginId").and_then(Value::as_str) else {
            continue;
        };
        // Absent seq → 0 (backward-compat: pre-annulment revoke nodes have no seq).
        let seq = node.get("seq").and_then(Value::as_u64).unwrap_or(0);
        let is_annulment = node.get("kind").and_then(Value::as_str) == Some("annulment");
        let scope = match node.get("capability").and_then(Value::as_str) {
            Some(cap) => RevocationScope::Capability(plugin_id.to_string(), cap.to_string()),
            None => RevocationScope::Plugin(plugin_id.to_string()),
        };

        let entry = seqs.entry(scope).or_default();
        let slot = if is_annulment {
            &mut entry.annul
        } else {
            &mut entry.revoke
        };
        *slot = Some(slot.map_or(seq, |cur| cur.max(seq)));
    }

    let mut out = Tombstones::default();
    for (scope, pair) in seqs {
        // Revoked iff a revoke fact exists AND it is not out-ranked by an annulment.
        let Some(revoke_seq) = pair.revoke else {
            continue; // an annulment with no revoke is inert
        };
        let net_revoked = match pair.annul {
            Some(annul_seq) => revoke_seq >= annul_seq, // tie → revoked (deny dominates)
            None => true,
        };
        if !net_revoked {
            continue;
        }
        match scope {
            RevocationScope::Plugin(id) => {
                out.plugins.insert(id);
            }
            RevocationScope::Capability(id, cap) => {
                out.capabilities.entry(id).or_default().insert(cap);
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
        build_revocation_tombstone_payload(plugin_id, capability, 1).to_string()
    }
    fn revoke_seq(plugin_id: &str, capability: Option<&str>, seq: u64) -> String {
        build_revocation_tombstone_payload(plugin_id, capability, seq).to_string()
    }
    fn annul_seq(plugin_id: &str, capability: Option<&str>, seq: u64) -> String {
        build_revocation_annulment_payload(plugin_id, capability, seq).to_string()
    }
    fn net(payloads: &[String]) -> Tombstones {
        tombstones_from_payloads(payloads.iter().map(String::as_str))
    }

    #[test]
    fn node_ids_distinguish_plugin_from_capability() {
        assert_eq!(revocation_node_id("vault"), "urn:sovereign:revocation:vault");
        assert_eq!(
            capability_revocation_node_id("vault", "network:outbound"),
            "urn:sovereign:revocation:vault:network:outbound"
        );
        assert_eq!(
            annulment_node_id("vault", None),
            "urn:sovereign:revocation:vault#annul"
        );
    }

    #[test]
    fn collects_plugin_and_capability_tombstones() {
        let ts = net(&[
            payload("quality", None),
            payload("vault", Some("network:outbound")),
            payload("vault", Some("shell:spawn")),
        ]);
        assert!(ts.plugins.contains("quality"));
        assert_eq!(
            ts.capabilities.get("vault"),
            Some(&HashSet::from([
                "network:outbound".to_string(),
                "shell:spawn".to_string()
            ]))
        );
    }

    #[test]
    fn malformed_tombstone_is_skipped_not_an_error() {
        let ts = net(&[
            "not json".to_string(),
            r#"{"@type":"RevocationTombstone"}"#.to_string(),
            payload("ok", None),
        ]);
        // The broken ones don't open anything; the valid one is honored.
        assert_eq!(ts.plugins, HashSet::from(["ok".to_string()]));
    }

    // ── un-revoke: annulment nets a revoke by seq (converges without a clock) ──

    #[test]
    fn unrevoke_with_higher_seq_nets_out_the_revoke() {
        // revoke@1 then unrevoke@2 → not revoked (the annulment out-ranks).
        let ts = net(&[revoke_seq("vault", None, 1), annul_seq("vault", None, 2)]);
        assert!(
            !ts.plugins.contains("vault"),
            "higher-seq annulment un-revokes"
        );
    }

    #[test]
    fn stale_revoke_cannot_beat_higher_seq_unrevoke() {
        // The convergence guarantee, NO clock: order of observation is irrelevant — the
        // net is argmax(seq) over the union, identical on every device. Feed the revoke
        // AFTER the annulment; the annulment (seq 2) still wins over the revoke (seq 1).
        let ts = net(&[annul_seq("vault", None, 2), revoke_seq("vault", None, 1)]);
        assert!(
            !ts.plugins.contains("vault"),
            "a stale revoke can't beat a higher-seq unrevoke"
        );
    }

    #[test]
    fn re_revoke_with_higher_seq_denies_again() {
        // revoke@1, unrevoke@2, re-revoke@3 → revoked again (reversible, monotone).
        let ts = net(&[
            revoke_seq("vault", None, 1),
            annul_seq("vault", None, 2),
            revoke_seq("vault", None, 3),
        ]);
        assert!(
            ts.plugins.contains("vault"),
            "re-revoke with higher seq denies again"
        );
    }

    #[test]
    fn equal_seq_revoke_wins_deny_dominates() {
        // Tie → REVOKED. Deny is the fail-safe posture when seqs are equal.
        let ts = net(&[revoke_seq("vault", None, 2), annul_seq("vault", None, 2)]);
        assert!(ts.plugins.contains("vault"), "equal seq → deny dominates");
    }

    #[test]
    fn annulment_without_a_revoke_is_inert() {
        // An un-revoke of something never revoked does nothing (no grant opened).
        let ts = net(&[annul_seq("vault", None, 5)]);
        assert!(ts.plugins.is_empty());
    }

    #[test]
    fn malformed_annulment_leaves_revocation_active() {
        // A broken annulment must fail safe by NOT annulling — deny stays dominant.
        let ts = net(&[
            revoke_seq("vault", None, 1),
            r#"{"@type":"RevocationTombstone","kind":"annulment"}"#.to_string(), // no pluginId
        ]);
        assert!(
            ts.plugins.contains("vault"),
            "a broken annulment must not un-revoke"
        );
    }

    #[test]
    fn missing_seq_treated_as_zero_backward_compatible() {
        // A pre-annulment revoke node (no seq field) stays revoked; an annulment@1 nets
        // it out (1 > 0), so the un-revoke path works even against legacy revoke nodes.
        let legacy_revoke = r#"{"@type":"RevocationTombstone","kind":"plugin","pluginId":"vault"}"#;
        assert!(net(&[legacy_revoke.to_string()]).plugins.contains("vault"));
        let ts = net(&[legacy_revoke.to_string(), annul_seq("vault", None, 1)]);
        assert!(
            !ts.plugins.contains("vault"),
            "annulment@1 out-ranks a seq-less (0) revoke"
        );
    }

    #[test]
    fn per_capability_annulment_is_independent() {
        // Un-revoking one cap leaves another cap's revocation intact.
        let ts = net(&[
            revoke_seq("vault", Some("fs:read"), 1),
            revoke_seq("vault", Some("network:outbound"), 1),
            annul_seq("vault", Some("network:outbound"), 2),
        ]);
        let caps = ts.capabilities.get("vault").unwrap();
        assert!(
            caps.contains("fs:read"),
            "the un-annulled cap stays revoked"
        );
        assert!(
            !caps.contains("network:outbound"),
            "the annulled cap is netted out"
        );
    }
}
