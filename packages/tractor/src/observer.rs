// Agent-tool observer — audit sink and capability-based event routing.
//
// Step 3 (core.rs): every host-fs/host-shell call emits a TelemetryBus event.
// Step 4 (this file): the audit subscriber writes those events to NDJSON and
//   routes them to any plugin that declared CAP_OBSERVE_HOST_EFFECTS in its
//   manifest.capabilities.provides. That plugin receives standard
//   `integration.on-event` calls — no new WIT interface needed.
//
// Routing is purely capability-driven. The tractor does not know the name or
// purpose of any observer plugin; it only checks the declared capability.
// The reference implementation lives in packages/scarecrow — but any plugin
// that declares "observe-host-effects" is eligible.

use std::path::{Path, PathBuf};
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt as _;

use crate::telemetry::{TelemetryBus, TelemetryEvent};
use crate::{EventEnvelope, PluginChannels};

pub use crate::capabilities::{CAP_OBSERVE_AGENT_EVENTS, CAP_OBSERVE_HOST_EFFECTS};

pub const AUDIT_FILE: &str = "scarecrow-audit.ndjson";
const HOST_EFFECT_PREFIX: &str = "host-effect:";
/// The prefix the agent narrates its lifecycle under (mirrors agent_events.rs).
const AGENT_EVENT_PREFIX: &str = "agent:";

/// Audit rotation knobs, resolved from env ONCE at boot (`AuditConfig::from_env`)
/// and threaded through the audit-subscriber write path, so rotation reads a
/// value, not process env (which leaks across threads under --test-threads>1).
///
/// - `rotate_bytes`: rotate the live audit file once it exceeds this many bytes.
///   The audit log is tamper-evidence, so rotation RENAMES the full file to a
///   sealed timestamped segment (never truncates/deletes recent lines) and starts
///   a fresh live file. Env override REFARM_AUDIT_ROTATE_BYTES; default 8 MiB.
/// - `max_segments`: keep at most this many sealed segments; older ones pruned.
///   Retention only — never touches the live file. Env REFARM_AUDIT_MAX_SEGMENTS;
///   default 16.
#[derive(Debug, Clone, Copy)]
pub struct AuditConfig {
    pub rotate_bytes: u64,
    pub max_segments: usize,
}

impl Default for AuditConfig {
    fn default() -> Self {
        Self {
            rotate_bytes: 8 * 1024 * 1024,
            max_segments: 16,
        }
    }
}

impl AuditConfig {
    /// Resolve the audit knobs from env. Called ONCE at spawn_audit_subscriber.
    pub fn from_env() -> Self {
        Self {
            rotate_bytes: std::env::var("REFARM_AUDIT_ROTATE_BYTES")
                .ok()
                .and_then(|raw| raw.parse::<u64>().ok())
                .filter(|n| *n > 0)
                .unwrap_or(8 * 1024 * 1024),
            max_segments: std::env::var("REFARM_AUDIT_MAX_SEGMENTS")
                .ok()
                .and_then(|raw| raw.parse::<usize>().ok())
                .filter(|n| *n > 0)
                .unwrap_or(16),
        }
    }
}

/// Spawn the Scarecrow background task.
///
/// Subscribes to `host-effect:*` TelemetryBus events and for each one:
///   1. Appends a NDJSON audit line to `{base_dir}/scarecrow-audit.ndjson`.
///   2. Forwards the event to every plugin registered in `observer_channels` —
///      i.e. every plugin that declared `"observe-host-effects"` in its manifest.
///
/// The task runs until the TelemetryBus sender is dropped (daemon shutdown).
pub fn spawn_audit_subscriber(
    telemetry: TelemetryBus,
    base_dir: PathBuf,
    observer_channels: PluginChannels,
    agent_observer_channels: PluginChannels,
) {
    // Audit rotation knobs resolved from env ONCE here at spawn.
    tokio::spawn(audit_subscriber_task(
        telemetry,
        base_dir,
        observer_channels,
        agent_observer_channels,
        AuditConfig::from_env(),
    ));
}

