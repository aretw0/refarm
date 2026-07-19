//! GC/TTL reaper for the sidecar's filesystem artifacts.
//!
//! The sidecar writes two kinds of per-effort file that otherwise grow without
//! bound across the daemon's lifetime:
//!   - task-results/{effort_id}.json  — one durable EffortResult per effort
//!   - streams/{stream_ref}.ndjson    — the respond stream for an effort
//!
//! After boot, `state.efforts` (the in-memory HashMap) is the source of truth;
//! the JSON exists only for cross-restart durability. So a terminal effort's
//! artifacts can be reclaimed once the effort is provably done AND old.
//!
//! The retention decision lives in `plan_reap`, which is a PURE function of
//! (efforts map, now, TTLs) — no fs, clock, or env — so every safety guarantee
//! is a deterministic unit test. `execute_reap` performs the fs deletes; the
//! background task in `spawn_reaper` mirrors the epoch ticker's self-terminating
//! Weak pattern so it never leaks across a host teardown.
//!
//! Slice 1 scope: sidecar fs artifacts ONLY. The graph `nodes` table (the far
//! larger streaming-node leak) needs a sqlite DELETE path plus consumer-read
//! coordination, and the audit log needs rotation not deletion — both deferred.

use std::collections::HashMap;
use std::sync::Weak;
use std::time::Duration;

use super::{
    is_terminal_effort_status, prompt_ref_from_effort, stream_ref_for_prompt, EffortInputStore,
    EffortResult, EffortStore, SidecarState,
};

/// Default retention for a terminal effort's artifacts (24h). A terminal effort
/// is already in the in-memory map, so the file is pure cross-restart
/// durability — a generous TTL is safe.
const DEFAULT_EFFORT_TTL_MS: u64 = 86_400_000;
/// Default retention for a stream ndjson (24h). A stream is a child of its
/// effort; there's no reason for it to outlive the effort's retention.
const DEFAULT_STREAM_TTL_MS: u64 = 86_400_000;
/// Default reap sweep interval (1h). Reaping is housekeeping, not latency
/// sensitive — a coarse interval keeps IO negligible while the TTL dominates
/// what actually gets deleted.
const DEFAULT_INTERVAL_MS: u64 = 3_600_000;
/// Delay before the first sweep so boot isn't taxed. Overridable (tests use a
/// tiny value to exercise the loop without waiting a minute).
const DEFAULT_INITIAL_DELAY_MS: u64 = 60_000;

fn env_ms(var: &str, default: u64) -> u64 {
    std::env::var(var)
        .ok()
        .and_then(|raw| raw.parse::<u64>().ok())
        .filter(|ms| *ms > 0)
        .unwrap_or(default)
}

/// Retention/cadence knobs for the fs artifact reaper. Resolved from env ONCE at
/// boot (`ReaperConfig::from_env`) and passed into `spawn_reaper`, so the reaper
/// reads a value, not process env — and tests construct it directly instead of
/// mutating the shared env (which leaks across threads under `--test-threads>1`;
/// the interval/delay vars are also read by the node reaper, so a set_var here
/// could bleed into a concurrent node-reaper test).
#[derive(Debug, Clone, Copy)]
pub(crate) struct ReaperConfig {
    pub effort_ttl_ms: u64,
    pub stream_ttl_ms: u64,
    pub interval_ms: u64,
    pub initial_delay_ms: u64,
}

impl Default for ReaperConfig {
    fn default() -> Self {
        Self {
            effort_ttl_ms: DEFAULT_EFFORT_TTL_MS,
            stream_ttl_ms: DEFAULT_STREAM_TTL_MS,
            interval_ms: DEFAULT_INTERVAL_MS,
            initial_delay_ms: DEFAULT_INITIAL_DELAY_MS,
        }
    }
}

