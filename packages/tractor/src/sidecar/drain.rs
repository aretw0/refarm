//! Safe restart: what is in flight right now, and the bounded drain a shutdown runs.
//!
//! Two facts, one file, because they are the same fact read at two moments:
//!
//!   - BEFORE deciding to restart, an operator (or a scheduler) asks
//!     `GET /efforts/in-flight` — "is anything running, and how long could it
//!     still legitimately take?".
//!   - DURING shutdown, the daemon asks the same question and then WAITS on the
//!     answer, bounded by exactly the number that answer already carried.
//!
//! ## The bound is never invented
//!
//! Every effort the dispatcher governs carries a `deadline_ms` resolved ONCE at
//! dispatch (`dispatch::dispatch_effort` → `budget::resolve_budget`, stashed in
//! `dispatch::dispatched_budgets`). Past that deadline the effort is over budget
//! *by its own declaration* — so the longest deadline among the efforts in flight
//! is the longest a correct drain can ever need to wait. `drain_bound_ms` is that
//! max and nothing else. There is no `DRAIN_TIMEOUT_MS`, no env knob, no default:
//!
//! - nothing in flight ⇒ bound 0, and the drain returns immediately;
//! - in flight but with no deadline resolved for any of them ⇒ bound 0 as well:
//!   the drain does not wait out a budget nobody declared, and says so.
//!
//! ## Three states, never two
//!
//! Every effort the drain touches ends in exactly one of:
//!
//!   - **drained** — it reached a terminal state before the bound elapsed;
//!   - **abandoned** — it had a resolved deadline and outlived it. Logged at
//!     ERROR with its id: an abandoned effort is a recorded fact, never a
//!     silence. Shutdown proceeds;
//!   - **could-not-tell** — it was still running at the bound with no deadline
//!     ever resolved for it, or it left the store without a terminal state, or
//!     the store could not be read at all. This is NOT collapsed into either of
//!     the other two: "I don't know" and "I abandoned it over budget" are
//!     different claims and only one of them is true.
//!
//! A drain that cannot complete is LOUD and still shuts down. Hanging forever on
//! a wedged effort is worse than a bounded abandonment; a silent abandonment is
//! worse than both.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::{is_terminal_effort_status, EffortResult, EffortStore, SidecarState};

/// How often the drain re-reads the effort store while waiting. A CADENCE, not a
/// bound — the bound is `drain_bound_ms`, derived entirely from what the in-flight
/// efforts already declared. Nothing here invents a timeout.
const DRAIN_POLL_MS: u64 = 50;

/// Still running at the bound, and nothing ever resolved a deadline for it — so
/// there is no budget it can be said to have exceeded. Could-not-tell, not abandoned.
pub(crate) const REASON_NO_DEADLINE: &str =
    "no dispatch-time deadline was ever resolved for this effort";
/// The effort store itself could not be read (poisoned lock). The drain cannot
/// tell what was in flight, so it claims nothing was drained.
pub(crate) const REASON_STORE_UNREADABLE: &str = "the effort store could not be read";
/// The record vanished mid-drain without ever showing a terminal state. Nothing
/// reaps a non-terminal effort, so this should not happen — which is exactly why
/// it is reported rather than read as completion.
pub(crate) const REASON_LEFT_THE_STORE: &str =
    "the effort left the store without reaching a terminal state";

// ── the gate ─────────────────────────────────────────────────────────────────

/// Whether this node still accepts NEW efforts. Closed once, at the first
/// shutdown signal, and never reopened: a process that has begun draining is on
/// its way out, and an effort admitted after that point would extend a drain
/// whose bound was already computed from the efforts admitted before it.
#[derive(Debug, Clone, Default)]
pub(crate) struct DrainGate(Arc<AtomicBool>);

impl DrainGate {
    /// True once the drain has started. Reported on `GET /efforts/in-flight` so a
    /// scheduler polling "can I restart" learns that someone already decided.
    pub(crate) fn is_draining(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }

    /// The submit-side question: may a new effort be dispatched?
    pub(crate) fn accepting(&self) -> bool {
        !self.is_draining()
    }

