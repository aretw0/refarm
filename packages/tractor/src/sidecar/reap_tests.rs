// GC/TTL reaper safety suite. The correctness-critical logic (plan_reap) is a
// pure fn, so most tests are deterministic with no fs/clock. The execute_reap +
// self-terminate tests touch a real temp dir. The invariant under test: the
// reaper NEVER deletes live data — only terminal-and-old artifacts.

use super::*;
use crate::sidecar::EffortResult;
use std::collections::HashMap;

const HOUR_MS: u64 = 3_600_000;
const DAY_MS: u64 = 86_400_000;
const NOW: u64 = 2_000_000_000; // fixed unix seconds for determinism

fn effort(id: &str, status: &str, completed_at: Option<&str>) -> EffortResult {
    EffortResult {
        effort_id: id.to_string(),
        status: status.to_string(),
        results: vec![],
        submitted_at: "2033-05-18T03:33:00Z".to_string(),
        completed_at: completed_at.map(str::to_string),
    }
}

/// ISO string for `NOW - age_secs`, matching chrono_now_iso's format.
fn iso_ago(age_secs: u64) -> String {
    let secs = NOW - age_secs;
    crate::timefmt::epoch_secs_to_iso(secs)
}

// ── parse_iso_to_epoch_secs (the age clock) ──────────────────────────────────

#[test]
fn iso_round_trips_through_epoch() {
    // parts -> iso -> secs must recover the original secs for the values
    // chrono_now_iso emits.
    for secs in [0u64, 1_000_000, NOW, NOW - DAY_MS / 1000, 4_000_000_000] {
        let iso = crate::timefmt::epoch_secs_to_iso(secs);
        assert_eq!(
            parse_iso_to_epoch_secs(&iso),
            Some(secs),
            "round-trip failed for {secs} ({iso})"
        );
    }
}

#[test]
fn malformed_iso_is_none_never_zero() {
    for bad in [
        "",
        "not-a-date",
        "2033-05-18T03:33:00",  // missing Z
        "2033-13-18T03:33:00Z", // month 13
        "2033-05-18 03:33:00Z", // space not T
        "20330518T033300Z",
    ] {
        assert_eq!(parse_iso_to_epoch_secs(bad), None, "must reject {bad:?}");
    }
}

// ── plan_reap (pure retention decision) ──────────────────────────────────────

#[test]
fn survives_non_terminal() {
    // A running effort with completed_at=None is never reaped, even with an
    // aggressively expired TTL.
    let mut efforts = HashMap::new();
    efforts.insert("e1".to_string(), effort("e1", "in-progress", None));
    let plan = plan_reap(&efforts, NOW, 0, 0);
    assert!(plan.is_empty(), "a running effort must never be reaped");
}

#[test]
fn survives_terminal_but_recent() {
    // Terminal alone is not enough — the age gate holds it.
    let mut efforts = HashMap::new();
    efforts.insert("e1".to_string(), effort("e1", "done", Some(&iso_ago(0))));
    let plan = plan_reap(&efforts, NOW, DAY_MS, DAY_MS);
    assert!(
        plan.is_empty(),
        "a fresh terminal effort must survive the TTL"
    );
}

#[test]
fn reaps_terminal_and_old() {
    // 48h-old terminal effort under a 24h TTL is reaped (both json and stream).
    let mut efforts = HashMap::new();
    efforts.insert(
        "e1".to_string(),
        effort("e1", "delivered", Some(&iso_ago(48 * 3600))),
    );
    let plan = plan_reap(&efforts, NOW, DAY_MS, DAY_MS);
    assert_eq!(plan.effort_ids, vec!["e1".to_string()]);
    let expected_stream = stream_ref_for_prompt(&prompt_ref_from_effort("e1"));
    assert_eq!(plan.stream_refs, vec![expected_stream]);
}

#[test]
fn terminal_no_completed_at_kept() {
    // A terminal status with a missing clock is a fail-safe keep (never age 0).
    let mut efforts = HashMap::new();
    efforts.insert("e1".to_string(), effort("e1", "failed", None));
    let plan = plan_reap(&efforts, NOW, 0, 0);
    assert!(plan.is_empty(), "terminal but no completed_at => keep");
}