impl ReaperConfig {
    /// Resolve the reaper knobs from the process env. Called ONCE at boot; the
    /// resolved config then rides into `spawn_reaper`.
    pub(crate) fn from_env() -> Self {
        Self {
            effort_ttl_ms: env_ms("REFARM_EFFORT_TTL_MS", DEFAULT_EFFORT_TTL_MS),
            stream_ttl_ms: env_ms("REFARM_STREAM_TTL_MS", DEFAULT_STREAM_TTL_MS),
            interval_ms: env_ms("REFARM_REAP_INTERVAL_MS", DEFAULT_INTERVAL_MS),
            initial_delay_ms: env_ms("REFARM_REAP_INITIAL_DELAY_MS", DEFAULT_INITIAL_DELAY_MS),
        }
    }
}

/// What a single sweep decided to delete. Both lists are effort/stream files
/// that are provably terminal-and-old; nothing else is ever included.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct ReapPlan {
    /// effort_ids whose task-results/{id}.json is reapable (also evicted from
    /// the in-memory map).
    pub(crate) effort_ids: Vec<String>,
    /// stream_refs whose streams/{stream_ref}.ndjson is reapable.
    pub(crate) stream_refs: Vec<String>,
}

impl ReapPlan {
    pub(crate) fn is_empty(&self) -> bool {
        self.effort_ids.is_empty() && self.stream_refs.is_empty()
    }
}

/// PURE retention decision. An effort's artifacts are reapable iff the effort is
/// terminal AND its `completed_at` is older than the TTL. Non-terminal efforts
/// (completed_at == None) are never reaped — the joint check is fail-safe: a
/// missing or unparseable timestamp means "keep", never "age 0".
///
/// `now_secs` is unix seconds; TTLs are milliseconds (env-facing unit).
pub(crate) fn plan_reap(
    efforts: &HashMap<String, EffortResult>,
    now_secs: u64,
    effort_ttl_ms: u64,
    stream_ttl_ms: u64,
) -> ReapPlan {
    let mut plan = ReapPlan::default();
    let effort_ttl_secs = effort_ttl_ms / 1000;
    let stream_ttl_secs = stream_ttl_ms / 1000;

    for (id, result) in efforts {
        if !is_terminal_effort_status(&result.status) {
            continue; // running effort — never reap.
        }
        // Terminal but no honest completion clock => keep (fail-safe).
        let Some(completed_at) = result.completed_at.as_deref() else {
            continue;
        };
        let Some(completed_secs) = parse_iso_to_epoch_secs(completed_at) else {
            continue; // unparseable timestamp => keep.
        };
        let age_secs = now_secs.saturating_sub(completed_secs);

        if age_secs >= effort_ttl_secs {
            plan.effort_ids.push(id.clone());
        }
        // A stream is joined to its effort's terminal+age gate: reap the stream
        // when the same effort is terminal and older than the stream TTL. The
        // stream_ref is derived deterministically from the effort id (the same
        // derivation dispatch uses), so we never parse the ndjson body.
        if age_secs >= stream_ttl_secs {
            let stream_ref = stream_ref_for_prompt(&prompt_ref_from_effort(id));
            plan.stream_refs.push(stream_ref);
        }
    }
    plan
}

