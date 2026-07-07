// Plugin pointer nodes — the id -> {hash, manifest} pointer that lets a device with
// a replicated GRANT (but no local install) resolve and load a plugin by content hash
// (E3 wiring).
//
// The skills content-addressing pattern is the precedent: a POINTER carries the
// metadata (id, hash, the manifest essentials) while the BYTES live in the content-
// addressed store, resolved by hash + verified. But the skills pointer rides a FLAT FS
// ledger that never touches the CRDT sync path — so it would never travel. This pointer
// instead rides the SAME Loro `"nodes"` map as the grant/config node (store_node), so
// when the grant syncs cross-device the pointer syncs with it, in the same doc over the
// same wire.
//
// A device that has the grant + this pointer + the content-store bytes has EVERYTHING
// to load: the whole manifest rides the pointer (small, public), so there is no second
// id->manifest lookup. The device-local `entry` (an absolute path) is stripped — the
// receiving device reconstructs it when load_plugin_by_hash materializes the install
// dir from the content-store.

use serde_json::Value;

pub(crate) const PLUGIN_POINTER_NODE_TYPE: &str = "RefarmPluginPointer";
const PLUGIN_POINTER_NODE_PREFIX: &str = "urn:refarm:plugin-pointer:";

/// The node id for a plugin's pointer — one per plugin id (upsert, like the config node).
pub(crate) fn plugin_pointer_node_id(plugin_id: &str) -> String {
    format!("{PLUGIN_POINTER_NODE_PREFIX}{plugin_id}")
}

/// Build a `RefarmPluginPointer` node payload from the raw `plugin.json` manifest value.
///
/// The whole manifest rides the pointer MINUS `entry` (a device-local absolute path that
/// must not replicate — mirrors DEVICE_LOCAL_KEYS). `hash` is the sha256 of the `.wasm`
/// (the content-address load_plugin_by_hash resolves); `integrity` is `sha256-<hash>`.
pub(crate) fn build_plugin_pointer_payload(
    plugin_id: &str,
    wasm_hash: &str,
    raw_manifest: &Value,
) -> Value {
    // Strip the device-local `entry` from the manifest that rides the wire.
    let manifest = match raw_manifest {
        Value::Object(map) => {
            let mut portable = map.clone();
            portable.remove("entry");
            Value::Object(portable)
        }
        other => other.clone(),
    };
    serde_json::json!({
        "@type": PLUGIN_POINTER_NODE_TYPE,
        "@id": plugin_pointer_node_id(plugin_id),
        "pluginId": plugin_id,
        "hash": wasm_hash,
        "integrity": format!("sha256-{wasm_hash}"),
        "manifest": manifest,
    })
}

/// Materialize the plugin pointer into the graph at load, so an orphan-grant device can
/// later resolve id -> hash + manifest and load by hash. Idempotent upsert by node id;
/// re-materializing the same pointer on every load is a no-op. Best-effort — a pointer
/// write failure never blocks the load (the local device already has the plugin).
pub(crate) fn materialize_plugin_pointer(
    sync: &crate::sync::NativeSync,
    plugin_id: &str,
    wasm_hash: &str,
    raw_manifest: &Value,
) -> anyhow::Result<()> {
    let payload = build_plugin_pointer_payload(plugin_id, wasm_hash, raw_manifest);
    sync.store_node(
        &plugin_pointer_node_id(plugin_id),
        PLUGIN_POINTER_NODE_TYPE,
        None,
        &payload.to_string(),
        Some("tractor-host"),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest() -> Value {
        serde_json::json!({
            "id": "@refarm/vault",
            "version": "0.1.0",
            "entry": "file:///home/user/.refarm/plugins/refarm_vault/plugin.wasm",
            "permissions": ["fs:read"],
            "observability": { "hooks": ["onLoad"] },
        })
    }

    #[test]
    fn pointer_id_is_stable_per_plugin() {
        assert_eq!(
            plugin_pointer_node_id("vault"),
            "urn:refarm:plugin-pointer:vault"
        );
    }

    #[test]
    fn pointer_carries_hash_manifest_and_integrity() {
        let payload = build_plugin_pointer_payload("vault", "abc123", &manifest());
        assert_eq!(payload["pluginId"], "vault");
        assert_eq!(payload["hash"], "abc123");
        assert_eq!(payload["integrity"], "sha256-abc123");
        assert_eq!(payload["@type"], PLUGIN_POINTER_NODE_TYPE);
        // The manifest essentials ride the pointer.
        assert_eq!(payload["manifest"]["id"], "@refarm/vault");
        assert_eq!(payload["manifest"]["permissions"][0], "fs:read");
    }

    #[test]
    fn pointer_strips_the_device_local_entry() {
        // `entry` is an absolute local path — it must NOT replicate (a peer reconstructs
        // it from the content-store). Same posture as DEVICE_LOCAL_KEYS.
        let payload = build_plugin_pointer_payload("vault", "abc123", &manifest());
        assert!(
            payload["manifest"].get("entry").is_none(),
            "the device-local entry must not ride the replicated pointer"
        );
    }
}
