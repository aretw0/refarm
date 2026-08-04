//! Where the model rate catalog comes from, and what reaches the guest.
//!
//! The guest (`packages/agent`) prices a run from `MODEL_RATE_CATALOG`, a plain
//! JSON string on its WASI env. This module is the ONLY place that decides what
//! that string contains — see [`resolve_injected_catalog`].
//!
//! Two facts shape it:
//!
//! 1. **The guest stays clock-free.** Rates already vary over time in the shipped
//!    catalog (the Sonnet 5 introductory window expires 2026-08-31 and a second
//!    entry takes over on 2026-09-01, and BOTH are in the artifact today). The
//!    host has a clock; the guest's `rate_for_model` is pure and its purity is
//!    load bearing for testing. So the host resolves the effective window and
//!    injects only the entries in force — the same entry shape with fewer rows,
//!    never a second schema.
//! 2. **A node can correct a rate without a build.** The embedded default is the
//!    audited artifact; a node may place its own `model-rates.v1.json` in the
//!    sovereign dir and the host reads that instead.

use std::path::{Path, PathBuf};

use serde_json::Value;

use super::config_node::SOVEREIGN_DIR_SELECTOR_KEY;

/// The env key the guest reads. Also carried in the closed text-content allowlist
/// (`host::sensitive_aliases::policy::is_text_content_model_env_key`) — the catalog
/// is prose-shaped (whitespace-legal, far past the credential-shaped 4 KiB cap),
/// not a credential.
pub(crate) const MODEL_RATE_CATALOG_ENV_KEY: &str = "MODEL_RATE_CATALOG";

/// The file a node may drop in its sovereign dir to override the embedded default.
/// Deliberately the SAME basename as the artifact it replaces, so an operator who
/// copies the shipped file and edits one rate is doing the obvious thing.
pub(crate) const CATALOG_OVERRIDE_FILE_NAME: &str = "model-rates.v1.json";

/// The audited artifact, embedded at compile time.
///
/// `packages/model-catalog-v1/catalog/model-rates.v1.json` is the SINGLE artifact.
/// Both sides are READERS of it — the TypeScript plugin stack for SDK consumers,
/// this host for the guest. Two readers of one artifact is not the two-sources
/// shape; two AUTHORS would be, which is exactly what the provider plugins had
/// become before they were pointed back at this file.
const EMBEDDED_CATALOG: &str =
    include_str!("../../../../model-catalog-v1/catalog/model-rates.v1.json");

const SCHEMA_VERSION: &str = "model-rate-catalog.v1";

/// Ceiling on a sovereign override, mirroring `read_refarm_config_bytes`. The
/// shipped catalog is ~11 KiB pretty-printed; 256 KiB is generous for a node that
/// adds entries and still refuses a file that is obviously not a catalog.
const MAX_CATALOG_BYTES: u64 = 256 * 1024;

/// The single place this host decides where the catalog comes from.
///
/// Today: an embedded default (the audited artifact) that a node may override with
/// a file in its sovereign dir. The resolved value is validated with the same rules
/// the `@refarm.dev/model-catalog-v1` package enforces, then filtered to the entries
/// in force at the host's current date, then serialized compact.
///
/// A later slice is expected to make the catalog a LOADED PLUGIN instead — this repo
/// already has a plugin registry with `get_plugin_api`, an `api:<name>` convention in
/// `provides`, and a `model-rate-catalog-composer:v1` capability on the TypeScript
/// side. The concrete motivation is an enterprise shipping NEGOTIATED rates without
/// forking, with the Barn's SHA-256 integrity check covering the artifact that sets
/// spend ceilings. When that lands, only THIS FUNCTION changes.
///
/// The contract that must stay stable is the one the guest sees: `MODEL_RATE_CATALOG`
/// is a string. The guest must never learn who produced it — not a file, not a plugin,
/// not a composed stack. Nothing downstream may branch on the catalog's provenance.
///
/// `None` means INJECT NOTHING, which the guest reads as "I do not know prices" and
/// answers by falling back to its built-in table — never by pricing anything at zero.
pub(crate) fn resolve_injected_catalog(base: &Path) -> Option<String> {
    resolve_injected_catalog_in(override_path(base).as_deref(), &today_utc())
}