/// Delete the planned files and evict the reaped efforts from the in-memory map.
/// fs deletes ignore NotFound (a stream file may not exist for a non-respond
/// effort). The map eviction is under one write lock so a reaped-from-disk
/// effort cannot be re-persisted stale. Takes the effort store + dirs directly
/// (not the whole SidecarState) so the reaper task holds only a Weak to the
/// store, and so tests drive it without a full state.
pub(crate) fn execute_reap(
    efforts: &EffortStore,
    efforts_input: &EffortInputStore,
    results_dir: &std::path::Path,
    streams_dir: &std::path::Path,
    plan: &ReapPlan,
) {
    for effort_id in &plan.effort_ids {
        let path = super::effort_result_path(results_dir, effort_id);
        remove_file_quiet(&path);
    }
    for stream_ref in &plan.stream_refs {
        let path = streams_dir.join(format!("{stream_ref}.ndjson"));
        remove_file_quiet(&path);
    }
    if !plan.effort_ids.is_empty() {
        {
            let mut store = efforts.write().expect("effort store poisoned");
            for effort_id in &plan.effort_ids {
                store.remove(effort_id);
            }
        }
        // Evict the retained Effort INPUT too (the heavier tasks+args struct,
        // keyed by the same effort_id). Missed before → efforts_input grew one
        // full input per dispatch forever while its results twin was reaped.
        let mut input = efforts_input.write().expect("effort input store poisoned");
        for effort_id in &plan.effort_ids {
            input.remove(effort_id);
        }
    }
    if !plan.is_empty() {
        tracing::info!(
            reaped_efforts = plan.effort_ids.len(),
            reaped_streams = plan.stream_refs.len(),
            "sidecar reaper reclaimed terminal-and-old artifacts"
        );
    }
}

fn remove_file_quiet(path: &std::path::Path) {
    match std::fs::remove_file(path) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            tracing::warn!(path = %path.display(), error = %e, "sidecar reaper: remove failed")
        }
    }
}

/// Spawn the self-terminating background reaper. Holds a Weak to the effort
/// store so the task exits once the SidecarState is dropped (mirrors the epoch
/// ticker's teardown contract — a strong Arc would keep the sidecar alive
/// forever and leak the task across restarts).
pub(crate) fn spawn_reaper(state: &SidecarState, cfg: ReaperConfig) {
    let ReaperConfig {
        effort_ttl_ms,
        stream_ttl_ms,
        interval_ms,
        initial_delay_ms,
    } = cfg;

    // The task holds ONLY a Weak to the effort store plus the (cheap, non-Arc)
    // dir paths — never a strong ref to the store between ticks. Each tick it
    // upgrades the Weak; `None` => the sidecar was dropped => self-terminate
    // (mirrors the epoch ticker's teardown contract, no leaked task).
    let weak: Weak<_> = std::sync::Arc::downgrade(&state.efforts);
    // Weak to the input store too, so the reaper can evict it alongside results
    // without keeping the sidecar alive between ticks (same teardown contract).
    let weak_input: Weak<_> = std::sync::Arc::downgrade(&state.efforts_input);
    let results_dir = state.results_dir.clone();
    let streams_dir = state.streams_dir.clone();

    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(initial_delay_ms)).await;
        // upgrade() failing means the sidecar was dropped — the `while let` then
        // exits and the reaper self-terminates.
        while let Some(efforts) = weak.upgrade() {
            let now_secs = now_unix_secs();
            let plan = {
                let map = efforts.read().expect("effort store poisoned");
                plan_reap(&map, now_secs, effort_ttl_ms, stream_ttl_ms)
            };
            if !plan.is_empty() {
                // If the input store is already gone (sidecar mid-teardown), fall
                // back to an empty one — execute_reap still reaps results + fs.
                if let Some(input) = weak_input.upgrade() {
                    execute_reap(&efforts, &input, &results_dir, &streams_dir, &plan);
                    drop(input);
                }
            }
            // Drop the strong ref before sleeping so we never keep the sidecar
            // alive across the (long) interval.
            drop(efforts);
            tokio::time::sleep(Duration::from_millis(interval_ms)).await;
        }
        tracing::debug!("sidecar reaper exiting (sidecar dropped)");
    });
}

fn now_unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Parse an ISO-8601 `YYYY-MM-DDThh:mm:ssZ` timestamp (as chrono_now_iso emits) back to unix seconds,
/// via the shared `time`-backed `timefmt` module. `None` on any malformed input so the caller keeps it.
pub(crate) fn parse_iso_to_epoch_secs(iso: &str) -> Option<u64> {
    crate::timefmt::iso_to_epoch_secs(iso)
}

#[cfg(test)]
#[path = "reap_tests.rs"]
mod tests;
