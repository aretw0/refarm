//! WHO THIS NODE IS — the two identifiers `node_descriptor.rs` publishes and
//! `sidecar::observation` records, and why they live in two different places
//! on purpose.
//!
//! A device that talks TO this node carries a human-chosen name (`refarm auth
//! list` already returns one — `galaxy-a55-5g`, the operator's phone). The
//! node itself had none: `node-descriptor.v1` published `declarationBase`,
//! `sovereignDir`, `pid` and `startedAt` — a pid that changes on every
//! restart, and a path that reads identical on any machine using `~`.
//! Meanwhile the CRDT node store REPLICATES: `BudgetObservation` rows from
//! the phone, this PC and any future node land in one table, and nothing on
//! any of them says which machine ran what.
//!
//! ## Two identifiers, deliberately not one
//!
//! **The declared name** (`declared_node_name`) — human-chosen, like the
//! phone's. It lives in `.refarm/config.json`, a sibling of `surfaces`,
//! `delivery` and `budget`:
//!
//! ```json
//! { "node": { "name": "galaxy-a55-5g-desktop" }, "surfaces": { … } }
//! ```
//!
//! It is a DECLARATION: mutable (a node can be renamed) and portable (it
//! travels when the config is recreated or replicated onto another
//! machine) — exactly like `budget.node` already does. Read the same way
//! `sidecar::budget::read_budget_section` reads `budget.node`: through
//! `crate::host::read_refarm_config_value_at`, live, no caching, so a
//! rename takes effect on the very next observation without a restart.
//!
//! **The opaque id** (`load_or_create_node_id`) — generated once, and it
//! must NEVER travel. If it lived in `config.json`, replicating that config
//! (by hand, or via the `SovereignConfig` graph node this same file digests
//! and syncs) would hand a SECOND machine the same id — worse than no id,
//! because the record would then lie with confidence about which node ran
//! what. So it lives beside the DATA (the sovereign dir the CRDT store and
//! `node.json` already live in), never beside the DECLARATIONS.
//!
//! ### Placement decided from precedent, not invented
//!
//! `packages/config/src/config-node.js`'s `CONFIG_NODE_DEVICE_LOCAL_KEYS`
//! (mirrored in `host/plugin_host/config_node.rs`'s `DEVICE_LOCAL_KEYS`,
//! kept byte-identical by `scripts/ci/check-config-node-keys.mjs`) is this
//! repository's existing answer to "what must never leave this device":
//! `sidecarUrl`, `autostart`, `engine`, and — the closest sibling to this
//! file's opaque id — `peerId`, "this device's own endpoint/identity" in
//! that file's own words. Those keys are stripped from an in-config value
//! BEFORE it is hashed into the replicated node. This file takes that same
//! rule one step further: rather than declare the opaque id inside
//! `config.json` and then strip it at digest time, it never enters
//! `config.json` at all — a plain file (`node-id`) beside `node.json` inside
//! the sovereign dir, which is filesystem-local by construction and was
//! never a candidate for `createConfigNode`'s replicated projection in the
//! first place. Nothing needs to join `CONFIG_NODE_DEVICE_LOCAL_KEYS` (JS or
//! Rust) because nothing here is ever read by `createConfigNode`; if a
//! future change ever put the opaque id where the config digest can see it,
//! THAT change would be the one obligated to join the stripped set — this
//! one is exempt by never crossing that boundary.
//!
//! ## Generate once, persist, never repair
//!
//! - **Missing file** → first boot: mint a `Uuid::new_v4`, write it, use it.
//! - **Present, valid** → use it. Never rewritten, ever — a value already on
//!   disk is a fact, not a suggestion.
//! - **Present, malformed** (unreadable UTF-8, empty, not a UUID — corrupt in
//!   any way) → logged at `warn` and treated as ABSENT for this boot. This
//!   file never "fixes" it by writing a fresh id over it: silently replacing
//!   a corrupt id with a new one is fabricating an identity, the same shape
//!   of lie D6 (`sidecar::observation`) exists to keep out of the record on
//!   the value side. An operator who wants a new id deletes the file
//!   themselves, deliberately.
//! - **Could not persist a freshly minted id** (disk full, permissions) →
//!   also absent, not just for this call but reported as such: a value this
//!   process would then claim is "this node's id" but that vanishes on the
//!   next restart is not stable, and claiming otherwise is the same
//!   fabrication in a different disguise.

use std::path::{Path, PathBuf};

/// The file, inside the sovereign dir — a sibling of `node.json`
/// (`node_descriptor::NODE_DESCRIPTOR_FILE`), not of `config.json`. See the
/// module doc's "Placement decided from precedent" for why that placement,
/// not a stripped key inside the config, is what keeps this value from ever
/// replicating.
pub const NODE_ID_FILE: &str = "node-id";

