//! The pending prompt on the node — a question the operator can answer from wherever they are.
//!
//! Design: `docs/superpowers/specs/2026-07-30-pending-prompt-wire-design.md` (P1–P6).
//! Wire shape and the TypeScript half: `packages/prompt-contract-v1/src/index.ts`, already
//! vendored into the device kit, so a phone parses this with nothing installed.
//!
//! ## The shape chosen: the hub lives HERE, and askers long-poll
//!
//! An asking process `POST`s its question and holds the request open until it is settled.
//! Attending devices `GET` the list and `POST` an answer. That single choice is what buys
//! **P1** — *a pending prompt's lifetime is its asker's lifetime, nothing persists* — for
//! free: the prompt's lifetime IS the open request. The asker dies, the connection drops,
//! the handler future is dropped, and [`PromptTicket`]'s `Drop` withdraws the question. No
//! storage, no liveness probing, no garbage collection, and no stale-answer problem.
//!
//! The alternative (hub in the asking process, sidecar proxying to it) honours P1 just as
//! directly but needs discovery plus proxying — strictly more machinery for the same
//! guarantee.
//!
//! ## P2 — exactly one answer settles a prompt
//!
//! [`HubInner::claim`] is the ONE compare-and-set, and it is a single `HashMap::remove`
//! under the hub's `Mutex`: `Some` wins, `None` lost. Removal *is* the CAS — there is no
//! separate "settled" flag that could disagree with the map, and no `await` anywhere near
//! it (every hub method is synchronous). Two devices answering in the same instant, an
//! answer landing as the asker's deadline fires, a withdraw racing an answer: all of them
//! funnel through here and exactly one gets `true`. Nothing else removes an entry, and
//! nothing else sends on a ticket's channel.
//!
//! ## P3 — attribution is gate-resolved, never client-supplied
//!
//! The identity recorded for an answer is the one THIS LISTENER's credential gate resolved
//! ([`super::auth::AuthenticatedDevice`], inserted by the auth middleware itself), or the
//! reserved [`NODE_LOCAL_PROMPT_DEVICE`] sentinel when the listener does not authenticate.
//! A `device` field in a request body is read by nothing here — see
//! [`resolve_answering_device`]. An attribution a caller can choose is not an attribution.
//!
//! ## P4 — a settlement carries WHO answered, never WHAT
//!
//! [`PendingPromptSettlement`] has no answer field, by construction, so the value a losing
//! peer is told about, the value a log line names, and the value returned by the list route
//! are all the same value: none. The answer reaches the asker through its own open request
//! and nowhere else. [`AnswerValue`] redacts itself in `Debug`, so a `{:?}` anywhere — a
//! future `tracing` line, a panic message — cannot print a secret.
//!
//! ## P5 — waiting is interruptible and expiry is an OUTCOME
//!
//! Every published prompt carries a deadline; there is no "wait forever" on this surface,
//! because a blocked CLI that waits forever is a CLI that gets killed with Ctrl-C and leaves
//! half-applied state. When the deadline passes the asker's request returns **200** with
//! `{"outcome":"abandoned","reason":"expired"}` — not a hang, and not an error a caller
//! would have to tell apart from a broken network.
//!
//! ## Honest polling
//!
//! The list route STATES its interval ([`PENDING_PROMPT_POLL_INTERVAL_MS`]) rather than
//! leaving an attending device to guess, and the queue is BOUNDED
//! ([`DEFAULT_MAX_PENDING_PROMPTS`]): publishing past the ceiling is refused `429`, loudly,
//! rather than accumulating questions nobody will ever see.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{extract::Path as AxumPath, extract::State, http::StatusCode, response::IntoResponse, Extension, Json};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::oneshot;

use super::auth::AuthenticatedDevice;
use super::SidecarState;

// ── wire constants — the TypeScript block is the other half of each of these ───────────

/// Wire discriminator. `PENDING_PROMPT_WIRE` in `prompt-contract-v1`.
pub(crate) const PENDING_PROMPT_WIRE: &str = "pending-prompt.v1";

/// The interval an attending device is TOLD to poll at. Stated, not implied.
/// `PENDING_PROMPT_POLL_INTERVAL_MS` in `prompt-contract-v1`.
pub(crate) const PENDING_PROMPT_POLL_INTERVAL_MS: u64 = 2_000;

/// The stdio peer that asked. Recorded when the ASKER's own side ends the prompt — its
/// deadline passing, or its request going away.
pub(crate) const TERMINAL_PROMPT_DEVICE: &str = " terminal";

/// An unauthenticated caller on the node's own loopback listener.
///
/// The leading space is this repo's non-collidable sentinel convention (`auth.ts` uses it
/// twice) and is sound because a validated device label is trimmed — so a real device label
/// can never begin with one, and can therefore never collide with these two.
pub(crate) const NODE_LOCAL_PROMPT_DEVICE: &str = " node-local";

/// Ceiling on simultaneously pending prompts. Not a queue that grows: publishing past it is
/// REFUSED. A node asks one question per blocked command, so reaching this means something
/// is wrong, and a wrong thing should say so.
pub(crate) const DEFAULT_MAX_PENDING_PROMPTS: usize = 64;

/// How many settled prompts stay recallable, so a peer that LOST the race is told what
/// happened instead of getting a bare 404 (P2). Fixed-size ring, bounded by construction.
pub(crate) const DEFAULT_RECENT_SETTLEMENTS: usize = 32;

