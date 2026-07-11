// The AGENT LEG (#6) host side — capability-tools list + invoke, verified without
// a real wasm guest. A mock plugin is stood up exactly as the sidecar effort test
// does (a channel in plugin_channels + a router subscription), plus a registry
// entry declaring its dispatchable verb. We then drive the REAL
// `capability_tools::Host` impl on the bindings:
//
//   - list_tools surfaces the plugin's verb as a provider-shaped tool schema, and
//     ONLY a verb guarded by <key>:dispatch (the #1 adapter's eligibility rule);
//   - invoke_tool routes to <key>:dispatch (the mock channel receives it, carrying
//     the verb + a replyRef) and its correlation-await returns the plugin's
//     dispatch-result:v1 node keyed by that replyRef;
//   - a plugin ABSENT from the registry (never loaded / revoked) surfaces no tool
//     and cannot be invoked — surfacing widens reach, not power.

// NOTE: this file is `include!`d into the same `tests` module as capability_gate.rs,
// so `PermissionGrant` (imported there) + `super::*` are already in scope.
use crate::host::plugin_host::host::plugin::capability_tools::Host as CapabilityToolsHost;
use crate::host::wasi_bridge::{CrossPluginAccess, ModelRoute};

/// Bindings wired with a cross-plugin registry + router, plus one mock dispatchable
/// plugin `vault` (provides vault:store guarded by vault:dispatch). Returns the
/// bindings, the shared sync (to stage a result node), and the mock plugin's rx
/// (to observe the delivered dispatch).
fn make_agent_leg_bindings() -> (
    TractorNativeBindings,
    NativeSync,
    tokio::sync::mpsc::UnboundedReceiver<crate::EventEnvelope>,
) {
    let storage = NativeStorage::open(":memory:").unwrap();
    let sync = NativeSync::new(storage, ":memory:").unwrap();
    let telemetry = TelemetryBus::new(10);

    let registry = crate::host::PluginRegistry::default();
    registry.register(
        "vault",
        crate::host::plugin_registry::PluginCapabilityProfile {
            provides: vec!["vault:store".into(), "vault:dispatch".into()],
            subscribes: vec!["vault:dispatch".into()],
            ..Default::default()
        },
    );

    let event_router = crate::EventRouter::default();
    event_router.subscribe("vault:dispatch", "vault");

    let plugin_channels: crate::PluginChannels =
        std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashMap::new()));
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<crate::EventEnvelope>();
    plugin_channels
        .write()
        .unwrap()
        .insert("vault".to_string(), tx);

    let cross = CrossPluginAccess { registry, event_router, plugin_channels };

    // The agent runs as "agent" — the CALLER. Its own grant is irrelevant to the
    // callee; invoke routes to vault under vault's instance, proving surfacing does
    // not lend the agent's authority.
    let bindings = TractorNativeBindings::new(
        "agent",
        sync.clone(),
        telemetry,
        HostEffectPolicy::default(),
        ModelRoute::default(),
        None,
        PermissionGrant::permissive(),
        None,
        Some(cross),
    );
    (bindings, sync, rx)
}

#[tokio::test]
async fn list_tools_surfaces_a_dispatchable_plugin_verb() {
    let (mut bindings, _sync, _rx) = make_agent_leg_bindings();

    let anthropic = bindings.list_tools("anthropic".to_string()).await;
    assert_eq!(anthropic.len(), 1, "exactly the one guarded verb surfaces");
    let schema: serde_json::Value = serde_json::from_str(&anthropic[0]).unwrap();
    assert_eq!(
        schema["name"], "vault_store",
        "tool name is <key>_<verb>, model-safe"
    );
    // No verbSchemas declared → the variadic `{ args }` schema, the correct shape for
    // an opaque verb (NOT a fallback).
    assert!(schema["input_schema"]["properties"]["args"].is_object());

    // OpenAI provider wraps the same body in the function envelope.
    let openai = bindings.list_tools("openai".to_string()).await;
    let oschema: serde_json::Value = serde_json::from_str(&openai[0]).unwrap();
    assert_eq!(oschema["type"], "function");
    assert_eq!(oschema["function"]["name"], "vault_store");
}