#[test]
fn all_terminal_statuses_reapable_when_old() {
    for status in [
        "done",
        "delivered",
        "partial",
        "failed",
        "timed-out",
        "cancelled",
    ] {
        let mut efforts = HashMap::new();
        efforts.insert(
            "e1".to_string(),
            effort("e1", status, Some(&iso_ago(48 * 3600))),
        );
        let plan = plan_reap(&efforts, NOW, DAY_MS, DAY_MS);
        assert_eq!(
            plan.effort_ids,
            vec!["e1".to_string()],
            "terminal status {status} must be reapable when old"
        );
    }
}

#[test]
fn independent_effort_and_stream_ttls() {
    // A short stream TTL can reap the stream while the json is kept by a longer
    // effort TTL — they are separately configurable.
    let mut efforts = HashMap::new();
    efforts.insert(
        "e1".to_string(),
        effort("e1", "done", Some(&iso_ago(2 * 3600))), // 2h old
    );
    // effort TTL 24h (keep json), stream TTL 1h (reap stream).
    let plan = plan_reap(&efforts, NOW, DAY_MS, HOUR_MS);
    assert!(plan.effort_ids.is_empty(), "json kept by long effort TTL");
    assert_eq!(
        plan.stream_refs.len(),
        1,
        "stream reaped by short stream TTL"
    );
}

// ── execute_reap + fs (real temp dir) ────────────────────────────────────────