/// The deadline a publisher gets when it names none. Matches `DEFAULT_PROMPT_TIMEOUT_MS`
/// in the TypeScript channel.
pub(crate) const DEFAULT_PROMPT_TIMEOUT_MS: u64 = 10 * 60 * 1000;

/// The longest a publisher may hold its request open. A caller-supplied deadline above this
/// is CLAMPED, not honoured: an open connection is a node resource, and P5's whole point is
/// that waiting ends.
pub(crate) const MAX_PROMPT_TIMEOUT_MS: u64 = 60 * 60 * 1000;

// ── the prompt itself ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct SelectOption {
    pub(crate) value: String,
    pub(crate) label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) description: Option<String>,
}

/// Kind, question, options, constraints — the prompt itself, and no rendering. A surface
/// decides how to draw this; the shape does not.
///
/// Parsed into a typed value rather than carried as opaque JSON, deliberately: the node has
/// to know the KIND to recompute `answerTravels` (P4) and to enforce the prompt's own
/// constraints on an answer, and re-serializing from the typed value means the daemon
/// republishes exactly the contract shape — an extra field a publisher smuggled in cannot
/// ride along to the attending device.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub(crate) enum OperatorPrompt {
    Confirm {
        question: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        default: Option<bool>,
    },
    Select {
        question: String,
        options: Vec<SelectOption>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        default: Option<String>,
    },
    Text {
        question: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        default: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        placeholder: Option<String>,
    },
    Secret {
        question: String,
        #[serde(default, rename = "visibleTail", skip_serializing_if = "Option::is_none")]
        visible_tail: Option<u32>,
    },
}

impl OperatorPrompt {
    /// The wire name of this kind — for the one rejection message that needs it.
    fn kind(&self) -> &'static str {
        match self {
            OperatorPrompt::Confirm { .. } => "confirm",
            OperatorPrompt::Select { .. } => "select",
            OperatorPrompt::Text { .. } => "text",
            OperatorPrompt::Secret { .. } => "secret",
        }
    }

    /// P4 — true when answering this from another device puts the ANSWER on the wire.
    ///
    /// COMPUTED from the kind, never read off a request: the publish body carries no
    /// `answerTravels` field at all, so a caller has no way to strip the warning off a
    /// secret before an attending surface shows it.
    fn answer_travels(&self) -> bool {
        matches!(self, OperatorPrompt::Secret { .. })
    }
}

/// Who asked. Enough to recognise the question at a glance on a small screen.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PendingPromptAsker {
    pub(crate) command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) pid: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) host: Option<String>,
}

/// A question waiting for an operator, as it crosses the wire.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingPrompt {
    pub(crate) wire: &'static str,
    pub(crate) id: String,
    /// What this question is ABOUT, when the asker chose to say — the coalescing key.
    ///
    /// Serialized so an attending device can show "3 processes are waiting on this" rather than
    /// three identical cards, and so a human can tell why one answer moved several things.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) subject: Option<String>,
    /// How many askers are waiting on this one card. `1` unless the subject coalesced.
    pub(crate) waiters: usize,
    pub(crate) prompt: OperatorPrompt,
    pub(crate) answer_travels: bool,
    pub(crate) asker: PendingPromptAsker,
    /// Epoch ms.
    pub(crate) asked_at: u64,
    /// P5 — the asker's deadline, epoch ms. Always present on this surface.
    pub(crate) expires_at: Option<u64>,
}

// ── The notice: what a wizard STATES, as opposed to what it asks ─────────────
//
// The node's half of `operator-notice.v1` (see
// docs/superpowers/specs/2026-08-03-announcement-contract-node-half-design.md).
// An `OperatorChannel` could only ask, so a wizard's framing stayed on the node
// that ran it while only the questions travelled. This is where the framing lives
// for every surface that PULLS — the PWA and `farm-attend` read it from here.

/// Wire discriminator. `OPERATOR_NOTICE_WIRE` in `prompt-contract-v1`.
pub(crate) const OPERATOR_NOTICE_WIRE: &str = "operator-notice.v1";

/// How many notices stay recallable. Beside `DEFAULT_RECENT_SETTLEMENTS`, and for the
/// reason D5 gives: a device that opens `/attend` AFTER the question was asked still
/// reads the framing that explains it. Not the P1 lifetime rule — a notice has nobody
/// waiting on it by definition, so "the asker is gone" is not a reason to drop it.
pub(crate) const DEFAULT_RECENT_NOTICES: usize = 32;

/// What kind of statement this is. Mirrors `OperatorNoticeKind` in `prompt-contract-v1`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum NoticeKind {
    /// refarm chose or narrowed something on the operator's behalf. Missing it means
    /// BELIEVING YOU CHOSE — the defect this contract exists to remove.
    Decision,
    /// The next answer causes an outward or irreversible effect. Sibling of
    /// `answer_travels`, which marks the same doctrine on the prompt side.
    Caution,
    /// Framing, prerequisites, what will be written. Missing it costs understanding.
    ///
    /// LAST because `#[serde(other)]` requires it, and `other` is what makes this the
    /// landing place for a kind this build does not know: a NEWER peer may name one,
    /// and the MESSAGE is the part the operator needs — dropping a notice to protect a
    /// taxonomy would be the wrong trade. Same judgement `checkPendingPromptWire` makes
    /// when it admits `unknown` rather than refusing an older peer.
    #[serde(other)]
    Context,
}

