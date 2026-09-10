//! WHAT THIS NODE IS, published where whoever can read the node can read it.
//!
//! A daemon that cannot say where it answers from will answer from the wrong place again.
//! That is not hypothetical: a runtime restarted from a repository resolved declarations
//! there, a device started a declared operation, and the node ADMITTED it (the catalog came
//! from the operator's home) and then REFUSED it while running (the workspace came from the
//! daemon's directory). What reached the phone was "the operation promised a result and
//! delivered none" — true, and naming no directory at all.
//!
//! ## Why a file and not a route
//!
//! Every sidecar route is `RouteRequirement::DeviceOnly` unless it declares otherwise, which
//! is the right default and the wrong fit here: `refarm runtime status` is the OPERATOR
//! asking their own node a question about itself, and there is no loopback exemption in the
//! gate. Requiring a device credential for that inverts the authority — whoever can read
//! `<refarm-dir>` already holds more than any enrolled device does.
//!
//! So the node publishes, and the filesystem IS the gate. The descriptor lives inside the
//! sovereign dir the node was given, so reading it requires exactly the access that reading
//! the node's declarations requires.
//!
//! ## Staleness is answered, not assumed
//!
//! A file outlives the process that wrote it, and a descriptor from a dead node is history
//! presented as fact — the same shape of lie this whole change exists to remove. So the PID
//! travels with it and the reader checks: alive means the descriptor describes something,
//! gone means it describes what used to be. No timestamp heuristic, no lock file, no
//! cleanup that a crash would skip.
//!
//! ## One descriptor, not one file per question
//!
//! `wire` is versioned because this is the place the NEXT fact a node needs to publish
//! belongs. A second file per fact is how a directory becomes a junk drawer.
//!
//! ## WHO, not just WHERE — `nodeName` and `nodeId`
//!
//! Everything above answers "where does this node answer from". It says nothing about
//! "which node is this" — the gap that left `BudgetObservation` unable to say which
//! machine ran a given effort even though the CRDT store already replicates rows from
//! every device onto one table. `nodeName` (the operator's declared, mutable label —
//! `config.json`'s `node.name`) and `nodeId` (an opaque id minted once and persisted
//! beside this very file, never replicated) close that gap; see `node_identity.rs` for
//! why they are resolved so differently and why one of them must never travel. Both are
//! OMITTED, never a fabricated placeholder, when this boot has none to report —
//! `declared_node_name` for an undeclared name, a first-boot write failure for a missing
//! id (see `node_identity::load_or_create_node_id`'s doc).

use std::path::{Path, PathBuf};

/// The file, inside the sovereign dir the node was given.
pub const NODE_DESCRIPTOR_FILE: &str = "node.json";
/// The contract name, versioned so a reader can refuse what it does not understand.
pub const NODE_DESCRIPTOR_WIRE: &str = "node-descriptor.v1";

/// Where the descriptor goes for a node whose sovereign dir is `refarm_dir`.
pub fn node_descriptor_path(refarm_dir: &Path) -> PathBuf {
    refarm_dir.join(NODE_DESCRIPTOR_FILE)
}

/// The descriptor's bytes. PURE — every field is an argument, so a test states the whole
/// fact and no test needs a running daemon or a clock.
///
/// `node_name`/`node_id` are `None` when this boot has nothing to report on that axis —
/// see the module doc's "WHO, not just WHERE". Built as a map rather than through the
/// `serde_json::json!` macro so an absent identifier is a MISSING key, never a `null`
/// value: a reader must be able to tell "this node declared no name" apart from "this
/// node has a name and it happens to be JSON null", and the second should not be
/// expressible at all.
pub fn node_descriptor_json(
    declaration_base: &Path,
    sovereign_dir: &str,
    pid: u32,
    started_at: &str,
    node_name: Option<&str>,
    node_id: Option<&str>,
) -> String {
    let mut map = serde_json::Map::new();
    map.insert("wire".into(), NODE_DESCRIPTOR_WIRE.into());
    map.insert(
        "declarationBase".into(),
        declaration_base.to_string_lossy().into_owned().into(),
    );
    map.insert("sovereignDir".into(), sovereign_dir.into());
    map.insert("pid".into(), pid.into());
    map.insert("startedAt".into(), started_at.into());
    if let Some(name) = node_name {
        map.insert("nodeName".into(), name.into());
    }
    if let Some(id) = node_id {
        map.insert("nodeId".into(), id.into());
    }
    let value = serde_json::Value::Object(map);
    format!("{}\n", serde_json::to_string_pretty(&value).unwrap_or_default())
}

/// Publish the descriptor, best effort.
///
/// A node that cannot write its own descriptor still works — every path that reads it
/// treats absence as "this node does not say", which is the honest answer and the one that
/// keeps an old node and a new reader compatible. So a failure here is never fatal: the
/// daemon's job is not to describe itself.
#[allow(clippy::too_many_arguments)]
pub fn publish_node_descriptor(
    refarm_dir: &Path,
    declaration_base: &Path,
    sovereign_dir: &str,
    pid: u32,
    started_at: &str,
    node_name: Option<&str>,
    node_id: Option<&str>,
) {
    let json = node_descriptor_json(declaration_base, sovereign_dir, pid, started_at, node_name, node_id);
    let _ = std::fs::create_dir_all(refarm_dir);
    let _ = std::fs::write(node_descriptor_path(refarm_dir), json);
}