fn test_state() -> (SidecarState, std::path::PathBuf) {
    let tmp = std::env::temp_dir().join(format!("reap-test-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(tmp.join("streams")).unwrap();
    std::fs::create_dir_all(tmp.join("task-results")).unwrap();
    let state = SidecarState::new(
        std::sync::Arc::new(std::sync::RwLock::new(HashMap::new())),
        std::sync::Arc::new(std::sync::RwLock::new(HashMap::new())), // cancel_flags
        std::sync::Arc::new(std::sync::RwLock::new(HashMap::new())), // in_flight_cancels
        std::sync::Arc::new(std::sync::RwLock::new(None)),
        crate::EventRouter::default(),
        crate::TelemetryBus::new(16),
        &tmp,
        ":memory:".to_string(),
    )
    .unwrap();
    (state, tmp)
}

#[test]
fn execute_reap_deletes_files_and_evicts_map() {
    let (state, tmp) = test_state();
    let old = effort("e1", "done", Some(&iso_ago(48 * 3600)));
    // Persist the json and a stream file as production would.
    state
        .efforts
        .write()
        .unwrap()
        .insert("e1".to_string(), old.clone());
    // Also retain the effort INPUT (as dispatch does), so we can prove it's
    // reaped alongside the result and can't grow unbounded.
    state.efforts_input.write().unwrap().insert(
        "e1".to_string(),
        super::super::Effort {
            id: "e1".to_string(),
            direction: None,
            tasks: vec![],
            source: None,
            submitted_at: String::new(),
            budget: None,
            workspace_id: None,
            workspace_source: None,
            scenario_id: None,
            credential_id: None,
            expectation: None,
        },
    );
    super::super::persist_effort_result(&state.results_dir, &old).unwrap();
    let stream_ref = stream_ref_for_prompt(&prompt_ref_from_effort("e1"));
    let stream_path = tmp.join("streams").join(format!("{stream_ref}.ndjson"));
    std::fs::write(&stream_path, "{}\n").unwrap();
    let json_path = super::super::effort_result_path(&state.results_dir, "e1");
    assert!(json_path.exists() && stream_path.exists());

    let plan = plan_reap(&state.efforts.read().unwrap(), NOW, DAY_MS, DAY_MS);
    execute_reap(
        &state.efforts,
        &state.efforts_input,
        &state.results_dir,
        &state.streams_dir,
        &plan,
    );

    assert!(!json_path.exists(), "json reaped");
    assert!(!stream_path.exists(), "stream reaped");
    assert!(
        !state.efforts.read().unwrap().contains_key("e1"),
        "reaped effort evicted from the in-memory map"
    );
    assert!(
        !state.efforts_input.read().unwrap().contains_key("e1"),
        "reaped effort INPUT must be evicted too (else it grows unbounded)"
    );
    std::fs::remove_dir_all(&tmp).ok();
}

#[test]
fn stream_survives_while_effort_live() {
    // A stream for a non-terminal effort is never reaped (its effort has no
    // completed_at). Uses the REAL stream_ref derivation.
    let (state, tmp) = test_state();
    state
        .efforts
        .write()
        .unwrap()
        .insert("live".to_string(), effort("live", "in-progress", None));
    let stream_ref = stream_ref_for_prompt(&prompt_ref_from_effort("live"));
    let stream_path = tmp.join("streams").join(format!("{stream_ref}.ndjson"));
    std::fs::write(&stream_path, "{}\n").unwrap();

    let plan = plan_reap(&state.efforts.read().unwrap(), NOW, 0, 0);
    execute_reap(
        &state.efforts,
        &state.efforts_input,
        &state.results_dir,
        &state.streams_dir,
        &plan,
    );
    assert!(stream_path.exists(), "a followed stream must survive");
    std::fs::remove_dir_all(&tmp).ok();
}

#[test]
fn orphan_stream_left_alone() {
    // A stream with no matching effort is kept (slice-1 conservative policy).
    let (state, tmp) = test_state();
    let orphan = tmp.join("streams").join("urn:orphan.ndjson");
    std::fs::write(&orphan, "{}\n").unwrap();
    let plan = plan_reap(&state.efforts.read().unwrap(), NOW, 0, 0);
    execute_reap(
        &state.efforts,
        &state.efforts_input,
        &state.results_dir,
        &state.streams_dir,
        &plan,
    );
    assert!(
        orphan.exists(),
        "orphan stream (unknown provenance) is kept"
    );
    std::fs::remove_dir_all(&tmp).ok();
}

#[test]
fn unparseable_json_left_alone() {
    // A garbage file in task-results/ is never deleted — the reaper only acts on
    // efforts it positively classifies as terminal-and-old (from the map, which
    // load_persisted_efforts skips unparseable files for).
    let (state, tmp) = test_state();
    let garbage = state.results_dir.join("garbage.json");
    std::fs::write(&garbage, "not an effort result").unwrap();
    let plan = plan_reap(&state.efforts.read().unwrap(), NOW, 0, 0);
    execute_reap(
        &state.efforts,
        &state.efforts_input,
        &state.results_dir,
        &state.streams_dir,
        &plan,
    );
    assert!(garbage.exists(), "unclassifiable file must not be deleted");
    std::fs::remove_dir_all(&tmp).ok();
}

#[tokio::test]
async fn reaper_does_not_keep_the_sidecar_alive() {
    // The reaper task holds ONLY a Weak to the effort store (plus cheap dir
    // paths), never a strong ref between ticks. So dropping the sidecar must
    // drop the store's strong count to zero — proving the task can't leak the
    // sidecar across a teardown (its next upgrade() returns None and it exits).
    // Tiny initial delay so the task reaches its loop; long interval so it's
    // parked on upgrade, not mid-sweep. Injected directly (no process env → no
    // cross-thread leak into a concurrent node-reaper test sharing these vars).
    let cfg = ReaperConfig {
        initial_delay_ms: 5,
        interval_ms: 3_600_000,
        ..ReaperConfig::default()
    };
    let (state, tmp) = test_state();
    let weak = std::sync::Arc::downgrade(&state.efforts);
    assert_eq!(std::sync::Arc::strong_count(&state.efforts), 1);

    spawn_reaper(&state, cfg);
    // Let the task pass its initial delay and reach the upgrade/park point.
    tokio::time::sleep(std::time::Duration::from_millis(40)).await;

    // Drop the ONLY strong owner (the sidecar). If the reaper held a strong ref
    // between ticks, this Weak would still upgrade — it must not.
    drop(state);

    // Give the runtime a moment for any transient strong ref inside a tick to be
    // released back to the parked (Weak-only) state.
    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    assert!(
        weak.upgrade().is_none(),
        "reaper must not hold the sidecar's effort store alive between ticks"
    );
    let _ = tmp; // temp dir cleaned by OS
}