/// A statement addressed to the operator, as it crosses the wire.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OperatorNotice {
    pub(crate) wire: &'static str,
    /// Monotonic within THIS node (N2). The node stamps it rather than trusting the
    /// caller's, because several CLI processes announce into one node and a
    /// caller-assigned ordinal would collide across them — and this number is what an
    /// attending device dedupes against.
    pub(crate) ordinal: u64,
    pub(crate) message: String,
    pub(crate) kind: NoticeKind,
    pub(crate) asker: PendingPromptAsker,
    /// Epoch ms.
    pub(crate) at: u64,
}

/// Why a prompt ended without an answer (P5).
///
/// Two members, not the contract's three: `cancelled` is what an operator does at the
/// terminal that asked, and the node never observes it — the asker simply stops waiting,
/// which arrives here as `Withdrawn`. A variant nothing can produce would be a promise this
/// surface does not keep.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AbandonReason {
    Expired,
    Withdrawn,
}

impl AbandonReason {
    fn as_str(self) -> &'static str {
        match self {
            AbandonReason::Expired => "expired",
            AbandonReason::Withdrawn => "withdrawn",
        }
    }
}

/// How a prompt ended, and WHO ended it.
///
/// Carries no answer, by construction and not by convention: this is the part that is safe
/// to return to a losing peer and safe to log, and a secret prompt's value must never be
/// either (P4). Adding a value field here is the one change this type exists to prevent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingPromptSettlement {
    pub(crate) prompt_id: String,
    /// `answered` | `abandoned`.
    pub(crate) outcome: &'static str,
    /// Which device settled it (P3), or one of the two reserved identities.
    pub(crate) device: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) reason: Option<&'static str>,
    /// Epoch ms.
    pub(crate) at: u64,
}

pub(crate) const OUTCOME_ANSWERED: &str = "answered";
pub(crate) const OUTCOME_ABANDONED: &str = "abandoned";

/// The operator's answer, on its way back to the asker that asked for it.
///
/// `Debug` is REDACTED, not derived. A derived one would print a secret the moment anyone
/// wrote `{:?}` — in a `tracing` line, in a panic message, in an `unwrap` on a `Result` that
/// happened to contain one. The value has exactly one destination (the publisher's own open
/// request) and this makes every other route to a log line print nothing.
#[derive(Clone, PartialEq)]
pub(crate) struct AnswerValue(Value);

impl std::fmt::Debug for AnswerValue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("AnswerValue(<redacted>)")
    }
}

/// What a settled ticket delivers to the asker: how it ended, and — only when it was
/// ANSWERED — the value.
#[derive(Debug)]
pub(crate) struct PromptOutcome {
    pub(crate) settlement: PendingPromptSettlement,
    pub(crate) value: Option<AnswerValue>,
}

// ── answering rules ────────────────────────────────────────────────────────────────────

const CONFIRM_TRUE: &[&str] = &["true", "yes", "y", "1"];
const CONFIRM_FALSE: &[&str] = &["false", "no", "n", "0"];

/// Is this a legal answer to this prompt? Constraints live with the shape (P6), so the node
/// enforces the same ones the terminal does — a select cannot settle on a value that was
/// never offered, whichever device typed it.
///
/// A rejection NEVER quotes the submitted value: for a secret prompt that would put the
/// secret into an error string returned over HTTP, which is the one place it must not go.
fn check_answer(prompt: &OperatorPrompt, value: &Value) -> Result<AnswerValue, String> {
    if let OperatorPrompt::Confirm { .. } = prompt {
        if let Some(flag) = value.as_bool() {
            return Ok(AnswerValue(Value::Bool(flag)));
        }
        if let Some(raw) = value.as_str() {
            let normalized = raw.trim().to_ascii_lowercase();
            if CONFIRM_TRUE.contains(&normalized.as_str()) {
                return Ok(AnswerValue(Value::Bool(true)));
            }
            if CONFIRM_FALSE.contains(&normalized.as_str()) {
                return Ok(AnswerValue(Value::Bool(false)));
            }
        }
        return Err("confirm expects a boolean".to_string());
    }

    let Some(text) = value.as_str() else {
        return Err(format!("{} expects a string", prompt.kind()));
    };
    if let OperatorPrompt::Select { options, .. } = prompt {
        if !options.iter().any(|option| option.value == text) {
            return Err("select expects one of the offered option values".to_string());
        }
    }
    Ok(AnswerValue(Value::String(text.to_string())))
}

/// Which identity to record for an answer (P3): the one the LISTENER's gate resolved, and
/// nothing else.
///
/// There is deliberately no parameter here a caller could reach. The gated listener's
/// middleware inserts [`AuthenticatedDevice`] itself, from the credential it just verified;
/// the ungated node-local listener inserts nothing, and its callers are recorded as
/// [`NODE_LOCAL_PROMPT_DEVICE`] — never as a device, never as the terminal.
///
/// Trimming is what makes the two reserved sentinels unreachable from outside: a
/// gate-resolved label loses any leading space, so it can never come back as one. A gate
/// that somehow resolved a blank identity resolves to the sentinel rather than to `""`.
fn resolve_answering_device(authenticated: Option<&AuthenticatedDevice>) -> String {
    let resolved = authenticated.map(|d| d.0.trim()).unwrap_or("");
    if resolved.is_empty() {
        NODE_LOCAL_PROMPT_DEVICE.to_string()
    } else {
        resolved.to_string()
    }
}