/// Where the opaque id goes for a node whose sovereign dir is `refarm_dir`.
pub fn node_id_path(refarm_dir: &Path) -> PathBuf {
    refarm_dir.join(NODE_ID_FILE)
}

/// Load this node's opaque, per-installation id — minting and persisting one
/// on first boot, refusing to silently repair a corrupt one, and never
/// re-deriving from anything that could be shared with another machine
/// (hostname, machine-id, tailnet name — the exact detection this module's
/// sibling design, `docs/superpowers/specs/2026-08-03-declared-node-base-design.md`,
/// exists to refuse for the declared base, and just as wrong here). See the
/// module doc's "Generate once, persist, never repair" for the full decision
/// table this function implements.
pub fn load_or_create_node_id(refarm_dir: &Path) -> Option<String> {
    let path = node_id_path(refarm_dir);
    match std::fs::read_to_string(&path) {
        Ok(contents) => {
            let trimmed = contents.trim();
            if trimmed.is_empty() {
                tracing::warn!(
                    path = %path.display(),
                    "sidecar: node-id file is empty — treating as absent, not repairing"
                );
                return None;
            }
            match uuid::Uuid::parse_str(trimmed) {
                Ok(_) => Some(trimmed.to_string()),
                Err(error) => {
                    tracing::warn!(
                        path = %path.display(),
                        %error,
                        "sidecar: node-id file is malformed — treating as absent, not repairing"
                    );
                    None
                }
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // First boot: nothing to trust yet, so there is nothing to
            // "repair" — minting one here is not the fabrication the module
            // doc warns against, it is the ONLY case this function is
            // allowed to write.
            let id = uuid::Uuid::new_v4().to_string();
            let _ = std::fs::create_dir_all(refarm_dir);
            match std::fs::write(&path, format!("{id}\n")) {
                Ok(()) => Some(id),
                Err(error) => {
                    tracing::warn!(
                        path = %path.display(),
                        %error,
                        "sidecar: could not persist a new node id — this process runs without one \
                         rather than claim a value that will not survive a restart"
                    );
                    None
                }
            }
        }
        Err(error) => {
            tracing::warn!(
                path = %path.display(),
                %error,
                "sidecar: could not read the node-id file — treating as absent"
            );
            None
        }
    }
}

/// This node's DECLARED name, from `config.json`'s `node.name` — a sibling
/// of `surfaces`, `delivery` and `budget`. `node_base` is the SAME base
/// `crate::host::declared_base()` returns (the directory that CONTAINS the
/// sovereign dir, not the sovereign dir itself) — taken as a parameter
/// rather than resolved internally, matching `sidecar::budget::read_budget_section`'s
/// convention, so this stays directly testable against a tempdir without
/// touching env.
///
/// `None` for every reason absence can have, all folded into one answer
/// (never a distinct error the caller has to branch on): no sovereign config
/// selector, no file, unreadable bytes, invalid JSON, no `node` key, no
/// `node.name` key, a non-string value, or a name that is empty once
/// trimmed. An empty declared name is not a name — D6 (`sidecar::observation`)
/// treats absent and empty as the same "nothing to record" everywhere else
/// in this record, and a node's own name is no exception.
///
/// Read live, every call, no caching — exactly like `read_budget_section`:
/// the declared name is documented as MUTABLE (a node can be renamed), so a
/// rename must be visible on the very next observation, not after a restart.
pub fn declared_node_name(node_base: &Path) -> Option<String> {
    let config = crate::host::read_refarm_config_value_at(node_base)
        .inspect_err(|error| {
            tracing::warn!(%error, "sidecar: sovereign config unreadable for node name — treating as absent");
        })
        .ok()??;
    let name = config.get("node")?.get("name")?.as_str()?.trim();
    if name.is_empty() {
        return None;
    }
    Some(name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── load_or_create_node_id ──────────────────────────────────────────

    #[test]
    fn a_missing_file_mints_and_persists_a_parseable_id() {
        let dir = std::env::temp_dir().join(format!("node-identity-missing-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create scratch dir");

        let id = load_or_create_node_id(&dir).expect("a fresh id on first boot");
        uuid::Uuid::parse_str(&id).expect("the minted id is a valid uuid");

        let on_disk = std::fs::read_to_string(node_id_path(&dir)).expect("read persisted id");
        assert_eq!(on_disk.trim(), id, "the persisted bytes match what this boot used");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_second_boot_reads_back_the_same_id_and_never_rewrites_it() {
        let dir = std::env::temp_dir().join(format!("node-identity-stable-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create scratch dir");

        let first = load_or_create_node_id(&dir).expect("first boot mints");
        let second = load_or_create_node_id(&dir).expect("second boot reads back");
        assert_eq!(first, second, "the id must be stable across restarts");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_malformed_file_is_absent_and_left_untouched_not_repaired() {
        let dir = std::env::temp_dir().join(format!("node-identity-malformed-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create scratch dir");
        std::fs::write(node_id_path(&dir), "not-a-uuid-at-all").expect("write garbage");

        let result = load_or_create_node_id(&dir);
        assert!(result.is_none(), "a corrupt id must read as absent, not as itself or a fresh mint");

        let on_disk = std::fs::read_to_string(node_id_path(&dir)).expect("read file back");
        assert_eq!(
            on_disk, "not-a-uuid-at-all",
            "a malformed id is never silently repaired — that would fabricate an identity"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_empty_file_is_absent_not_repaired() {
        let dir = std::env::temp_dir().join(format!("node-identity-empty-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create scratch dir");
        std::fs::write(node_id_path(&dir), "").expect("write empty file");

        assert!(load_or_create_node_id(&dir).is_none());
        let on_disk = std::fs::read_to_string(node_id_path(&dir)).expect("read file back");
        assert_eq!(on_disk, "", "an empty file is never repaired either");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_valid_preexisting_id_is_returned_verbatim() {
        let dir = std::env::temp_dir().join(format!("node-identity-preexisting-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create scratch dir");
        let planted = uuid::Uuid::new_v4().to_string();
        std::fs::write(node_id_path(&dir), format!("{planted}\n")).expect("plant id");

        assert_eq!(load_or_create_node_id(&dir), Some(planted));

        std::fs::remove_dir_all(&dir).ok();
    }

    // ── declared_node_name ──────────────────────────────────────────────

    fn write_config(node_base: &Path, json: &str) {
        let sovereign_dir = node_base.join(".refarm");
        std::fs::create_dir_all(&sovereign_dir).expect("create .refarm dir");
        std::fs::write(sovereign_dir.join("config.json"), json).expect("write config.json");
    }

    struct EnvGuard {
        key: &'static str,
        previous: Option<String>,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let previous = std::env::var(key).ok();
            std::env::set_var(key, value);
            Self { key, previous }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.previous {
                Some(v) => std::env::set_var(self.key, v),
                None => std::env::remove_var(self.key),
            }
        }
    }

    #[test]
    fn a_declared_name_beside_surfaces_and_budget_is_read_back() {
        let _env = crate::test_support::env_lock();
        let _sovereign_dir = EnvGuard::set("SOVEREIGN_DIR", ".refarm");
        let node_base = tempfile::tempdir().expect("tempdir");
        let _sovereign_base = EnvGuard::set(
            "SOVEREIGN_BASE",
            node_base.path().to_str().expect("utf8 path"),
        );
        write_config(
            node_base.path(),
            r#"{ "node": { "name": "galaxy-a55-5g-desktop" }, "surfaces": {}, "budget": {} }"#,
        );

        assert_eq!(
            declared_node_name(node_base.path()),
            Some("galaxy-a55-5g-desktop".to_string())
        );
    }

    #[test]
    fn no_config_file_at_all_is_absent_not_an_error() {
        let _env = crate::test_support::env_lock();
        let _sovereign_dir = EnvGuard::set("SOVEREIGN_DIR", ".refarm");
        let node_base = tempfile::tempdir().expect("tempdir");
        let _sovereign_base = EnvGuard::set(
            "SOVEREIGN_BASE",
            node_base.path().to_str().expect("utf8 path"),
        );

        assert_eq!(declared_node_name(node_base.path()), None);
    }

    #[test]
    fn a_config_with_no_node_section_is_absent() {
        let _env = crate::test_support::env_lock();
        let _sovereign_dir = EnvGuard::set("SOVEREIGN_DIR", ".refarm");
        let node_base = tempfile::tempdir().expect("tempdir");
        let _sovereign_base = EnvGuard::set(
            "SOVEREIGN_BASE",
            node_base.path().to_str().expect("utf8 path"),
        );
        write_config(node_base.path(), r#"{ "surfaces": {} }"#);

        assert_eq!(declared_node_name(node_base.path()), None);
    }

    #[test]
    fn an_empty_declared_name_is_absent_not_an_empty_string() {
        // D6's rule applied to the declaration itself: a name that is empty once
        // trimmed is not a name, so it must not read differently than no
        // declaration at all.
        let _env = crate::test_support::env_lock();
        let _sovereign_dir = EnvGuard::set("SOVEREIGN_DIR", ".refarm");
        let node_base = tempfile::tempdir().expect("tempdir");
        let _sovereign_base = EnvGuard::set(
            "SOVEREIGN_BASE",
            node_base.path().to_str().expect("utf8 path"),
        );
        write_config(node_base.path(), r#"{ "node": { "name": "   " } }"#);

        assert_eq!(declared_node_name(node_base.path()), None);
    }
}
