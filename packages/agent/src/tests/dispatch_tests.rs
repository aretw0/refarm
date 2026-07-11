//! Unit tests for the agent's DELEGATION dispatch handling — the pure parse/build
//! helpers that turn an `agent:dispatch` event into a `DispatchResult` node. The full
//! agent-A → agent-B round-trip (invoke_tool → dispatch → sub-agent turn → result) is
//! proven end-to-end in the tractor harness; these lock the envelope contract that both
//! sides depend on, mirroring lsp-code-ops's `parse_dispatch` tests.

use super::super::{
    build_dispatch_result_node, dispatch_error_result, parse_agent_dispatch, DISPATCH_RESULT_TYPE,
    REPLY_REF_FIELD, RESULT_FIELD,
};

#[test]
fn parse_agent_dispatch_splits_envelope_from_args() {
    let req = parse_agent_dispatch(
        r#"{"verb":"respond","replyRef":"dispatch-abc","prompt":"summarize this","model":"m1"}"#,
    )
    .expect("well-formed dispatch parses");
    assert_eq!(req.verb, "respond");
    assert_eq!(req.reply_ref, "dispatch-abc");
    // Args = the payload MINUS verb/replyRef — i.e. exactly the respond payload.
    assert_eq!(req.args["prompt"], "summarize this");
    assert_eq!(req.args["model"], "m1");
    assert!(req.args.get("verb").is_none(), "verb must not leak into args");
    assert!(
        req.args.get("replyRef").is_none(),
        "replyRef must not leak into args"
    );
}

#[test]
fn parse_agent_dispatch_rejects_malformed_payloads() {
    assert!(parse_agent_dispatch(r#"{"replyRef":"r-1"}"#).is_none()); // no verb
    assert!(parse_agent_dispatch(r#"{"verb":"respond"}"#).is_none()); // no replyRef
    assert!(parse_agent_dispatch("not json").is_none()); // not JSON
    assert!(parse_agent_dispatch(r#"["array"]"#).is_none()); // not an object
    assert!(parse_agent_dispatch(r#"{"verb":1,"replyRef":"r"}"#).is_none()); // verb not a string
}

#[test]
fn build_dispatch_result_node_carries_correlation_and_result() {
    let result = serde_json::json!({ "content": "done", "model": "mock" });
    let node = build_dispatch_result_node("dispatch-xyz", result.clone());

    // The @id + @type + correlation field are the shape the host's await polls for.
    assert_eq!(node["@id"], "urn:sovereign:dispatch-result:dispatch-xyz");
    assert_eq!(node["@type"], DISPATCH_RESULT_TYPE);
    assert_eq!(node[REPLY_REF_FIELD], "dispatch-xyz");
    // The verb's result rides verbatim under `result` — the sub-agent's response object.
    assert_eq!(node[RESULT_FIELD], result);
}

#[test]
fn dispatch_error_result_is_an_error_object() {
    // The agent ALWAYS stores a result node (even on failure) so the caller never hangs;
    // a failure is surfaced as `{ error: <message> }`, not a missing node.
    let err = dispatch_error_result("prompt is required");
    assert_eq!(err["error"], "prompt is required");
}

#[test]
fn dispatch_result_node_round_trips_through_json() {
    // The guest stores `node.to_string()`; the host parses it back and reads replyRef.
    // Prove that serialize→parse preserves the correlation key and result exactly.
    let node = build_dispatch_result_node(
        "dispatch-rt",
        serde_json::json!({ "content": "hi", "usage": { "tokens_out": 3 } }),
    );
    let serialized = node.to_string();
    let parsed: serde_json::Value = serde_json::from_str(&serialized).unwrap();
    assert_eq!(parsed[REPLY_REF_FIELD], "dispatch-rt");
    assert_eq!(parsed[RESULT_FIELD]["content"], "hi");
    assert_eq!(parsed[RESULT_FIELD]["usage"]["tokens_out"], 3);
}