// ── the hub ────────────────────────────────────────────────────────────────────────────

/// Why a publish was refused. Both are the operator's own node telling the truth rather
/// than queueing something nobody will see.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum PublishRefusal {
    /// The bounded queue is full.
    TooManyPending(usize),
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) enum AnswerOutcome {
    Settled(PendingPromptSettlement),
    Unknown,
    AlreadySettled(PendingPromptSettlement),
    Invalid(String),
}

struct HubEntry {
    pending: PendingPrompt,
    /// Publication order, so `list()` is oldest-first without an ordered-map dependency.
    seq: u64,
    /// EVERY asker waiting on this one question.
    ///
    /// A `Vec` rather than a single sender because of coalescing (see [`PromptHub::publish`]):
    /// several processes may be waiting on the SAME card, and settling it has to reach all of
    /// them. P2 is untouched — `claim` is still one `remove`, still the only compare-and-set,
    /// and the fan-out happens after it has already won.
    settle: Vec<oneshot::Sender<PromptOutcome>>,
}

struct HubInner {
    entries: HashMap<String, HubEntry>,
    recent: Vec<PendingPromptSettlement>,
    /// What was STATED, bounded (N3). No watermark here: a watermark belongs to a
    /// consumer that batches, and this node's readers poll and dedupe on `ordinal`
    /// themselves. Nothing on this side mutates on read.
    notices: Vec<OperatorNotice>,
    notice_seq: u64,
    seq: u64,
    max_pending: usize,
    recent_capacity: usize,
    notice_capacity: usize,
}

impl HubInner {
    /// **THE first-answer-wins rule (P2), in one place.**
    ///
    /// The compare-and-set is the `remove`: the entry is in the map exactly once, so exactly
    /// one caller can take it out, and every other caller — a second device in the same
    /// instant, the expiry timer, a dropped asker — gets `None` and loses. There is no
    /// separate `settled` flag, on purpose: a flag and a map are two facts that can disagree,
    /// and the map alone cannot.
    ///
    /// Called only with the hub's `Mutex` held, and every path in this module settles by
    /// calling it and respects its verdict. Nothing else removes an entry from `entries`,
    /// and nothing else sends on a ticket's channel.
    fn claim(
        &mut self,
        prompt_id: &str,
        settlement: PendingPromptSettlement,
        value: Option<AnswerValue>,
    ) -> bool {
        let Some(entry) = self.entries.remove(prompt_id) else {
            return false;
        };
        self.remember(settlement.clone());
        // Every asker waiting on this card hears the same settlement. One decision, N waiters —
        // which is the whole point of coalescing: the operator answered the QUESTION, not one
        // process's copy of it.
        //
        // An asker may already be gone (its request dropped); a closed channel is not a failure
        // of the settlement, it just means nobody is left on that one to hear it.
        for sender in entry.settle {
            let _ = sender.send(PromptOutcome {
                settlement: settlement.clone(),
                value: value.clone(),
            });
        }
        true
    }

    fn remember(&mut self, settlement: PendingPromptSettlement) {
        self.recent.push(settlement);
        while self.recent.len() > self.recent_capacity {
            self.recent.remove(0);
        }
    }

    fn settlement_of(&self, prompt_id: &str) -> Option<PendingPromptSettlement> {
        self.recent
            .iter()
            .rev()
            .find(|settlement| settlement.prompt_id == prompt_id)
            .cloned()
    }
}

/// Pending prompts, in memory, for exactly as long as their askers are waiting.
///
/// Nothing here is persisted and nothing is garbage-collected (P1). Cloning shares one hub:
/// `SidecarState` is cloned per request, and every clone must see the same questions.
#[derive(Clone)]
pub struct PromptHub {
    inner: Arc<Mutex<HubInner>>,
}

/// Counts only — never the questions, never who is asking. A derived `Debug` on a state
/// struct that happens to contain a hub would otherwise print every pending question.
impl std::fmt::Debug for PromptHub {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let inner = self.inner.lock().expect("prompt hub poisoned");
        f.debug_struct("PromptHub")
            .field("pending", &inner.entries.len())
            .field("recent", &inner.recent.len())
            .finish()
    }
}

impl Default for PromptHub {
    fn default() -> Self {
        Self::with_limits(DEFAULT_MAX_PENDING_PROMPTS, DEFAULT_RECENT_SETTLEMENTS)
    }
}

impl PromptHub {
    pub fn new() -> Self {
        Self::default()
    }

    pub(crate) fn with_limits(max_pending: usize, recent_capacity: usize) -> Self {
        Self::with_all_limits(max_pending, recent_capacity, DEFAULT_RECENT_NOTICES)
    }

    /// A hub whose NOTICE ring is small enough for a test to overflow it deliberately.
    #[cfg(test)]
    pub(crate) fn with_notice_capacity(notice_capacity: usize) -> Self {
        Self::with_all_limits(DEFAULT_MAX_PENDING_PROMPTS, DEFAULT_RECENT_SETTLEMENTS, notice_capacity)
    }

    fn with_all_limits(max_pending: usize, recent_capacity: usize, notice_capacity: usize) -> Self {
        Self {
            inner: Arc::new(Mutex::new(HubInner {
                entries: HashMap::new(),
                recent: Vec::new(),
                notices: Vec::new(),
                notice_seq: 0,
                seq: 0,
                max_pending,
                recent_capacity,
                notice_capacity,
            })),
        }
    }