    /// Stop accepting new efforts. Idempotent and one-way.
    pub(crate) fn close(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
}

// ── what is in flight ────────────────────────────────────────────────────────

/// One effort that has not reached a terminal state, with the deadline that was
/// resolved for it at dispatch — `None` when no resolution is knowable (a
/// non-agent dispatch never stashes one, and an effort loaded from disk after a
/// previous process died has no in-memory resolution at all).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct InFlightEffort {
    pub(crate) effort_id: String,
    pub(crate) status: String,
    pub(crate) deadline_ms: Option<u64>,
}

/// PURE. An effort is in flight iff it carries no `completed_at` AND its status
/// is non-terminal — the joint check the reaper already trusts, read the other
/// way round. Sorted by id so the answer (and every log line derived from it) is
/// deterministic rather than HashMap-ordered.
pub(crate) fn in_flight_efforts(
    efforts: &HashMap<String, EffortResult>,
    deadlines: &HashMap<String, u64>,
) -> Vec<InFlightEffort> {
    let mut in_flight: Vec<InFlightEffort> = efforts
        .values()
        .filter(|effort| {
            effort.completed_at.is_none() && !is_terminal_effort_status(&effort.status)
        })
        .map(|effort| InFlightEffort {
            effort_id: effort.effort_id.clone(),
            status: effort.status.clone(),
            deadline_ms: deadlines.get(&effort.effort_id).copied(),
        })
        .collect();
    in_flight.sort_by(|a, b| a.effort_id.cmp(&b.effort_id));
    in_flight
}

/// PURE. The longest a correct drain can need: the largest deadline any in-flight
/// effort declared. Zero when nothing is in flight, and zero when nothing in
/// flight has a resolved deadline — see the module doc for why that is a refusal
/// to invent a number rather than a missing feature.
pub(crate) fn drain_bound_ms(in_flight: &[InFlightEffort]) -> u64 {
    in_flight
        .iter()
        .filter_map(|effort| effort.deadline_ms)
        .max()
        .unwrap_or(0)
}

/// What is in flight RIGHT NOW. `None` — never an empty list — when the effort
/// store cannot be read: "nothing is running" and "I cannot tell" are different
/// answers and a restart decision hangs on which one it is.
pub(crate) fn in_flight_now(state: &SidecarState) -> Option<Vec<InFlightEffort>> {
    let deadlines = super::dispatch::dispatched_deadlines_ms();
    let store = state.efforts.read().ok()?;
    Some(in_flight_efforts(&store, &deadlines))
}

// ── what the drain decided ───────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum EffortDrainOutcome {
    /// Reached a terminal state within the bound.
    Drained,
    /// Outlived the deadline IT declared. Shutdown did not wait longer.
    Abandoned { deadline_ms: u64 },
    /// Neither of the above can honestly be claimed.
    CouldNotTell { reason: &'static str },
}

impl EffortDrainOutcome {
    pub(crate) fn label(&self) -> &'static str {
        match self {
            Self::Drained => "drained",
            Self::Abandoned { .. } => "abandoned",
            Self::CouldNotTell { .. } => "could-not-tell",
        }
    }
}

/// What one shutdown drain did, per effort and in aggregate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DrainReport {
    /// The bound this drain resolved to — max in-flight deadline, or 0.
    pub(crate) bound_ms: u64,
    /// How long it actually waited. Always ≤ `bound_ms`.
    pub(crate) waited_ms: u64,
    /// One entry per effort that was in flight when the drain began, by id.
    pub(crate) outcomes: Vec<(String, EffortDrainOutcome)>,
    /// False when the effort store could not be read at all — the drain then
    /// claims nothing, in either direction.
    pub(crate) store_readable: bool,
}

impl DrainReport {
    fn nothing_in_flight() -> Self {
        Self {
            bound_ms: 0,
            waited_ms: 0,
            outcomes: Vec::new(),
            store_readable: true,
        }
    }

    fn unreadable() -> Self {
        Self {
            bound_ms: 0,
            waited_ms: 0,
            outcomes: Vec::new(),
            store_readable: false,
        }
    }

    pub(crate) fn count(&self, label: &str) -> usize {
        self.outcomes
            .iter()
            .filter(|(_, outcome)| outcome.label() == label)
            .count()
    }