/// The env-free half of [`resolve_injected_catalog`]: an explicit override path (or
/// `None` for "this node has no sovereign dir") and an explicit date. Pure over its
/// inputs so the refusal rule and the window filter are testable without steering
/// process env from a parallel test thread.
fn resolve_injected_catalog_in(override_file: Option<&Path>, today: &str) -> Option<String> {
    if let Some(path) = override_file {
        match read_override(path) {
            OverrideRead::Absent => {} // fall through to the embedded default
            OverrideRead::Unreadable(reason) => {
                refuse(path, &[reason]);
                return None;
            }
            OverrideRead::Text(raw) => {
                return match prepare_catalog(&raw, today) {
                    Ok(json) => Some(json),
                    Err(issues) => {
                        refuse(path, &issues);
                        None
                    }
                };
            }
        }
    }

    match prepare_catalog(EMBEDDED_CATALOG, today) {
        Ok(json) => Some(json),
        Err(issues) => {
            // Unreachable in a healthy build — the embedded artifact is validated by
            // this module's own tests. If it ever fires, injecting nothing is still
            // the honest answer: the guest falls back rather than pricing from a
            // catalog nobody could check.
            tracing::error!(
                issues = %issues.join("; "),
                "embedded model rate catalog failed validation — injecting NO catalog"
            );
            None
        }
    }
}

/// Refuse loudly. A node that placed an override BELIEVES it corrected a rate; if we
/// quietly reverted to the embedded default it would keep believing that while being
/// charged the old number. So an override that cannot be read, parsed or validated
/// takes the whole catalog down with it — no catalog at all, and a log line naming
/// the file and every issue.
fn refuse(path: &Path, issues: &[String]) {
    tracing::error!(
        path = %path.display(),
        issues = %issues.join("; "),
        "sovereign model rate catalog override is INVALID — refusing it AND injecting no \
         catalog at all (a silent fall back to the embedded default would let this node \
         believe it had corrected a rate when it had not). Fix or remove the file."
    );
}

enum OverrideRead {
    Absent,
    Text(String),
    Unreadable(String),
}

/// Where a node's override lives: a sibling of `config.json` inside the sovereign dir.
/// `None` when no sovereign dir selector is set — the same rule `sovereign_config_path`
/// applies, so "no config path" and "no catalog override path" mean the same thing.
fn override_path(base: &Path) -> Option<PathBuf> {
    let dir = std::env::var(SOVEREIGN_DIR_SELECTOR_KEY).ok()?;
    let dir = dir.trim();
    if dir.is_empty() {
        return None;
    }
    Some(base.join(dir).join(CATALOG_OVERRIDE_FILE_NAME))
}

fn read_override(path: &Path) -> OverrideRead {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        // Not there at all — the ordinary case, and NOT a refusal: a node with no
        // override is a node that never claimed to have corrected anything.
        Err(_) => return OverrideRead::Absent,
    };
    if !metadata.is_file() {
        return OverrideRead::Unreadable("not a regular file".to_string());
    }
    if metadata.len() > MAX_CATALOG_BYTES {
        return OverrideRead::Unreadable(format!(
            "{} bytes exceeds the {MAX_CATALOG_BYTES}-byte ceiling",
            metadata.len()
        ));
    }
    match std::fs::read_to_string(path) {
        Ok(text) => OverrideRead::Text(text),
        Err(err) => OverrideRead::Unreadable(format!("unreadable: {err}")),
    }
}

