use super::*;

#[test]
fn mint_urn_has_expected_prefix() {
    let id = mint_urn("prompt");
    assert!(
        id.starts_with("urn:refarm:prompt-"),
        "unexpected urn: {id}"
    );
}
