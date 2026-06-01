// Scarecrow observation and event routing — Barn/Scarecrow Steps 3+4.
//
// Step 3 (core.rs): every agent-fs/agent-shell call emits a TelemetryBus event.
// Step 4a (this file): subscriber writes those events to an audit NDJSON file.
// Step 4b (this file): subscriber also routes events to any loaded Scarecrow plugin
//   via the existing agent_channels mechanism — the plugin receives standard
//   `integration.on-event(event, payload)` calls, no new WIT interface needed.
//
// A Scarecrow plugin is any loaded plugin whose id starts with SCARECROW_PLUGIN_PREFIX.
// The minimal reference implementation lives in packages/scarecrow.

use std::path::{Path, PathBuf};
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt as _;

use crate::telemetry::{TelemetryBus, TelemetryEvent};
use crate::{AgentChannels, AgentMessage};

pub const AUDIT_FILE: &str = "scarecrow-audit.ndjson";
pub const SCARECROW_PLUGIN_PREFIX: &str = "@refarm/scarecrow";
const AGENT_TOOL_PREFIX: &str = "agent-tool:";

/// Spawn the Scarecrow background task.
///
/// - Subscribes to `agent-tool:*` TelemetryBus events.
/// - Appends each event as a NDJSON line to `{base_dir}/scarecrow-audit.ndjson`.
/// - If a plugin whose id starts with `@refarm/scarecrow` is registered in
///   `agent_channels`, forwards each event via `AgentMessage` so the plugin's
///   `integration.on-event` export is called — enabling policy-as-WASM without
///   any new WIT interface definitions.
///
/// The task runs until the TelemetryBus sender is dropped (daemon shutdown).
pub fn spawn_audit_subscriber(
    telemetry: TelemetryBus,
    base_dir: PathBuf,
    agent_channels: AgentChannels,
) {
    tokio::spawn(audit_subscriber_task(telemetry, base_dir, agent_channels));
}