    /// State a fact. Stamps the ordinal and returns what was recorded.
    ///
    /// Does NOT wake anything waiting on a prompt: a notice is not a question, nothing
    /// is blocked on it, and nobody needs to be woken for it (D9). It sits in the ring
    /// until a device comes to read it.
    pub(crate) fn announce(
        &self,
        asker: &PendingPromptAsker,
        message: &str,
        kind: NoticeKind,
    ) -> OperatorNotice {
        let mut inner = self.inner.lock().expect("prompt hub poisoned");
        inner.notice_seq += 1;
        let notice = OperatorNotice {
            wire: OPERATOR_NOTICE_WIRE,
            ordinal: inner.notice_seq,
            message: message.to_string(),
            kind,
            asker: asker.clone(),
            at: now_epoch_millis(),
        };
        inner.notices.push(notice.clone());
        // Bounded by construction, never grown — the same shape as `recent`.
        while inner.notices.len() > inner.notice_capacity {
            inner.notices.remove(0);
        }
        notice
    }

    /// Everything still in the notice ring, oldest first.
    pub(crate) fn notices(&self) -> Vec<OperatorNotice> {
        self.inner.lock().expect("prompt hub poisoned").notices.clone()
    }

    /// Publish a question and take a ticket for it. The ticket is the ASKER's handle: hold
    /// it for as long as you are waiting, and drop it to withdraw (P1).
    /// Publish a question — or JOIN one already being asked about the same subject.
    ///
    /// ## Why joining exists
    ///
    /// Without it, N processes wanting the same thing produce N cards on the operator's phone,
    /// each needing its own answer, and the operator taps "connect the VPN" four times for one
    /// VPN. The question is the same question; only the asker differs.
    ///
    /// ## What joining does NOT change
    ///
    /// P2 is untouched. `claim` is still one `HashMap::remove` and still the only
    /// compare-and-set; joining adds waiters to an entry, it does not add a second way to settle
    /// one. P1 is untouched too, and is the subtle half: the card lives as long as ANY of its
    /// askers, so a joined asker going away withdraws nothing — see [`PromptHub::release`].
    ///
    /// ## The deadline belongs to the FIRST asker
    ///
    /// A joiner inherits the card's existing `expires_at` rather than extending it. Extending
    /// would let a late joiner keep a question standing past the deadline the operator was
    /// shown, which is a different question from the one they were asked.
    pub(crate) fn publish(
        &self,
        prompt: OperatorPrompt,
        asker: PendingPromptAsker,
        timeout_ms: u64,
        subject: Option<String>,
    ) -> Result<PromptTicket, PublishRefusal> {
        let (tx, rx) = oneshot::channel();
        let asked_at = now_epoch_millis();

        {
            let mut inner = self.inner.lock().expect("prompt hub poisoned");

            // JOIN, when the asker declared a subject already being asked about.
            if let Some(key) = subject.as_deref() {
                if let Some(entry) = inner
                    .entries
                    .values_mut()
                    .find(|entry| entry.pending.subject.as_deref() == Some(key))
                {
                    entry.settle.push(tx);
                    entry.pending.waiters = entry.settle.len();
                    let pending = entry.pending.clone();
                    return Ok(PromptTicket {
                        hub: self.clone(),
                        pending,
                        rx,
                    });
                }
            }

            if inner.entries.len() >= inner.max_pending {
                return Err(PublishRefusal::TooManyPending(inner.max_pending));
            }
            let id = format!("p-{}", uuid::Uuid::new_v4().simple());
            let pending = PendingPrompt {
                wire: PENDING_PROMPT_WIRE,
                answer_travels: prompt.answer_travels(),
                id: id.clone(),
                subject,
                waiters: 1,
                prompt,
                asker,
                asked_at,
                expires_at: Some(asked_at.saturating_add(timeout_ms)),
            };
            inner.seq += 1;
            let seq = inner.seq;
            inner.entries.insert(
                id,
                HubEntry {
                    pending: pending.clone(),
                    seq,
                    settle: vec![tx],
                },
            );
            Ok(PromptTicket {
                hub: self.clone(),
                pending,
                rx,
            })
        }
    }

    /// One asker has stopped waiting. Withdraw the card only when it was the LAST one.
    ///
    /// THIS IS P1 UNDER COALESCING, and getting it wrong is silent: a naive `Drop` that always
    /// withdrew would let any joined asker's exit cancel a question the others are still waiting
    /// on — and the operator would see the card vanish for no reason they could observe.
    ///
    /// The dropped asker's own sender goes with it; the remaining ones keep the card alive.
    /// Idempotent, like `withdraw`: an entry already settled is simply not there.
    pub(crate) fn release(&self, prompt_id: &str) {
        let mut inner = self.inner.lock().expect("prompt hub poisoned");
        let Some(entry) = inner.entries.get_mut(prompt_id) else {
            return;
        };
        // A closed receiver is a departed asker. Dropping them here rather than counting
        // separately keeps ONE source of truth for "who is still waiting".
        entry.settle.retain(|sender| !sender.is_closed());
        entry.pending.waiters = entry.settle.len();
        if !entry.settle.is_empty() {
            return;
        }
        let settlement = PendingPromptSettlement {
            prompt_id: prompt_id.to_string(),
            outcome: OUTCOME_ABANDONED,
            device: TERMINAL_PROMPT_DEVICE.to_string(),
            reason: Some(AbandonReason::Withdrawn.as_str()),
            at: now_epoch_millis(),
        };
        inner.claim(prompt_id, settlement, None);
    }