/// A plugin that DECLARES `verbSchemas["vault:store"]` — the same mock as
/// `make_agent_leg_bindings` but with a typed arg schema, so `list_tools` must render
/// the plugin's schema verbatim (named args + `required`) instead of the variadic one.
fn make_typed_agent_leg_bindings() -> TractorNativeBindings {
    let storage = NativeStorage::open(":memory:").unwrap();
    let sync = NativeSync::new(storage, ":memory:").unwrap();
    let telemetry = TelemetryBus::new(10);

    let registry = crate::host::PluginRegistry::default();
    let mut schemas = std::collections::HashMap::new();
    schemas.insert(
        "vault:store".to_string(),
        serde_json::json!({
            "type": "object",
            "properties": {
                "path": { "type": "string", "description": "note path" },
                "body": { "type": "string" }
            },
            "required": ["path"]
        }),
    );
    registry.register(
        "vault",
        crate::host::plugin_registry::PluginCapabilityProfile {
            provides: vec!["vault:store".into(), "vault:dispatch".into()],
            subscribes: vec!["vault:dispatch".into()],
            verb_schemas: schemas,
            ..Default::default()
        },
    );

    let event_router = crate::EventRouter::default();
    event_router.subscribe("vault:dispatch", "vault");
    let plugin_channels: crate::PluginChannels =
        std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashMap::new()));
    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel::<crate::EventEnvelope>();
    plugin_channels.write().unwrap().insert("vault".to_string(), tx);
    let cross = CrossPluginAccess { registry, event_router, plugin_channels };

    TractorNativeBindings::new(
        "agent",
        sync,
        telemetry,
        HostEffectPolicy::default(),
        ModelRoute::default(),
        None,
        PermissionGrant::permissive(),
        None,
        Some(cross),
    )
}

#[tokio::test]
async fn list_tools_renders_a_declared_verb_schema_typed_not_variadic() {
    let mut bindings = make_typed_agent_leg_bindings();

    // Anthropic: the plugin's schema IS the input_schema — typed named args, `required`,
    // and NO variadic `args` property.
    let anthropic = bindings.list_tools("anthropic".to_string()).await;
    assert_eq!(anthropic.len(), 1);
    let schema: serde_json::Value = serde_json::from_str(&anthropic[0]).unwrap();
    assert_eq!(schema["name"], "vault_store");
    let props = &schema["input_schema"]["properties"];
    assert!(props["path"].is_object(), "typed `path` arg present: {schema}");
    assert!(props["body"].is_object(), "typed `body` arg present");
    assert!(
        props.get("args").is_none(),
        "a declared schema replaces the variadic `args`, not augments it: {schema}"
    );
    assert_eq!(schema["input_schema"]["required"][0], "path");

    // OpenAI: the same schema body, in the function envelope's `parameters`.
    let openai = bindings.list_tools("openai".to_string()).await;
    let oschema: serde_json::Value = serde_json::from_str(&openai[0]).unwrap();
    assert_eq!(oschema["function"]["name"], "vault_store");
    let oprops = &oschema["function"]["parameters"]["properties"];
    assert!(oprops["path"].is_object());
    assert!(oprops.get("args").is_none());
}

#[tokio::test]
async fn list_tool_prompts_for_a_typed_verb_points_at_the_schema() {
    // With a declared schema but NO verbDocs, the boilerplate guidance must agree with
    // the typed schema render — it points at the schema, not at variadic `args` strings.
    let mut bindings = make_typed_agent_leg_bindings();
    let prompts = bindings.list_tool_prompts().await;
    assert_eq!(prompts.len(), 1);
    assert!(prompts[0].contains("vault_store"), "names the tool: {}", prompts[0]);
    assert!(
        prompts[0].contains("schema"),
        "typed verb guidance points at the schema, not key=value args: {}",
        prompts[0]
    );
}

