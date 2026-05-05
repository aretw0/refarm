use super::*;

#[test]
fn new_pi_urn_has_expected_prefix() {
    let id = new_pi_urn("prompt");
    assert!(
        id.starts_with("urn:pi-agent:prompt-"),
        "unexpected urn: {id}"
    );
}
