//! Process ACTIVITY telemetry — the runtime half of the surface-neutral "working"
//! signal, mirroring the TS `ProcessActivity` shape (packages/capabilities/src/activity.ts).
//!
//! The substrate already knows exactly when work begins and ends (an effort goes
//! in-progress, then terminal), but it only exposed that as a poll snapshot — a surface
//! staring at a running agent turn or a 45s dispatch saw nothing. Emitting a `process:*`
//! telemetry event at those choke points lets a daemon→surface bridge forward it to the
//! operator's `ActivitySink`, so remote work (an agent turn in the runtime) lights up the
//! CLI/TUI/web exactly like local work (a login wrapped in `withActivity`) — the renderer
//! never knows the origin.
//!
//! These are payload SHAPERS + the event names, matching the TS contract field-for-field
//! (`activityRef`, `phase`, `label`, `kind`, `note?`, `fraction?`, `ok?`) so a bridge can
//! deserialize a `process:*` telemetry event straight into a `ProcessActivity`. Emitting
//! is a thin `TelemetryBus::emit` over these — same pattern as agent_events.rs.

/// The three lifecycle event names — `process:<phase>`, parallel to the TS
/// `ProcessActivity.phase`. `started`/`finished` are the core every process emits;
/// `progress` is optional.
pub(crate) const EVENT_PROCESS_STARTED: &str = "process:started";
/// The `progress` phase mirrors the TS contract but is not emitted at the dispatch
/// choke points yet — it is the reserved seam for bridging the agent's per-step
/// lifecycle (`agent:iteration` / `agent:tool:call`) into progress ticks. Kept so the RS
/// contract stays field-complete with the TS `ProcessActivity`.
#[allow(dead_code)]
pub(crate) const EVENT_PROCESS_PROGRESS: &str = "process:progress";
pub(crate) const EVENT_PROCESS_FINISHED: &str = "process:finished";

/// `process:started` — a unit of work began. `activity_ref` correlates all events of this
/// unit (a surface tracks concurrent activities by it); `label` is what the operator
/// reads; `kind` is the open work vocabulary. PURE.
pub(crate) fn started_payload(activity_ref: &str, label: &str, kind: &str) -> serde_json::Value {
    serde_json::json!({
        "activityRef": activity_ref,
        "phase": "started",
        "label": label,
        "kind": kind,
    })
}

/// `process:progress` — an OPTIONAL step tick. `note` is a short current-step string;
/// `fraction` is 0..1 completion when the process can estimate it (omitted otherwise).
/// PURE. Reserved for the agent-lifecycle bridge (see `EVENT_PROCESS_PROGRESS`); tested
/// now so the shape is pinned against the TS contract before a caller exists.
#[allow(dead_code)]
pub(crate) fn progress_payload(
    activity_ref: &str,
    label: &str,
    kind: &str,
    note: Option<&str>,
    fraction: Option<f64>,
) -> serde_json::Value {
    let mut value = serde_json::json!({
        "activityRef": activity_ref,
        "phase": "progress",
        "label": label,
        "kind": kind,
    });
    if let Some(note) = note {
        value["note"] = serde_json::json!(note);
    }
    if let Some(fraction) = fraction {
        value["fraction"] = serde_json::json!(fraction);
    }
    value
}

/// `process:finished` — the work ended; `ok` is whether it succeeded. A surface stops its
/// "working" affordance on this. PURE.
pub(crate) fn finished_payload(
    activity_ref: &str,
    label: &str,
    kind: &str,
    ok: bool,
) -> serde_json::Value {
    serde_json::json!({
        "activityRef": activity_ref,
        "phase": "finished",
        "label": label,
        "kind": kind,
        "ok": ok,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::{TelemetryBus, TelemetryEvent};

    #[test]
    fn started_payload_matches_the_ts_contract_fields() {
        let p = started_payload("a-1", "Agent responding", "agent");
        assert_eq!(p["activityRef"], "a-1");
        assert_eq!(p["phase"], "started");
        assert_eq!(p["label"], "Agent responding");
        assert_eq!(p["kind"], "agent");
    }

    #[test]
    fn progress_payload_omits_absent_note_and_fraction() {
        let bare = progress_payload("a", "L", "k", None, None);
        assert_eq!(bare["phase"], "progress");
        assert!(bare.get("note").is_none());
        assert!(bare.get("fraction").is_none());

        let full = progress_payload("a", "L", "k", Some("step 2"), Some(0.5));
        assert_eq!(full["note"], "step 2");
        assert_eq!(full["fraction"], 0.5);
    }

    #[test]
    fn finished_payload_carries_ok() {
        assert_eq!(finished_payload("a", "L", "k", true)["ok"], true);
        assert_eq!(finished_payload("a", "L", "k", false)["ok"], false);
    }

    #[tokio::test]
    async fn shaped_payloads_reach_a_bus_subscriber() {
        // The dispatch site publishes these shaped payloads over the bus (and the file);
        // prove the shape survives a bus round-trip so a forwarder/subscriber reads it back.
        let bus = TelemetryBus::new(16);
        let mut rx = bus.subscribe();

        bus.emit(
            TelemetryEvent::new(EVENT_PROCESS_STARTED, None)
                .with_payload(started_payload("eff-1", "Dispatching to agent", "dispatch")),
        );
        bus.emit(
            TelemetryEvent::new(EVENT_PROCESS_FINISHED, None)
                .with_payload(finished_payload("eff-1", "", "dispatch", true)),
        );

        let started = rx.recv().await.unwrap();
        assert_eq!(started.event, "process:started");
        assert_eq!(started.payload.unwrap()["activityRef"], "eff-1");
        let finished = rx.recv().await.unwrap();
        assert_eq!(finished.event, "process:finished");
        assert_eq!(finished.payload.unwrap()["ok"], true);
    }
}
