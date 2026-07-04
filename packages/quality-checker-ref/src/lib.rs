#[allow(warnings)]
mod bindings;

use bindings::exports::refarm::quality::checker::{
    Finding, Guest, Profile, Rule, Subject,
};
use serde::Deserialize;

/// The reference `text` checker. It proves the `quality-checker` component
/// boundary end-to-end with the smallest real matcher: `check.type == "contains"`
/// flags text that includes a literal substring. Matcher-is-data — the rule's
/// `check` is opaque JSON the checker interprets, so richer matchers (regex, DOM
/// asserts) ship as checker code + rule data, never a contract change.
///
/// This world imports NOTHING (no wasi:filesystem/sockets/env). That absence is
/// the sandbox: this checker can only read the `subject` the host hands it and
/// return findings. It cannot touch the filesystem or network even if it wanted
/// to — there is no import to do so.
struct ReferenceChecker;

/// The `check` field of a rule, parsed from its opaque JSON string. Only the
/// `contains` matcher is implemented here; an unknown type yields no finding
/// (forward-safe — a newer profile's matcher simply doesn't fire on this
/// checker, it never errors).
#[derive(Deserialize)]
#[serde(tag = "type")]
enum Matcher {
    #[serde(rename = "contains")]
    Contains { value: String },
    #[serde(other)]
    Unknown,
}

/// Extract the analyzable text from a subject. `text` is used as-is; `dom` is
/// treated as its serialized string (a real design checker would parse it, but a
/// substring matcher can scan the serialized form).
fn subject_text(subject: &Subject) -> &str {
    match subject {
        Subject::Text(text) => text,
        Subject::Dom(dom) => dom,
    }
}

fn evaluate_rule(rule: &Rule, text: &str) -> Option<Finding> {
    let matcher: Matcher = serde_json::from_str(&rule.check).ok()?;
    match matcher {
        Matcher::Contains { value } if text.contains(&value) => Some(Finding {
            severity: rule.severity.clone(),
            rule_id: rule.id.clone(),
            message: rule.description.clone(),
            // A locus is optional opaque JSON; the reference checker reports the
            // matched substring so a host can render where it fired.
            locus: Some(format!("{{\"match\":{}}}", json_string(&value))),
        }),
        _ => None,
    }
}

/// Minimal JSON string escaper (no serde_json::to_string dep on the hot path,
/// and the value set is small/controlled).
fn json_string(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

impl Guest for ReferenceChecker {
    fn check(subject: Subject, profile: Profile) -> Vec<Finding> {
        let text = subject_text(&subject);
        profile
            .rules
            .iter()
            .filter_map(|rule| evaluate_rule(rule, text))
            .collect()
    }
}

bindings::export!(ReferenceChecker with_types_in bindings);
