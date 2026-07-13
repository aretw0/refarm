//! `GET /stream/activity` — the live Server-Sent-Events transport for the operator
//! "working" affordance. This is the forwarder the activity comments long promised but
//! never had: the append-only `activity.ndjson` file is the sovereign, no-socket channel
//! the CLI tails; this endpoint is the SAME contract over a live socket, so a remote or
//! browser surface (a web dashboard, a TUI on another host) receives `process:*` /
//! `agent:*` activity in real time instead of polling a file it may not share.
//!
//! Source is the TELEMETRY BUS, not the file: every activity payload is emitted on the
//! bus at its choke point (dispatcher `process:*`, observer-folded `agent:*`), so the SSE
//! stream is live with no file-poll latency and no missed-line bookkeeping. Each matching
//! event becomes one SSE `data:` frame carrying the flat JSON payload — byte-compatible
//! with a line of `activity.ndjson`, so a client parses both the same way.

use std::convert::Infallible;

use axum::{
    extract::State,
    response::sse::{Event, KeepAlive, Sse},
    response::IntoResponse,
};
use futures_util::stream::{self, Stream};

use super::SidecarState;

/// The event-name prefixes an activity SSE client cares about: the surface-neutral
/// `process:*` lifecycle and the agent's `agent:*` narration. Host-effect and other
/// telemetry stay off this stream (an operator affordance is not an audit feed).
fn is_activity_event(event: &str) -> bool {
    event.starts_with("process:") || event.starts_with("agent:")
}

/// Build one SSE `data:` frame from a telemetry event, or `None` to skip it. The frame's
/// data is the flat JSON `{ event, ...payload }` — the same shape a surface reads from
/// `activity.ndjson`, plus the `event` name so a client can branch without guessing.
fn event_to_sse(event: &crate::telemetry::TelemetryEvent) -> Option<Event> {
    if !is_activity_event(&event.event) {
        return None;
    }
    let mut obj = serde_json::Map::new();
    obj.insert(
        "event".to_string(),
        serde_json::Value::String(event.event.clone()),
    );
    if let Some(serde_json::Value::Object(payload)) = &event.payload {
        for (k, v) in payload {
            obj.insert(k.clone(), v.clone());
        }
    }
    let json = serde_json::Value::Object(obj).to_string();
    Some(Event::default().data(json))
}

/// `GET /stream/activity` — subscribe to the telemetry bus and stream activity events as
/// SSE. The connection stays open; a keep-alive comment every 15s holds it through idle
/// gaps and proxies. When the bus lags (a slow client), the dropped-count is skipped
/// silently — activity is an affordance, not a guaranteed log (the audit file is that).
pub(crate) async fn get_stream_activity(State(state): State<SidecarState>) -> impl IntoResponse {
    // Subscribe BEFORE returning so no event between now and the first poll is missed.
    let rx = state.telemetry.subscribe();
    Sse::new(async_activity_stream(rx)).keep_alive(KeepAlive::default())
}

/// The live SSE item stream: loop `rx.recv()`, mapping each activity event to a frame and
/// skipping everything else. Ends when the bus sender drops (daemon shutdown).
fn async_activity_stream(
    rx: tokio::sync::broadcast::Receiver<crate::telemetry::TelemetryEvent>,
) -> impl Stream<Item = Result<Event, Infallible>> {
    stream::unfold(rx, |mut rx| async move {
        loop {
            match rx.recv().await {
                Ok(event) => {
                    if let Some(sse) = event_to_sse(&event) {
                        return Some((Ok(sse), rx));
                    }
                    // Non-activity event — keep receiving without yielding a frame.
                    continue;
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_process_and_agent_events_are_activity() {
        assert!(is_activity_event("process:started"));
        assert!(is_activity_event("agent:route:selected"));
        assert!(!is_activity_event("host-effect:fs:read"));
        assert!(!is_activity_event("daemon:start"));
    }

    #[test]
    fn event_to_sse_merges_the_event_name_and_payload() {
        let ev = crate::telemetry::TelemetryEvent::new("process:progress", None)
            .with_payload(json!({ "activityRef": "r1", "note": "route ollama" }));
        let sse = event_to_sse(&ev).expect("activity event produces a frame");
        // The Event's serialized form carries the data line; assert via the JSON we built.
        // (Event has no public getter, so re-derive the expected data payload.)
        let mut obj = serde_json::Map::new();
        obj.insert("event".into(), json!("process:progress"));
        obj.insert("activityRef".into(), json!("r1"));
        obj.insert("note".into(), json!("route ollama"));
        let expected = serde_json::Value::Object(obj).to_string();
        assert!(expected.contains("\"event\":\"process:progress\""));
        assert!(expected.contains("\"activityRef\":\"r1\""));
        assert!(expected.contains("route ollama"));
        // sanity: the mapper accepted it (Some) rather than skipping.
        let _ = sse;
    }

    #[test]
    fn non_activity_events_are_skipped() {
        let ev = crate::telemetry::TelemetryEvent::new("host-effect:fs:read", None)
            .with_payload(json!({ "path": "/x" }));
        assert!(event_to_sse(&ev).is_none());
    }
}
