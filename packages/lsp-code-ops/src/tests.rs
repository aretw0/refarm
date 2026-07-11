//! Native tests for the LSP-plugin's PURE dispatch helpers — the parse + result-node
//! shaping that the wasm guest wires over. No WASM build needed (§7-cheap): these prove
//! the dispatch contract (parse `{verb, replyRef, ...}` → run → `refarm:DispatchResult`)
//! without a host or the LSP subprocess.

use super::*;

#[test]
fn parse_dispatch_splits_envelope_from_args() {
    let req = parse_dispatch(
        r#"{"verb":"find-references","replyRef":"r-1","file":"a.rs","line":10,"column":4}"#,
    )
    .expect("valid dispatch parses");
    assert_eq!(req.verb, "find-references");
    assert_eq!(req.reply_ref, "r-1");
    // The two envelope fields are stripped; the rest are the verb's args.
    assert_eq!(
        req.args,
        serde_json::json!({ "file": "a.rs", "line": 10, "column": 4 })
    );
}

#[test]
fn parse_dispatch_rejects_missing_verb_or_reply_ref() {
    assert!(parse_dispatch(r#"{"replyRef":"r-1"}"#).is_none()); // no verb
    assert!(parse_dispatch(r#"{"verb":"x"}"#).is_none()); // no replyRef
    assert!(parse_dispatch("not json").is_none());
    assert!(parse_dispatch(r#"["array"]"#).is_none()); // not an object
}

#[test]
fn dispatch_result_node_carries_reply_ref_and_result_where_the_host_looks() {
    let node = build_dispatch_result_node("r-42", serde_json::json!({ "ok": true }));
    // The host's await polls @type == refarm:DispatchResult and matches refarm:replyRef.
    assert_eq!(node["@type"], DISPATCH_RESULT_TYPE);
    assert_eq!(node[REPLY_REF_FIELD], "r-42");
    assert_eq!(node[RESULT_FIELD], serde_json::json!({ "ok": true }));
    // A stable, replyRef-scoped id so re-dispatch of the same ref overwrites, not dupes.
    assert_eq!(node["@id"], "urn:refarm:dispatch-result:r-42");
}

#[test]
fn find_references_result_is_one_object_per_reference() {
    let refs = vec![
        ("a.rs".to_string(), 3, 5, "definition".to_string()),
        ("b.rs".to_string(), 7, 2, "reference".to_string()),
    ];
    assert_eq!(
        find_references_result(&refs),
        serde_json::json!([
            { "file": "a.rs", "line": 3, "column": 5, "kind": "definition" },
            { "file": "b.rs", "line": 7, "column": 2, "kind": "reference" }
        ])
    );
    // Empty is a valid result (no references found), not an error.
    assert_eq!(find_references_result(&[]), serde_json::json!([]));
}

#[test]
fn rename_result_reports_files_and_edits() {
    assert_eq!(
        rename_result(3, 11),
        serde_json::json!({ "filesChanged": 3, "editsApplied": 11 })
    );
}

#[test]
fn error_result_wraps_the_message() {
    assert_eq!(
        error_result("no language server"),
        serde_json::json!({ "error": "no language server" })
    );
}

#[test]
fn parse_symbol_location_requires_all_three() {
    assert_eq!(
        parse_symbol_location(&serde_json::json!({ "file": "a.rs", "line": 10, "column": 4 })),
        Some(("a.rs".to_string(), 10, 4))
    );
    assert_eq!(
        parse_symbol_location(&serde_json::json!({ "file": "a.rs", "line": 10 })),
        None // no column
    );
    assert_eq!(
        parse_symbol_location(&serde_json::json!({ "line": 10, "column": 4 })),
        None // no file
    );
}
