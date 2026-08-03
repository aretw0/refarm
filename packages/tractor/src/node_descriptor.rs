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
pub fn node_descriptor_json(
    declaration_base: &Path,
    sovereign_dir: &str,
    pid: u32,
    started_at: &str,
) -> String {
    let value = serde_json::json!({
        "wire": NODE_DESCRIPTOR_WIRE,
        "declarationBase": declaration_base.to_string_lossy(),
        "sovereignDir": sovereign_dir,
        "pid": pid,
        "startedAt": started_at,
    });
    format!("{}\n", serde_json::to_string_pretty(&value).unwrap_or_default())
}

/// Publish the descriptor, best effort.
///
/// A node that cannot write its own descriptor still works — every path that reads it
/// treats absence as "this node does not say", which is the honest answer and the one that
/// keeps an old node and a new reader compatible. So a failure here is never fatal: the
/// daemon's job is not to describe itself.
pub fn publish_node_descriptor(
    refarm_dir: &Path,
    declaration_base: &Path,
    sovereign_dir: &str,
    pid: u32,
    started_at: &str,
) {
    let json = node_descriptor_json(declaration_base, sovereign_dir, pid, started_at);
    let _ = std::fs::create_dir_all(refarm_dir);
    let _ = std::fs::write(node_descriptor_path(refarm_dir), json);
}

/// Publish for THIS process, now — the shape `main()` uses, so the binary never has to
/// name a clock or a pid and the crate keeps its own time formatting to itself.
pub fn publish_for_this_process(refarm_dir: &Path, declaration_base: &Path, sovereign_dir: &str) {
    publish_node_descriptor(
        refarm_dir,
        declaration_base,
        sovereign_dir,
        std::process::id(),
        &crate::timefmt::now_iso_seconds(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_descriptor_states_where_the_node_answers_from() {
        let json = node_descriptor_json(Path::new("/home/op"), ".refarm", 4242, "2026-08-03T02:11:04Z");
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
        let json = node_descriptor_json(Path::new("/x"), ".refarm", 7, "t");
        assert!(json.contains("\"pid\": 7"), "the pid must be readable: {json}");
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
        );
    }
}