    /// The drain's own verdict, least-certain first: an unknown anywhere makes the
    /// whole drain "could-not-tell", an abandonment makes it "abandoned", and only
    /// a drain that accounted for everything says "drained".
    pub(crate) fn verdict(&self) -> &'static str {
        if !self.store_readable || self.count("could-not-tell") > 0 {
            "could-not-tell"
        } else if self.count("abandoned") > 0 {
            "abandoned"
        } else {
            "drained"
        }
    }

    /// Say what happened, per effort, with its id. `signal` names which signal
    /// asked — an operator debugging a restart needs to know whether something
    /// asked politely (SIGINT) or a supervisor timed out (SIGTERM).
    pub(crate) fn log(&self, signal: &str) {
        if !self.store_readable {
            tracing::error!(
                signal,
                reason = REASON_STORE_UNREADABLE,
                "shutdown drain COULD NOT TELL what was in flight — shutting down anyway"
            );
        }
        for (effort_id, outcome) in &self.outcomes {
            match outcome {
                EffortDrainOutcome::Drained => tracing::info!(
                    signal,
                    %effort_id,
                    "shutdown drain: effort reached a terminal state"
                ),
                EffortDrainOutcome::Abandoned { deadline_ms } => tracing::error!(
                    signal,
                    %effort_id,
                    deadline_ms,
                    bound_ms = self.bound_ms,
                    "shutdown drain ABANDONED this effort — it outlived the deadline it declared; shutting down anyway"
                ),
                EffortDrainOutcome::CouldNotTell { reason } => tracing::error!(
                    signal,
                    %effort_id,
                    reason,
                    "shutdown drain COULD NOT TELL whether this effort finished; shutting down anyway"
                ),
            }
        }
        tracing::info!(
            signal,
            verdict = self.verdict(),
            bound_ms = self.bound_ms,
            waited_ms = self.waited_ms,
            drained = self.count("drained"),
            abandoned = self.count("abandoned"),
            could_not_tell = self.count("could-not-tell"),
            "shutdown drain complete"
        );
    }
}

// ── the drain ────────────────────────────────────────────────────────────────

/// Where the per-effort deadlines come from. Production reads the live
/// dispatch-time budget store; tests hand in a fixed snapshot so the drain's
/// arithmetic is provable without standing up a dispatcher.
#[derive(Clone)]
enum DeadlineSource {
    Dispatched,
    #[cfg(test)]
    Fixed(HashMap<String, u64>),
}

impl DeadlineSource {
    fn snapshot(&self) -> HashMap<String, u64> {
        match self {
            Self::Dispatched => super::dispatch::dispatched_deadlines_ms(),
            #[cfg(test)]
            Self::Fixed(deadlines) => deadlines.clone(),
        }
    }
}

/// The shutdown drain: the effort store to watch and the gate to close. Holds
/// only what it needs (not the whole `SidecarState`) so the daemon's WS server
/// can own one without owning the sidecar, and so tests drive it from a bare map.
#[derive(Clone)]
pub(crate) struct ShutdownDrain {
    efforts: EffortStore,
    gate: DrainGate,
    deadlines: DeadlineSource,
}

impl ShutdownDrain {
    /// The drain for a live sidecar. Shares the SAME store and the SAME gate the
    /// HTTP routes use — closing this gate is what makes `POST /efforts` refuse.
    pub(crate) fn for_state(state: &SidecarState) -> Self {
        Self {
            efforts: state.efforts.clone(),
            gate: state.drain_gate.clone(),
            deadlines: DeadlineSource::Dispatched,
        }
    }

    /// Close the gate, wait for what is in flight, and report. Never returns
    /// later than `bound_ms` after it started.
    pub(crate) async fn run(&self) -> DrainReport {
        self.run_with_poll(Duration::from_millis(DRAIN_POLL_MS)).await
    }