    /// Every prompt still waiting, oldest first. Never includes a settled one.
    pub(crate) fn list(&self) -> Vec<PendingPrompt> {
        let inner = self.inner.lock().expect("prompt hub poisoned");
        let mut entries: Vec<&HubEntry> = inner.entries.values().collect();
        entries.sort_by_key(|entry| entry.seq);
        entries.iter().map(|entry| entry.pending.clone()).collect()
    }

    /// How many questions are waiting. Test-only: production code asks the hub to DO
    /// something, never to describe itself.
    #[cfg(test)]
    pub(crate) fn pending_count(&self) -> usize {
        self.inner.lock().expect("prompt hub poisoned").entries.len()
    }

    /// Settle a prompt with an answer. The first caller wins; the rest are told WHY, because
    /// a silent drop teaches a caller to retry harder.
    pub(crate) fn answer(&self, prompt_id: &str, value: &Value, device: &str) -> AnswerOutcome {
        let mut inner = self.inner.lock().expect("prompt hub poisoned");
        let Some(entry) = inner.entries.get(prompt_id) else {
            return match inner.settlement_of(prompt_id) {
                // "The answer is no" and "I could not ask" are different answers, and a peer
                // that lost a race deserves the first one.
                Some(settlement) => AnswerOutcome::AlreadySettled(settlement),
                None => AnswerOutcome::Unknown,
            };
        };
        let checked = match check_answer(&entry.pending.prompt, value) {
            Ok(checked) => checked,
            Err(detail) => return AnswerOutcome::Invalid(detail),
        };
        let settlement = PendingPromptSettlement {
            prompt_id: prompt_id.to_string(),
            outcome: OUTCOME_ANSWERED,
            device: device.to_string(),
            reason: None,
            at: now_epoch_millis(),
        };
        if !inner.claim(prompt_id, settlement.clone(), Some(checked)) {
            return match inner.settlement_of(prompt_id) {
                Some(won) => AnswerOutcome::AlreadySettled(won),
                None => AnswerOutcome::Unknown,
            };
        }
        AnswerOutcome::Settled(settlement)
    }

    /// End a prompt WITHOUT an answer (P5). Idempotent: `false` when something else already
    /// settled it.
    pub(crate) fn withdraw(&self, prompt_id: &str, reason: AbandonReason, device: &str) -> bool {
        let settlement = PendingPromptSettlement {
            prompt_id: prompt_id.to_string(),
            outcome: OUTCOME_ABANDONED,
            device: device.to_string(),
            reason: Some(reason.as_str()),
            at: now_epoch_millis(),
        };
        let mut inner = self.inner.lock().expect("prompt hub poisoned");
        inner.claim(prompt_id, settlement, None)
    }

    /// How a recently-settled prompt ended, or `None` once it has aged out of the ring. The
    /// route path reads the ring through `answer` (which must consult it under the SAME lock
    /// it just lost the race on); this is the test-facing view of the same fact.
    #[cfg(test)]
    pub(crate) fn settlement_of(&self, prompt_id: &str) -> Option<PendingPromptSettlement> {
        self.inner
            .lock()
            .expect("prompt hub poisoned")
            .settlement_of(prompt_id)
    }
}

/// The asker's handle on one published question.
///
/// **This is where P1 is realized.** Dropping the ticket withdraws the prompt, so a question
/// cannot outlive the process that is waiting for the answer: an asker that is killed, a
/// request whose connection drops, a handler future axum cancels — every one of them ends in
/// this `Drop`, and the question disappears from every attending device's next poll.
pub(crate) struct PromptTicket {
    hub: PromptHub,
    pub(crate) pending: PendingPrompt,
    rx: oneshot::Receiver<PromptOutcome>,
}

impl PromptTicket {
    /// Wait for this prompt to be settled — by any of the paths that can settle it.
    ///
    /// BORROWS rather than consumes: the channel cannot be moved out of a ticket whose
    /// `Drop` is the whole of P1, and that is the point — the ticket must still be here to
    /// withdraw the question if this wait is abandoned.
    ///
    /// `None` only if the hub dropped the sender without settling, which nothing does.
    pub(crate) async fn settled_await(&mut self) -> Option<PromptOutcome> {
        (&mut self.rx).await.ok()
    }

    /// The settlement already delivered, without waiting. Test-only.
    #[cfg(test)]
    pub(crate) fn settled_now(&mut self) -> Option<PromptOutcome> {
        self.rx.try_recv().ok()
    }
}

impl Drop for PromptTicket {
    fn drop(&mut self) {
        // CLOSE OUR OWN RECEIVER FIRST. `Drop::drop` runs BEFORE this struct's fields are
        // dropped, so at this instant `self.rx` is still alive and the hub would count this very
        // asker as still waiting — the card would never be withdrawn, and P1 would be quietly
        // gone. Closing it is what makes "is anyone still listening?" the honest question.
        self.rx.close();
        // RELEASE, not withdraw. A card may have several askers waiting on it (coalescing), and
        // this one leaving must not cancel the question for the rest — `release` withdraws only
        // when the last waiter is gone. Idempotent, exactly as before: an entry already settled
        // is not in the map.
        self.hub.release(&self.pending.id);
    }
}