async fn audit_subscriber_task(
    telemetry: TelemetryBus,
    base_dir: PathBuf,
    agent_channels: AgentChannels,
) {
    let audit_path = base_dir.join(AUDIT_FILE);
    let mut rx = telemetry.subscribe();
    loop {
        match rx.recv().await {
            Ok(event) => {
                if !event.event.starts_with(AGENT_TOOL_PREFIX) {
                    continue;
                }
                if let Some(line) = format_audit_line(&event) {
                    append_line(&audit_path, &line).await;
                    route_to_scarecrow_plugin(&event, &line, &agent_channels);
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                tracing::warn!(skipped = n, "scarecrow: audit subscriber lagged — events skipped");
            }
        }
    }
}

/// Forward an agent-tool event to every loaded Scarecrow plugin via agent_channels.
///
/// Scarecrow plugins are identified by a plugin_id that starts with
/// `SCARECROW_PLUGIN_PREFIX` (e.g. `@refarm/scarecrow`, `@refarm/scarecrow-strict`).
/// The NDJSON line already computed for the audit file is reused as the payload.
fn route_to_scarecrow_plugin(
    event: &TelemetryEvent,
    json_payload: &str,
    agent_channels: &AgentChannels,
) {
    let Ok(guard) = agent_channels.read() else { return };
    for (plugin_id, tx) in guard.iter() {
        if plugin_id.starts_with(SCARECROW_PLUGIN_PREFIX) {
            let _ = tx.send(AgentMessage {
                event: event.event.clone(),
                payload: Some(json_payload.to_owned()),
            });
        }
    }
}

/// Format a TelemetryEvent as a flat JSON object for the audit log.
/// Payload fields are merged into the top-level object for direct `jq` access.
pub(crate) fn format_audit_line(event: &TelemetryEvent) -> Option<String> {
    let mut obj = serde_json::Map::new();
    obj.insert("ts".into(), serde_json::Value::Number(event.timestamp.into()));
    obj.insert("event".into(), serde_json::Value::String(event.event.clone()));
    if let Some(plugin_id) = &event.plugin_id {
        obj.insert("plugin_id".into(), serde_json::Value::String(plugin_id.clone()));
    }
    if let Some(payload) = &event.payload {
        if let Some(map) = payload.as_object() {
            for (k, v) in map {
                obj.insert(k.clone(), v.clone());
            }
        }
    }
    serde_json::to_string(&serde_json::Value::Object(obj)).ok()
}

async fn append_line(path: &Path, line: &str) {
    match OpenOptions::new().create(true).append(true).open(path).await {
        Ok(mut file) => {
            let _ = file.write_all(line.as_bytes()).await;
            let _ = file.write_all(b"\n").await;
        }
        Err(e) => {
            tracing::debug!(path = %path.display(), error = %e, "scarecrow: cannot open audit file");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::TelemetryEvent;

    fn make_event(event: &str, plugin_id: Option<&str>, payload: serde_json::Value) -> TelemetryEvent {
        let mut e = TelemetryEvent::new(event, plugin_id.map(String::from));
        e = e.with_payload(payload);
        e
    }

    #[test]
    fn format_fs_read_event() {
        let ev = make_event(
            "agent-tool:fs:read",
            Some("pi-agent"),
            serde_json::json!({ "path": "/workspaces/refarm/README.md", "bytes": 1024 }),
        );
        let line = format_audit_line(&ev).expect("should format");
        let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid JSON");
        assert_eq!(parsed["event"], "agent-tool:fs:read");
        assert_eq!(parsed["plugin_id"], "pi-agent");
        assert_eq!(parsed["path"], "/workspaces/refarm/README.md");
        assert_eq!(parsed["bytes"], 1024);
        assert!(parsed["ts"].is_number());
    }

    #[test]
    fn format_shell_spawn_event() {
        let ev = make_event(
            "agent-tool:shell:spawn",
            Some("pi-agent"),
            serde_json::json!({
                "argv": ["refarm", "agent", "finish", "--lane", "after-edit", "--run", "--json"],
                "exit_code": 0,
                "duration_ms": 12340,
                "timed_out": false
            }),
        );
        let line = format_audit_line(&ev).expect("should format");
        let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid JSON");
        assert_eq!(parsed["event"], "agent-tool:shell:spawn");
        assert_eq!(parsed["exit_code"], 0);
        assert_eq!(parsed["duration_ms"], 12340);
        assert_eq!(parsed["timed_out"], false);
        assert!(parsed["argv"].is_array());
    }

    #[test]
    fn event_without_payload_formats_cleanly() {
        let ev = TelemetryEvent::new("agent-tool:fs:edit", Some("pi-agent".into()));
        let line = format_audit_line(&ev).expect("should format");
        let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid JSON");
        assert_eq!(parsed["event"], "agent-tool:fs:edit");
        assert_eq!(parsed["plugin_id"], "pi-agent");
    }

    #[test]
    fn route_to_scarecrow_sends_to_matching_plugins() {
        use std::collections::HashMap;
        use std::sync::{Arc, RwLock};
        use tokio::sync::mpsc;

        let (tx, mut rx) = mpsc::unbounded_channel::<AgentMessage>();
        let channels: AgentChannels = Arc::new(RwLock::new({
            let mut m = HashMap::new();
            m.insert("@refarm/scarecrow".to_string(), tx);
            m
        }));

        let ev = make_event(
            "agent-tool:fs:write",
            Some("pi-agent"),
            serde_json::json!({ "path": "/workspaces/refarm/src/main.ts", "bytes": 512 }),
        );
        let line = format_audit_line(&ev).unwrap();
        route_to_scarecrow_plugin(&ev, &line, &channels);

        let msg = rx.try_recv().expect("should have received a message");
        assert_eq!(msg.event, "agent-tool:fs:write");
        assert!(msg.payload.unwrap().contains("512"));
    }

    #[test]
    fn route_skips_non_scarecrow_plugins() {
        use std::collections::HashMap;
        use std::sync::{Arc, RwLock};
        use tokio::sync::mpsc;

        let (tx, mut rx) = mpsc::unbounded_channel::<AgentMessage>();
        let channels: AgentChannels = Arc::new(RwLock::new({
            let mut m = HashMap::new();
            m.insert("@refarm/pi-agent".to_string(), tx);
            m
        }));

        let ev = make_event("agent-tool:fs:read", Some("pi-agent"), serde_json::json!({}));
        let line = format_audit_line(&ev).unwrap();
        route_to_scarecrow_plugin(&ev, &line, &channels);
        assert!(rx.try_recv().is_err(), "pi-agent should not receive scarecrow events");
    }
}
