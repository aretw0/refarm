use super::*;

#[test]
fn new_agent_urn_has_expected_prefix() {
    let id = new_agent_urn("prompt");
    assert!(
        id.starts_with("urn:agent:prompt-"),
        "unexpected urn: {id}"
    );
}