/// Parse → validate → filter to the window in force → serialize compact.
///
/// Filtering happens AFTER validation deliberately. The shadowing guard (a general
/// `contains` rule placed ahead of a specific one) is a property of the catalog as
/// AUTHORED; checking the filtered projection instead would let a node ship a
/// shadowed pair that only becomes reachable once a window expires.
fn prepare_catalog(raw: &str, today: &str) -> Result<String, Vec<String>> {
    let value: Value = serde_json::from_str(raw)
        .map_err(|err| vec![format!("$: not valid JSON: {err}")])?;
    let issues = validation_issues(&value);
    if !issues.is_empty() {
        return Err(issues);
    }
    let filtered = filter_to_effective(&value, today);
    serde_json::to_string(&filtered).map_err(|err| vec![format!("$: not serializable: {err}")])
}

/// Drop every entry whose `effectiveFrom`/`effectiveTo` window does not contain
/// `today`. The result carries the SAME entry shape with fewer rows — the guest
/// receives full entries (rates, citations, context windows) and never a narrow
/// projection, because a second shape would be a second source.
fn filter_to_effective(catalog: &Value, today: &str) -> Value {
    let mut out = catalog.clone();
    let kept: Vec<Value> = catalog
        .get("entries")
        .and_then(Value::as_array)
        .map(|entries| {
            entries
                .iter()
                .filter(|entry| entry_in_effect_at(entry, today))
                .cloned()
                .collect()
        })
        .unwrap_or_default();
    out["entries"] = Value::Array(kept);
    out
}

/// Whether an entry is in force on `today`. Absent bounds mean "always" on that side.
/// A bound that is present but not a `YYYY-MM-DD` date EXCLUDES the entry, mirroring
/// the TypeScript resolver (`!Number.isFinite(from) → false`): an unreadable window is
/// not an open one.
fn entry_in_effect_at(entry: &Value, today: &str) -> bool {
    let Some(today) = iso_date(today) else {
        return false;
    };
    if let Some(from) = entry.get("effectiveFrom").and_then(Value::as_str) {
        match iso_date(from) {
            Some(from) if today >= from => {}
            _ => return false,
        }
    }
    if let Some(to) = entry.get("effectiveTo").and_then(Value::as_str) {
        match iso_date(to) {
            Some(to) if today <= to => {}
            _ => return false,
        }
    }
    true
}

/// The `YYYY-MM-DD` prefix of a date string, or `None` when it is not one. Zero-padded
/// fixed-width ISO dates compare correctly as plain strings, so the caller can use `<=`
/// directly — no calendar arithmetic, no timezone, no leap-year hand-rolling.
fn iso_date(value: &str) -> Option<&str> {
    let value = value.trim();
    if value.len() < 10 {
        return None;
    }
    let head = &value[..10];
    let bytes = head.as_bytes();
    let shaped = bytes
        .iter()
        .enumerate()
        .all(|(i, b)| if i == 4 || i == 7 { *b == b'-' } else { b.is_ascii_digit() });
    shaped.then_some(head)
}

/// The host's "now", as a date. The guest never computes this — that is the whole
/// point of resolving the window here.
///
/// Goes through `timefmt`, the one place this crate formats a calendar date, rather
/// than reaching for `time` directly: that module exists precisely because four
/// hand-rolled civil-date implementations once produced a real leap-year bug.
fn today_utc() -> String {
    let now = crate::timefmt::now_iso_seconds();
    now.get(..10).unwrap_or_default().to_string()
}

/// `true` when `key` holds a non-empty string — the shape every citation field in the
/// schema demands: present, a string, and not blank.
fn has_non_empty_str(object: &serde_json::Map<String, Value>, key: &str) -> bool {
    object.get(key).and_then(Value::as_str).is_some_and(|v| !v.is_empty())
}

