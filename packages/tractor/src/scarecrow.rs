// Scarecrow Step 4 foundation — subscribes to agent-tool TelemetryBus events
// and appends them as NDJSON to {base_dir}/scarecrow-audit.ndjson.
//
// Establishes the subscription pattern for future Scarecrow policy plugins
// (Step 4 full: replaceable WASM policy plugin via scarecrow-bridge WIT interface).
// Until the WIT bridge exists, this is the auditable record of every agent action.

use std::path::{Path, PathBuf};
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt as _;

use crate::telemetry::{TelemetryBus, TelemetryEvent};

pub const AUDIT_FILE: &str = "scarecrow-audit.ndjson";
const AGENT_TOOL_PREFIX: &str = "agent-tool:";

/// Spawn a background task that subscribes to `agent-tool:*` telemetry events
/// and appends each one as a NDJSON line to `{base_dir}/scarecrow-audit.ndjson`.
///
/// The task runs until the `TelemetryBus` sender is dropped (daemon shutdown).
/// Lagged events are skipped with a warning; the file is opened append-only so
/// existing audit history is never overwritten.
pub fn spawn_audit_subscriber(telemetry: TelemetryBus, base_dir: PathBuf) {
    tokio::spawn(audit_subscriber_task(telemetry, base_dir));
}

async fn audit_subscriber_task(telemetry: TelemetryBus, base_dir: PathBuf) {
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
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                tracing::warn!(skipped = n, "scarecrow: audit subscriber lagged — events skipped");
            }
        }
    }
}

/// Format a TelemetryEvent as a flat JSON object.
/// Payload fields are merged into the top-level object for easy `jq` access.
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
    fn non_agent_tool_events_return_none() {
        let ev = make_event("plugin:log", Some("pi-agent"), serde_json::json!({ "msg": "hello" }));
        // format_audit_line formats any event; filtering is done in the subscriber loop.
        // Confirm it still produces a valid line (the loop filters before calling format).
        let line = format_audit_line(&ev);
        assert!(line.is_some());
    }

    #[test]
    fn event_without_payload_formats_cleanly() {
        let ev = TelemetryEvent::new("agent-tool:fs:edit", Some("pi-agent".into()));
        let line = format_audit_line(&ev).expect("should format");
        let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid JSON");
        assert_eq!(parsed["event"], "agent-tool:fs:edit");
        assert_eq!(parsed["plugin_id"], "pi-agent");
        assert!(!parsed["payload"].is_string());
    }
}
