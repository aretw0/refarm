use super::*;

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
