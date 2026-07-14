//! Native tests for the observer's pure verdict/node helpers — no WASM build needed.

use super::*;

#[test]
fn risk_matches_the_permission_vocabulary() {
    assert_eq!(risk_of_effect("host-effect:fs:read"), "low");
    assert_eq!(risk_of_effect("host-effect:fs:write"), "medium");
    assert_eq!(risk_of_effect("host-effect:fs:edit"), "medium");
    assert_eq!(risk_of_effect("host-effect:shell:spawn"), "high");
    // An unrecognised effect is high — fail-closed.
    assert_eq!(risk_of_effect("host-effect:mystery"), "high");
}

#[test]
fn high_risk_is_flagged_the_rest_noted() {
    assert_eq!(verdict_for("host-effect:shell:spawn"), ("high", "flagged"));
    assert_eq!(verdict_for("host-effect:fs:read"), ("low", "noted"));
    assert_eq!(verdict_for("host-effect:fs:write"), ("medium", "noted"));
}

#[test]
fn observation_node_carries_effect_risk_verdict_and_plugin() {
    let node = build_observation_node(
        3,
        "host-effect:shell:spawn",
        Some(r#"{"plugin_id":"agent","argv":["ls"]}"#),
    );
    assert_eq!(node["@type"], OBSERVATION_TYPE);
    assert_eq!(node["@id"], "urn:sovereign:scarecrow-observation:3");
    assert_eq!(node["effect"], "host-effect:shell:spawn");
    assert_eq!(node["risk"], "high");
    assert_eq!(node["verdict"], "flagged");
    assert_eq!(node["pluginId"], "agent");
}

#[test]
fn observation_node_tolerates_a_payload_without_plugin_id() {
    let node = build_observation_node(1, "host-effect:fs:read", Some("{}"));
    assert_eq!(node["risk"], "low");
    assert!(node["pluginId"].is_null());
    // And a missing payload entirely.
    let node2 = build_observation_node(2, "host-effect:fs:read", None);
    assert!(node2["pluginId"].is_null());
}