/// Publish for THIS process, now — the shape `main()` uses, so the binary never has to
/// name a clock or a pid and the crate keeps its own time formatting to itself.
///
/// Resolves both identifiers here rather than asking the caller for them, so `main()`'s
/// call site stays the one line it already was: `node_id` is minted/read straight off
/// `refarm_dir` (the exact directory this descriptor itself lands in — see
/// `node_identity::load_or_create_node_id`), and `node_name` is read live off
/// `declaration_base` (the same base every other config-declared fact on this node
/// resolves against — see `node_identity::declared_node_name`).
pub fn publish_for_this_process(refarm_dir: &Path, declaration_base: &Path, sovereign_dir: &str) {
    let node_id = crate::node_identity::load_or_create_node_id(refarm_dir);
    let node_name = crate::node_identity::declared_node_name(declaration_base);
    publish_node_descriptor(
        refarm_dir,
        declaration_base,
        sovereign_dir,
        std::process::id(),
        &crate::timefmt::now_iso_seconds(),
        node_name.as_deref(),
        node_id.as_deref(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_descriptor_states_where_the_node_answers_from() {
        let json = node_descriptor_json(
            Path::new("/home/op"),
            ".refarm",
            4242,
            "2026-08-03T02:11:04Z",
            None,
            None,
        );
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("valid json");
        assert_eq!(parsed["wire"], NODE_DESCRIPTOR_WIRE);
        assert_eq!(parsed["declarationBase"], "/home/op");
        assert_eq!(parsed["sovereignDir"], ".refarm");
        assert_eq!(parsed["pid"], 4242);
        assert_eq!(parsed["startedAt"], "2026-08-03T02:11:04Z");
    }

    #[test]
    fn the_pid_travels_so_a_reader_can_tell_history_from_fact() {
        // A descriptor outlives its process. Without the pid a reader cannot distinguish a
        // live node from a directory that used to hold one, and would report the second as
        // the first — the same shape of lie this file exists to remove.
        let json = node_descriptor_json(Path::new("/x"), ".refarm", 7, "t", None, None);
        assert!(json.contains("\"pid\": 7"), "the pid must be readable: {json}");
    }

    #[test]
    fn the_descriptor_carries_the_declared_name_and_opaque_id_when_both_are_known() {
        let json = node_descriptor_json(
            Path::new("/home/op"),
            ".refarm",
            4242,
            "t",
            Some("galaxy-a55-5g-desktop"),
            Some("b6e9c9c0-1e2f-4a3b-9c1d-0e5f6a7b8c9d"),
        );
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("valid json");
        assert_eq!(parsed["nodeName"], "galaxy-a55-5g-desktop");
        assert_eq!(parsed["nodeId"], "b6e9c9c0-1e2f-4a3b-9c1d-0e5f6a7b8c9d");
    }

    #[test]
    fn an_unknown_identifier_is_a_missing_key_never_a_null() {
        // A reader must be able to tell "this node declared no name" apart from "this
        // node's name happens to be JSON null" — the second must not be expressible.
        let json = node_descriptor_json(Path::new("/x"), ".refarm", 7, "t", None, None);
        let parsed: serde_json::Value = serde_json::from_str(&json).expect("valid json");
        assert!(parsed.get("nodeName").is_none(), "no declared name: nodeName must be absent, not null");
        assert!(parsed.get("nodeId").is_none(), "no opaque id: nodeId must be absent, not null");
    }

    #[test]
    fn it_lands_inside_the_sovereign_dir_the_node_was_given() {
        // Reading it therefore needs exactly the access reading the node's declarations
        // needs — the filesystem is the gate, which is why this is a file and not a route.
        assert_eq!(
            node_descriptor_path(Path::new("/home/op/.refarm")),
            PathBuf::from("/home/op/.refarm/node.json")
        );
    }

    #[test]
    fn publishing_is_best_effort_and_never_panics() {
        // A node that cannot describe itself still works. Absence means "this node does not
        // say", which keeps an old node and a new reader compatible.
        publish_node_descriptor(
            Path::new("/proc/nonexistent-and-unwritable"),
            Path::new("/home/op"),
            ".refarm",
            1,
            "t",
            None,
            None,
        );
    }

    #[test]
    fn publish_for_this_process_mints_and_persists_an_id_on_first_boot() {
        // `publish_for_this_process` is the shape `main()` actually calls — this proves
        // the identity resolution wired INTO it, not just the pure json builder above.
        let refarm_dir = std::env::temp_dir().join(format!("node-descriptor-boot-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&refarm_dir).expect("create scratch refarm dir");

        publish_for_this_process(&refarm_dir, Path::new("/no/such/declared/base"), ".refarm");

        let contents = std::fs::read_to_string(node_descriptor_path(&refarm_dir)).expect("read node.json");
        let parsed: serde_json::Value = serde_json::from_str(&contents).expect("valid json");
        let node_id = parsed["nodeId"].as_str().expect("a minted node id");
        uuid::Uuid::parse_str(node_id).expect("the published id is a valid uuid");
        // No config.json under the scratch declared base, so no declared name to publish.
        assert!(parsed.get("nodeName").is_none());

        let on_disk = std::fs::read_to_string(crate::node_identity::node_id_path(&refarm_dir))
            .expect("the id was persisted, not just published");
        assert_eq!(on_disk.trim(), node_id, "the published id is the persisted one, not a second mint");

        std::fs::remove_dir_all(&refarm_dir).ok();
    }
}
