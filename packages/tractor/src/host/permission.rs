//! The canonical permission vocabulary — the single source of truth for the
//! capabilities a plugin can DECLARE in its manifest and an operator can APPROVE.
//!
//! This is Axis 1: the WASI / host-effect capabilities that govern what a plugin
//! may DO (read files, run commands, reach the network). It is DISTINCT from the
//! inter-plugin capability-dependency axis (`capabilities.requires`, e.g.
//! `storage:v1`) which the TS `decidePluginPolicy` grades — those two axes wear
//! similar clothing but are unrelated. This module owns only the effect axis.
//!
//! # Why a closed enum (not free strings)
//!
//! Before this, permissions were free `String`s: the Rust manifest reader took
//! any string, `PermissionGrant` did raw set membership, and TS only checked for
//! duplicates. An unknown permission is inert for security (`grants()` never
//! returns true for a capability the plugin didn't declare AND the host doesn't
//! recognize), but it lets a typo (`fs:reed`) pass silently and leaves the
//! persona-approval vocabulary undefined ("what do we render for the operator to
//! approve?"). A closed enum catches typos, keeps the vocabulary honest, and
//! matches the house style — `targets`, `trust.profile`, and `surfaces.layer` all
//! reject values outside their known set.
//!
//! # Source of truth (ADR-059)
//!
//! The host is the authoritative runtime, so this enum is the source of truth.
//! The TS side mirrors it as a union + a label table, and a guard
//! (`scripts/ci/check-permission-vocab.mjs`, the same shape as `check:wit`) fails
//! if the two drift.

use std::fmt;

/// A declarable, approvable plugin capability (the effect axis).
///
/// The wire form is the kebab `family:verb` string (e.g. `network:outbound`) —
/// that is what appears in `plugin.json`'s `permissions[]` and what
/// `PermissionGrant` keys on. This enum is the validated, exhaustive in-memory
/// form; `as_str`/`from_str` bridge to the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(crate) enum Permission {
    /// Read files through the host-fs bridge.
    FsRead,
    /// Write / edit files through the host-fs bridge.
    FsWrite,
    /// Spawn OS subprocesses through the host-shell bridge.
    ShellSpawn,
    /// Make outbound network requests (wasi:http/outgoing-handler).
    NetworkOutbound,
}

/// How much authority a permission hands a plugin — the axis the persona weighs
/// when approving an install. Ordered least → most dangerous.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum RiskLevel {
    /// Reads only; no mutation, no egress. Still a data-exposure surface.
    Low,
    /// Mutates local state or reaches the network — real side effects.
    Medium,
    /// Executes arbitrary code / commands — the highest-authority grant.
    High,
}

impl RiskLevel {
    /// A stable lowercase token for wire/serialization (mirrored by the TS table).
    /// Foundation-ahead for the approval UX; exercised by tests today.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            RiskLevel::Low => "low",
            RiskLevel::Medium => "medium",
            RiskLevel::High => "high",
        }
    }
}

impl Permission {
    /// Every permission in the vocabulary, in a stable order. The single place a
    /// new capability is registered — adding a variant here (and to `as_str`/
    /// `from_str`, which the compiler forces via exhaustiveness) is the whole
    /// "add a grant to the vocabulary" movement.
    pub(crate) const ALL: &'static [Permission] = &[
        Permission::FsRead,
        Permission::FsWrite,
        Permission::ShellSpawn,
        Permission::NetworkOutbound,
    ];

    /// The canonical wire string (what appears in `plugin.json`).
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Permission::FsRead => "fs:read",
            Permission::FsWrite => "fs:write",
            Permission::ShellSpawn => "shell:spawn",
            Permission::NetworkOutbound => "network:outbound",
        }
    }

    /// Parse a wire string into a known permission. `None` for anything outside
    /// the closed vocabulary — the manifest reader turns that into a validation
    /// error (reject unknown, matching `targets`/`trust.profile`).
    pub(crate) fn from_str(s: &str) -> Option<Permission> {
        Permission::ALL.iter().copied().find(|p| p.as_str() == s)
    }

    /// A short human-readable label for the persona approval surface — what the
    /// operator reads when deciding whether to approve an install. The TS side
    /// mirrors this table; the drift guard keeps them identical.
    ///
    /// Foundation-ahead: the persona approval UX (the install→approve loop) is a
    /// later slice; the label table is authored now so the vocabulary and its
    /// human-readable surface land together (and the TS mirror + guard have
    /// something to check). Exercised by tests today.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn label(self) -> &'static str {
        match self {
            Permission::FsRead => "Read files",
            Permission::FsWrite => "Write and edit files",
            Permission::ShellSpawn => "Run system commands",
            Permission::NetworkOutbound => "Make network requests",
        }
    }

    /// How much authority this grant confers — for sorting/coloring the approval
    /// prompt (highest risk surfaced first). Foundation-ahead like `label`.
    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn risk(self) -> RiskLevel {
        match self {
            Permission::FsRead => RiskLevel::Low,
            Permission::FsWrite => RiskLevel::Medium,
            Permission::NetworkOutbound => RiskLevel::Medium,
            Permission::ShellSpawn => RiskLevel::High,
        }
    }
}

impl fmt::Display for Permission {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Validate a manifest's declared permission strings against the closed
/// vocabulary. Returns the unrecognized strings (empty = all known). The manifest
/// reader turns a non-empty result into a validation error, so a typo like
/// `fs:reed` fails the load instead of silently becoming an inert dead grant.
pub(crate) fn unknown_permissions<'a>(declared: impl IntoIterator<Item = &'a str>) -> Vec<String> {
    declared
        .into_iter()
        .filter(|s| Permission::from_str(s).is_none())
        .map(|s| s.to_string())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_every_permission_through_the_wire_string() {
        for &p in Permission::ALL {
            assert_eq!(
                Permission::from_str(p.as_str()),
                Some(p),
                "{p} must round-trip through its wire string"
            );
        }
    }

    #[test]
    fn all_is_exhaustive_over_the_enum() {
        // If a variant is added without being registered in ALL, this catches it:
        // match is exhaustive, so every variant must map to a distinct wire string,
        // and every wire string must parse back into ALL.
        for &p in Permission::ALL {
            assert!(
                Permission::from_str(p.as_str()).is_some(),
                "{p} in ALL must parse"
            );
        }
        // Count guard: bump this when the vocabulary grows (forces a conscious
        // decision + updating the mirrored TS table + the drift guard).
        assert_eq!(
            Permission::ALL.len(),
            4,
            "vocabulary size changed — update the TS mirror + guard"
        );
    }

    #[test]
    fn rejects_unknown_permissions() {
        assert!(
            Permission::from_str("fs:reed").is_none(),
            "typo is not a known permission"
        );
        assert!(
            Permission::from_str("storage:v1").is_none(),
            "the requires-axis is not a permission"
        );
        assert!(Permission::from_str("").is_none());
    }

    #[test]
    fn unknown_permissions_flags_only_the_unrecognized() {
        let declared = ["fs:read", "fs:reed", "network:outbound", "storage:v1"];
        let unknown = unknown_permissions(declared.iter().copied());
        assert_eq!(
            unknown,
            vec!["fs:reed".to_string(), "storage:v1".to_string()]
        );
    }

    #[test]
    fn every_permission_has_a_label_and_risk() {
        for &p in Permission::ALL {
            assert!(!p.label().is_empty(), "{p} needs a persona-facing label");
            // risk() is total (match is exhaustive) — just exercise it.
            let _ = p.risk().as_str();
        }
    }
}