/// The Rust mirror of `validateModelRateCatalog` (`packages/model-catalog-v1/src/index.ts`).
/// An override is an operator-authored file that feeds every cost estimate this node
/// makes, so the host runs the same checks the package does rather than trusting it.
fn validation_issues(catalog: &Value) -> Vec<String> {
    let mut issues = Vec::new();

    let Some(object) = catalog.as_object() else {
        return vec!["$: catalog must be an object".to_string()];
    };

    if object.get("schemaVersion").and_then(Value::as_str) != Some(SCHEMA_VERSION) {
        issues.push(format!("schemaVersion: must equal {SCHEMA_VERSION}"));
    }
    if !has_non_empty_str(object, "catalogVersion") {
        issues.push("catalogVersion: must be a non-empty string".to_string());
    }

    let Some(entries) = object.get("entries").and_then(Value::as_array) else {
        issues.push("entries: must be an array".to_string());
        return issues;
    };

    for (index, entry) in entries.iter().enumerate() {
        let prefix = format!("entries[{index}]");
        let Some(entry) = entry.as_object() else {
            issues.push(format!("{prefix}: must be an object"));
            continue;
        };

        if !has_non_empty_str(entry, "provider") {
            issues.push(format!("{prefix}.provider: must be a non-empty string"));
        }

        match entry.get("match").and_then(Value::as_object) {
            None => issues.push(format!("{prefix}.match: must be an object")),
            Some(rule) => {
                match rule.get("mode").and_then(Value::as_str) {
                    Some("contains") | Some("exact") => {}
                    _ => issues.push(format!("{prefix}.match.mode: must be contains or exact")),
                }
                if !has_non_empty_str(rule, "value") {
                    issues.push(format!("{prefix}.match.value: must be a non-empty string"));
                }
            }
        }

        match entry.get("rate").and_then(Value::as_object) {
            None => issues.push(format!("{prefix}.rate: must be an object")),
            Some(rate) => {
                for field in ["inputPerMTokenUsd", "outputPerMTokenUsd"] {
                    match rate.get(field).and_then(Value::as_f64) {
                        Some(value) if value >= 0.0 && value.is_finite() => {}
                        _ => issues
                            .push(format!("{prefix}.rate.{field}: must be a non-negative number")),
                    }
                }
            }
        }

        if !has_non_empty_str(entry, "pricingUrl") {
            issues.push(format!("{prefix}.pricingUrl: must be a non-empty string"));
        }
        if !has_non_empty_str(entry, "verifiedAt") {
            issues.push(format!("{prefix}.verifiedAt: must be a non-empty date string"));
        }

        // Absent is fine — a vendor that does not publish the figure gets no entry.
        // PRESENT and unsourced is not: the same discipline pricingUrl/verifiedAt enforce.
        if let Some(window) = entry.get("contextWindow") {
            match window.as_object() {
                None => issues.push(format!(
                    "{prefix}.contextWindow: must be an object when present"
                )),
                Some(window) => {
                    match window.get("tokens").and_then(Value::as_u64) {
                        Some(tokens) if tokens > 0 => {}
                        _ => issues
                            .push(format!("{prefix}.contextWindow.tokens: must be a positive integer")),
                    }
                    if !has_non_empty_str(window, "sourceUrl") {
                        issues.push(format!(
                            "{prefix}.contextWindow.sourceUrl: must be a non-empty string"
                        ));
                    }
                    if !has_non_empty_str(window, "verifiedAt") {
                        issues.push(format!(
                            "{prefix}.contextWindow.verifiedAt: must be a non-empty date string"
                        ));
                    }
                }
            }
        }

        if let Some(gap) = entry.get("contextWindowUnknown") {
            match gap.as_object() {
                None => issues.push(format!(
                    "{prefix}.contextWindowUnknown: must be an object when present"
                )),
                Some(gap) => {
                    match gap.get("reason").and_then(Value::as_str) {
                        Some("not-published") | Some("source-not-found") => {}
                        _ => issues.push(format!(
                            "{prefix}.contextWindowUnknown.reason: must be not-published or source-not-found"
                        )),
                    }
                    if !has_non_empty_str(gap, "checkedAt") {
                        issues.push(format!(
                            "{prefix}.contextWindowUnknown.checkedAt: must be a non-empty date string"
                        ));
                    }
                }
            }
        }

        // A figure and a reason for having no figure cannot both be true.
        if entry.contains_key("contextWindow") && entry.contains_key("contextWindowUnknown") {
            issues.push(format!(
                "{prefix}.contextWindowUnknown: must not be set when contextWindow carries a verified figure"
            ));
        }
    }

    issues.extend(shadowed_entry_issues(entries));
    issues
}

