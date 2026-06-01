// Agent-tool observer — audit sink and capability-based event routing.
//
// Step 3 (core.rs): every agent-fs/agent-shell call emits a TelemetryBus event.
// Step 4 (this file): the audit subscriber writes those events to NDJSON and
//   routes them to any plugin that declared CAP_OBSERVE_AGENT_TOOLS in its
//   manifest.capabilities.provides. That plugin receives standard
//   `integration.on-event` calls — no new WIT interface needed.
//
// Routing is purely capability-driven. The tractor does not know the name or
// purpose of any observer plugin; it only checks the declared capability.
// The reference implementation lives in packages/scarecrow — but any plugin
// that declares "observe-agent-tools" is eligible.

use std::path::{Path, PathBuf};
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt as _;

use crate::telemetry::{TelemetryBus, TelemetryEvent};
use crate::{AgentChannels, AgentMessage};

/// Capability string a plugin must declare in `capabilities.provides` to
/// receive agent-tool events via `integration.on-event`.
pub const CAP_OBSERVE_AGENT_TOOLS: &str = "observe-agent-tools";

pub const AUDIT_FILE: &str = "scarecrow-audit.ndjson";
const AGENT_TOOL_PREFIX: &str = "agent-tool:";

/// Spawn the Scarecrow background task.
///
/// Subscribes to `agent-tool:*` TelemetryBus events and for each one:
///   1. Appends a NDJSON audit line to `{base_dir}/scarecrow-audit.ndjson`.
///   2. Forwards the event to every plugin registered in `observer_channels` —
///      i.e. every plugin that declared `"observe-agent-tools"` in its manifest.
///
/// The task runs until the TelemetryBus sender is dropped (daemon shutdown).
pub fn spawn_audit_subscriber(
    telemetry: TelemetryBus,
    base_dir: PathBuf,
    observer_channels: AgentChannels,
) {
    tokio::spawn(audit_subscriber_task(telemetry, base_dir, observer_channels));
}

async fn audit_subscriber_task(
    telemetry: TelemetryBus,
    base_dir: PathBuf,
    observer_channels: AgentChannels,
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
                    forward_to_observers(&event, &line, &observer_channels);
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                tracing::warn!(skipped = n, "scarecrow: audit subscriber lagged — events skipped");
            }
        }
    }
}

/// Forward an agent-tool event to every channel in `observer_channels`.
///
/// All plugins in this map have already been vetted by capability declaration —
/// no further filtering is needed here.
fn forward_to_observers(
    event: &TelemetryEvent,
    json_payload: &str,
    observer_channels: &AgentChannels,
) {
    let Ok(guard) = observer_channels.read() else { return };
    for tx in guard.values() {
        let _ = tx.send(AgentMessage {
            event: event.event.clone(),
            payload: Some(json_payload.to_owned()),
        });
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
    fn forward_sends_to_all_observer_channels() {
        use std::collections::HashMap;
        use std::sync::{Arc, RwLock};
        use tokio::sync::mpsc;

        let (tx1, mut rx1) = mpsc::unbounded_channel::<AgentMessage>();
        let (tx2, mut rx2) = mpsc::unbounded_channel::<AgentMessage>();
        let observer_channels: AgentChannels = Arc::new(RwLock::new({
            let mut m = HashMap::new();
            m.insert("@refarm/scarecrow".to_string(), tx1);
            m.insert("@refarm/scarecrow-strict".to_string(), tx2);
            m
        }));

        let ev = make_event(
            "agent-tool:fs:write",
            Some("pi-agent"),
            serde_json::json!({ "path": "/workspaces/refarm/src/main.ts", "bytes": 512 }),
        );
        let line = format_audit_line(&ev).unwrap();
        forward_to_observers(&ev, &line, &observer_channels);

        let msg1 = rx1.try_recv().expect("observer 1 should receive");
        let msg2 = rx2.try_recv().expect("observer 2 should receive");
        assert_eq!(msg1.event, "agent-tool:fs:write");
        assert_eq!(msg2.event, "agent-tool:fs:write");
        assert!(msg1.payload.unwrap().contains("512"));
    }

    #[test]
    fn forward_to_empty_observer_channels_is_noop() {
        use std::collections::HashMap;
        use std::sync::{Arc, RwLock};

        let observer_channels: AgentChannels = Arc::new(RwLock::new(HashMap::new()));
        let ev = make_event("agent-tool:fs:read", Some("pi-agent"), serde_json::json!({}));
        let line = format_audit_line(&ev).unwrap();
        // Should not panic with no observers registered
        forward_to_observers(&ev, &line, &observer_channels);
    }
}