async fn audit_subscriber_task(
    telemetry: TelemetryBus,
    base_dir: PathBuf,
    observer_channels: PluginChannels,
    agent_observer_channels: PluginChannels,
    config: AuditConfig,
) {
    let audit_path = base_dir.join(AUDIT_FILE);
    let mut rx = telemetry.subscribe();
    loop {
        match rx.recv().await {
            Ok(event) => {
                // Route by prefix off the SAME telemetry subscription: host effects
                // go to the audit log + host-effect observers; agent lifecycle events
                // go to agent-event observers. Anything else is ignored.
                if event.event.starts_with(HOST_EFFECT_PREFIX) {
                    if let Some(line) = format_audit_line(&event) {
                        append_line(&audit_path, &line, config).await;
                        forward_to_observers(&event, &line, &observer_channels);
                    }
                } else if event.event.starts_with(AGENT_EVENT_PREFIX) {
                    if let Some(line) = format_audit_line(&event) {
                        forward_to_observers(&event, &line, &agent_observer_channels);
                    }
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                tracing::warn!(
                    skipped = n,
                    "scarecrow: audit subscriber lagged — events skipped"
                );
            }
        }
    }
}

/// Forward a host-effect event to every channel in `observer_channels`.
///
/// All plugins in this map have already been vetted by capability declaration —
/// no further filtering is needed here.
fn forward_to_observers(
    event: &TelemetryEvent,
    json_payload: &str,
    observer_channels: &PluginChannels,
) {
    let Ok(guard) = observer_channels.read() else {
        return;
    };
    for tx in guard.values() {
        let _ = tx.send(EventEnvelope::fire(
            event.event.clone(),
            Some(json_payload.to_owned()),
        ));
    }
}

/// Format a TelemetryEvent as a flat JSON object for the audit log.
/// Payload fields are merged into the top-level object for direct `jq` access.
pub(crate) fn format_audit_line(event: &TelemetryEvent) -> Option<String> {
    let mut obj = serde_json::Map::new();
    obj.insert(
        "ts".into(),
        serde_json::Value::Number(event.timestamp.into()),
    );
    obj.insert(
        "event".into(),
        serde_json::Value::String(event.event.clone()),
    );
    if let Some(plugin_id) = &event.plugin_id {
        obj.insert(
            "plugin_id".into(),
            serde_json::Value::String(plugin_id.clone()),
        );
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

async fn append_line(path: &Path, line: &str, config: AuditConfig) {
    // Rotate BEFORE appending so a sealed segment never grows past the threshold.
    rotate_if_needed(path, config).await;
    match OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await
    {
        Ok(mut file) => {
            // The audit log is tamper-evidence (CLAUDE.md §3). A dropped write
            // leaves a hole in the security trail, so surface it (warn) instead of
            // swallowing — a host-effect that executed but whose audit record was
            // lost is exactly what an operator must be able to see.
            if let Err(e) = file.write_all(line.as_bytes()).await {
                tracing::warn!(path = %path.display(), error = %e, "scarecrow: audit line write failed — security trail has a gap");
            } else if let Err(e) = file.write_all(b"\n").await {
                tracing::warn!(path = %path.display(), error = %e, "scarecrow: audit newline write failed — security trail line is unterminated");
            }
        }
        Err(e) => {
            tracing::warn!(path = %path.display(), error = %e, "scarecrow: cannot open audit file — host-effect went unaudited");
        }
    }
}

/// If the live audit file has grown past the rotate threshold, seal it: rename
/// it to `scarecrow-audit.<unix_secs>.ndjson` (preserving every line — tamper
/// evidence is never truncated) and let the next append create a fresh file.
/// Then prune sealed segments beyond the retention window. All best-effort: any
/// fs error leaves the log intact and just skips rotation this round.
async fn rotate_if_needed(path: &Path, config: AuditConfig) {
    let Ok(meta) = tokio::fs::metadata(path).await else {
        return; // no file yet — nothing to rotate.
    };
    if meta.len() < config.rotate_bytes {
        return;
    }
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // scarecrow-audit.ndjson -> scarecrow-audit.<secs>.ndjson
    let sealed = sealed_segment_path(path, secs);
    if let Err(e) = tokio::fs::rename(path, &sealed).await {
        tracing::warn!(path = %path.display(), error = %e, "scarecrow: audit rotate rename failed");
        return;
    }
    tracing::info!(sealed = %sealed.display(), "scarecrow: audit log rotated");
    prune_old_segments(path, config).await;
}

/// Build the sealed segment path for the live audit file at `secs`.
/// `.../scarecrow-audit.ndjson` -> `.../scarecrow-audit.<secs>.ndjson`.
fn sealed_segment_path(live: &Path, secs: u64) -> PathBuf {
    let dir = live.parent().unwrap_or_else(|| Path::new("."));
    dir.join(format!("scarecrow-audit.{secs}.ndjson"))
}

/// Remove sealed segments beyond the retention window (oldest first), keeping the
/// newest `config.max_segments`. Never touches the live file. Sealed segments
/// are recognised by the `scarecrow-audit.<digits>.ndjson` name pattern.
async fn prune_old_segments(live: &Path, config: AuditConfig) {
    let dir = live.parent().unwrap_or_else(|| Path::new("."));
    let Ok(mut entries) = tokio::fs::read_dir(dir).await else {
        return;
    };
    // Collect (secs, path) for every sealed segment.
    let mut segments: Vec<(u64, PathBuf)> = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let p = entry.path();
        if let Some(secs) = sealed_segment_secs(&p) {
            segments.push((secs, p));
        }
    }
    let max = config.max_segments;
    if segments.len() <= max {
        return;
    }
    // Oldest first; drop everything past the retention window.
    segments.sort_by_key(|(secs, _)| *secs);
    let to_prune = segments.len() - max;
    for (_, p) in segments.into_iter().take(to_prune) {
        if let Err(e) = tokio::fs::remove_file(&p).await {
            tracing::warn!(path = %p.display(), error = %e, "scarecrow: prune sealed segment failed");
        } else {
            tracing::debug!(path = %p.display(), "scarecrow: pruned old audit segment");
        }
    }
}

/// Parse the unix-secs stamp out of a `scarecrow-audit.<secs>.ndjson` filename,
/// or None if it isn't a sealed segment (e.g. the live file, or anything else).
fn sealed_segment_secs(path: &Path) -> Option<u64> {
    let name = path.file_name()?.to_str()?;
    let mid = name
        .strip_prefix("scarecrow-audit.")?
        .strip_suffix(".ndjson")?;
    // The live file strips to "" here (scarecrow-audit.ndjson); only digit runs
    // are sealed segments.
    if mid.is_empty() || !mid.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    mid.parse::<u64>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::TelemetryEvent;

    fn make_event(
        event: &str,
        plugin_id: Option<&str>,
        payload: serde_json::Value,
    ) -> TelemetryEvent {
        let mut e = TelemetryEvent::new(event, plugin_id.map(String::from));
        e = e.with_payload(payload);
        e
    }

    #[test]
    fn format_fs_read_event() {
        let ev = make_event(
            "host-effect:fs:read",
            Some("agent"),
            serde_json::json!({ "path": "/workspaces/refarm/README.md", "bytes": 1024 }),
        );
        let line = format_audit_line(&ev).expect("should format");
        let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid JSON");
        assert_eq!(parsed["event"], "host-effect:fs:read");
        assert_eq!(parsed["plugin_id"], "agent");
        assert_eq!(parsed["path"], "/workspaces/refarm/README.md");
        assert_eq!(parsed["bytes"], 1024);
        assert!(parsed["ts"].is_number());
    }

    #[test]
    fn format_shell_spawn_event() {
        let ev = make_event(
            "host-effect:shell:spawn",
            Some("agent"),
            serde_json::json!({
                "argv": ["refarm", "agent", "finish", "--lane", "after-edit", "--run", "--json"],
                "exit_code": 0,
                "duration_ms": 12340,
                "timed_out": false
            }),
        );
        let line = format_audit_line(&ev).expect("should format");
        let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid JSON");
        assert_eq!(parsed["event"], "host-effect:shell:spawn");
        assert_eq!(parsed["exit_code"], 0);
        assert_eq!(parsed["duration_ms"], 12340);
        assert_eq!(parsed["timed_out"], false);
        assert!(parsed["argv"].is_array());
    }

    #[test]
    fn event_without_payload_formats_cleanly() {
        let ev = TelemetryEvent::new("host-effect:fs:edit", Some("agent".into()));
        let line = format_audit_line(&ev).expect("should format");
        let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid JSON");
        assert_eq!(parsed["event"], "host-effect:fs:edit");
        assert_eq!(parsed["plugin_id"], "agent");
    }

    #[test]
    fn forward_sends_to_all_observer_channels() {
        use std::collections::HashMap;
        use std::sync::{Arc, RwLock};
        use tokio::sync::mpsc;

        let (tx1, mut rx1) = mpsc::unbounded_channel::<EventEnvelope>();
        let (tx2, mut rx2) = mpsc::unbounded_channel::<EventEnvelope>();
        let observer_channels: PluginChannels = Arc::new(RwLock::new({
            let mut m = HashMap::new();
            m.insert("@refarm/scarecrow".to_string(), tx1);
            m.insert("@refarm/scarecrow-strict".to_string(), tx2);
            m
        }));

        let ev = make_event(
            "host-effect:fs:write",
            Some("agent"),
            serde_json::json!({ "path": "/workspaces/refarm/src/main.ts", "bytes": 512 }),
        );
        let line = format_audit_line(&ev).unwrap();
        forward_to_observers(&ev, &line, &observer_channels);

        let msg1 = rx1.try_recv().expect("observer 1 should receive");
        let msg2 = rx2.try_recv().expect("observer 2 should receive");
        assert_eq!(msg1.event, "host-effect:fs:write");
        assert_eq!(msg2.event, "host-effect:fs:write");
        assert!(msg1.payload.unwrap().contains("512"));
    }

    #[test]
    fn agent_and_host_effect_observers_are_distinct_capabilities() {
        // The two observer opt-ins must not collapse into one — an audit observer
        // should not be force-fed agent chatter, and vice versa.
        assert_ne!(CAP_OBSERVE_HOST_EFFECTS, CAP_OBSERVE_AGENT_EVENTS);
        assert_eq!(CAP_OBSERVE_AGENT_EVENTS, "observe-agent-events");
    }

    #[test]
    fn an_agent_event_forwards_to_the_agent_observer_channel() {
        use std::collections::HashMap;
        use std::sync::{Arc, RwLock};
        use tokio::sync::mpsc;

        let (tx, mut rx) = mpsc::unbounded_channel::<EventEnvelope>();
        let agent_observers: PluginChannels = Arc::new(RwLock::new({
            let mut m = HashMap::new();
            m.insert("@refarm/run-tracer".to_string(), tx);
            m
        }));

        // A tool:call lifecycle event carries the run correlation + tool name.
        let ev = make_event(
            "agent:tool:call",
            Some("agent"),
            serde_json::json!({ "prompt_ref": "urn:sovereign:prompt-1", "tool": "read_file", "ok": true }),
        );
        let line = format_audit_line(&ev).unwrap();
        forward_to_observers(&ev, &line, &agent_observers);

        let msg = rx.try_recv().expect("agent-event observer should receive");
        assert_eq!(msg.event, "agent:tool:call");
        assert!(msg.payload.unwrap().contains("read_file"));
    }

    #[test]
    fn forward_to_empty_observer_channels_is_noop() {
        use std::collections::HashMap;
        use std::sync::{Arc, RwLock};

        let observer_channels: PluginChannels = Arc::new(RwLock::new(HashMap::new()));
        let ev = make_event("host-effect:fs:read", Some("agent"), serde_json::json!({}));
        let line = format_audit_line(&ev).unwrap();
        // Should not panic with no observers registered
        forward_to_observers(&ev, &line, &observer_channels);
    }

    // ── rotation ──────────────────────────────────────────────────────────────

    #[test]
    fn sealed_segment_secs_recognises_only_sealed_names() {
        // Sealed segments: scarecrow-audit.<digits>.ndjson.
        assert_eq!(
            sealed_segment_secs(Path::new("/x/scarecrow-audit.1700000000.ndjson")),
            Some(1_700_000_000)
        );
        // The LIVE file is never a sealed segment.
        assert_eq!(
            sealed_segment_secs(Path::new("/x/scarecrow-audit.ndjson")),
            None
        );
        // Non-digit or unrelated names are ignored.
        assert_eq!(
            sealed_segment_secs(Path::new("/x/scarecrow-audit.abc.ndjson")),
            None
        );
        assert_eq!(sealed_segment_secs(Path::new("/x/other.ndjson")), None);
    }

    #[tokio::test]
    async fn rotate_seals_the_full_file_and_starts_fresh() {
        let dir = std::env::temp_dir().join(format!("audit-rot-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let live = dir.join(AUDIT_FILE);

        // Tiny threshold so a couple of lines trip rotation — injected via config,
        // no process env (which leaks across threads under --test-threads>1).
        let config = AuditConfig {
            rotate_bytes: 20,
            ..AuditConfig::default()
        };

        // Write enough to exceed 20 bytes, then one more append triggers rotation.
        append_line(&live, "first-audit-line-well-over-twenty-bytes", config).await;
        let before: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
            .collect();
        // Next append sees the oversized live file and seals it first.
        append_line(&live, "second-line", config).await;

        let names: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
            .collect();
        // A sealed segment now exists (scarecrow-audit.<secs>.ndjson)...
        assert!(
            names.iter().any(|n| n.starts_with("scarecrow-audit.")
                && n.ends_with(".ndjson")
                && *n != AUDIT_FILE),
            "rotation must produce a sealed segment: {names:?} (before: {before:?})"
        );
        // ...and a fresh live file holds only the post-rotation line.
        let live_content = std::fs::read_to_string(&live).unwrap();
        assert!(
            live_content.contains("second-line") && !live_content.contains("first-audit-line"),
            "the fresh live file holds only post-rotation lines: {live_content:?}"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn prune_keeps_newest_segments_only() {
        let dir = std::env::temp_dir().join(format!("audit-prune-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let live = dir.join(AUDIT_FILE);
        // Small retention window — injected via config, no process env.
        let config = AuditConfig {
            max_segments: 2,
            ..AuditConfig::default()
        };

        // Seal three segments with increasing stamps + keep the live file present.
        for secs in [100u64, 200, 300] {
            tokio::fs::write(dir.join(format!("scarecrow-audit.{secs}.ndjson")), "x")
                .await
                .unwrap();
        }
        tokio::fs::write(&live, "live").await.unwrap();

        prune_old_segments(&live, config).await;

        // The oldest (100) is pruned; the 2 newest (200, 300) and the live file stay.
        assert!(
            !dir.join("scarecrow-audit.100.ndjson").exists(),
            "oldest pruned"
        );
        assert!(
            dir.join("scarecrow-audit.200.ndjson").exists(),
            "newest kept"
        );
        assert!(
            dir.join("scarecrow-audit.300.ndjson").exists(),
            "newest kept"
        );
        assert!(live.exists(), "the live file is never pruned");
        std::fs::remove_dir_all(&dir).ok();
    }
}