/// Entries resolve FIRST-MATCH-WINS in array order, so a general `contains` rule placed
/// ahead of a more specific one makes the specific rule unreachable — permanently, and
/// silently, because the general rule answers with a plausible price instead of failing.
///
/// This is the bug that once billed Opus 4.5 at Opus 4's rate. `exact` rules cannot
/// shadow and cannot be shadowed, so they are exempt. Mirrors `shadowedEntryIssues`.
fn shadowed_entry_issues(entries: &[Value]) -> Vec<String> {
    fn contains_rule(entry: &Value) -> Option<(String, &str)> {
        let rule = entry.get("match")?;
        if rule.get("mode").and_then(Value::as_str) != Some("contains") {
            return None;
        }
        let value = rule.get("value").and_then(Value::as_str)?;
        let provider = entry
            .get("provider")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase();
        Some((provider, value))
    }

    let mut issues = Vec::new();
    for (i, earlier) in entries.iter().enumerate() {
        let Some((earlier_provider, earlier_value)) = contains_rule(earlier) else {
            continue;
        };
        for (j, later) in entries.iter().enumerate().skip(i + 1) {
            let Some((later_provider, later_value)) = contains_rule(later) else {
                continue;
            };
            if earlier_provider != later_provider {
                continue;
            }
            if earlier_value == later_value || !later_value.contains(earlier_value) {
                continue;
            }
            issues.push(format!(
                "entries[{j}].match.value: \"{later_value}\" can never be reached: entries[{i}] \
                 matches \"{earlier_value}\", a substring of it, and resolution is \
                 first-match-wins. Move the more specific rule first."
            ));
        }
    }
    issues
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entries_of(json: &str) -> Vec<Value> {
        serde_json::from_str::<Value>(json)
            .expect("prepared catalog is JSON")
            .get("entries")
            .and_then(Value::as_array)
            .cloned()
            .expect("prepared catalog carries entries")
    }

    fn sonnet_5_rates(json: &str) -> Vec<(f64, f64)> {
        entries_of(json)
            .iter()
            .filter(|e| e["match"]["value"] == "claude-sonnet-5")
            .map(|e| {
                (
                    e["rate"]["inputPerMTokenUsd"].as_f64().unwrap(),
                    e["rate"]["outputPerMTokenUsd"].as_f64().unwrap(),
                )
            })
            .collect()
    }

    #[test]
    fn the_embedded_artifact_is_the_audited_one_and_it_validates() {
        let catalog: Value = serde_json::from_str(EMBEDDED_CATALOG).expect("embedded is JSON");
        assert!(
            validation_issues(&catalog).is_empty(),
            "embedded catalog must pass the same validation the package enforces: {:?}",
            validation_issues(&catalog)
        );
        assert_eq!(
            catalog["entries"].as_array().map(Vec::len),
            Some(27),
            "the artifact ships 27 authored entries"
        );
    }

    #[test]
    fn the_host_resolves_the_effective_window_so_the_guest_never_needs_a_clock() {
        // Sonnet 5 is the real case, not a hypothetical: an introductory $2/$10 row
        // runs through 2026-08-31 and a $3/$15 row takes over on 2026-09-01. BOTH are
        // in the artifact today; EXACTLY ONE may be injected.
        let before = prepare_catalog(EMBEDDED_CATALOG, "2026-08-04").expect("valid");
        assert_eq!(
            sonnet_5_rates(&before),
            vec![(2.0, 10.0)],
            "before the switch the introductory rate is the only Sonnet 5 row"
        );

        let after = prepare_catalog(EMBEDDED_CATALOG, "2026-09-15").expect("valid");
        assert_eq!(
            sonnet_5_rates(&after),
            vec![(3.0, 15.0)],
            "after the switch the post-intro rate is the only Sonnet 5 row"
        );

        // The boundary days themselves are inclusive on both sides.
        assert_eq!(sonnet_5_rates(&prepare_catalog(EMBEDDED_CATALOG, "2026-08-31").unwrap()), vec![(2.0, 10.0)]);
        assert_eq!(sonnet_5_rates(&prepare_catalog(EMBEDDED_CATALOG, "2026-09-01").unwrap()), vec![(3.0, 15.0)]);

        // 27 authored, 26 in force on any given day — one row fewer, same shape.
        assert_eq!(entries_of(&before).len(), 26);
        assert_eq!(entries_of(&after).len(), 26);
    }

    #[test]
    fn the_injected_entry_keeps_the_full_shape_not_a_narrow_projection() {
        let prepared = prepare_catalog(EMBEDDED_CATALOG, "2026-08-04").expect("valid");
        let first = entries_of(&prepared).remove(0);
        for field in ["provider", "match", "rate", "pricingUrl", "verifiedAt"] {
            assert!(first.get(field).is_some(), "entry must carry {field}");
        }
        assert!(
            first.get("contextWindow").is_some(),
            "a second shape would be a second source — the citation travels too"
        );
    }

    #[test]
    fn entry_order_is_precedence_and_the_filter_preserves_it() {
        let authored: Value = serde_json::from_str(EMBEDDED_CATALOG).unwrap();
        let authored: Vec<&str> = authored["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["match"]["value"].as_str().unwrap())
            .collect();
        let prepared = prepare_catalog(EMBEDDED_CATALOG, "2026-08-04").unwrap();
        let injected: Vec<String> = entries_of(&prepared)
            .iter()
            .map(|e| e["match"]["value"].as_str().unwrap().to_string())
            .collect();
        // The injected list is the authored list with rows removed — never reordered.
        let mut authored_iter = authored.iter();
        for value in &injected {
            assert!(
                authored_iter.any(|a| a == value),
                "injected order must be a subsequence of the authored order"
            );
        }
    }

    #[test]
    fn an_absent_override_uses_the_embedded_default() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(CATALOG_OVERRIDE_FILE_NAME);
        let resolved =
            resolve_injected_catalog_in(Some(&path), "2026-08-04").expect("embedded default");
        assert_eq!(entries_of(&resolved).len(), 26);
    }

    #[test]
    fn a_valid_override_replaces_the_embedded_default_entirely() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(CATALOG_OVERRIDE_FILE_NAME);
        std::fs::write(
            &path,
            r#"{
              "schemaVersion": "model-rate-catalog.v1",
              "catalogVersion": "node-local.1",
              "entries": [{
                "provider": "anthropic",
                "match": { "mode": "contains", "value": "claude-sonnet-5" },
                "rate": { "inputPerMTokenUsd": 1.5, "outputPerMTokenUsd": 7.0 },
                "pricingUrl": "https://example.invalid/negotiated",
                "verifiedAt": "2026-08-04"
              }]
            }"#,
        )
        .expect("write override");

        let resolved = resolve_injected_catalog_in(Some(&path), "2026-08-04").expect("override");
        assert_eq!(entries_of(&resolved).len(), 1);
        assert_eq!(sonnet_5_rates(&resolved), vec![(1.5, 7.0)]);
    }

    #[test]
    fn an_invalid_override_refuses_rather_than_falling_back_to_the_default() {
        let dir = tempfile::tempdir().expect("tempdir");

        // Not JSON at all.
        let broken = dir.path().join("broken.json");
        std::fs::write(&broken, "{ this is not json").unwrap();
        assert!(
            resolve_injected_catalog_in(Some(&broken), "2026-08-04").is_none(),
            "an unparseable override must inject NO catalog — falling back would let this \
             node believe it had corrected a rate when it had not"
        );

        // Parses, but fails validation (negative rate).
        let negative = dir.path().join("negative.json");
        std::fs::write(
            &negative,
            r#"{"schemaVersion":"model-rate-catalog.v1","catalogVersion":"x","entries":[
              {"provider":"anthropic","match":{"mode":"contains","value":"claude-sonnet-5"},
               "rate":{"inputPerMTokenUsd":-1,"outputPerMTokenUsd":10},
               "pricingUrl":"https://example.invalid","verifiedAt":"2026-08-04"}]}"#,
        )
        .unwrap();
        assert!(resolve_injected_catalog_in(Some(&negative), "2026-08-04").is_none());

        // Parses and is well-formed per-entry, but a general rule shadows a specific one —
        // the defect that once billed Opus 4.5 at Opus 4's rate.
        let shadowed = dir.path().join("shadowed.json");
        std::fs::write(
            &shadowed,
            r#"{"schemaVersion":"model-rate-catalog.v1","catalogVersion":"x","entries":[
              {"provider":"anthropic","match":{"mode":"contains","value":"claude-opus-4"},
               "rate":{"inputPerMTokenUsd":15,"outputPerMTokenUsd":75},
               "pricingUrl":"https://example.invalid","verifiedAt":"2026-08-04"},
              {"provider":"anthropic","match":{"mode":"contains","value":"claude-opus-4-5"},
               "rate":{"inputPerMTokenUsd":5,"outputPerMTokenUsd":25},
               "pricingUrl":"https://example.invalid","verifiedAt":"2026-08-04"}]}"#,
        )
        .unwrap();
        assert!(resolve_injected_catalog_in(Some(&shadowed), "2026-08-04").is_none());

        // Wrong schema version.
        let wrong_schema = dir.path().join("wrong-schema.json");
        std::fs::write(
            &wrong_schema,
            r#"{"schemaVersion":"model-rate-catalog.v2","catalogVersion":"x","entries":[]}"#,
        )
        .unwrap();
        assert!(resolve_injected_catalog_in(Some(&wrong_schema), "2026-08-04").is_none());

        // A directory where the file should be is not "absent" — something is there and
        // it is not a catalog.
        let as_dir = dir.path().join("as-dir.json");
        std::fs::create_dir(&as_dir).unwrap();
        assert!(resolve_injected_catalog_in(Some(&as_dir), "2026-08-04").is_none());
    }

    #[test]
    fn an_unreadable_window_bound_excludes_the_entry_rather_than_opening_it() {
        let entry = serde_json::json!({ "effectiveFrom": "not-a-date" });
        assert!(!entry_in_effect_at(&entry, "2026-08-04"));
        let entry = serde_json::json!({ "effectiveTo": "2026-13" });
        assert!(!entry_in_effect_at(&entry, "2026-08-04"));
        let entry = serde_json::json!({});
        assert!(entry_in_effect_at(&entry, "2026-08-04"));
    }

    #[test]
    fn the_hosts_own_clock_lands_inside_the_shipped_windows() {
        // Not a value assertion — a liveness one: whatever "today" is, the host must
        // produce a date the filter can read, and the artifact must price Sonnet 5 on it.
        let today = today_utc();
        assert!(iso_date(&today).is_some(), "today must be YYYY-MM-DD: {today}");
        let prepared = prepare_catalog(EMBEDDED_CATALOG, &today).expect("valid");
        assert_eq!(
            sonnet_5_rates(&prepared).len(),
            1,
            "exactly one Sonnet 5 row may be in force on any given day"
        );
    }
}