#[tokio::test]
async fn list_tool_prompts_gives_one_guidance_line_per_verb() {
    let (mut bindings, _sync, _rx) = make_agent_leg_bindings();

    let prompts = bindings.list_tool_prompts().await;
    assert_eq!(prompts.len(), 1, "one guidance line per dispatchable verb");
    // The guidance names the model-facing tool + the plugin it routes to — the
    // context the flat schema under-explains.
    assert!(prompts[0].contains("vault_store"), "names the tool: {}", prompts[0]);
    assert!(prompts[0].contains("vault"), "names the target plugin: {}", prompts[0]);
    assert!(prompts[0].contains("args"), "explains the arg shape: {}", prompts[0]);
}

#[tokio::test]
async fn list_tool_prompts_is_empty_without_a_registry() {
    // A bindings with no cross-plugin wired (test/legacy host) yields no guidance,
    // matching list_tools' empty-list behavior — never a panic.
    let storage = NativeStorage::open(":memory:").unwrap();
    let sync = NativeSync::new(storage, ":memory:").unwrap();
    let mut bindings = TractorNativeBindings::new(
        "agent",
        sync,
        TelemetryBus::new(10),
        HostEffectPolicy::default(),
        ModelRoute::default(),
        None,
        PermissionGrant::permissive(),
        None,
        None, // no CrossPluginAccess
    );
    assert!(bindings.list_tool_prompts().await.is_empty());
}

#[tokio::test]
async fn invoke_tool_routes_to_dispatch_and_awaits_the_result_node() {
    let (mut bindings, sync, mut rx) = make_agent_leg_bindings();

    // Spawn a mock "vault plugin": it receives the vault:dispatch event, reads the
    // replyRef, and stores a refarm:DispatchResult node — exactly the contract the
    // real vault harness proves. This is what the invoke's correlation-await reads.
    let sync_for_plugin = sync.clone();
    let plugin = tokio::spawn(async move {
        let msg = rx.recv().await.expect("dispatch delivered");
        assert_eq!(msg.event, "vault:dispatch");
        let payload: serde_json::Value =
            serde_json::from_str(msg.payload.as_deref().unwrap()).unwrap();
        assert_eq!(payload["verb"], "store", "the tool name maps to the verb");
        let reply_ref = payload["replyRef"].as_str().unwrap().to_string();
        // Store the correlated result node the caller awaits.
        let node = serde_json::json!({
            "@id": format!("urn:refarm:dispatch-result:{reply_ref}"),
            "@type": "refarm:DispatchResult",
            "refarm:replyRef": reply_ref,
            "refarm:result": { "stored": true },
        });
        sync_for_plugin
            .store_node(
                node["@id"].as_str().unwrap(),
                "refarm:DispatchResult",
                None,
                &node.to_string(),
                Some("vault"),
            )
            .unwrap();
    });

    let result = bindings
        .invoke_tool("vault_store".to_string(), r#"{"path":"n.md"}"#.to_string())
        .await
        .expect("invoke must return the correlated result");
    plugin.await.unwrap();

    let node: serde_json::Value = serde_json::from_str(&result).unwrap();
    assert_eq!(node["@type"], "refarm:DispatchResult");
    assert_eq!(node["refarm:result"]["stored"], true);
}

#[tokio::test]
async fn invoke_tool_for_an_unregistered_plugin_fails_not_escalates() {
    let (mut bindings, _sync, _rx) = make_agent_leg_bindings();

    // A tool name for a plugin that is NOT in the registry (never loaded / revoked)
    // resolves to nothing — the agent cannot invoke what was never granted a load.
    let err = bindings
        .invoke_tool("ghost_do".to_string(), "{}".to_string())
        .await
        .expect_err("an unregistered plugin's tool must fail");
    assert!(
        err.contains("no loaded plugin provides tool"),
        "fails at resolution, not by escalating: {err}"
    );
}
