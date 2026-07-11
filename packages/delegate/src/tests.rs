//! Unit tests for the delegate's PURE helpers — persona resolution, chain threading, the
//! respond-input shape, and result extraction. The full delegate → agent → sub-turn
//! round-trip is proven end to end in the tractor harness; these lock the pure logic the
//! guest composes.

use super::*;

#[test]
fn parse_dispatch_splits_envelope_from_args() {
    let req = parse_dispatch(
        r#"{"verb":"single","replyRef":"dispatch-1","persona":"scout","task":"look around"}"#,
    )
    .expect("well-formed dispatch parses");
    assert_eq!(req.verb, "single");
    assert_eq!(req.reply_ref, "dispatch-1");
    assert_eq!(req.args["persona"], "scout");
    assert_eq!(req.args["task"], "look around");
    assert!(req.args.get("verb").is_none());
    assert!(req.args.get("replyRef").is_none());
}

#[test]
fn parse_dispatch_rejects_malformed() {
    assert!(parse_dispatch(r#"{"replyRef":"r"}"#).is_none()); // no verb
    assert!(parse_dispatch(r#"{"verb":"single"}"#).is_none()); // no replyRef
    assert!(parse_dispatch("not json").is_none());
    assert!(parse_dispatch(r#"["x"]"#).is_none());
}

#[test]
fn default_personas_are_the_four_named_agent_persona_nodes() {
    let personas = default_personas();
    let names: Vec<&str> = personas
        .iter()
        .filter_map(|p| p.get("name").and_then(Value::as_str))
        .collect();
    assert_eq!(names, vec!["scout", "planner", "worker", "reviewer"]);
    // Each is a well-formed AgentPersona node with a system prompt and a stable urn id.
    for p in &personas {
        assert_eq!(p["@type"], PERSONA_NODE_TYPE);
        assert!(p["@id"].as_str().unwrap().starts_with("urn:sovereign:agent-persona:"));
        assert!(!p["system"].as_str().unwrap().is_empty());
    }
}

#[test]
fn resolve_persona_returns_system_and_model_for_a_known_name() {
    let personas = vec![json!({
        "@type": "AgentPersona",
        "name": "scout",
        "system": "You are a scout.",
        "model": "some-model"
    })];
    let (system, model) = resolve_persona(&personas, Some("scout"));
    assert_eq!(system.as_deref(), Some("You are a scout."));
    assert_eq!(model.as_deref(), Some("some-model"));
}

#[test]
fn resolve_persona_falls_back_to_agent_default_for_unknown_or_missing() {
    let personas = default_personas();
    // Unknown name → no override (agent default), not an error.
    assert_eq!(resolve_persona(&personas, Some("nonexistent")), (None, None));
    // Missing / empty name → default.
    assert_eq!(resolve_persona(&personas, None), (None, None));
    assert_eq!(resolve_persona(&personas, Some("  ")), (None, None));
}

#[test]
fn resolve_persona_omits_model_when_the_node_has_none() {
    let personas = vec![json!({ "name": "scout", "system": "S" })];
    let (system, model) = resolve_persona(&personas, Some("scout"));
    assert_eq!(system.as_deref(), Some("S"));
    assert_eq!(model, None, "a persona without a model leaves it to the agent default");
}

#[test]
fn thread_previous_substitutes_the_marker_when_present() {
    let out = thread_previous("Review this: {previous}", Some("the plan"));
    assert_eq!(out, "Review this: the plan");
}

#[test]
fn thread_previous_appends_when_no_marker() {
    let out = thread_previous("Implement it.", Some("scout notes"));
    assert_eq!(out, "Implement it.\n\n--- Previous step output ---\nscout notes");
}

#[test]
fn thread_previous_leaves_the_first_step_untouched() {
    assert_eq!(thread_previous("Start here.", None), "Start here.");
}

#[test]
fn respond_input_carries_prompt_and_omits_absent_overrides() {
    let bare = respond_input("do it", None, None);
    assert_eq!(bare["prompt"], "do it");
    assert!(bare.get("system").is_none(), "no system when persona has none");
    assert!(bare.get("model").is_none());

    let full = respond_input("do it", Some("You are X."), Some("m1"));
    assert_eq!(full["prompt"], "do it");
    assert_eq!(full["system"], "You are X.");
    assert_eq!(full["model"], "m1");
    // session_id is never set — each sub-turn gets a fresh session.
    assert!(full.get("session_id").is_none());
}

#[test]
fn extract_content_unwraps_the_dispatch_result_envelope() {
    let dispatch_result = json!({
        "@type": "DispatchResult",
        "replyRef": "r",
        "result": { "content": "the answer", "model": "m", "usage": {} }
    })
    .to_string();
    assert_eq!(extract_content(&dispatch_result), "the answer");
}

#[test]
fn extract_content_handles_a_bare_result_or_odd_shape() {
    // A bare result object (no envelope) with content.
    assert_eq!(
        extract_content(&json!({ "content": "hi" }).to_string()),
        "hi"
    );
    // No content anywhere → the result is surfaced as a string, not lost.
    let no_content = json!({ "result": { "note": "x" } }).to_string();
    assert!(extract_content(&no_content).contains("note"));
    // Non-JSON → returned verbatim (never panics).
    assert_eq!(extract_content("plain text"), "plain text");
}

#[test]
fn error_result_is_an_error_object() {
    // The delegate ALWAYS stores a result node (even on failure) so a caller never hangs;
    // a failure surfaces as `{ error: <message> }`, and a chain aborts on it (the guest
    // checks `result.get("error")`).
    let err = error_result("delegation to the agent failed");
    assert_eq!(err["error"], "delegation to the agent failed");
}

#[test]
fn build_dispatch_result_node_has_the_shared_shape() {
    let node = build_dispatch_result_node("dispatch-9", json!({ "content": "done" }));
    assert_eq!(node["@type"], DISPATCH_RESULT_TYPE);
    assert_eq!(node[REPLY_REF_FIELD], "dispatch-9");
    assert_eq!(node[RESULT_FIELD]["content"], "done");
    assert_eq!(node["@id"], "urn:sovereign:dispatch-result:dispatch-9");
}