    async fn run_with_poll(&self, poll: Duration) -> DrainReport {
        // Stop accepting new efforts FIRST: the bound below is computed from what
        // is in flight at this instant, so nothing may join after it is measured.
        self.gate.close();

        let deadlines = self.deadlines.snapshot();
        let Ok(initial) = self.efforts.read().map(|store| {
            let in_flight = in_flight_efforts(&store, &deadlines);
            drop(store);
            in_flight
        }) else {
            return DrainReport::unreadable();
        };
        if initial.is_empty() {
            // Nothing to wait for, so nothing is waited for. No default, no floor.
            return DrainReport::nothing_in_flight();
        }

        let bound_ms = drain_bound_ms(&initial);
        tracing::info!(
            in_flight = initial.len(),
            bound_ms,
            "shutdown drain started — no new efforts will be accepted"
        );

        let started = Instant::now();
        let mut pending = initial;
        let mut outcomes: Vec<(String, EffortDrainOutcome)> = Vec::new();
        let mut store_readable = true;

        loop {
            // Observe BEFORE deciding whether to keep waiting, so a bound of zero
            // still gets one honest look at the store.
            match self.efforts.read() {
                Ok(store) => {
                    let mut still_running = Vec::new();
                    for effort in std::mem::take(&mut pending) {
                        match store.get(&effort.effort_id) {
                            Some(current) if is_terminal_effort_status(&current.status) => {
                                outcomes.push((effort.effort_id, EffortDrainOutcome::Drained));
                            }
                            Some(_) => still_running.push(effort),
                            None => outcomes.push((
                                effort.effort_id,
                                EffortDrainOutcome::CouldNotTell {
                                    reason: REASON_LEFT_THE_STORE,
                                },
                            )),
                        }
                    }
                    pending = still_running;
                }
                Err(_) => {
                    store_readable = false;
                    break;
                }
            }

            if pending.is_empty() {
                break;
            }
            let elapsed_ms = started.elapsed().as_millis() as u64;
            if elapsed_ms >= bound_ms {
                break;
            }
            tokio::time::sleep(poll.min(Duration::from_millis(bound_ms - elapsed_ms))).await;
        }

        // Whatever is still running when the bound elapses: abandoned if it
        // declared a deadline it outlived, could-not-tell if it never had one.
        for effort in pending {
            let outcome = if !store_readable {
                EffortDrainOutcome::CouldNotTell {
                    reason: REASON_STORE_UNREADABLE,
                }
            } else {
                match effort.deadline_ms {
                    Some(deadline_ms) => EffortDrainOutcome::Abandoned { deadline_ms },
                    None => EffortDrainOutcome::CouldNotTell {
                        reason: REASON_NO_DEADLINE,
                    },
                }
            };
            outcomes.push((effort.effort_id, outcome));
        }
        outcomes.sort_by(|a, b| a.0.cmp(&b.0));

        DrainReport {
            bound_ms,
            waited_ms: started.elapsed().as_millis() as u64,
            outcomes,
            store_readable,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::RwLock;

    fn effort(id: &str, status: &str, completed_at: Option<&str>) -> EffortResult {
        EffortResult {
            effort_id: id.to_string(),
            status: status.to_string(),
            results: vec![],
            submitted_at: "2026-08-04T00:00:00.000Z".to_string(),
            completed_at: completed_at.map(str::to_string),
        }
    }

    fn store(entries: Vec<EffortResult>) -> EffortStore {
        Arc::new(RwLock::new(
            entries
                .into_iter()
                .map(|e| (e.effort_id.clone(), e))
                .collect(),
        ))
    }

    fn drain_over(efforts: EffortStore, deadlines: &[(&str, u64)]) -> ShutdownDrain {
        ShutdownDrain {
            efforts,
            gate: DrainGate::default(),
            deadlines: DeadlineSource::Fixed(
                deadlines
                    .iter()
                    .map(|(id, ms)| ((*id).to_string(), *ms))
                    .collect(),
            ),
        }
    }

    // ── in flight ────────────────────────────────────────────────────────────

    #[test]
    fn in_flight_is_no_completion_and_a_non_terminal_status() {
        let efforts: HashMap<String, EffortResult> = vec![
            effort("a-running", super::super::EFFORT_IN_PROGRESS, None),
            effort("b-pending", super::super::EFFORT_PENDING, None),
            effort("c-done", super::super::EFFORT_DONE, Some("2026-08-04T00:00:01.000Z")),
            // Terminal but never stamped: still not in flight — the status is final.
            effort("d-failed", super::super::EFFORT_FAILED, None),
        ]
        .into_iter()
        .map(|e| (e.effort_id.clone(), e))
        .collect();

        let in_flight = in_flight_efforts(&efforts, &HashMap::new());
        let ids: Vec<&str> = in_flight.iter().map(|e| e.effort_id.as_str()).collect();
        assert_eq!(ids, vec!["a-running", "b-pending"]);
    }

    #[test]
    fn in_flight_carries_the_deadline_resolved_at_dispatch() {
        let efforts: HashMap<String, EffortResult> =
            vec![effort("a", super::super::EFFORT_IN_PROGRESS, None)]
                .into_iter()
                .map(|e| (e.effort_id.clone(), e))
                .collect();
        let deadlines: HashMap<String, u64> = [("a".to_string(), 45_000)].into_iter().collect();

        let in_flight = in_flight_efforts(&efforts, &deadlines);
        assert_eq!(in_flight[0].deadline_ms, Some(45_000));
    }

    #[test]
    fn the_bound_is_the_longest_declared_deadline_and_zero_when_none_is() {
        let with_deadlines = vec![
            InFlightEffort {
                effort_id: "a".into(),
                status: "in-progress".into(),
                deadline_ms: Some(45_000),
            },
            InFlightEffort {
                effort_id: "b".into(),
                status: "in-progress".into(),
                deadline_ms: Some(120_000),
            },
            InFlightEffort {
                effort_id: "c".into(),
                status: "in-progress".into(),
                deadline_ms: None,
            },
        ];
        assert_eq!(drain_bound_ms(&with_deadlines), 120_000);

        // Nothing in flight, and in flight but nothing declared, both resolve to
        // zero — the drain never invents a number to wait out.
        assert_eq!(drain_bound_ms(&[]), 0);
        assert_eq!(drain_bound_ms(&with_deadlines[2..]), 0);
    }

    // ── the drain ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn a_drain_with_nothing_in_flight_is_immediate() {
        let drain = drain_over(
            store(vec![effort(
                "already-done",
                super::super::EFFORT_DONE,
                Some("2026-08-04T00:00:01.000Z"),
            )]),
            &[],
        );

        let began = Instant::now();
        let report = drain.run().await;

        assert_eq!(report.bound_ms, 0, "no deadline to wait out");
        assert_eq!(report.waited_ms, 0);
        assert!(report.outcomes.is_empty(), "nothing was in flight to report");
        assert_eq!(report.verdict(), "drained");
        assert!(
            began.elapsed() < Duration::from_millis(200),
            "an empty drain must not wait: took {:?}",
            began.elapsed()
        );
    }

    #[tokio::test]
    async fn the_drain_closes_the_gate_before_it_waits() {
        let drain = drain_over(store(vec![]), &[]);
        assert!(drain.gate.accepting(), "open before the signal");
        drain.run().await;
        assert!(
            drain.gate.is_draining(),
            "a draining node accepts no new efforts"
        );
    }

    #[tokio::test]
    async fn an_effort_that_finishes_inside_its_deadline_is_drained() {
        let efforts = store(vec![effort("slow", super::super::EFFORT_IN_PROGRESS, None)]);
        let drain = drain_over(efforts.clone(), &[("slow", 2_000)]);

        // Terminal a little after the drain starts, well inside the 2s bound.
        let finisher = efforts.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(120)).await;
            let mut store = finisher.write().expect("effort store");
            store.insert(
                "slow".to_string(),
                effort(
                    "slow",
                    super::super::EFFORT_DONE,
                    Some("2026-08-04T00:00:01.000Z"),
                ),
            );
        });

        let report = drain.run().await;

        assert_eq!(
            report.outcomes,
            vec![("slow".to_string(), EffortDrainOutcome::Drained)]
        );
        assert_eq!(report.verdict(), "drained");
        assert!(
            report.waited_ms >= 100,
            "the drain actually waited for it: {}ms",
            report.waited_ms
        );
        assert!(
            report.waited_ms < 2_000,
            "and stopped waiting the moment it finished: {}ms",
            report.waited_ms
        );
    }

    #[tokio::test]
    async fn an_effort_that_outlives_its_own_deadline_is_abandoned_with_its_id() {
        let efforts = store(vec![effort("wedged", super::super::EFFORT_IN_PROGRESS, None)]);
        let drain = drain_over(efforts, &[("wedged", 150)]);

        let began = Instant::now();
        let report = drain.run().await;

        assert_eq!(
            report.outcomes,
            vec![(
                "wedged".to_string(),
                EffortDrainOutcome::Abandoned { deadline_ms: 150 }
            )],
            "abandoned, named, and not silent"
        );
        assert_eq!(report.verdict(), "abandoned");
        assert_eq!(report.bound_ms, 150);
        assert!(
            began.elapsed() < Duration::from_secs(2),
            "the drain must not hang on a wedged effort: {:?}",
            began.elapsed()
        );
    }

    #[tokio::test]
    async fn an_effort_with_no_resolved_deadline_is_could_not_tell_never_abandoned() {
        let efforts = store(vec![effort("orphan", super::super::EFFORT_IN_PROGRESS, None)]);
        let drain = drain_over(efforts, &[]);

        let began = Instant::now();
        let report = drain.run().await;

        assert_eq!(report.bound_ms, 0, "nothing declared a deadline to wait out");
        assert_eq!(
            report.outcomes,
            vec![(
                "orphan".to_string(),
                EffortDrainOutcome::CouldNotTell {
                    reason: REASON_NO_DEADLINE
                }
            )],
            "we cannot claim it went over a budget it never had"
        );
        assert_eq!(report.verdict(), "could-not-tell");
        assert!(began.elapsed() < Duration::from_millis(200));
    }

    #[tokio::test]
    async fn one_abandoned_effort_does_not_hide_the_ones_that_drained() {
        let efforts = store(vec![
            effort("a-finished", super::super::EFFORT_IN_PROGRESS, None),
            effort("b-wedged", super::super::EFFORT_IN_PROGRESS, None),
        ]);
        let drain = drain_over(efforts.clone(), &[("a-finished", 200), ("b-wedged", 200)]);

        let finisher = efforts.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(60)).await;
            let mut store = finisher.write().expect("effort store");
            store.insert(
                "a-finished".to_string(),
                effort(
                    "a-finished",
                    super::super::EFFORT_DONE,
                    Some("2026-08-04T00:00:01.000Z"),
                ),
            );
        });

        let report = drain.run().await;

        assert_eq!(report.count("drained"), 1);
        assert_eq!(report.count("abandoned"), 1);
        assert_eq!(report.verdict(), "abandoned");
        assert_eq!(
            report.outcomes,
            vec![
                ("a-finished".to_string(), EffortDrainOutcome::Drained),
                (
                    "b-wedged".to_string(),
                    EffortDrainOutcome::Abandoned { deadline_ms: 200 }
                ),
            ]
        );
    }

    /// Every outcome has a line, and the verdict never hides the least certain one.
    /// `log` is what makes an abandonment a recorded fact instead of a silence, so it
    /// is exercised on all three kinds — a panic in the loud path would only ever be
    /// discovered during a real shutdown.
    #[test]
    fn the_report_names_each_outcome_and_takes_the_least_certain_verdict() {
        let mixed = DrainReport {
            bound_ms: 500,
            waited_ms: 500,
            outcomes: vec![
                ("a".to_string(), EffortDrainOutcome::Drained),
                (
                    "b".to_string(),
                    EffortDrainOutcome::Abandoned { deadline_ms: 500 },
                ),
                (
                    "c".to_string(),
                    EffortDrainOutcome::CouldNotTell {
                        reason: REASON_NO_DEADLINE,
                    },
                ),
            ],
            store_readable: true,
        };
        assert_eq!(mixed.count("drained"), 1);
        assert_eq!(mixed.count("abandoned"), 1);
        assert_eq!(mixed.count("could-not-tell"), 1);
        assert_eq!(
            mixed.verdict(),
            "could-not-tell",
            "an unknown outranks an abandonment, which outranks a clean drain"
        );
        mixed.log("SIGTERM");

        let abandoned = DrainReport {
            outcomes: vec![(
                "b".to_string(),
                EffortDrainOutcome::Abandoned { deadline_ms: 500 },
            )],
            ..mixed.clone()
        };
        assert_eq!(abandoned.verdict(), "abandoned");
        abandoned.log("SIGINT");

        DrainReport::unreadable().log("SIGTERM");
        assert_eq!(DrainReport::unreadable().verdict(), "could-not-tell");
    }

    #[tokio::test]
    async fn an_unreadable_store_is_could_not_tell_and_still_shuts_down() {
        let efforts = store(vec![effort("x", super::super::EFFORT_IN_PROGRESS, None)]);
        // Poison the lock the way a panic inside a writer would.
        let poisoner = efforts.clone();
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.write().expect("effort store");
            panic!("poison the effort store");
        })
        .join();

        let drain = drain_over(efforts, &[("x", 5_000)]);
        let report = drain.run().await;

        assert!(!report.store_readable);
        assert_eq!(report.verdict(), "could-not-tell");
        assert!(
            report.outcomes.is_empty(),
            "it claims nothing — not drained, not abandoned"
        );
    }
}
