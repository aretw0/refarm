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
use crate::{PluginChannels, EventEnvelope};

pub use crate::capabilities::CAP_OBSERVE_HOST_EFFECTS;

pub const AUDIT_FILE: &str = "scarecrow-audit.ndjson";
const HOST_EFFECT_PREFIX: &str = "host-effect:";

/// Rotate the live audit file once it exceeds this many bytes. The audit log is
/// tamper-evidence, so rotation RENAMES the full file to a sealed timestamped
/// segment (never truncates or deletes recent lines) and starts a fresh live
/// file. Overridable via REFARM_AUDIT_ROTATE_BYTES; default 8 MiB.
fn audit_rotate_bytes() -> u64 {
    std::env::var("REFARM_AUDIT_ROTATE_BYTES")
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(8 * 1024 * 1024)
}

/// Keep at most this many sealed segments; older ones are pruned. Retention, not
/// deletion of live data — only fully-sealed old segments are removed, and only
/// beyond the window. Overridable via REFARM_AUDIT_MAX_SEGMENTS; default 16.
fn audit_max_segments() -> usize {
    std::env::var("REFARM_AUDIT_MAX_SEGMENTS")
        .ok()
        .and_then(|raw| raw.parse::<usize>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(16)
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
) {
    tokio::spawn(audit_subscriber_task(
        telemetry,
        base_dir,
        observer_channels,
    ));
}

async fn audit_subscriber_task(
    telemetry: TelemetryBus,
    base_dir: PathBuf,
    observer_channels: PluginChannels,
) {
    let audit_path = base_dir.join(AUDIT_FILE);
    let mut rx = telemetry.subscribe();
    loop {
        match rx.recv().await {
            Ok(event) => {
                if !event.event.starts_with(HOST_EFFECT_PREFIX) {
                    continue;
                }
                if let Some(line) = format_audit_line(&event) {
                    append_line(&audit_path, &line).await;
                    forward_to_observers(&event, &line, &observer_channels);
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
        let _ = tx.send(EventEnvelope {
            event: event.event.clone(),
            payload: Some(json_payload.to_owned()),
        });
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

async fn append_line(path: &Path, line: &str) {
    // Rotate BEFORE appending so a sealed segment never grows past the threshold.
    rotate_if_needed(path).await;
    match OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await
    {
        Ok(mut file) => {
            let _ = file.write_all(line.as_bytes()).await;
            let _ = file.write_all(b"\n").await;
        }
        Err(e) => {
            tracing::debug!(path = %path.display(), error = %e, "scarecrow: cannot open audit file");
        }
    }
}

/// If the live audit file has grown past the rotate threshold, seal it: rename
/// it to `scarecrow-audit.<unix_secs>.ndjson` (preserving every line — tamper
/// evidence is never truncated) and let the next append create a fresh file.
/// Then prune sealed segments beyond the retention window. All best-effort: any
/// fs error leaves the log intact and just skips rotation this round.
async fn rotate_if_needed(path: &Path) {
    let Ok(meta) = tokio::fs::metadata(path).await else {
        return; // no file yet — nothing to rotate.
    };
    if meta.len() < audit_rotate_bytes() {
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
    prune_old_segments(path).await;
}

/// Build the sealed segment path for the live audit file at `secs`.
/// `.../scarecrow-audit.ndjson` -> `.../scarecrow-audit.<secs>.ndjson`.
fn sealed_segment_path(live: &Path, secs: u64) -> PathBuf {
    let dir = live.parent().unwrap_or_else(|| Path::new("."));
    dir.join(format!("scarecrow-audit.{secs}.ndjson"))
}

/// Remove sealed segments beyond the retention window (oldest first), keeping the
/// newest `audit_max_segments()`. Never touches the live file. Sealed segments
/// are recognised by the `scarecrow-audit.<digits>.ndjson` name pattern.
async fn prune_old_segments(live: &Path) {
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
    let max = audit_max_segments();
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
    fn forward_to_empty_observer_channels_is_noop() {
        use std::collections::HashMap;
        use std::sync::{Arc, RwLock};

        let observer_channels: PluginChannels = Arc::new(RwLock::new(HashMap::new()));
        let ev = make_event(
            "host-effect:fs:read",
            Some("agent"),
            serde_json::json!({}),
        );
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
        assert_eq!(sealed_segment_secs(Path::new("/x/scarecrow-audit.ndjson")), None);
        // Non-digit or unrelated names are ignored.
        assert_eq!(sealed_segment_secs(Path::new("/x/scarecrow-audit.abc.ndjson")), None);
        assert_eq!(sealed_segment_secs(Path::new("/x/other.ndjson")), None);
    }

    #[tokio::test]
    async fn rotate_seals_the_full_file_and_starts_fresh() {
        let dir = std::env::temp_dir().join(format!("audit-rot-{}", uuid::Uuid::new_v4()));
        tokio::fs::create_dir_all(&dir).await.unwrap();
        let live = dir.join(AUDIT_FILE);

        // Tiny threshold so a couple of lines trip rotation.
        std::env::set_var("REFARM_AUDIT_ROTATE_BYTES", "20");

        // Write enough to exceed 20 bytes, then one more append triggers rotation.
        append_line(&live, "first-audit-line-well-over-twenty-bytes").await;
        let before: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
            .collect();
        // Next append sees the oversized live file and seals it first.
        append_line(&live, "second-line").await;

        std::env::remove_var("REFARM_AUDIT_ROTATE_BYTES");

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
        std::env::set_var("REFARM_AUDIT_MAX_SEGMENTS", "2");

        // Seal three segments with increasing stamps + keep the live file present.
        for secs in [100u64, 200, 300] {
            tokio::fs::write(dir.join(format!("scarecrow-audit.{secs}.ndjson")), "x")
                .await
                .unwrap();
        }
        tokio::fs::write(&live, "live").await.unwrap();

        prune_old_segments(&live).await;
        std::env::remove_var("REFARM_AUDIT_MAX_SEGMENTS");

        // The oldest (100) is pruned; the 2 newest (200, 300) and the live file stay.
        assert!(!dir.join("scarecrow-audit.100.ndjson").exists(), "oldest pruned");
        assert!(dir.join("scarecrow-audit.200.ndjson").exists(), "newest kept");
        assert!(dir.join("scarecrow-audit.300.ndjson").exists(), "newest kept");
        assert!(live.exists(), "the live file is never pruned");
        std::fs::remove_dir_all(&dir).ok();
    }
}
