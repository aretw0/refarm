use super::*;

#[test]
fn parse_respond_payload_parses_session_fields() {
    let payload = serde_json::json!({
        "prompt": "hello",
        "session_id": "urn:refarm:session:abc123",
        "history_turns": 10,
    })
    .to_string();
    let req = parse_respond_payload(&payload).expect("valid payload must parse");
    assert_eq!(req.prompt, "hello");
    assert_eq!(req.session_id.as_deref(), Some("urn:refarm:session:abc123"));
    assert_eq!(req.history_turns, Some(10));
}

#[test]
fn parse_respond_payload_session_fields_optional() {
    let payload = serde_json::json!({ "prompt": "hello" }).to_string();
    let req = parse_respond_payload(&payload).expect("prompt-only payload must parse");
    assert!(req.session_id.is_none(), "session_id must default to None");
    assert!(req.history_turns.is_none(), "history_turns must default to None");
}

#[test]
fn parse_respond_payload_ignores_empty_session_id() {
    let payload = serde_json::json!({ "prompt": "hello", "session_id": "" }).to_string();
    let req = parse_respond_payload(&payload).expect("empty session_id must parse");
    assert!(req.session_id.is_none(), "empty session_id must be treated as absent");
}

#[test]
fn respond_accepts_session_id_and_history_turns() {
    let payload = serde_json::json!({
        "prompt": "hello",
        "session_id": "urn:refarm:session:test",
        "history_turns": 5,
    })
    .to_string();
    let output = <PiAgent as IntegrationGuest>::respond(payload)
        .expect("respond with session fields must succeed");
    let parsed: serde_json::Value = serde_json::from_str(&output).unwrap();
    assert!(parsed.get("content").and_then(|v| v.as_str()).is_some());
}

#[test]
fn respond_returns_complete_structure() {
    let payload = serde_json::json!({ "prompt": "what is active inference?" }).to_string();
    let output =
        <PiAgent as IntegrationGuest>::respond(payload).expect("respond should return ok payload");
    let parsed: serde_json::Value =
        serde_json::from_str(&output).expect("respond output must be valid JSON");

    assert!(
        parsed
            .get("content")
            .and_then(|value| value.as_str())
            .is_some(),
        "respond output must include string field content"
    );
    assert!(
        parsed
            .get("model")
            .and_then(|value| value.as_str())
            .is_some(),
        "respond output must include string field model"
    );
    assert!(
        parsed
            .get("provider")
            .and_then(|value| value.as_str())
            .is_some(),
        "respond output must include string field provider"
    );

    let usage = parsed.get("usage").expect("usage object must exist");
    assert!(
        usage
            .get("tokens_in")
            .and_then(|value| value.as_u64())
            .is_some(),
        "usage.tokens_in must be numeric"
    );
    assert!(
        usage
            .get("tokens_out")
            .and_then(|value| value.as_u64())
            .is_some(),
        "usage.tokens_out must be numeric"
    );
    assert!(
        usage
            .get("estimated_usd")
            .and_then(|value| value.as_f64())
            .is_some(),
        "usage.estimated_usd must be numeric"
    );
}

#[test]
fn respond_rejects_payload_without_prompt() {
    let payload = serde_json::json!({ "system": "only-system" }).to_string();
    let error = <PiAgent as IntegrationGuest>::respond(payload)
        .expect_err("respond must reject payload without prompt");

    match error {
        PluginError::InvalidSchema(message) => {
            assert!(message.contains("prompt"));
        }
        other => panic!("expected invalid-schema error, got: {other:?}"),
    }
}