fn now_epoch_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

// ── HTTP surface ───────────────────────────────────────────────────────────────────────

fn json_error(status: StatusCode, body: Value) -> axum::response::Response {
    (status, Json(body)).into_response()
}

/// `GET /prompts` — every question still waiting, and the interval to come back at.
///
/// Returns no answers and no settlements: this surface can be used to SEE a question and to
/// GIVE an answer, never to read one back.
pub(crate) async fn get_prompts(State(state): State<SidecarState>) -> impl IntoResponse {
    Json(serde_json::json!({
        "wire": PENDING_PROMPT_WIRE,
        // Stated, not implied — an attending device should not have to guess how often it
        // is welcome to ask.
        "pollIntervalMs": PENDING_PROMPT_POLL_INTERVAL_MS,
        "prompts": state.prompts.list(),
        // ADDITIVE, and `wire` does NOT bump. `parsePendingPromptList` reads `prompts`
        // and ignores what it does not know, so a kit frozen at whatever `farm-update`
        // last fetched shows no framing and is otherwise unchanged — the correct
        // degradation, and the same judgement `checkPendingPromptWire` makes when it
        // admits `unknown` rather than locking the operator out of a working device.
        "notices": state.prompts.notices(),
    }))
}

/// `POST /notices` — state a fact (N1).
///
/// Its OWN route rather than a field on `POST /prompts`, because those two are
/// different concerns that merely coincide today. Riding the publish would make
/// TRANSPORT (how the node's ring learns what was said) inherit a DELIVERY rule (D9:
/// framing rides the question so a three-line preflight is not three Telegram
/// messages) — a coincidence that holds only while the sole producer is a wizard that
/// always asks next, and that would leave every future statement the node makes ("the
/// VPN is up", an automation's result, an operation's progress) needing a road of its
/// own. That is the fragmentation already spread across `stream:v1`,
/// `connection_frames` and `login-flow`; this would have been the fourth.
///
/// AUTH is not a new decision: publishing is the ASKER's side, exactly like
/// `POST /prompts`, so this route declares no scope in `auth::route_requirement` and is
/// therefore reachable by device credentials only — never by the `prompt:answer`
/// credential, which belongs to whoever ANSWERS.
///
/// Returns immediately. There is nothing to wait for: a notice has no settlement.
pub(crate) async fn post_notices(
    State(state): State<SidecarState>,
    Json(request): Json<PublishNoticeRequest>,
) -> impl IntoResponse {
    if request.message.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "empty-notice" })),
        );
    }
    let notice = state
        .prompts
        .announce(&request.asker, &request.message, request.kind);
    (StatusCode::OK, Json(serde_json::json!({ "ordinal": notice.ordinal })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublishNoticeRequest {
    pub(crate) asker: PendingPromptAsker,
    pub(crate) message: String,
    /// Absent ⇒ `context`, matching the contract's default so a caller that says only
    /// a sentence gets the same kind on both sides of the wire.
    #[serde(default = "default_notice_kind")]
    pub(crate) kind: NoticeKind,
}

fn default_notice_kind() -> NoticeKind {
    NoticeKind::Context
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PublishPromptRequest {
    prompt: OperatorPrompt,
    asker: PendingPromptAsker,
    /// The asker's deadline. Omitted or `null` ⇒ [`DEFAULT_PROMPT_TIMEOUT_MS`]; above
    /// [`MAX_PROMPT_TIMEOUT_MS`] ⇒ clamped. There is no "no deadline" on this surface.
    #[serde(default)]
    timeout_ms: Option<u64>,
    /// WHAT THIS QUESTION IS ABOUT — the coalescing key, and OPT-IN.
    ///
    /// Omitted, this publishes a card of its own, exactly as before. Supplied, an asker whose
    /// subject matches one already waiting JOINS that card instead of adding another, and the
    /// single answer settles every joined asker.
    ///
    /// DECLARED, NEVER INFERRED FROM THE QUESTION TEXT. Two prompts can read identically and
    /// mean different things — "Bring the VPN up?" for a read-only sync and for a deploy are not
    /// one decision, and sharing an answer between them would hand the operator's consent to a
    /// thing they were not shown. The asker is the only party that knows whether two questions
    /// are the same question, so the asker says so. Same discipline as `--attended-elsewhere`:
    /// a claim the caller makes, not a similarity the node guesses.
    #[serde(default)]
    subject: Option<String>,
}

/// `POST /prompts` — publish a question and WAIT for it to be settled (the asker's side).
///
/// The request stays open for the prompt's whole life, which is what makes P1 free. Three
/// ways it ends, and the asker can tell them apart without parsing prose:
///
/// - `200 {"outcome":"answered","device":…,"value":…}` — somebody answered;
/// - `200 {"outcome":"abandoned","reason":"expired",…}` — the deadline passed (P5);
/// - `200 {"outcome":"abandoned","reason":"withdrawn",…}` — the prompt was withdrawn.
///
/// Expiry is deliberately a 200 with a NAMED outcome rather than a timeout status or a
/// dropped connection: a transport-level failure is indistinguishable from a broken network,
/// and an asker that cannot tell "nobody answered in time" from "the node is unreachable"
/// will retry the second when it should be handling the first.
pub(crate) async fn post_prompts(
    State(state): State<SidecarState>,
    Json(raw): Json<Value>,
) -> impl IntoResponse {
    let request: PublishPromptRequest = match serde_json::from_value(raw) {
        Ok(request) => request,
        Err(error) => {
            return json_error(
                StatusCode::BAD_REQUEST,
                serde_json::json!({ "error": "invalid-prompt", "detail": error.to_string() }),
            );
        }
    };

    let timeout_ms = request
        .timeout_ms
        .unwrap_or(DEFAULT_PROMPT_TIMEOUT_MS)
        .min(MAX_PROMPT_TIMEOUT_MS);

    let mut ticket = match state.prompts.publish(
        request.prompt,
        request.asker,
        timeout_ms,
        request.subject.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()),
    ) {
        Ok(ticket) => ticket,
        Err(PublishRefusal::TooManyPending(ceiling)) => {
            return json_error(
                StatusCode::TOO_MANY_REQUESTS,
                serde_json::json!({
                    "error": "too-many-pending",
                    "detail": format!(
                        "{ceiling} prompts are already pending — refusing to queue more"
                    ),
                    "maxPending": ceiling,
                }),
            );
        }
    };

    let prompt_id = ticket.pending.id.clone();
    let expires_at = ticket.pending.expires_at;
    tracing::info!(
        prompt_id = %prompt_id,
        kind = ticket.pending.prompt.kind(),
        answer_travels = ticket.pending.answer_travels,
        timeout_ms,
        "pending prompt published — waiting for an operator"
    );

    // Interruptible waiting, bounded by the asker's own deadline (P5). `timeout` polls the
    // settlement first and the clock second, so a settlement that landed in the very instant
    // the deadline fired is read as the answer it is rather than as an expiry.
    let waited = tokio::time::timeout(Duration::from_millis(timeout_ms), &mut ticket.rx).await;
    let outcome = match waited {
        Ok(received) => received.ok(),
        Err(_elapsed) => {
            // Claim the expiry. If a device won in that same instant this returns false and
            // THEIR settlement is already in the channel — either way exactly one settlement
            // was sent, so taking it here cannot block.
            state
                .prompts
                .withdraw(&prompt_id, AbandonReason::Expired, TERMINAL_PROMPT_DEVICE);
            ticket.settled_await().await
        }
    };

    let Some(outcome) = outcome else {
        // Unreachable while the hub holds the sender until it settles; reported rather than
        // panicked so a handler can never take the daemon's task down with it.
        return json_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            serde_json::json!({ "error": "prompt-lost", "promptId": prompt_id }),
        );
    };

    // WHO answered, never WHAT. This is the only line this path logs, and it is the same
    // information a losing peer is given.
    tracing::info!(
        prompt_id = %outcome.settlement.prompt_id,
        outcome = outcome.settlement.outcome,
        device = %outcome.settlement.device,
        reason = outcome.settlement.reason.unwrap_or("-"),
        "pending prompt settled"
    );

    let mut body = serde_json::json!({
        "promptId": outcome.settlement.prompt_id,
        "outcome": outcome.settlement.outcome,
        "device": outcome.settlement.device,
        "at": outcome.settlement.at,
        "expiresAt": expires_at,
    });
    if let Some(reason) = outcome.settlement.reason {
        body["reason"] = Value::String(reason.to_string());
    }
    // The ONE place an answer value is written into a response: the open request of the
    // asker that asked for it.
    if let Some(AnswerValue(value)) = outcome.value {
        body["value"] = value;
    }
    (StatusCode::OK, Json(body)).into_response()
}

/// `POST /prompts/:id/answer` — settle a pending prompt (the attending device's side).
///
/// The answering identity is `device`, resolved from the LISTENER's gate. The body is read
/// for exactly one field, `value`; a `device` field a caller sends is not merged, not
/// preferred, not even consulted — see [`resolve_answering_device`].
pub(crate) async fn post_prompt_answer(
    State(state): State<SidecarState>,
    AxumPath(prompt_id): AxumPath<String>,
    authenticated: Option<Extension<AuthenticatedDevice>>,
    Json(body): Json<Value>,
) -> impl IntoResponse {
    let device = resolve_answering_device(authenticated.as_ref().map(|ext| &ext.0));
    let value = body.get("value").cloned().unwrap_or(Value::Null);

    match state.prompts.answer(&prompt_id, &value, &device) {
        AnswerOutcome::Settled(settlement) => (
            StatusCode::OK,
            Json(serde_json::json!({
                "outcome": settlement.outcome,
                "device": settlement.device,
            })),
        )
            .into_response(),
        AnswerOutcome::AlreadySettled(settlement) => {
            // 409, naming WHO settled it: a peer that lost the race is told what happened.
            let mut body = serde_json::json!({
                "error": "already-settled",
                "outcome": settlement.outcome,
                "device": settlement.device,
            });
            if let Some(reason) = settlement.reason {
                body["reason"] = Value::String(reason.to_string());
            }
            json_error(StatusCode::CONFLICT, body)
        }
        AnswerOutcome::Invalid(detail) => json_error(
            StatusCode::BAD_REQUEST,
            // `detail` is generated from the prompt's own constraints and never quotes the
            // submitted value — a secret must not come back in an error string.
            serde_json::json!({ "error": "invalid-answer", "detail": detail }),
        ),
        AnswerOutcome::Unknown => json_error(
            StatusCode::NOT_FOUND,
            serde_json::json!({ "error": "unknown-prompt" }),
        ),
    }
}

#[cfg(test)]
#[path = "pending_prompt_tests.rs"]
mod tests;
