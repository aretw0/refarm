//! Opt-in per-device authentication gate for the runtime sidecar.
//!
//! The operator's question — "what stops another device from entering my node?" — is
//! answered here: with a policy configured, every sidecar request must carry a valid
//! per-device bearer credential, or it is rejected `401`. This is the identity gate that
//! sits ABOVE the network gate (Tailscale): the tailnet authenticates the device to the
//! network; this authenticates the device to the FARM.
//!
//! **The gate is turned on by a DECLARATION, not by an env var.** `surfaces.<name>` with
//! `"gate": "device-token"` in `.refarm/config.json` IS the opt-in; the policy path is then
//! DERIVED — `<refarm-dir>/auth-policy.json`, the same conventional file
//! `refarm auth enroll` already writes by default. Before this, the writer knew the
//! convention and the reader did not: the reader gated on `REFARM_AUTH_POLICY`'s mere
//! presence, so an operator who declared the gate was still made to plumb the path by hand
//! (`export REFARM_AUTH_POLICY=…`) before the declaration would be believed. That asymmetry
//! was the defect; `resolve_policy_path` is where it is closed.
//!
//! Fail-closed by construction, mirroring the opt-in CORS layer:
//!   - no declared gate and no `REFARM_AUTH_POLICY` ⇒ `resolve_auth_policy` is `None` ⇒ the
//!     layer is never added ⇒ behavior is byte-identical to before the gate existed. Nothing
//!     was declared, so nothing is claimed.
//!   - a declared gate whose policy file does not exist YET ⇒ a **deny-all** policy: bound,
//!     and every request `401` until `refarm auth enroll` mints a credential. Denying all is
//!     the STRICTEST possible enforcement of the declared gate, not a hole — and it is what
//!     keeps a declared-but-not-yet-enrolled node bootable instead of locking the operator
//!     out of a runtime that refuses to start.
//!   - a policy file that exists but is unreadable/invalid ⇒ the same **deny-all** (never
//!     silently ungated): if you asked for auth, a broken policy must lock the door, not
//!     leave it open.
//!
//! Resolved ONCE per daemon start, never once per gate: `main.rs` calls
//! `ResolvedAuthPolicy::resolve` and hands the ANSWER to both the HTTP sidecar and the WS
//! server. `resolve_auth_policy` is private to this module so that "once" is a compile-time
//! property — see `ResolvedAuthPolicy` for the defect that made it necessary.
//!
//! RESOLVED once, but not FROZEN once. "One resolution" is about there being one reader of
//! the file and one answer both gates enforce — it was never meant to make a credential
//! policy immutable for the lifetime of the process. It briefly did, and the operational
//! cost was immediate: enrolling a device (`refarm auth enroll` writes this exact file)
//! required a full runtime restart before the new credential was accepted, and revoking one
//! required a restart before it STOPPED being accepted. A credential policy is precisely the
//! kind of state that must be re-read when it changes. So the one answer both gates hold is
//! a SHARED, updatable handle (`AuthGate`) rather than a snapshot each gate copied: a
//! background watcher re-reads the file and swaps the value behind it, and both gates observe
//! the swap at once because there is only ever one value. See `AuthGate::reload_if_changed`
//! for the fail-closed rule that governs every re-read.
//!
//! Slice 1 (this module) AUTHENTICATES: enrolled device or not. Which workspace/namespace an
//! identity may act in is authorization — Slice 2 (via `@refarm.dev/workspace-access-contract-v1`).
//! The credential is a bearer token; only its SHA-256 is ever stored in the policy (never the
//! raw token), and the lookup is over hashes. `/sync` (the CRDT WS on :42000) is a separate
//! gate, tracked as a follow-up.
//!
//! ## TWO arrays, two meanings — and the one that must never drift
//!
//! `credentials[]` is a DEVICE credential: unscoped, non-expiring, full authority over every
//! route this gate guards. That is exactly what it has always meant, and nothing here widens
//! or narrows it. In particular a `credentials[]` entry that happens to carry a `scope` or an
//! `expiresAt` key is STILL a full device credential — those fields are ignored there, as
//! every unknown field always has been. A field appearing in one array does not change the
//! other array's meaning; the two are parsed by two different functions into two different
//! types, so they cannot be confused for one another by accident.
//!
//! `scopedCredentials[]` (`packages/emoji-sas-v1`, wire `scoped-credential.v1`) is the
//! opposite kind of thing: NARROW authority, and it DIES. It exists so a browser can answer
//! the operator's pending questions without holding a device token. It was deliberately given
//! its own top-level key because this module used to have no scope check and no clock — a
//! "scoped" entry placed in `credentials[]` would have been honoured as a full, permanent
//! device credential. This module now reads that key, with scope and expiry as verified
//! fields, which is what makes the separation an enforcement rather than an absence.
//!
//! ## Routes DECLARE what they require; silence is device-only
//!
//! [`route_requirement`] is the table. A route that names a scope is reachable by a scoped
//! credential holding it — and by any device credential, which is unscoped by design. A route
//! that names NOTHING admits device credentials only. That is the fail-closed reading of
//! silence, and it is the important half: a route added tomorrow, renamed today, or reached
//! by a path this table does not recognize is device-only until someone writes down the scope
//! it is willing to be reached with. Silence never grants.
//!
//! ## The clock, stated
//!
//! Expiry is judged at AUTHENTICATION time, against the host wall clock
//! ([`host_clock_ms`]), never at parse time. An `expiresAt` already in the past when the file
//! is read is therefore a RUNTIME REFUSAL, not a parse error — three reasons, all structural:
//! [`parse_policy`] must stay a pure function of the bytes (a clock inside it would make the
//! same bytes parse two ways); the reload is fingerprint-driven, so an unchanged file is never
//! re-parsed and a deadline that passes between writes would never be noticed if expiry were a
//! load-time decision; and refusing at the door is strictly stricter than refusing at load,
//! because it also covers the credential that expires while the process runs.
//!
//! There is NO skew grace, deliberately. The comparison is `now >= expiresAt` — the same
//! boundary `packages/emoji-sas-v1` uses (`expiresAt <= now` ⇒ expired) — with no tolerance
//! window in either direction. A window could only ever EXTEND a credential's life, which is a
//! widening, and this module does not widen. A host clock running behind therefore lets a
//! credential outlive its deadline by the skew (unavoidable without a trusted time source, and
//! bounded by it); a host clock running ahead kills one early, which is the fail-closed
//! direction and is accepted as the cost. A clock that cannot be read as a point after the
//! UNIX epoch refuses EVERY scoped credential — an unreadable clock cannot be used to say a
//! deadline has not passed. Device credentials have no expiry and are untouched by any of it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use axum::{
    body::Body,
    http::{header, Method, Request, Response, StatusCode},
    middleware::Next,
};
use sha2::{Digest, Sha256};

use crate::security_events::{Budget, SecurityEvent};

/// Env naming the auth policy file — an OVERRIDE of the derived path, never the only way in.
/// Set to a non-blank value ⇒ that exact path wins over any derivation (the operator's
/// explicit value always beats a convention). Unset — or set to blank, which is not a value
/// and never was — ⇒ the path is derived from the declaration (`resolve_policy_path`).
pub(crate) const AUTH_POLICY_ENV: &str = "REFARM_AUTH_POLICY";

/// The conventional policy file name inside the refarm dir. Byte-identical to the default
/// `refarm auth enroll` writes (`apps/refarm/src/commands/auth.ts`'s `DEFAULT_POLICY_PATH` =
/// `.refarm/auth-policy.json`) — deliberately ONE convention shared by the writer and the
/// reader, because the whole defect this constant fixes was the writer knowing a convention
/// the reader did not.
pub(crate) const AUTH_POLICY_FILE_NAME: &str = "auth-policy.json";

/// How often the watcher re-reads the policy file. The upper bound on how long an enrolment
/// waits to be honoured — and, more importantly, on how long a REVOCATION waits to bite.
///
/// Deliberately a poll and not an inotify subscription: no watch crate is in this crate's
/// dependency tree (`notify` is not in the lock), and the writer this must follow is an
/// atomic tmp→rename, which replaces the INODE. An inotify watch on the path would follow
/// the old inode and go permanently deaf after the first enrolment unless the parent
/// directory were watched instead — more machinery, and a new dependency, to observe a
/// ~200-byte file. A read of that file every two seconds costs nothing measurable, follows
/// a rename by construction, and re-reads nothing when the bytes are unchanged (see
/// `Reading::fingerprint`).
const RELOAD_POLL_INTERVAL: Duration = Duration::from_secs(2);

/// Wire scope names. Their vocabulary is pinned to emoji-sas-v1's shared fixture in tests:
/// one authority contract, consumed by two runtimes.
pub(crate) const SCOPE_ANSWER_PROMPTS: &str = "prompt:answer";
pub(crate) const SCOPE_READ_OPERATIONS: &str = "operation:read";
pub(crate) const SCOPE_START_OPERATIONS: &str = "operation:start";

/// The wire discriminator every scoped entry must carry (`SCOPED_CREDENTIAL_WIRE` in
/// `emoji-sas-v1`). An entry without it is not a scoped credential and is refused.
pub(crate) const SCOPED_CREDENTIAL_WIRE: &str = "scoped-credential.v1";

/// A scope, VALIDATED. An enum rather than a string, and that is the point: an unknown scope
/// string CANNOT be represented, so "an unknown scope refuses the credential" is a property
/// of the type instead of a check somebody has to remember to write at every use site. The
/// only door into this type is [`Scope::from_wire`], and it is total.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Scope {
    /// `prompt:answer` — read this node's pending questions and settle them, and nothing
    /// else.
    AnswerPrompts,
    ReadOperations,
    StartOperations,
}

impl Scope {
    /// The wire string, or `None` when the string names no scope this node knows. Fail-closed
    /// by construction: a scope we do not understand is never narrowed to one we do.
    fn from_wire(raw: &str) -> Option<Self> {
        match raw {
            SCOPE_ANSWER_PROMPTS => Some(Scope::AnswerPrompts),
            SCOPE_READ_OPERATIONS => Some(Scope::ReadOperations),
            SCOPE_START_OPERATIONS => Some(Scope::StartOperations),
            _ => None,
        }
    }

    /// The wire string for this scope.
    ///
    /// This was test-only, under the rule that "nothing in the running gate ever renders a
    /// scope — a scope printed beside an identity is exactly the log line this module refuses
    /// to emit". That rule is NARROWED here, deliberately and to one place: it remains true of
    /// every `tracing` line this module emits (none names a scope, an identity, or a hash), and
    /// it stops being true of the authorisation audit, which exists precisely so the operator
    /// can see what authority was exercised and by whom.
    ///
    /// The two are different objects, not a rule and its exception. A log line is emitted to
    /// whatever collects the process's output; the audit is a local, rotation-bounded,
    /// operator-owned file whose entire purpose is answering "was this device used last
    /// night, and to do what". An audit that withheld the scope could not answer the second
    /// half — and a scope is authority metadata, not a secret: it is never a credential, and
    /// knowing that a route required `prompt:answer` helps nobody hold one.
    pub(crate) const fn wire(self) -> &'static str {
        match self {
            Scope::AnswerPrompts => SCOPE_ANSWER_PROMPTS,
            Scope::ReadOperations => SCOPE_READ_OPERATIONS,
            Scope::StartOperations => SCOPE_START_OPERATIONS,
        }
    }
}

/// The two route paths whose scope is DECLARED below. Stated here and registered from here
/// (`sidecar::sidecar_routes` names these constants), so the route the router serves and the
/// route this table judges cannot drift apart by a rename — the drift that would silently
/// turn a scoped route back into a device-only one, or the reverse.
pub(crate) const ROUTE_PROMPTS: &str = "/prompts";
/// The answer route, in axum's pattern form. [`route_requirement`] matches the CONCRETE path
/// (`/prompts/<id>/answer`) segment by segment; `route_requirement_matches_the_registered_patterns`
/// pins the two spellings against each other.
pub(crate) const ROUTE_PROMPT_ANSWER: &str = "/prompts/:id/answer";

/// What a ROUTE requires of the credential presented to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RouteRequirement {
    /// The route DECLARES a scope. A scoped credential holding it passes — and so does any
    /// device credential, which is unscoped by design and always had authority here.
    Scoped(Scope),
    /// The route declares NOTHING, and therefore admits a device credential only. The
    /// default, and the fail-closed reading of silence: an unrecognised path, an unexpected
    /// method, a route added tomorrow — all device-only until someone writes down the scope
    /// the route is willing to be reached with.
    DeviceOnly,
}

/// THE route→scope table. PURE: a method and a path in, a requirement out; no state, no
/// request body, nothing a caller can influence beyond the request line itself.
///
/// Matched over the CONCRETE path's segments rather than axum's `MatchedPath` extension so
/// the decision is a testable pure function of two values instead of a property of how the
/// middleware happens to be layered — and so that a path this table does not recognize
/// (percent-encoded, trailing-slashed, mis-nested) falls through to [`RouteRequirement::DeviceOnly`]
/// rather than to whatever a partial match would have yielded.
///
/// Note the two entries are METHOD-specific: `GET /prompts` (read the questions) is scoped,
/// `POST /prompts` (publish one — an asking process's act, not an answering device's) is not.
/// Same path, different authority.
pub(crate) fn route_requirement(method: &Method, path: &str) -> RouteRequirement {
    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    match (method, segments.as_slice()) {
        (&Method::GET, ["prompts"]) => RouteRequirement::Scoped(Scope::AnswerPrompts),
        (&Method::POST, ["prompts", _, "answer"]) => RouteRequirement::Scoped(Scope::AnswerPrompts),
        (&Method::GET, ["operations"]) | (&Method::GET, ["operations", _]) => {
            RouteRequirement::Scoped(Scope::ReadOperations)
        }
        (&Method::POST, ["operations"]) => RouteRequirement::Scoped(Scope::StartOperations),
        (&Method::POST, ["operations", _, "cancel"]) => {
            RouteRequirement::Scoped(Scope::StartOperations)
        }
        _ => RouteRequirement::DeviceOnly,
    }
}

/// A device credential: the SHA-256 (lowercase hex) of its bearer token → the identity it
/// authenticates as. The raw token never lives in the policy.
///
/// UNSCOPED and NON-EXPIRING, exactly as it has always been: this is the full authority of an
/// enrolled device. There is deliberately no scope field and no expiry field here — a device
/// credential that could carry either would be a scoped credential under a name that promises
/// otherwise, and the whole separation would be a comment again.
#[derive(Debug, Clone)]
pub(crate) struct Credential {
    pub(crate) token_sha256: String,
    pub(crate) identity: String,
}

/// A scoped credential: narrow authority, and it dies. Structurally a DIFFERENT TYPE from
/// [`Credential`], parsed by a different function out of a different array — which is what
/// makes "a scoped entry is never a device credential" impossible to get wrong rather than
/// merely intended.
#[derive(Debug, Clone)]
pub(crate) struct ScopedCredential {
    pub(crate) token_sha256: String,
    pub(crate) identity: String,
    /// What it may do. Never empty off disk (an entry with no scope is refused at parse), so
    /// an empty set can only be constructed in a test — where it is exactly the mutation
    /// guard for a `scope.contains(..)` that got optimised into `true`.
    pub(crate) scope: Vec<Scope>,
    /// Epoch ms. Never optional: a scoped credential with no deadline is a device credential
    /// with a different field name.
    pub(crate) expires_at_ms: i64,
}

/// WHAT authenticated — the identity to attribute the request to, and which KIND of
/// credential said so. The kind is not used to grant anything (the grant already happened);
/// it exists so "this scoped entry was honoured as a scoped credential, not promoted to a
/// device one" is a thing a test can assert directly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Verified {
    pub(crate) identity: String,
    pub(crate) kind: CredentialKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CredentialKind {
    Device,
    Scoped,
}

/// WHAT the gate decided about one credential on one route — the four facts it has always
/// known and, until now, had no way to tell apart.
///
/// [`AuthPolicy::verify`] used to return `Option<Verified>`, and a bare `None` meant three
/// unrelated things at once: nothing recognises this token, this token is recognised and may
/// not do this, this token is recognised and has expired. Those have three different remedies
/// and exactly one of them is an attack, so conflating them meant the limiter punished a
/// caller with a scope bug as though it were guessing credentials.
///
/// The distinction stops HERE. `verify` still exists and still answers `Option<Verified>` —
/// it is now literally defined as this value with the distinction forgotten
/// ([`Decision::verified`]) — so every existing caller, the WS handshake included, is
/// unchanged. What is new is that the middleware can ask the finer question, and does.
///
/// Nothing derived from this value reaches the caller. See [`auth_middleware`]: all three
/// refusals render the same bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Decision {
    /// The credential verified and the route's authority is satisfied.
    Verified(Verified),
    /// Nothing in force matches the token presented. The ONLY fact here that is evidence of
    /// guessing, and therefore the only one that spends the guessing budget.
    ///
    /// Carries no identity because there is none to carry — a token that matches nothing
    /// resolves to nobody, which is also why this variant can never name a victim.
    AuthenticationFailed,
    /// The credential VERIFIED — this node issued it and still honours it — and it does not
    /// hold the authority this route requires.
    ///
    /// Only a scoped credential can reach here: a device credential is unscoped and satisfies
    /// every requirement, so it never gets past the first branch of [`AuthPolicy::decide`].
    AuthorizationRefused { identity: String },
    /// The credential verified and its deadline has passed — or the host clock cannot be read,
    /// which cannot be used to assert that a deadline has NOT passed.
    ///
    /// Checked before the route's authority on purpose: expiry is a property of the CREDENTIAL,
    /// not of the request, so the fact does not change with whichever route the caller happened
    /// to hit. An expired credential is expired everywhere, and the remedy ("issue another") is
    /// the same everywhere.
    CredentialExpired { identity: String },
}

impl Decision {
    /// The distinction, FORGOTTEN — what every caller outside the middleware sees, and the
    /// definition of [`AuthPolicy::verify`]. Written as a projection rather than as a second
    /// code path so the two answers cannot drift: there is one decision procedure, and the
    /// coarse answer is a function of the fine one.
    ///
    /// `#[cfg(test)]` for the same reason [`AuthGate::authenticate`] is: since the middleware
    /// began asking the finer question, the coarse answer has no production caller, and a
    /// production caller able to discard the reason is how the conflation would grow back. It
    /// is kept — and exercised by every pre-existing test in this module, unchanged — because
    /// "the new decision procedure answers exactly what the old one answered" is the whole
    /// regression proof, and it is only checkable if the old question is still askable.
    #[cfg(test)]
    fn verified(self) -> Option<Verified> {
        match self {
            Decision::Verified(verified) => Some(verified),
            _ => None,
        }
    }

    /// The identity this decision RESOLVED, when it resolved one. Never one a caller claimed —
    /// a caller has no way to claim one here.
    fn identity(&self) -> Option<&str> {
        match self {
            Decision::Verified(verified) => Some(verified.identity.as_str()),
            Decision::AuthorizationRefused { identity }
            | Decision::CredentialExpired { identity } => Some(identity.as_str()),
            Decision::AuthenticationFailed => None,
        }
    }

    /// Which KIND of credential this decision concerns. `Scoped` for both recognised-refusals
    /// by construction (see [`Decision::AuthorizationRefused`]) — stated here, in one place,
    /// rather than hardcoded at the audit call site where it would rot silently the day a
    /// device credential gains a scope.
    fn kind(&self) -> Option<CredentialKind> {
        match self {
            Decision::Verified(verified) => Some(verified.kind),
            Decision::AuthorizationRefused { .. } | Decision::CredentialExpired { .. } => {
                Some(CredentialKind::Scoped)
            }
            Decision::AuthenticationFailed => None,
        }
    }

    /// Which budget this decision spends when it is a refusal — the separation, as one
    /// function. `None` for a verified decision: a success spends nothing.
    fn budget(&self) -> Option<Budget> {
        match self {
            Decision::Verified(_) => None,
            Decision::AuthenticationFailed => Some(Budget::Authentication),
            Decision::AuthorizationRefused { .. } | Decision::CredentialExpired { .. } => {
                Some(Budget::Authorization)
            }
        }
    }

    /// The event this decision emits when it is REFUSED (a rate limit engaging is decided by
    /// the limiter, not here, and is named at that point).
    fn refusal_event(&self) -> Option<SecurityEvent> {
        match self {
            Decision::Verified(_) => None,
            Decision::AuthenticationFailed => Some(SecurityEvent::AuthenticationFailed),
            Decision::AuthorizationRefused { .. } => Some(SecurityEvent::AuthorizationRefused),
            Decision::CredentialExpired { .. } => Some(SecurityEvent::CredentialExpired),
        }
    }
}

/// The host wall clock as epoch milliseconds, or `None` when it cannot be read as a point
/// after the UNIX epoch. `None` refuses every scoped credential — see the module doc's clock
/// section: an unreadable clock cannot be used to assert that a deadline has NOT passed.
///
/// Wall clock and not a monotonic one because `expiresAt` is an absolute epoch instant minted
/// on another machine; there is nothing for a monotonic reading to be compared against.
fn host_clock_ms() -> Option<i64> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|elapsed| elapsed.as_millis() as i64)
}

/// The resolved auth policy: the enrolled device credentials, plus any scoped credentials.
#[derive(Debug, Clone, Default)]
pub(crate) struct AuthPolicy {
    credentials: Vec<Credential>,
    scoped: Vec<ScopedCredential>,
    /// How many `scopedCredentials` entries were REFUSED by the parser. A count, for the one
    /// log line — never which entry, never whose.
    refused_scoped: usize,
}

impl AuthPolicy {
    /// Authenticate a bearer token as a DEVICE → the identity it maps to, or `None`. The
    /// token is hashed and matched against stored hashes — the raw token is never compared.
    /// PURE.
    ///
    /// Device credentials ONLY, and that is unchanged in every particular: a scoped
    /// credential is never returned from here, whatever it holds and whenever it is asked.
    ///
    /// TEST-ONLY since the WS handshake began asking [`AuthGate::admit`] with
    /// [`RouteRequirement::DeviceOnly`]. That question ADMITS EXACTLY WHAT THIS ONE DID — a
    /// device credential and nothing else, by the module's own rule for silence — and it also
    /// says WHY it refused, which is what lets the handshake spend the right budget and write
    /// the right event. Kept, and still asserted against, because "the finer question admits
    /// exactly what the coarse one always did" is only checkable while the coarse one is still
    /// askable.
    #[cfg(test)]
    pub(crate) fn authenticate(&self, token: &str) -> Option<&str> {
        let digest = sha256_hex(token);
        self.credentials
            .iter()
            .find(|c| c.token_sha256 == digest)
            .map(|c| c.identity.as_str())
    }

    /// Verify a bearer token against ONE route's requirement, at one instant. PURE — the
    /// clock is an argument, so the whole decision is testable without waiting for time to
    /// pass or faking a global.
    ///
    /// Order matters and is deliberate: a DEVICE credential is checked first and satisfies
    /// every requirement, because it is unscoped by design. Only then, and only if the route
    /// declared a scope, is the scoped set consulted — so a route that declared nothing can
    /// never be reached by a scoped credential, no matter what that credential holds.
    ///
    /// The three scoped conditions are all required, every time: the hash matches, the scope
    /// is held, and the deadline has not passed. `None` for any failure, with no reason
    /// returned — a gate that says WHICH of the three failed is a gate that helps someone
    /// enumerate.
    ///
    /// TEST-ONLY since the middleware began asking [`Self::decide`] — see
    /// [`Decision::verified`]. Its every pre-existing assertion still holds, which is the
    /// point: this is the old question, still answered the old way.
    #[cfg(test)]
    pub(crate) fn verify(
        &self,
        token: &str,
        required: RouteRequirement,
        now_ms: Option<i64>,
    ) -> Option<Verified> {
        self.decide(token, required, now_ms).verified()
    }

    /// The SAME verification, with the reason kept. PURE, for the same reason [`Self::verify`]
    /// is: the clock is an argument.
    ///
    /// Order, and why each step is where it is:
    ///
    /// 1. **Device credential.** Unscoped by design, satisfies every requirement. Checked
    ///    first, exactly as before, so a route that declared nothing can never be reached by a
    ///    scoped credential no matter what it holds.
    /// 2. **Is this token recognised at all?** A token matching neither set is
    ///    [`Decision::AuthenticationFailed`] — and this is the ONE new lookup: the old code
    ///    returned early for a `DeviceOnly` route without ever consulting the scoped set, so a
    ///    browser holding a real scoped credential and a device-only route looked exactly like
    ///    a stranger guessing. That is the conflation this whole change exists to end, and it
    ///    lived in a `let … else` two lines long.
    /// 3. **Expiry**, before authority — see [`Decision::CredentialExpired`].
    /// 4. **Authority.** A route that declared nothing admits device credentials only, so a
    ///    recognised scoped credential is refused there; a route that declared a scope admits
    ///    a credential that holds it.
    ///
    /// The caller learns none of this. `verify` — which is what every existing call site uses
    /// — is this function with steps 2–4 collapsed back into one `None`.
    pub(crate) fn decide(
        &self,
        token: &str,
        required: RouteRequirement,
        now_ms: Option<i64>,
    ) -> Decision {
        let digest = sha256_hex(token);
        if let Some(device) = self.credentials.iter().find(|c| c.token_sha256 == digest) {
            return Decision::Verified(Verified {
                identity: device.identity.clone(),
                kind: CredentialKind::Device,
            });
        }
        let Some(entry) = self.scoped.iter().find(|c| c.token_sha256 == digest) else {
            return Decision::AuthenticationFailed;
        };
        // An unreadable clock refuses, rather than being treated as instant zero (which would
        // make every deadline lie in the future — the widening direction).
        let expired = match now_ms {
            None => true,
            Some(now) => now >= entry.expires_at_ms,
        };
        if expired {
            return Decision::CredentialExpired { identity: entry.identity.clone() };
        }
        let RouteRequirement::Scoped(required) = required else {
            return Decision::AuthorizationRefused { identity: entry.identity.clone() };
        };
        if !entry.scope.contains(&required) {
            return Decision::AuthorizationRefused { identity: entry.identity.clone() };
        }
        Decision::Verified(Verified { identity: entry.identity.clone(), kind: CredentialKind::Scoped })
    }

    /// A deny-all policy — every request is rejected. The fail-closed fallback.
    fn deny_all() -> Self {
        Self::default()
    }

    /// How many device identities this policy admits. A count says "the revocation landed"
    /// without naming a token, a hash, or an identity.
    fn identity_count(&self) -> usize {
        self.credentials.len()
    }

    /// How many scoped credentials this policy admits — counted the same way, and logged
    /// separately from `identity_count` so an operator can tell a browser session appearing
    /// from a device being enrolled.
    fn scoped_count(&self) -> usize {
        self.scoped.len()
    }

    /// How many scoped entries the parser REFUSED. Non-zero means the file contains something
    /// this gate will not honour — visible, and countable, without naming it.
    fn refused_scoped_count(&self) -> usize {
        self.refused_scoped
    }

    /// Test-only: a DEVICE-only policy. Signature deliberately unchanged — the WS handshake's
    /// tests build policies through it, and "a device-only policy is what the WS gate judges"
    /// is part of what stays true.
    #[cfg(test)]
    pub(crate) fn from_credentials(credentials: Vec<Credential>) -> Self {
        Self { credentials, ..Default::default() }
    }

    /// Test-only: both arrays at once, bypassing the parser — for the wire tests, and for the
    /// mechanism guards that need a scope set the parser would never produce (an empty one).
    #[cfg(test)]
    pub(crate) fn from_parts(credentials: Vec<Credential>, scoped: Vec<ScopedCredential>) -> Self {
        Self { credentials, scoped, refused_scoped: 0 }
    }
}

/// SHA-256 of `input` as lowercase hex. The same digest the policy file stores per token.
pub(crate) fn sha256_hex(input: &str) -> String {
    use std::fmt::Write as _;
    let digest = Sha256::digest(input.as_bytes());
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        let _ = write!(out, "{byte:02x}");
    }
    out
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// A BOUND ON FAILED AUTHENTICATION — AND A SEPARATE ONE ON REFUSED AUTHORIZATION
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// ## The two facts, and why one budget was wrong
//
// This gate learns two different things and used to spend one budget on both:
//
//   * **authentication failed** — the credential does not verify. Evidence of GUESSING.
//   * **authorization refused** — the credential verifies; the scope is wrong. Evidence of a
//     BUG, in a caller this node itself issued a credential to.
//
// Sharing a budget meant a browser holding a real `prompt:answer` credential that asked for
// five routes it had no authority for was locked out for a minute — including from the routes
// it WAS entitled to — for a mistake in its own routing. A legitimate app punished as an
// attacker, and the node blind to the difference in the one place it mattered.
//
// They no longer share. [`FailureLimiter`] holds two [`BudgetTable`]s, [`Budget`] names which
// one a refusal spends, and a scope refusal cannot touch the guessing budget. What that buys,
// precisely: a credential with a scope bug keeps working on the routes it is entitled to,
// while still being told — at a bounded rate — about the ones it is not.
//
// ## Identical outward, distinguished inward
//
// The separation must not become a credential-validity ORACLE. Answering "valid credential,
// wrong scope" differently from "no such credential" would tell whoever presented a guessed
// token that the token EXISTS — the single most valuable thing an attacker can learn, handed
// out by the very refusal meant to stop them. So the distinction is total inside and invisible
// outside, and three separate mechanisms keep it invisible:
//
//   1. **Same bytes.** All three refusals render `401 {"error":"unauthorized","reason":
//      "invalid"}`, exactly as before this change. One `unauthorized("invalid")` call site.
//   2. **Same numbers.** Both budgets use the SAME threshold, window and capacity, so a caller
//      counting `401`s until the `429` — and reading the same `Retry-After` — learns nothing
//      about which budget they are spending. Different thresholds would have made the COUNT
//      the oracle, which is the subtle way this design could have failed.
//   3. **Same silence when locked out.** A caller at either bound gets `429` with no line
//      written, by the same rule for the same reason.
//
// The one thing a scope-refused caller can observe that a guessing caller cannot is that its
// ENTITLED routes still answer `200`. That is not a leak: it requires already holding a
// credential that works, and a credential that works has already told its holder it is valid.
//
// ## Where each budget is consulted, which is the whole design
//
// | | authentication | authorization |
// |---|---|---|
// | consulted | BEFORE verification | only AFTER a refusal is decided |
// | can refuse a request the policy would have served | yes (only for a credential that has itself failed) | **never**, structurally |
// | cleared by a success | yes | no — see [`FailureLimiter::on_success`] |
//
// ## Why the authorization budget is bounded at all
//
// Unbounded was a defensible answer and is not the one taken. Reaching that budget requires
// holding a credential this node issued, so bounding it stops no attack. It bounds the TRAIL:
// every refusal writes an audit line, and an unbounded stream of them from one misconfigured
// caller is a disk-filling amplifier pointed at the operator's own record — the exact failure
// the authentication lockout's silence was introduced to prevent. It costs a legitimate caller
// nothing, because it is only ever reached by a request that was already going to be refused.
//
// The gate refused bad credentials from the day it existed, and did so an unlimited number of
// times. Refusing is not the same as bounding: a device on the tailnet could present wrong
// credentials as fast as it could open sockets, forever, and the node would answer every one
// of them with a fresh hash and a fresh `401`. E5 of the phone-enrolment design
// (`docs/superpowers/specs/2026-07-30-phone-initiated-enrolment-design.md`) asks for "a
// bounded queue and a rate limit on anything a remote peer can create" — written once in the
// substrate so every adapter inherits it. It was applied to what this node SENDS. This is the
// same sentence applied to what it ACCEPTS.
//
// ## What the limit is keyed on, and why every other key is worse
//
// The key is a tag of the CREDENTIAL PRESENTED. Not a claimed identity, not a peer address.
//
// A **claimed identity** is the tempting key and the dangerous one. A limiter keyed on who the
// caller SAYS it is hands any caller a remote lockout tool aimed at anyone they can name:
// present garbage in someone else's name until their budget is gone, and the gate does the
// attacker's work for them. This module never learns a claimed identity in the first place —
// a failed verification yields no identity at all, only `None` — and that stays true here.
// The identity in an audit line below is only ever one this gate RESOLVED, never one a caller
// asserted.
//
// A **network address** is the other tempting key, and this codebase has already refused it,
// for a reason that outranks rate limiting: `sidecar::node_local`'s
// `no_code_path_can_decide_authentication_from_a_request_property` asserts that the mechanisms
// for learning where a request came from appear in NO file that serves a request. That
// invariant is what keeps "is this authenticated" a question about a credential instead of a
// question about what a packet claims. A refusal keyed on the caller's address would drag
// exactly that mechanism back into this file, and the next "…but trust it when it looks local"
// branch would then be writable. It also fails on its own terms: several devices behind one
// address share one budget, so the neighbour exhausts yours.
//
// The presented credential has the property neither of those has: **spending a credential's
// budget requires presenting that credential.** A third party cannot burn the operator's
// budget without already holding the operator's token — and if they hold it they are not
// guessing, they authenticate, and the lockout has cost the operator nothing that was not
// already lost. The budget belongs to the secret, and only the secret's holder can spend it.
//
// ## Two tiers, asymmetric on purpose
//
// Keying on the credential bounds REPEAT attempts of one credential. It cannot, on its own,
// bound a search across many distinct credentials — each guess is a new key, so no bucket ever
// fills. The honest fix for that is a shared counter, and a shared counter consulted BEFORE
// verification would be precisely the third-party lockout this design refuses: a stranger's
// flood would deny the operator their own node.
//
// So the two tiers are consulted at different moments, and that asymmetry is the whole design:
//
//   - the **per-credential** bucket is consulted BEFORE the policy is read, and refuses
//     outright. Safe at that position because only the credential's holder can fill it.
//   - the **overflow** counter — one shared bucket, reached only once the table is full — is
//     consulted only AFTER verification has already FAILED. It changes what a failing request
//     is told (`429` rather than `401`) and never blocks a request that would have succeeded.
//     A flood therefore cannot deny service to anyone holding a valid credential, because the
//     valid credential is verified before the shared counter is ever consulted.
//
// ## Bounded memory
//
// [`FAILURE_TABLE_CAPACITY`] entries, and not one more. Failures against untracked credentials
// once the table is full go to the single shared overflow counter, so a flood of distinct
// tokens grows the limiter's state by exactly zero. Stale buckets are reclaimed lazily when
// the table is full; buckets still inside their window are NEVER evicted, because eviction
// under pressure would be an escape hatch — flood the table, evict your own lockout, resume.

/// How many failures ONE presented credential may accrue before the gate stops even looking
/// at it. Five: enough that a client with a stale token in its config does not trip on its
/// first retry, and not a useful number of guesses.
pub(crate) const FAILURE_THRESHOLD: u32 = 5;

/// How long a tripped credential is refused — and how long a bucket survives without a new
/// failure before it is forgotten. ONE duration for both, because they are one statement: the
/// limiter remembers a failure for exactly as long as it is willing to act on it.
///
/// Measured from the LAST COUNTED failure, and attempts made while locked out are not counted
/// (they never reach the counter — see [`FailureLimiter::blocked`]). So hammering the door
/// cannot extend the lockout, and the recovery is unconditional: wait this long.
pub(crate) const FAILURE_WINDOW: Duration = Duration::from_secs(60);

/// THE memory bound: how many distinct credentials the failure table tracks at once.
pub(crate) const FAILURE_TABLE_CAPACITY: usize = 256;

/// How many failures against UNTRACKED credentials — the ones arriving once the table is full,
/// which is what a flood of distinct tokens looks like — before failing requests are answered
/// `429` instead of `401`. Higher than the per-credential threshold because it is a shared
/// counter: it should mean "this node is being ground", not "a few clients are misconfigured".
pub(crate) const OVERFLOW_THRESHOLD: u32 = 64;

/// Mixed into the limiter's key so the tag is NOT a prefix of the `tokenSha256` the policy
/// stores. Both are digests of the same token; without separation the tag would be a partial
/// match for the stored hash the moment anything rendered it. Nothing renders it — but the
/// property should not have to depend on that.
const LIMITER_TAG_DOMAIN: &[u8] = b"refarm-auth-failure-limiter\0";

/// A short, domain-separated tag of a presented credential — the failure table's key.
///
/// 64 bits rather than the whole digest because the table needs a NAME for a credential, not
/// the credential. A collision merges two buckets, which only ever makes the limiter stricter
/// (two callers sharing one budget) — the fail-closed direction, and at 256 entries it is not
/// a direction anyone will observe.
///
/// `pub(crate)` so the WS handshake's suite can assert the tag NEVER reaches the trail, exactly
/// as this module's own suite does. Widened for the assertion and for nothing else: it has no
/// caller outside the limiter, and `node_local`'s structural test still pins its signature —
/// the limiter's key is derived from the presented credential and from nothing else.
pub(crate) fn credential_tag(token: &str) -> u64 {
    let mut hasher = Sha256::new();
    hasher.update(LIMITER_TAG_DOMAIN);
    hasher.update(token.as_bytes());
    let digest = hasher.finalize();
    let mut head = [0u8; 8];
    head.copy_from_slice(&digest[..8]);
    u64::from_be_bytes(head)
}

/// What to tell a caller whose request did not authenticate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Refusal {
    /// The credential did not authenticate. `401`, and the same one word as ever.
    Invalid,
    /// Too many failures. `429`, with how long it is worth waiting before trying again —
    /// stated, because E5's own list ends with "refusal that says why, since a silent drop
    /// teaches a caller to retry harder". Saying "too many, wait 60s" tells the caller nothing
    /// about any credential's validity: it is a fact about their own behaviour.
    RateLimited { retry_after: Duration },
}

/// One credential's failure bucket.
#[derive(Debug, Clone, Copy)]
struct Bucket {
    failures: u32,
    /// When the most recent COUNTED failure landed. The window runs from here.
    last: Instant,
}

/// ONE budget's table: the per-credential buckets and the shared overflow counter.
///
/// Extracted so there can be TWO of them with identical mechanics and no copied code. Every
/// rule below — the threshold, the window, the capacity, the lazy expiry, the
/// never-evict-a-live-lockout reclaim — is stated once and holds for both budgets, which is
/// what keeps their OUTWARD behaviour indistinguishable. A caller counts the same number of
/// `401`s before the same `429` with the same `Retry-After` whichever budget they are
/// spending; if the two tables had different numbers, the count itself would be the oracle
/// this design refuses to hand out.
#[derive(Debug, Default)]
struct BudgetTable {
    buckets: HashMap<u64, Bucket>,
    /// The one shared bucket for credentials the table had no room for. `None` until the
    /// table has actually overflowed, so the ordinary case carries no extra state.
    overflow: Option<Bucket>,
}

impl BudgetTable {
    /// Is this credential locked out RIGHT NOW — asked before the policy is consulted, so a
    /// locked-out credential is refused without the gate doing the work of verifying it.
    /// `Some(retry_after)` ⇒ refuse; `None` ⇒ carry on to verification.
    ///
    /// Expiry is applied here, on read, rather than by a sweeping task: a bucket whose window
    /// has closed is removed the moment anyone asks about it, so the lockout ends on its own
    /// with nothing scheduled and nothing to fail.
    fn blocked(&mut self, tag: u64, now: Instant) -> Option<Duration> {
        let bucket = *self.buckets.get(&tag)?;
        if bucket.failures < FAILURE_THRESHOLD {
            return None;
        }
        let elapsed = now.saturating_duration_since(bucket.last);
        if elapsed >= FAILURE_WINDOW {
            self.buckets.remove(&tag);
            return None;
        }
        Some(FAILURE_WINDOW - elapsed)
    }

    /// Count a failure against this credential and say what to tell the caller.
    fn on_failure(&mut self, tag: u64, now: Instant) -> Refusal {
        let failures = match self.buckets.get_mut(&tag) {
            Some(bucket) => {
                // A bucket whose window closed while it was below the threshold starts over,
                // so five typos spread across a week are not five typos in a minute.
                if now.saturating_duration_since(bucket.last) >= FAILURE_WINDOW {
                    bucket.failures = 0;
                }
                bucket.failures = bucket.failures.saturating_add(1);
                bucket.last = now;
                bucket.failures
            }
            None => {
                if self.buckets.len() >= FAILURE_TABLE_CAPACITY {
                    self.reclaim(now);
                }
                if self.buckets.len() >= FAILURE_TABLE_CAPACITY {
                    return self.overflow_failure(now);
                }
                self.buckets.insert(tag, Bucket { failures: 1, last: now });
                1
            }
        };
        // ONE threshold comparison in the whole limiter, so there is one place for it to be
        // wrong and one place for a mutation to be caught.
        if failures >= FAILURE_THRESHOLD {
            Refusal::RateLimited { retry_after: FAILURE_WINDOW }
        } else {
            Refusal::Invalid
        }
    }

    /// A failure against a credential the table had no room for. Shared counter, consulted
    /// ONLY after verification already failed — see the module section above for why its
    /// position in the request path is what makes it safe.
    fn overflow_failure(&mut self, now: Instant) -> Refusal {
        let bucket = self.overflow.get_or_insert(Bucket { failures: 0, last: now });
        if now.saturating_duration_since(bucket.last) >= FAILURE_WINDOW {
            bucket.failures = 0;
        }
        bucket.failures = bucket.failures.saturating_add(1);
        bucket.last = now;
        if bucket.failures >= OVERFLOW_THRESHOLD {
            Refusal::RateLimited { retry_after: FAILURE_WINDOW }
        } else {
            Refusal::Invalid
        }
    }

    /// Drop buckets whose window has closed. Called only when the table is full, so the cost
    /// is paid under pressure and never on the ordinary path — and it is bounded by the
    /// capacity, which is the point of having one.
    ///
    /// Only STALE buckets go. A bucket still inside its window survives even when the table is
    /// full, which is what stops a flood from being an escape hatch: an attacker cannot evict
    /// their own lockout by filling the table, because their own bucket is the freshest thing
    /// in it.
    fn reclaim(&mut self, now: Instant) {
        self.buckets
            .retain(|_, bucket| now.saturating_duration_since(bucket.last) < FAILURE_WINDOW);
    }

    /// Forget this credential's failures, because it has just authenticated.
    ///
    /// A success resets the counter, and it must. The budget exists to bound GUESSING, and a
    /// correct credential is proof the caller was not guessing: a client that retried a stale
    /// token four times and then had its config fixed must not carry four failures into the
    /// next hour. It gives an attacker nothing — resetting a bucket requires presenting the
    /// credential that owns it, and presenting it is authenticating, so the reset grants
    /// exactly the access they already had.
    fn on_success(&mut self, tag: u64) {
        self.buckets.remove(&tag);
    }

    /// How many buckets are held. The memory bound, observable — for the flood test, which
    /// asserts it stops rising, and for nothing else.
    #[cfg(test)]
    fn tracked(&self) -> usize {
        self.buckets.len()
    }
}

/// The bounded failure limiter: TWO budgets, one per fact, sharing nothing but their rules.
///
/// Not `Clone`: there is one, behind the gate's `Arc`, so every listener sharing that gate
/// shares one set of budgets.
///
/// # Why they had to separate
///
/// They were one table. A browser holding a real `prompt:answer` credential that asked for a
/// route it had no authority for spent the budget that exists to stop credential GUESSING —
/// and five such requests locked it out of the routes it WAS entitled to, for a minute, for a
/// bug in its own routing. A legitimate caller was punished as an attacker, and the node lost
/// the ability to tell the two apart in the one place it most needed to.
///
/// # Why the authorization budget exists at all, rather than being unbounded
///
/// Unbounded was defensible and is not what this does. Reaching the authorization budget
/// requires HOLDING a credential this node issued, so it is not the guessing population and
/// bounding it protects against no attack. But a refusal is not free: each one writes a line
/// to the operator's audit trail, and an unbounded stream of them from one misconfigured
/// caller is a disk-filling amplifier pointed at the trail — the exact failure the lockout's
/// silence was added to prevent on the authentication side. The bound costs a legitimate
/// caller nothing (it is consulted only once the request was going to be refused anyway) and
/// it keeps the trail readable. So: bounded, for the trail's sake, not for the door's.
#[derive(Debug, Default)]
pub(crate) struct FailureLimiter {
    /// Bounds guessing. Consulted BEFORE verification.
    authentication: BudgetTable,
    /// Bounds refusal volume against recognised credentials. Consulted only AFTER a refusal
    /// has been decided — so it can never block a request that would have succeeded, which is
    /// the property that makes the whole separation worth having.
    authorization: BudgetTable,
}

impl FailureLimiter {
    fn table(&mut self, budget: Budget) -> &mut BudgetTable {
        match budget {
            Budget::Authentication => &mut self.authentication,
            Budget::Authorization => &mut self.authorization,
        }
    }

    /// Is this credential at this budget's bound RIGHT NOW?
    fn blocked(&mut self, budget: Budget, tag: u64, now: Instant) -> Option<Duration> {
        self.table(budget).blocked(tag, now)
    }

    /// Count a failure against ONE budget and say what to tell the caller.
    fn on_failure(&mut self, budget: Budget, tag: u64, now: Instant) -> Refusal {
        self.table(budget).on_failure(tag, now)
    }

    /// Forget this credential's failed AUTHENTICATIONS, because it has just authenticated.
    ///
    /// Deliberately not the authorization budget. The two budgets answer different questions
    /// and a success answers only one of them. "Were you guessing?" — no, demonstrably, so the
    /// guessing count goes. "Are you asking for authority you do not have?" — a success on a
    /// route you ARE entitled to says nothing about that, and clearing it here would let a
    /// caller alternate one good request with one refused one and generate refusals forever,
    /// which is precisely the unbounded trail the authorization budget exists to prevent.
    fn on_success(&mut self, tag: u64) {
        self.authentication.on_success(tag);
    }

    /// How many credentials the GUESSING budget is tracking. The memory bound the flood test
    /// watches; unchanged in meaning from when there was one table.
    #[cfg(test)]
    pub(crate) fn tracked(&self) -> usize {
        self.authentication.tracked()
    }

    /// How many credentials one named budget is tracking — for the tests that must show a
    /// scope refusal landing in one table and not the other.
    #[cfg(test)]
    pub(crate) fn tracked_in(&self, budget: Budget) -> usize {
        match budget {
            Budget::Authentication => self.authentication.tracked(),
            Budget::Authorization => self.authorization.tracked(),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// THE AUTHORISATION AUDIT TRAIL
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// `operations.json` records what CHANGED. Nothing recorded who came in. The operator could not
// answer "was this device used last night?" — the one question an enrolled-device gate exists
// to make answerable — because every authentication, successful or not, left the process as a
// `tracing` line and nothing else.
//
// ## What it reuses, and what it deliberately does not
//
// It writes to the daemon's EXISTING audit trail: `<refarm-dir>/scarecrow-audit.ndjson`,
// through `observer::append_line`, under an `auth:` event prefix beside the `host-effect:` and
// `agent:` ones already there. That is a real reuse and not a cosmetic one — the rotation
// (`observer::AuditConfig`, 8 MiB segments), the retention (16 sealed segments, oldest pruned),
// the tamper-evidence rule that a full segment is SEALED by rename rather than truncated, and
// the operator's existing habit of reading one file all come with it. A second security log
// would have needed its own rotation, its own cap, and its own ways of going wrong.
//
// Three stores were considered and not used. `operations.json`
// (`packages/operation-consent-v1`) rewrites its whole JSON document on every append and has no
// cap at all — O(n) per event and unbounded growth, which is the wrong shape for an event
// stream a remote peer can drive. `history-contract-v1` and `provenance-contract-v1` are
// TypeScript wire contracts with no storage implementation and no Rust side at all
// (`RecordHistoryStore` is literally a `Vec`); adopting either would have meant writing the
// persistence from scratch and calling it reuse.
//
// It does NOT go through the `TelemetryBus`, which was the shorter path to the same file. The
// bus is a `tokio::sync::broadcast`: it drops messages when a subscriber lags, and a flood of
// failed authentications is exactly when it would lag. A security trail with holes in it
// precisely when it is interesting is worse than no trail, because it reads as quiet.
//
// ## Why it survives a restart
//
// On disk, under the refarm dir, appended and fsync-free but flushed per line — the same
// durability the host-effect trail has had. Anything in memory answers "was this device used
// last night" only while the daemon that saw last night is still running, which is the one
// condition under which the question is least likely to be asked.
//
// ## Bounded growth, twice over
//
// The file is bounded by the rotation it inherits: 8 MiB × 16 segments, ~128 MiB ceiling,
// oldest pruned, both already tunable by the existing `REFARM_AUDIT_ROTATE_BYTES` /
// `REFARM_AUDIT_MAX_SEGMENTS`. And the RATE is bounded by the limiter above: attempts refused
// while a credential is locked out write NO line, because the lockout was already recorded on
// the attempt that tripped it. Writing one line per attempt during a lockout would have handed
// an attacker a disk-filling amplifier and taught the operator to skim.
//
// ## What is never written
//
// No token. No token hash. No limiter tag. Not truncated, not salted, not "just the first
// eight characters" — none of it, in any form. The identity is the label the policy already
// stores in plaintext and is the entire point of an attribution; the scope is the ROUTE's
// requirement, not an enumeration of what the credential holds. `audit_line` is a pure
// function of six values and none of them is derived from the secret, which is what makes
// that assertion testable rather than aspirational.

// The outcome of one authentication decision is named by `crate::security_events`, not here.
// It used to be a private three-variant enum (`Accepted` / `Refused` / `LockedOut`) whose
// `Refused` covered three unrelated facts and whose names existed only inside this file. It is
// now the framework's vocabulary: five names, one namespace, mirrored in TypeScript and pinned
// against a shared wire fixture — because the consumer who most needs to tell a scope bug from
// an attack is not this module.

/// The absence of a value, rendered. A failure has no identity and no credential kind — and
/// writing `-` rather than omitting the key keeps every line the same shape, so an operator
/// grepping the trail does not have to know which fields a refusal happens to carry.
const AUDIT_ABSENT: &str = "-";

/// One audit line. PURE — six values in, a string out; no clock, no I/O, no lock. That is what
/// lets the "no credential material is ever written" rule be tested as a property of a
/// function rather than asserted about a file and hoped for.
///
/// Note what is NOT a parameter: the token, its digest, and the limiter tag. They are not
/// omitted from the output, they are absent from the SIGNATURE — this function could not write
/// a credential if someone asked it to.
pub(crate) fn audit_line(
    now_ms: i64,
    event: SecurityEvent,
    identity: Option<&str>,
    kind: Option<CredentialKind>,
    required: RouteRequirement,
    method: &str,
) -> String {
    // Rendered through serde_json, never formatted by hand: an identity or a method is
    // attacker-adjacent text, and a hand-built line is how one of them becomes a second line.
    serde_json::json!({
        "ts": now_ms,
        "event": event.name(),
        "outcome": event.outcome(),
        // WHICH bound this fact moved. Derivable from the name for every variant but one, and
        // the one it is not derivable for is the one a consumer most needs: a rate limit
        // engaging on `authentication` means this node is being ground by someone guessing;
        // the same limit engaging on `authorization` means one caller this node KNOWS is
        // asking for authority it does not have. Opposite meanings, opposite responses, and
        // no way to tell them apart from an HTTP status code — which is the point.
        "budget": match event.budget() {
            Some(budget) => budget.wire(),
            None => AUDIT_ABSENT,
        },
        // Only ever an identity this gate RESOLVED from a verified credential — never one a
        // caller claimed, because a caller has no way to claim one here.
        "identity": identity.unwrap_or(AUDIT_ABSENT),
        "credential": match kind {
            Some(CredentialKind::Device) => "device",
            Some(CredentialKind::Scoped) => "scoped",
            None => AUDIT_ABSENT,
        },
        // The scope the ROUTE required, which is the authority that was exercised (or sought).
        // Not the scope set the credential holds: the question the operator asks is "what was
        // done with this", not "what else could this have done".
        "scope": match required {
            RouteRequirement::Scoped(scope) => scope.wire(),
            RouteRequirement::DeviceOnly => AUDIT_ABSENT,
        },
        "method": method,
    })
    .to_string()
}

/// Where authentication events are written. A path and the retention knobs, resolved once at
/// boot beside the policy itself.
#[derive(Debug, Clone)]
pub(crate) struct AuthAudit {
    path: PathBuf,
    config: crate::observer::AuditConfig,
}

impl AuthAudit {
    /// The trail for a refarm dir — the SAME file `observer::spawn_audit_subscriber` writes,
    /// derived the same way from the same dir, so there is one trail and not two.
    fn for_refarm_dir(refarm_dir: &Path) -> Self {
        Self {
            path: refarm_dir.join(crate::observer::AUDIT_FILE),
            config: crate::observer::AuditConfig::from_env(),
        }
    }

    /// Write one line. Best-effort in the same sense the host-effect trail is: a write that
    /// fails warns (through `observer::append_line`) rather than failing the request, because
    /// a node that stops authenticating when its disk is full is a worse outcome than a gap in
    /// the trail — and the gap is audible.
    async fn record(
        &self,
        event: SecurityEvent,
        identity: Option<&str>,
        kind: Option<CredentialKind>,
        required: RouteRequirement,
        method: &str,
    ) {
        let line = audit_line(
            host_clock_ms().unwrap_or_default(),
            event,
            identity,
            kind,
            required,
            method,
        );
        crate::observer::append_line(&self.path, &line, self.config).await;
    }
}

/// The policy file shape. Unknown fields (workspaces/memberships for Slice 2) are ignored
/// so the file format is stable across slices.
#[derive(serde::Deserialize)]
struct PolicyFile {
    /// UNCHANGED, deliberately: a typed `Vec`, so a malformed device entry is a whole-file
    /// parse error and therefore a deny-all. That is the present meaning of this array and it
    /// is not being widened or narrowed here.
    #[serde(default)]
    credentials: Vec<CredentialEntry>,
    /// A raw `Value`, and NOT a typed `Vec<ScopedEntry>` — the difference is load-bearing.
    /// Typed, one malformed browser-session entry would fail the whole document, which is
    /// deny-all, which means a bad scoped entry could revoke the operator's phone. Raw, each
    /// entry is validated on its own and refuses only itself (and a `scopedCredentials` that
    /// is not an array at all refuses only itself, leaving every device credential standing).
    /// Absent ⇒ `Value::Null` ⇒ no scoped credentials and nothing refused, which is exactly
    /// what the operator's real policy file is.
    #[serde(rename = "scopedCredentials", default)]
    scoped_credentials: serde_json::Value,
}

#[derive(serde::Deserialize)]
struct CredentialEntry {
    identity: String,
    #[serde(rename = "tokenSha256")]
    token_sha256: String,
}

/// Parse a policy JSON string into an `AuthPolicy`. PURE (no I/O, NO CLOCK) so it is
/// native-testable — and so the same bytes always parse to the same value, which is what lets
/// the fingerprinted reload skip a re-read without skipping a decision. Expiry is judged at
/// the door, not here; see the module doc's clock section.
pub(crate) fn parse_policy(raw: &str) -> Result<AuthPolicy, serde_json::Error> {
    let file: PolicyFile = serde_json::from_str(raw)?;
    let credentials = file
        .credentials
        .into_iter()
        .map(|c| Credential {
            token_sha256: c.token_sha256.trim().to_ascii_lowercase(),
            identity: c.identity,
        })
        .collect();
    let (scoped, refused_scoped) = parse_scoped_credentials(&file.scoped_credentials);
    Ok(AuthPolicy { credentials, scoped, refused_scoped })
}

/// Every scoped credential in the `scopedCredentials` value, plus how many entries were
/// REFUSED. PURE.
///
/// One bad entry never takes another with it, and never takes the gate with it: the survivors
/// are kept and the refusals are counted. A `scopedCredentials` that is not an array is itself
/// one refusal — the key is unusable, so nothing under it is honoured, and the device
/// credentials in the same file are untouched.
fn parse_scoped_credentials(raw: &serde_json::Value) -> (Vec<ScopedCredential>, usize) {
    let Some(entries) = raw.as_array() else {
        // Null is ABSENCE (no key at all), not a malformation — the shape of every policy
        // written before scoped credentials existed, and of the operator's today.
        return (Vec::new(), usize::from(!raw.is_null()));
    };
    let mut parsed = Vec::with_capacity(entries.len());
    let mut refused = 0usize;
    for entry in entries {
        match parse_scoped_credential(entry) {
            Some(credential) => parsed.push(credential),
            None => refused += 1,
        }
    }
    (parsed, refused)
}

/// Validate ONE scoped entry off disk, or refuse it. PURE, total, and fail-closed in every
/// branch: a missing field, a blank field, a non-numeric deadline, an empty scope list, a
/// scope string this node does not know — any of them refuses THIS entry and nothing else.
///
/// The required-field set mirrors `parseScopedCredential` in
/// `packages/emoji-sas-v1/src/scoped-credential.ts` so the two runtimes agree on what a valid
/// entry is, with one deliberate difference: an unknown scope string refuses the entry HERE
/// (`Scope::from_wire`), because authority this gate cannot describe is authority it must not
/// grant. Silently dropping the unknown scope and honouring the rest would be narrowing a
/// grant nobody asked to have narrowed.
fn parse_scoped_credential(value: &serde_json::Value) -> Option<ScopedCredential> {
    let entry = value.as_object()?;
    let text = |key: &str| {
        entry
            .get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    };

    if text("wire")? != SCOPED_CREDENTIAL_WIRE {
        return None;
    }
    // Required to be STATED even though the gate never reads them: `id` is what
    // `refarm auth revoke` names, `surface`/`issuedVia` are what an audit reads. An entry
    // missing them is not the shape `emoji-sas-v1` mints, and honouring a shape neither side
    // agrees on is how the two halves start drifting.
    text("id")?;
    text("surface")?;
    text("issuedVia")?;
    let identity = text("identity")?.to_string();
    let token_sha256 = text("tokenSha256")?.to_ascii_lowercase();
    // Present and numeric, or refused. `issuedAt`'s VALUE decides nothing — only its
    // presence, so a half-formed entry cannot pass as a well-formed one.
    epoch_ms(entry.get("issuedAt")?)?;
    let expires_at_ms = epoch_ms(entry.get("expiresAt")?)?;

    let declared = entry.get("scope")?.as_array()?;
    if declared.is_empty() {
        return None;
    }
    let mut scope = Vec::with_capacity(declared.len());
    for named in declared {
        scope.push(Scope::from_wire(named.as_str()?.trim())?);
    }
    Some(ScopedCredential { token_sha256, identity, scope, expires_at_ms })
}

/// A JSON number as epoch milliseconds, or `None` when it is not a finite number at all.
/// Mirrors `Number.isFinite` on the TypeScript side — `Date.now()` serializes as an integer,
/// but a hand-edited `1.7e12` must not be the difference between a credential working and a
/// whole policy being refused.
fn epoch_ms(value: &serde_json::Value) -> Option<i64> {
    if let Some(exact) = value.as_i64() {
        return Some(exact);
    }
    let approximate = value.as_f64()?;
    approximate.is_finite().then(|| approximate.floor() as i64)
}

/// The two boot-time facts the policy path is resolved FROM. Decided ONCE in `main.rs` and
/// threaded into every surface that needs it — never re-read from global state:
///
///   - **the refarm dir the daemon was GIVEN** (`--refarm-dir`, defaulted by main.rs's
///     `dirs_sovereign_base`). Not `.refarm` hardcoded, not re-derived from cwd: the daemon
///     already received the answer, and a second derivation is how two readers start
///     disagreeing about which farm they are reading.
///   - **whether the `surfaces` declaration names `"gate": "device-token"`** anywhere
///     (`crate::host::any_surface_declares_device_token_gate`). A declared gate is the
///     operator's statement that this node is credential-gated; that intent is what makes
///     the conventional policy path meaningful, so that intent is what derives it.
///
/// `pub` (re-exported as `crate::sidecar::AuthPolicySource`) because `main.rs` is a separate
/// crate from this library and is where both facts are known. Fields stay private: nothing
/// outside this module can construct a source without naming both.
#[derive(Debug, Clone)]
pub struct AuthPolicySource {
    refarm_dir: PathBuf,
    device_token_gate_declared: bool,
}

impl AuthPolicySource {
    pub fn new(refarm_dir: PathBuf, device_token_gate_declared: bool) -> Self {
        Self { refarm_dir, device_token_gate_declared }
    }
}

/// A resolved policy path plus WHO decided it — the only thing that distinguishes "the
/// operator pointed us at a file that isn't there" (their explicit path, their error) from
/// "the gate is declared and enrollment simply hasn't happened yet" (expected, and the one
/// case that gets its own guidance line).
#[derive(Debug, Clone, PartialEq, Eq)]
struct PolicyPath {
    path: PathBuf,
    /// `true` ⇒ derived from the declaration; `false` ⇒ the `REFARM_AUTH_POLICY` override.
    derived: bool,
}

/// WHERE the policy lives, or `None` when no policy is resolvable at all.
///
/// PRECEDENCE, one line: a non-blank `REFARM_AUTH_POLICY` always wins; otherwise a declared
/// `device-token` gate derives `<refarm-dir>/auth-policy.json`; otherwise there is no policy.
///
/// A set-but-BLANK env is not a value and never was — it behaves EXACTLY as unset, which is
/// what it has always done (both meant "gate off" when the env was the only input; both now
/// mean "the env decides nothing, so the declaration decides"). Blank is not a way to switch
/// a declared gate back off; a declaration is turned off by editing the declaration.
///
/// PURE: one env read and one path join. No file I/O, no logging, no side effects.
fn resolve_policy_path(source: &AuthPolicySource) -> Option<PolicyPath> {
    if let Some(explicit) = policy_path_override() {
        return Some(PolicyPath { path: PathBuf::from(explicit), derived: false });
    }
    if !source.device_token_gate_declared {
        return None;
    }
    Some(PolicyPath {
        path: source.refarm_dir.join(AUTH_POLICY_FILE_NAME),
        derived: true,
    })
}

/// The operator's explicit `REFARM_AUTH_POLICY`, trimmed, if it is a real value. PURE.
fn policy_path_override() -> Option<String> {
    let raw = std::env::var(AUTH_POLICY_ENV).ok()?;
    let trimmed = raw.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

/// `true` exactly when a policy is RESOLVABLE — declaration-derived or named by
/// `REFARM_AUTH_POLICY` — which is the SAME condition `resolve_auth_policy` uses to decide
/// `Some` (gate on, whether or not the file turns out to exist: an absent or unreadable
/// policy is still `Some(deny_all)`) vs `None` (gate off, nothing declared).
///
/// This is no longer an env-presence peek: a declared gate makes a policy resolvable with no
/// env at all, which is the whole point — the declaration is what the operator states, so the
/// declaration is what the reader must believe.
///
/// Deliberately does NOT read or parse the file, and emits no log line: it is the cheap peek
/// for callers that only need "is a policy resolvable" (the WS bind preflight, which runs from
/// `main.rs` BEFORE the runtime boots and BEFORE the authoritative read is due) without
/// triggering the enable/deny-all log line that only the one real resolution —
/// `ResolvedAuthPolicy::resolve`, called once per daemon start — should ever emit. PURE: env
/// inspection and a path join, no file I/O, no logging.
///
/// The peek is kept, and kept ahead of the resolution, because the preflight's whole purpose
/// is to refuse a bad `--ws-host` as the daemon's FIRST act — before any file is read and
/// before anything boots. It cannot disagree with `ResolvedAuthPolicy::is_gated()`: both are
/// literally "`resolve_policy_path` is `Some`", pinned by
/// `the_cheap_peek_agrees_with_the_one_resolution_in_every_case`.
pub(crate) fn auth_policy_configured(source: &AuthPolicySource) -> bool {
    resolve_policy_path(source).is_some()
}

/// Resolve the auth policy — the ONE emitter of the gate's enable/deny-all log line
/// (`auth_policy_configured` above stays silent by design).
///   - no declared gate + no env ⇒ `None` (layer never added — the secure default is off).
///   - resolvable + readable/valid ⇒ the parsed policy (gate on).
///   - DERIVED + the file does not exist yet ⇒ `Some(deny_all)`, with a loud line naming the
///     derived path and `refarm auth enroll`: the gate was declared, so it binds and denies
///     everything until a credential exists. A silent 401 is a ghost hunt.
///   - anything else unreadable/invalid (including an override path that isn't there — the
///     operator's explicit value, so their error to see) ⇒ `Some(deny_all)`, fail-closed.
///
/// PRIVATE to this module, and that privacy is the fix: `ResolvedAuthPolicy::resolve` is the
/// only caller, so "resolve once per daemon start" is enforced by the compiler rather than by
/// a comment every future call site has to read. A second resolution elsewhere in the crate
/// is now a name-resolution error, not a second file read and a second log line.
fn resolve_auth_policy(source: &AuthPolicySource) -> Option<AuthGate> {
    let located = resolve_policy_path(source)?;
    let reading = read_policy_file(&located.path);
    let policy = match &reading.observed {
        Observed::Policy(policy) => {
            tracing::info!(
                credentials = policy.identity_count(),
                scoped = policy.scoped_count(),
                refused_scoped = policy.refused_scoped_count(),
                path = %located.path.display(),
                derived = located.derived,
                "sidecar auth gate enabled (opt-in)"
            );
            policy.clone()
        }
        Observed::Absent if located.derived => {
            tracing::warn!(
                path = %located.path.display(),
                "auth policy file is ABSENT at the derived path — a surface declares \"gate\": \
                 \"device-token\", so the gate is bound and enforced DENY-ALL: every request is \
                 rejected 401 until a credential exists. Fix: run `refarm auth enroll`"
            );
            AuthPolicy::deny_all()
        }
        _ => {
            tracing::error!(
                path = %located.path.display(),
                "auth policy configured but unreadable/invalid — gating DENY-ALL"
            );
            AuthPolicy::deny_all()
        }
    };
    // The trail is derived from the refarm dir the daemon was GIVEN, never from the policy
    // path's parent: `REFARM_AUTH_POLICY` can point the policy anywhere, and the audit must
    // still land in the node's own directory beside the trail the rest of the runtime writes.
    let audit = AuthAudit::for_refarm_dir(&source.refarm_dir);
    Some(AuthGate::new(located, policy, reading.fingerprint, Some(audit)))
}

/// WHAT one read of the policy file said. Three outcomes, because they warrant three
/// different log lines — but only ONE of them is ever a policy: everything else is
/// `deny_all`, at boot and at every reload alike.
enum Observed {
    /// Read and parsed cleanly. The only case that installs credentials.
    Policy(AuthPolicy),
    /// The file is not there. At boot on a DERIVED path this is the expected
    /// "declared but not enrolled yet"; after a reload it is a disappearance.
    Absent,
    /// There is a file and it cannot be believed — unreadable (permissions), unparseable,
    /// or HALF-WRITTEN. Never a policy, and never mistaken for an empty one: a truncated
    /// `{"credentials": [{"iden` is a `serde_json` error, not zero credentials, so it can
    /// only ever land here.
    Broken,
}

/// One read of the policy file: what it said, plus a fingerprint that identifies this exact
/// observation so a reload can tell "changed" from "unchanged" without re-applying (and
/// re-LOGGING) an answer already in force.
///
/// The fingerprint is the SHA-256 of the bytes when there were bytes, and a bracketed
/// sentinel otherwise. The two spaces cannot collide: a digest is 64 lowercase hex chars and
/// a sentinel starts with `<`. Fingerprinting the CONTENT rather than the mtime is what makes
/// the watcher correct across an atomic tmp→rename (new inode, possibly older mtime) and
/// across a rewrite that lands inside the same filesystem timestamp granularity.
struct Reading {
    observed: Observed,
    fingerprint: String,
}

/// Read the policy file once. NO logging and no state change — the caller decides what this
/// observation means (a boot line, a reload line, or nothing at all) and is the single
/// emitter for it. One `read_to_string`, so a concurrent writer can only ever hand us bytes,
/// never a partially-applied policy.
fn read_policy_file(path: &Path) -> Reading {
    match std::fs::read_to_string(path) {
        Ok(raw) => {
            let fingerprint = sha256_hex(&raw);
            match parse_policy(&raw) {
                Ok(policy) => Reading { observed: Observed::Policy(policy), fingerprint },
                Err(_) => Reading { observed: Observed::Broken, fingerprint },
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Reading { observed: Observed::Absent, fingerprint: "<absent>".to_string() }
        }
        Err(e) => Reading {
            observed: Observed::Broken,
            fingerprint: format!("<unreadable:{:?}>", e.kind()),
        },
    }
}

// ═══════════════════════════════════════════════════════════════════════════════════════
// ONE GATE DECISION, ASKED BY EVERY SURFACE
// ═══════════════════════════════════════════════════════════════════════════════════════
//
// The limiter, the policy and the budget were consulted in one place — inside
// [`auth_middleware`] — in an order the middleware's own doc-comment describes at length. That
// was correct and it was unreachable: the WS handshake is not a middleware, is not `async`, and
// returns an `ErrorResponse` rather than a `Response`, so it could not call any of it. It had a
// policy read and nothing else: no bound on failed handshakes, no line in the trail.
//
// The sequence is therefore stated ONCE, HERE, as [`AuthGate::admit`], and both surfaces ask it.
// Not copied into the handshake — copied is how the two drift, and a second limiter is a second
// budget, which is a way around the first.
//
// What [`AuthGate::admit`] deliberately does NOT do: build a response, or write a line. Those
// are the two things the two surfaces genuinely differ on.
//
//   * The HTTP gate answers a `429` with `Retry-After` when a bound engages. The WS handshake
//     answers the SAME `401` it has always answered, byte for byte — see
//     [`GateOutcome::Refused`]. Both are honest renderings of the same [`Refusal`]; neither is a
//     second decision.
//   * The HTTP gate awaits the audit write inside the request path. The handshake callback is
//     synchronous (tungstenite's `Callback` is `FnOnce(&Request, Response) -> Result<…>`), so it
//     carries the record OUT and its caller writes it after the response has already gone to the
//     socket — which is strictly better for the no-timing-signal rule, since the trail's I/O is
//     then not on the refusal path at all.

/// One fact to write down, carried from the decision to whoever can await the write.
///
/// Deliberately NOT the token, its digest, or the limiter's tag — the same absence
/// [`audit_line`] enforces, restated one level up so a surface that holds this value between the
/// decision and the write is holding nothing worth leaking. Every field here is either resolved
/// by this gate from a verified credential or is a constant of the vocabulary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AuditRecord {
    /// The fact, named by `crate::security_events` — never by the surface that emits it.
    pub(crate) event: SecurityEvent,
    /// Only ever an identity this gate RESOLVED. Never one a caller claimed.
    pub(crate) identity: Option<String>,
    pub(crate) kind: Option<CredentialKind>,
}

/// The gate's whole answer about ONE presented credential: what to do with the caller, and what
/// to write down. Rendered into bytes by the surface, which is the only part that differs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum GateOutcome {
    /// Let it through, attributed to `verified.identity`.
    Admitted { verified: Verified, record: AuditRecord },
    /// Refuse. `refusal` is WHAT to tell the caller — and the HTTP gate distinguishes its two
    /// variants while the WS handshake deliberately does not, because a handshake that answered
    /// a new status when a bound engaged would be announcing the bound on the wire.
    ///
    /// `record` is `None` for exactly the two silences the HTTP gate already keeps: an attempt
    /// made while ALREADY locked out (the lockout was recorded on the attempt that tripped it,
    /// and a line per attempt is a disk-filling amplifier handed to whoever is hammering).
    Refused { refusal: Refusal, record: Option<AuditRecord> },
}

/// THE live policy — one value, shared by every gate, re-read when the file changes.
///
/// Cloning an `AuthGate` clones an `Arc`, never the policy: the HTTP middleware layer and the
/// WS handshake callback each hold a clone, and both therefore observe a reload the instant it
/// is applied. That is the same guarantee `ResolvedAuthPolicy` already made — "both gates
/// enforce the same credentials" — extended from "the same value at boot" to "the same value,
/// always". Re-introducing a per-gate SNAPSHOT held for the process lifetime would silently
/// undo it: one gate would keep honouring a credential the other has revoked.
#[derive(Clone)]
pub(crate) struct AuthGate {
    state: Arc<GateState>,
}

struct GateState {
    /// The path resolved ONCE at boot (env override or derivation). The watcher re-reads
    /// this exact path forever; it never re-resolves, because re-resolving is how two
    /// readers start disagreeing about which file is the policy.
    located: PolicyPath,
    /// What the gates enforce RIGHT NOW.
    current: RwLock<AuthPolicy>,
    /// The fingerprint of the observation currently in force. Guards both the re-apply and
    /// the log line: no change, no swap, no line.
    applied: Mutex<String>,
    /// The bound on failed authentication. Lives HERE, behind the same `Arc` as the policy, so
    /// every listener that shares this gate shares one set of budgets — a per-listener limiter
    /// would give an attacker as many budgets as the node has sockets.
    ///
    /// A `std::sync::Mutex` and not an async one: every critical section is a hash lookup and
    /// an integer bump, held across no `.await` (the middleware takes the lock, decides, and
    /// drops it before any I/O). An async mutex here would buy contention behaviour this never
    /// needs and would make the guard live across the audit write, which is the one thing that
    /// must not happen.
    limiter: Mutex<FailureLimiter>,
    /// Where authentication events are recorded. `None` only in tests that inject a policy and
    /// have no dir to write to — a gate resolved at boot always has one.
    audit: Option<AuthAudit>,
}

/// Never prints credentials — not the tokens, not their hashes, not the identities. A
/// derived `Debug` would have printed every stored hash the moment anyone wrote `?gate`.
impl std::fmt::Debug for AuthGate {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuthGate")
            .field("path", &self.state.located.path)
            .field("derived", &self.state.located.derived)
            .field("identities", &self.identity_count())
            .field("scoped", &self.scoped_count())
            .finish()
    }
}

impl AuthGate {
    fn new(
        located: PolicyPath,
        policy: AuthPolicy,
        fingerprint: String,
        audit: Option<AuthAudit>,
    ) -> Self {
        Self {
            state: Arc::new(GateState {
                located,
                current: RwLock::new(policy),
                applied: Mutex::new(fingerprint),
                limiter: Mutex::new(FailureLimiter::default()),
                audit,
            }),
        }
    }

    /// Is this credential at the named budget's bound right now? Takes the lock, decides,
    /// releases it — the guard never outlives this call, which is what keeps the middleware's
    /// future `Send`.
    fn blocked(&self, budget: Budget, tag: u64, now: Instant) -> Option<Duration> {
        self.state
            .limiter
            .lock()
            .expect("auth limiter lock poisoned")
            .blocked(budget, tag, now)
    }

    /// Count a failure against ONE budget and say what to answer.
    fn note_failure(&self, budget: Budget, tag: u64, now: Instant) -> Refusal {
        self.state
            .limiter
            .lock()
            .expect("auth limiter lock poisoned")
            .on_failure(budget, tag, now)
    }

    /// Forget this credential's failures — it has just authenticated.
    fn note_success(&self, tag: u64) {
        self.state
            .limiter
            .lock()
            .expect("auth limiter lock poisoned")
            .on_success(tag);
    }

    /// Record one authentication event, if this gate has a trail to write to.
    async fn audit(
        &self,
        event: SecurityEvent,
        identity: Option<&str>,
        kind: Option<CredentialKind>,
        required: RouteRequirement,
        method: &str,
    ) {
        if let Some(audit) = &self.state.audit {
            audit.record(event, identity, kind, required, method).await;
        }
    }

    /// Test-only: how many credentials the GUESSING budget is tracking — the memory bound,
    /// observable.
    #[cfg(test)]
    pub(crate) fn tracked_failures(&self) -> usize {
        self.state.limiter.lock().expect("auth limiter lock poisoned").tracked()
    }

    /// Test-only: how many credentials ONE named budget is tracking. THE observation the whole
    /// separation rests on — a scope refusal must move `Authorization` and leave
    /// `Authentication` at zero.
    #[cfg(test)]
    pub(crate) fn tracked_failures_in(&self, budget: Budget) -> usize {
        self.state.limiter.lock().expect("auth limiter lock poisoned").tracked_in(budget)
    }

    /// Authenticate a bearer token as a DEVICE against the policy IN FORCE right now → its
    /// identity. Returns an owned identity because the value is read out from behind a lock —
    /// a borrow would pin the policy and block the next reload.
    ///
    /// TEST-ONLY since routes began declaring scopes: production's entry point — for the HTTP
    /// middleware and, since the handshake gained a bound and a trail, for the WS handshake too
    /// — is [`AuthGate::admit`], which takes the requirement the surface declares. Kept
    /// because it is the exact question most of this module's tests ask ("is this token a
    /// device credential, right now"), and because a production caller that could ask it
    /// WITHOUT naming a route is precisely the hole scoped credentials introduce: it would be
    /// an authentication that no route requirement was ever consulted for.
    #[cfg(test)]
    pub(crate) fn authenticate(&self, token: &str) -> Option<String> {
        self.snapshot().authenticate(token).map(str::to_string)
    }

    /// A copy of the policy in force.
    ///
    /// TEST-ONLY since the WS handshake began asking [`Self::admit`]. It was that handshake's
    /// production entry point: it took a snapshot and judged it with a function that was PURE
    /// over an `&AuthPolicy` — which is exactly why the handshake had no limiter and no trail,
    /// since neither is a property of a policy value. A production caller able to obtain the
    /// policy WITHOUT the gate is how a surface grows a second, unbounded door, so the door is
    /// closed at the type level rather than by asking future callers not to.
    #[cfg(test)]
    pub(crate) fn snapshot(&self) -> AuthPolicy {
        self.state.current.read().expect("auth policy lock poisoned").clone()
    }

    fn identity_count(&self) -> usize {
        self.state.current.read().expect("auth policy lock poisoned").identity_count()
    }

    fn scoped_count(&self) -> usize {
        self.state.current.read().expect("auth policy lock poisoned").scoped_count()
    }

    /// Verify a bearer token against ONE route's requirement, using the policy IN FORCE right
    /// now and the host clock right now. The HTTP gate's real entry point.
    ///
    /// Reads the live value under the lock rather than snapshotting it: what a request is
    /// judged by must be the policy at THAT instant, so an issued scoped credential works on
    /// the next request and a revoked one stops on the next request — the same guarantee
    /// `authenticate` already gives device credentials, extended to the scoped set for free
    /// because there is only ever one value behind this handle.
    ///
    /// REMOVED as a gate-level method when the middleware began asking [`Self::decide`]: the
    /// coarse question now has no caller here, and a gate-level way to discard the reason is
    /// how the conflation would grow back. The projection itself still exists, and is still
    /// exercised by every pre-existing test in this module, one level down at
    /// [`AuthPolicy::verify`] — which is where the regression proof belongs, because that is
    /// the pure function the old tests were written against.
    ///
    /// The same verification with the REASON kept — the middleware's real entry point, and the
    /// only place in the running daemon that asks the finer question. Everything downstream of
    /// it (the response bytes) is identical for all three refusals; everything beside it (the
    /// budget spent, the event written) is not.
    pub(crate) fn decide(&self, token: &str, required: RouteRequirement) -> Decision {
        self.state
            .current
            .read()
            .expect("auth policy lock poisoned")
            .decide(token, required, host_clock_ms())
    }

    /// THE gate decision for one presented credential — the limiter, the policy, and the
    /// limiter again, in the one order this module allows them to be consulted in. Every
    /// surface that gates on a credential asks THIS: the HTTP middleware below, and the WS
    /// handshake in `daemon::ws_server`.
    ///
    /// `now` is a MONOTONIC instant, taken by the caller and passed in — the limiter's clock is
    /// deliberately not the expiry clock. A lockout is a local duration, not an instant minted
    /// elsewhere, so it must not be lengthened or ended by the host's wall clock being
    /// corrected, which is also the one clock an attacker on the same host might influence.
    /// Passing it in additionally makes the whole sequence drivable across a window boundary in
    /// a test without waiting sixty seconds.
    ///
    /// A credential meets the limiter at up to three moments, and WHICH budget it meets at each
    /// is the design:
    ///
    ///   1. BEFORE verification, against the AUTHENTICATION budget only. A credential that has
    ///      itself failed [`FAILURE_THRESHOLD`] verifications is refused here without the policy
    ///      being consulted. Safe at this position for the one reason the whole design rests on:
    ///      only the holder of a credential can fill its bucket.
    ///   2. AFTER the decision, and only if it was a refusal, against the AUTHORIZATION budget.
    ///      Deliberately not at position 1: up there it would refuse a request before the policy
    ///      was consulted, and the same credential may be entirely entitled to what it is now
    ///      asking for. Down here it can only change what an already-refused caller is told.
    ///   3. To COUNT the refusal against whichever budget the decision named.
    ///
    /// A SUCCESSFUL verification is never refused by the limiter — step 1 can only fire for a
    /// credential that has itself failed authentication [`FAILURE_THRESHOLD`] times, steps 2 and
    /// 3 are not reached at all, and no scope refusal can ever put a credential into the budget
    /// step 1 reads. That is the anti-lockout property, stated as control flow rather than as a
    /// promise, and it now holds for the handshake as well as for the request.
    ///
    /// NOT called for a caller who presented NO credential: there is nothing to key on, nothing
    /// was guessed, and counting ordinary unauthenticated noise would let a third party spend
    /// the budget that exists to detect guessing. Both surfaces refuse that case before they get
    /// here, and neither counts it.
    pub(crate) fn admit(
        &self,
        token: &str,
        required: RouteRequirement,
        now: Instant,
    ) -> GateOutcome {
        let tag = credential_tag(token);

        if let Some(retry_after) = self.blocked(Budget::Authentication, tag, now) {
            return GateOutcome::Refused {
                refusal: Refusal::RateLimited { retry_after },
                // Deliberately silent in the trail — see [`GateOutcome::Refused`].
                record: None,
            };
        }

        let decision = self.decide(token, required);
        let identity = decision.identity().map(str::to_string);
        let kind = decision.kind();

        let Some(budget) = decision.budget() else {
            let Decision::Verified(verified) = decision else {
                unreachable!("only a verified decision has no budget to spend")
            };
            // The one path that spends nothing and clears the guessing count.
            self.note_success(tag);
            let record = AuditRecord {
                event: SecurityEvent::Accepted,
                identity: Some(verified.identity.clone()),
                kind: Some(verified.kind),
            };
            return GateOutcome::Admitted { verified, record };
        };

        if let Some(retry_after) = self.blocked(budget, tag, now) {
            return GateOutcome::Refused {
                refusal: Refusal::RateLimited { retry_after },
                record: None,
            };
        }

        match self.note_failure(budget, tag, now) {
            Refusal::Invalid => GateOutcome::Refused {
                refusal: Refusal::Invalid,
                record: Some(AuditRecord {
                    event: decision.refusal_event().expect("a refusal names its event"),
                    identity,
                    kind,
                }),
            },
            Refusal::RateLimited { retry_after } => GateOutcome::Refused {
                refusal: Refusal::RateLimited { retry_after },
                // The attempt that TRIPS the limit gets its own event — it is the one line an
                // operator most needs, and it is written exactly once per lockout.
                record: Some(AuditRecord {
                    event: SecurityEvent::RateLimitEngaged(budget),
                    identity,
                    kind,
                }),
            },
        }
    }

    /// Write one [`AuditRecord`], if this gate has a trail to write to. The single writer both
    /// surfaces reach the audit through — there is one trail, one line shape, and one place the
    /// vocabulary is rendered.
    pub(crate) async fn record(
        &self,
        record: &AuditRecord,
        required: RouteRequirement,
        method: &str,
    ) {
        self.audit(record.event, record.identity.as_deref(), record.kind, required, method)
            .await;
    }

    /// Test-only: the same verification at a NAMED instant, so an expiry can be crossed
    /// without waiting for wall time.
    #[cfg(test)]
    pub(crate) fn verify_at(
        &self,
        token: &str,
        required: RouteRequirement,
        now_ms: i64,
    ) -> Option<Verified> {
        self.state
            .current
            .read()
            .expect("auth policy lock poisoned")
            .verify(token, required, Some(now_ms))
    }

    /// Re-read the policy file and, if the observation CHANGED, swap in the new answer for
    /// every gate at once. Returns `true` exactly when a swap happened — which is also
    /// exactly when one log line is emitted.
    ///
    /// FAIL-CLOSED, by the SAME rule the boot resolution uses, deliberately: anything that
    /// is not a cleanly parsed policy installs `deny_all`. There is no "keep the
    /// last-known-good" path.
    ///
    /// That choice is the doctrine of this module, not a preference. `resolve_auth_policy`
    /// has always answered "configured but unreadable/invalid ⇒ deny_all" — if you asked for
    /// auth, a policy that cannot be believed locks the door. A reload that instead kept the
    /// last-known-good policy would make the module answer the same question two different
    /// ways depending on WHEN it was asked, and the divergence lands exactly on the case
    /// that matters most: an operator revokes a device, the write leaves the file corrupt,
    /// and last-known-good keeps admitting the credential they just revoked — indefinitely,
    /// and silently, because nothing further changes to trigger another read. Deny-all
    /// cannot fail that way. Its cost is bounded and visible: the door is shut, loudly, until
    /// the file is readable again — and the next good write reopens it within one poll.
    ///
    /// A half-written file cannot masquerade as an empty policy: truncated JSON does not
    /// parse, so it is `Observed::Broken` (an ERROR line), never `Observed::Policy` with zero
    /// credentials (an INFO "reloaded, 0 identities"). Both deny, but only one of them is a
    /// deliberate revocation, and an operator must be able to tell which they are looking at.
    pub(crate) fn reload_if_changed(&self) -> bool {
        let reading = read_policy_file(&self.state.located.path);
        let mut applied = self.state.applied.lock().expect("auth policy lock poisoned");
        if *applied == reading.fingerprint {
            return false;
        }
        *applied = reading.fingerprint;

        let path = self.state.located.path.display().to_string();
        let previously = self.identity_count();
        let scoped_previously = self.scoped_count();
        let next = match reading.observed {
            Observed::Policy(policy) => {
                // The ONE reload line. `identities` is what an operator watches after
                // running `refarm auth enroll` (it goes up) or revoking (it goes DOWN) —
                // the moment a revocation takes effect is the moment they most need
                // confirmation, so it is stated, counted, and never guessed at. Counts
                // only: no token, no hash, no identity name.
                tracing::info!(
                    identities = policy.identity_count(),
                    previously,
                    scoped = policy.scoped_count(),
                    scoped_previously,
                    refused_scoped = policy.refused_scoped_count(),
                    path = %path,
                    "auth policy reloaded — the change is in force for every gate, no restart"
                );
                policy
            }
            Observed::Absent => {
                tracing::warn!(
                    previously,
                    path = %path,
                    "auth policy file DISAPPEARED — gating DENY-ALL: every request is rejected \
                     401 until the file is back. Fix: run `refarm auth enroll`"
                );
                AuthPolicy::deny_all()
            }
            Observed::Broken => {
                tracing::error!(
                    previously,
                    path = %path,
                    "auth policy became unreadable/invalid (a truncated write, or a corrupt \
                     file) — gating DENY-ALL. The previous policy is NOT kept: a policy that \
                     cannot be read cannot be enforced"
                );
                AuthPolicy::deny_all()
            }
        };
        *self.state.current.write().expect("auth policy lock poisoned") = next;
        true
    }

    /// Test-only: a gate over an injected policy, pointed at a path that does not exist.
    /// For the handshake/middleware tests, which are about ENFORCEMENT, not about reloading
    /// — they never call `reload_if_changed`, so the path is never read.
    #[cfg(test)]
    pub(crate) fn for_test(policy: AuthPolicy) -> Self {
        Self::new(
            PolicyPath { path: PathBuf::from("/nonexistent/injected-policy.json"), derived: false },
            policy,
            "<injected>".to_string(),
            None,
        )
    }

    /// Test-only: a gate that WRITES its audit to a named dir, for the tests that read the
    /// trail back. Separate from `for_test` so the enforcement tests keep writing nowhere.
    #[cfg(test)]
    pub(crate) fn for_test_with_audit(policy: AuthPolicy, refarm_dir: &Path) -> Self {
        Self::new(
            PolicyPath { path: PathBuf::from("/nonexistent/injected-policy.json"), derived: false },
            policy,
            "<injected>".to_string(),
            Some(AuthAudit::for_refarm_dir(refarm_dir)),
        )
    }
}

/// THE auth policy of this daemon: resolved ONCE at start, then handed to every gate that
/// enforces it, instead of each gate resolving for itself.
///
/// The defect this closes was audible. With a `"gate": "device-token"` declaration and no
/// policy file yet, a boot printed the derived-but-ABSENT warning TWICE, ~10µs apart, because
/// the HTTP sidecar (`sidecar::start`) and the WS server (`daemon::WsServer::start`) each
/// called `resolve_auth_policy` for themselves. Both call sites long pre-date that warning —
/// they resolved twice from the env before it existed too; the warning only made an inherited
/// duplication audible. And the doubled line is the SYMPTOM: two independent reads of the same
/// file are two answers that can in principle disagree, leaving one gate honouring a
/// credential the other has never heard of. One read, one line, one value both gates enforce.
///
/// The SOURCE is what `main.rs` knows (the refarm dir + the declaration); the RESULT is what
/// travels. `main.rs` builds the `AuthPolicySource`, calls `resolve` exactly once, and clones
/// this value into both gates — which no longer receive a source at all, so they *cannot*
/// resolve a second time.
///
/// Opaque outside the crate on purpose: the field is private and `AuthPolicy` stays
/// `pub(crate)`, so `main.rs` (a separate crate) can carry this value from the resolution to
/// the gates without ever being able to read a credential out of it. Same doctrine as
/// `AuthPolicySource` — what crosses the crate boundary is a handle, never the credentials.
#[derive(Debug, Clone)]
pub struct ResolvedAuthPolicy {
    /// `None` ⇒ no policy was resolvable at all (nothing declared, no env) ⇒ no gate is
    /// bound anywhere, and there is nothing to watch. `Some` ⇒ the gate is bound and this
    /// handle is what it enforces — including a `deny_all` behind it, which is the STRICTEST
    /// enforcement of a declared gate, not an absence of one.
    ///
    /// A HANDLE, not a snapshot: whether the gate is bound is fixed at boot (it follows the
    /// declaration and the env, which do not change under a running daemon), but WHAT it
    /// enforces follows the file.
    gate: Option<AuthGate>,
}

impl ResolvedAuthPolicy {
    /// The one resolution. Call EXACTLY ONCE per daemon start: this is the only file read of
    /// the policy and the only emitter of the enable/deny-all log line.
    ///
    /// `pub` because `main.rs` is a separate crate and is where the boot happens — it is the
    /// single place that holds an `AuthPolicySource`, which is what keeps "once" true.
    pub fn resolve(source: &AuthPolicySource) -> Self {
        Self { gate: resolve_auth_policy(source) }
    }

    /// `true` when a gate is BOUND — the bool both bind guards take. Equal by construction to
    /// `auth_policy_configured(source)` for the same source (both are exactly
    /// "`resolve_policy_path` is `Some`"), which is why the WS preflight's cheap peek and this
    /// authoritative answer can never disagree.
    ///
    /// Unaffected by reloads on purpose: a policy file that becomes unreadable does not
    /// UNBIND the gate (that would widen access to "no gate at all"); it makes the bound gate
    /// deny everything.
    pub(crate) fn is_gated(&self) -> bool {
        self.gate.is_some()
    }

    /// The live gate to ENFORCE, or `None` when no gate is bound. Both gates take a clone
    /// from here — the sidecar's `auth_middleware` layer and the WS
    /// `Sec-WebSocket-Protocol` handshake — and a clone is an `Arc` bump, so both keep
    /// observing the same value across every reload.
    pub(crate) fn gate(&self) -> Option<AuthGate> {
        self.gate.clone()
    }

    /// Start the ONE watcher that keeps the policy current. Call once per daemon start,
    /// from `main.rs`, right after `resolve` — inside the tokio runtime.
    ///
    /// This is what makes enrolment and revocation operational without a restart. Before it,
    /// admitting a device the operator had just enrolled meant restarting the whole runtime:
    /// the wrong granularity by a wide margin, and a `401` with no explanation for anyone who
    /// enrolled after the boot.
    ///
    /// A no-op when no gate is bound — there is no path to watch, and nothing declared means
    /// nothing to claim. `pub` for the same reason `resolve` is: `main.rs` is a separate
    /// crate, and keeping the spawn there keeps "once per daemon start" true of the watcher
    /// exactly as it is of the resolution.
    pub fn spawn_reload_watcher(&self) {
        self.spawn_reload_watcher_every(RELOAD_POLL_INTERVAL);
    }

    /// The watcher, with its period named. Split out so the test suite can drive the REAL
    /// loop — same task, same `reload_if_changed`, same fail-closed rule — at a period that
    /// costs no wall-clock seconds, rather than either sleeping through two-second polls or
    /// pulling in tokio's `test-util` feature to fake the clock. The period is a constant,
    /// not a decision: nothing in the loop's behaviour depends on its value.
    fn spawn_reload_watcher_every(&self, period: Duration) {
        let Some(gate) = self.gate.clone() else {
            return;
        };
        tracing::info!(
            path = %gate.state.located.path.display(),
            poll_ms = period.as_millis() as u64,
            "watching the auth policy for changes — enrolment and revocation take effect \
             without restarting the runtime"
        );
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(period);
            // A tick missed because the host was busy must not become a burst of catch-up
            // reads of a file that changes a few times a year.
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                ticker.tick().await;
                gate.reload_if_changed();
            }
        });
    }

    /// Test-only: a resolved value built WITHOUT resolving, for tests that inject a policy
    /// directly (hermetic — no env mutation, no file on disk).
    #[cfg(test)]
    pub(crate) fn from_policy(policy: Option<AuthPolicy>) -> Self {
        Self { gate: policy.map(AuthGate::for_test) }
    }
}

/// The bearer token from `Authorization: Bearer <token>`, if present and non-empty. PURE.
fn bearer_token(request: &Request<Body>) -> Option<String> {
    let raw = request.headers().get(header::AUTHORIZATION)?.to_str().ok()?;
    let token = raw
        .strip_prefix("Bearer ")
        .or_else(|| raw.strip_prefix("bearer "))?
        .trim();
    (!token.is_empty()).then(|| token.to_string())
}

/// The identity THIS LISTENER's gate resolved for the request in hand — attached by
/// [`auth_middleware`] itself, from the credential it has just verified.
///
/// It exists so a handler can ATTRIBUTE an action to a device without ever asking the caller
/// who they are (P3 of the pending-prompt design). The guarantee is structural: this value is
/// only ever constructed here, out of a `gate.authenticate` result, and axum populates request
/// extensions server-side only — nothing a caller sends can produce one. A listener
/// constructed WITHOUT the credential layer (the node-local socket) therefore has no
/// extension at all, and a handler that finds none knows it was not authenticated rather than
/// being told so by the request.
///
/// Not a credential and not a secret: it is the identity label the policy already stores in
/// plaintext, and naming it is the whole point of an attribution.
#[derive(Debug, Clone)]
pub(crate) struct AuthenticatedDevice(pub(crate) String);

fn unauthorized(reason: &str) -> Response<Body> {
    let body = serde_json::json!({ "error": "unauthorized", "reason": reason }).to_string();
    Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::WWW_AUTHENTICATE, "Bearer")
        .body(Body::from(body))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

/// `429`, with `Retry-After` in seconds — the refusal that says why.
///
/// `429` and not `401`, and the distinction carries no information about any credential: it is
/// a statement about how often THIS caller has failed, which the caller already knows. It is
/// also the status this codebase already uses for a bound being reached
/// (`pending_prompt`'s full queue), so an operator meets one meaning of `429` on this node and
/// not two.
///
/// `Retry-After` is stated because E5's list ends with "refusal that says why, since a silent
/// drop teaches a caller to retry harder" — and a caller told to wait 60 seconds is a caller
/// that stops hammering. That is the honest-citizenship half of the same sentence that asked
/// for the limit in the first place.
fn too_many_requests(retry_after: Duration) -> Response<Body> {
    // Always at least a second: `Retry-After: 0` reads as "immediately", which is the opposite
    // of what a limiter means.
    let seconds = retry_after.as_secs().max(1);
    let body = serde_json::json!({
        "error": "too_many_requests",
        "reason": "too many failed authentication attempts",
        "retryAfterSeconds": seconds,
    })
    .to_string();
    Response::builder()
        .status(StatusCode::TOO_MANY_REQUESTS)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::RETRY_AFTER, seconds.to_string())
        .body(Body::from(body))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

/// Axum middleware: reject any request without a valid enrolled credential. An
/// authenticated request passes through carrying the identity the gate resolved for it
/// ([`AuthenticatedDevice`]) and nothing else changed.
///
/// Takes the live `AuthGate`, not a copy of the policy: the layer is built once when the
/// router is, and a copy taken there would be the policy as it stood at boot forever — which
/// is precisely the restart-to-enroll defect, and worse, restart-to-REVOKE.
///
/// The identity is attached HERE, at the one place it is known, rather than re-derived by a
/// handler: a handler that re-read the `Authorization` header would be a second
/// authentication path, and a handler that read the identity out of a request BODY would let
/// a caller name itself. Neither is possible when the only producer is the verification
/// itself.
///
/// The SCOPE required is read from the request LINE — method and path, through the pure
/// [`route_requirement`] table — before the credential is even looked at, and a route that
/// declares nothing admits device credentials only. A refusal says `invalid` whether the
/// credential was unknown, out of scope, or expired: one word, on purpose, because a gate
/// that distinguishes the three is a gate that helps someone enumerate.
/// ## The limiter's position, which is the design
///
/// A request with NO credential is refused and NOT counted. It guesses nothing — there is no
/// credential being tested — so counting it would let ordinary unauthenticated noise (a
/// mis-pointed client, a probe, a browser that wandered in) spend a budget that exists to
/// detect guessing, which is a way for a third party to blunt the signal for free. That is the
/// one decision this function still makes on its own; everything after it is
/// [`AuthGate::admit`], which states the limiter/policy/limiter order ONCE for every surface
/// that gates on a credential.
///
/// What the caller learns from any of it: nothing. Same status, same body, same headers, same
/// number of attempts before the same `429`, whichever budget is moving.
///
/// The node-local listener is untouched by every word of this: it is constructed WITHOUT this
/// layer (`node_local::gate_for`), so it has no credential, no failures to count, and no way
/// to reach a limiter that lives inside a middleware it never runs.
pub(crate) async fn auth_middleware(
    gate: AuthGate,
    mut request: Request<Body>,
    next: Next,
) -> Response<Body> {
    let required = route_requirement(request.method(), request.uri().path());
    let method = request.method().clone();
    let Some(token) = bearer_token(&request) else {
        // Not counted, not audited: nothing was presented, so nothing was attempted.
        return unauthorized("missing");
    };

    match gate.admit(&token, required, Instant::now()) {
        GateOutcome::Admitted { verified, record } => {
            gate.record(&record, required, method.as_str()).await;
            request.extensions_mut().insert(AuthenticatedDevice(verified.identity));
            next.run(request).await
        }
        GateOutcome::Refused { refusal, record } => {
            if let Some(record) = record {
                gate.record(&record, required, method.as_str()).await;
            }
            match refusal {
                // THE no-oracle rule, as one line of code: three different facts, one response.
                // `invalid` whether the credential was unknown, out of scope, or expired — a
                // gate that said which is a gate that confirms a guessed credential exists.
                Refusal::Invalid => unauthorized("invalid"),
                Refusal::RateLimited { retry_after } => too_many_requests(retry_after),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_hex_is_deterministic_and_lowercase_hex() {
        let a = sha256_hex("secret-token");
        assert_eq!(a, sha256_hex("secret-token"));
        assert_ne!(a, sha256_hex("other"));
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
    }

    #[test]
    fn authenticate_maps_a_known_token_to_its_identity() {
        let policy = AuthPolicy::from_credentials(vec![Credential {
            token_sha256: sha256_hex("arthur-device-1"),
            identity: "id-arthur".to_string(),
        }]);
        assert_eq!(policy.authenticate("arthur-device-1"), Some("id-arthur"));
        assert_eq!(policy.authenticate("wrong"), None);
    }

    #[test]
    fn deny_all_authenticates_nothing() {
        let policy = AuthPolicy::deny_all();
        assert_eq!(policy.authenticate("anything"), None);
    }

    // ── the derived policy path: declaring the gate IS the plumbing ────────────────

    /// A refarm dir under a fresh temp root, plus the source for it. `gate` is what the
    /// `surfaces` declaration says; the dir is what `--refarm-dir` gave the daemon.
    fn source_for(dir: &std::path::Path, gate: bool) -> AuthPolicySource {
        AuthPolicySource::new(dir.to_path_buf(), gate)
    }

    /// Write a policy enrolling exactly one `token` at `path`. Returns nothing — the
    /// assertion is always "does resolving find THIS credential", never the file's bytes.
    fn write_policy(path: &std::path::Path, token: &str, identity: &str) {
        write_policy_many(path, &[(token, identity)]);
    }

    /// The same, for an enrolment set — the shape `refarm auth enroll` writes when more than
    /// one device is enrolled, and what the reload tests add to and remove from.
    fn write_policy_many(path: &std::path::Path, enrolled: &[(&str, &str)]) {
        std::fs::write(path, policy_bytes(enrolled)).unwrap();
    }

    /// The bytes of a policy file, so a test can write a PREFIX of them (a truncated write).
    fn policy_bytes(enrolled: &[(&str, &str)]) -> Vec<u8> {
        let credentials: Vec<_> = enrolled
            .iter()
            .map(|(token, identity)| {
                serde_json::json!({ "identity": identity, "tokenSha256": sha256_hex(token) })
            })
            .collect();
        serde_json::to_vec_pretty(&serde_json::json!({ "credentials": credentials })).unwrap()
    }

    type LogBuffer = std::sync::Arc<std::sync::Mutex<Vec<u8>>>;

    struct Sink(LogBuffer);
    impl std::io::Write for Sink {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn log_subscriber(buffer: LogBuffer) -> impl tracing::Subscriber + Send + Sync {
        tracing_subscriber::fmt()
            .with_max_level(tracing::Level::TRACE)
            .with_ansi(false)
            .with_writer(move || Sink(buffer.clone()))
            .finish()
    }

    fn drain(buffer: &LogBuffer) -> String {
        String::from_utf8_lossy(&buffer.lock().unwrap().clone()).to_string()
    }

    /// Capture everything `tracing` emits while `f` runs. Used both ways: to prove the
    /// derived-but-absent line IS emitted, and to prove the cheap peek emits NOTHING.
    fn captured_logs(f: impl FnOnce()) -> String {
        let buffer: LogBuffer = Default::default();
        tracing::subscriber::with_default(log_subscriber(buffer.clone()), f);
        drain(&buffer)
    }

    /// The same capture as a GUARD, for async tests: a daemon boot spans `.await` points, so
    /// it cannot be wrapped in one closure. Hold the guard across the boot, drop it, read the
    /// buffer. Sound under `#[tokio::test]`'s single-threaded runtime — the guard is
    /// thread-local and the whole test body stays on one thread.
    fn capture_logs_until_dropped() -> (LogBuffer, tracing::subscriber::DefaultGuard) {
        let buffer: LogBuffer = Default::default();
        let guard = tracing::subscriber::set_default(log_subscriber(buffer.clone()));
        (buffer, guard)
    }

    #[test]
    fn declared_gate_derives_the_conventional_path_and_parses_the_policy_there() {
        // The defect this closes: `refarm auth enroll` writes `<refarm-dir>/auth-policy.json`
        // by default, and the reader used to demand `REFARM_AUTH_POLICY` before it would
        // look there. Declaring the gate must be enough — no env at all.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        write_policy(&dir.path().join(AUTH_POLICY_FILE_NAME), "declared-token", "id-arthur");

        let source = source_for(dir.path(), true);
        assert!(auth_policy_configured(&source), "a declared gate makes a policy resolvable");
        let gate = resolve_auth_policy(&source).expect("declared gate ⇒ Some");
        assert_eq!(gate.authenticate("declared-token").as_deref(), Some("id-arthur"));
    }

    #[test]
    fn declared_gate_with_no_policy_file_yet_is_deny_all_and_says_so_once() {
        // MUTATION GUARD. Two ways this rots: (a) an absent derived policy going back to
        // `None`, which would REFUSE the bind and lock the operator out of a runtime that
        // will not boot; (b) an absent derived policy resolving to an EMPTY-but-permissive
        // policy. Neither: bind, and deny everything, loudly — the strictest possible
        // enforcement of the gate the operator declared but has not yet enrolled into.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        let derived = dir.path().join(AUTH_POLICY_FILE_NAME);
        assert!(!derived.exists(), "the whole point is that it is NOT there yet");

        let source = source_for(dir.path(), true);
        assert!(auth_policy_configured(&source), "declared ⇒ resolvable ⇒ the bind is permitted");

        let mut resolved = None;
        let logs = captured_logs(|| resolved = resolve_auth_policy(&source));
        let gate = resolved.expect("an absent derived policy must be Some(deny_all), never None");
        assert_eq!(gate.authenticate("anything-at-all"), None, "deny ALL");

        // The line must be findable by an operator staring at an unexplained 401.
        assert!(logs.contains(&derived.display().to_string()), "must name the derived path: {logs}");
        assert!(logs.contains("ABSENT"), "must say the file is absent: {logs}");
        assert!(logs.contains("refarm auth enroll"), "must name the fix: {logs}");
    }

    #[test]
    fn env_overrides_the_derivation_even_when_the_derived_path_also_exists() {
        // MUTATION GUARD for precedence. Both files exist and enroll DIFFERENT tokens, so
        // an implementation that quietly prefers the derived path (or merges the two) fails
        // here rather than in production. The operator's explicit value always wins.
        let _env = crate::test_support::env_lock();
        let dir = tempfile::tempdir().unwrap();
        write_policy(&dir.path().join(AUTH_POLICY_FILE_NAME), "derived-token", "id-derived");
        let override_path = dir.path().join("elsewhere.json");
        write_policy(&override_path, "override-token", "id-override");

        std::env::set_var(AUTH_POLICY_ENV, &override_path);
        let gate = resolve_auth_policy(&source_for(dir.path(), true)).expect("Some");
        std::env::remove_var(AUTH_POLICY_ENV);

        assert_eq!(gate.authenticate("override-token").as_deref(), Some("id-override"));
        assert_eq!(gate.authenticate("derived-token"), None, "the derived file must be ignored");
    }

    #[test]
    fn env_override_wins_even_with_no_gate_declared() {
        // The override is not conditional on a declaration — it is how a policy is used
        // for a surface that never declared one (and how the pre-declaration world worked).
        let _env = crate::test_support::env_lock();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("explicit.json");
        write_policy(&path, "explicit-token", "id-explicit");

        std::env::set_var(AUTH_POLICY_ENV, &path);
        let source = source_for(dir.path(), false);
        let configured = auth_policy_configured(&source);
        let policy = resolve_auth_policy(&source);
        std::env::remove_var(AUTH_POLICY_ENV);

        assert!(configured);
        assert_eq!(
            policy.expect("Some").authenticate("explicit-token").as_deref(),
            Some("id-explicit")
        );
    }

    #[test]
    fn env_set_but_blank_behaves_exactly_as_unset() {
        // PIN. Blank is not a value and never was: today it means "the env decides
        // nothing", identically to unset — in BOTH directions. It is not a way to switch a
        // declared gate off (that is done by editing the declaration), and it is not a way
        // to turn one on. Easy to regress into "set ⇒ Some(deny_all)" or "blank ⇒ hard off".
        let _env = crate::test_support::env_lock();
        let dir = tempfile::tempdir().unwrap();
        write_policy(&dir.path().join(AUTH_POLICY_FILE_NAME), "declared-token", "id-arthur");

        for blank in ["", "   ", "\t\n"] {
            std::env::remove_var(AUTH_POLICY_ENV);
            let unset_no_gate = auth_policy_configured(&source_for(dir.path(), false));
            let unset_gated = auth_policy_configured(&source_for(dir.path(), true));

            std::env::set_var(AUTH_POLICY_ENV, blank);
            let blank_no_gate = auth_policy_configured(&source_for(dir.path(), false));
            let blank_gated = auth_policy_configured(&source_for(dir.path(), true));
            let blank_policy = resolve_auth_policy(&source_for(dir.path(), true));
            std::env::remove_var(AUTH_POLICY_ENV);

            assert_eq!(blank_no_gate, unset_no_gate, "blank {blank:?} must equal unset (no gate)");
            assert!(!blank_no_gate, "blank + nothing declared ⇒ no policy, exactly as today");
            assert_eq!(blank_gated, unset_gated, "blank {blank:?} must equal unset (gated)");
            assert!(blank_gated, "blank is not a value — the declaration still decides");
            assert_eq!(
                blank_policy.expect("gated ⇒ Some").authenticate("declared-token").as_deref(),
                Some("id-arthur"),
                "blank must fall through to the DERIVED path, not to a deny-all"
            );
        }
    }

    #[test]
    fn nothing_declared_and_no_env_resolves_to_no_policy_at_all() {
        // The secure default stays OFF-by-absence: no declaration, no env ⇒ no layer, byte
        // -identical to before the gate existed. A policy file sitting at the conventional
        // path does NOT switch the gate on by itself — the DECLARATION is the opt-in.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        write_policy(&dir.path().join(AUTH_POLICY_FILE_NAME), "stray-token", "id-stray");

        let source = source_for(dir.path(), false);
        assert!(!auth_policy_configured(&source));
        assert!(resolve_auth_policy(&source).is_none(), "no declaration ⇒ no gate");
    }

    #[test]
    fn a_derived_policy_that_exists_but_is_invalid_is_deny_all() {
        // Preserved from the env-only world, now for the derived path too: a broken policy
        // locks the door. Distinct from ABSENT — the file is there and unparseable, which
        // is an error, not "not enrolled yet".
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(AUTH_POLICY_FILE_NAME), "{ not json").unwrap();

        let gate = resolve_auth_policy(&source_for(dir.path(), true)).expect("Some(deny_all)");
        assert_eq!(gate.authenticate("anything"), None);
    }

    #[test]
    fn env_set_to_a_missing_file_is_still_deny_all_exactly_as_before() {
        // Today's behaviour, pinned: the operator named a path; a path that isn't there is
        // their error, and it fails closed rather than silently ungated.
        let _env = crate::test_support::env_lock();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var(AUTH_POLICY_ENV, dir.path().join("not-there.json"));
        let configured = auth_policy_configured(&source_for(dir.path(), false));
        let policy = resolve_auth_policy(&source_for(dir.path(), false));
        std::env::remove_var(AUTH_POLICY_ENV);

        assert!(configured, "set + unreadable ⇒ still resolvable (unchanged)");
        assert_eq!(policy.expect("Some(deny_all)").authenticate("anything"), None);
    }

    #[test]
    fn auth_policy_configured_answers_resolvable_and_stays_silent() {
        // Its contract: "is a policy RESOLVABLE" (declaration-derived or env), cheaply and
        // WITHOUT logging. The silence is load-bearing — it runs in the WS bind preflight
        // before the runtime boots, and the enable/deny-all line must come from exactly one
        // resolution path (`resolve_auth_policy`), once, or the operator reads it twice and
        // stops trusting it.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();

        let logs = captured_logs(|| {
            assert!(!auth_policy_configured(&source_for(dir.path(), false)), "nothing ⇒ false");
            // Derived, with NO file on disk — the exact case `resolve_auth_policy` DOES log
            // about. The peek must not read the file, and must not say a word.
            assert!(auth_policy_configured(&source_for(dir.path(), true)), "declared ⇒ true");
            std::env::set_var(AUTH_POLICY_ENV, "/nonexistent/policy.json");
            assert!(auth_policy_configured(&source_for(dir.path(), false)), "env ⇒ true");
            std::env::remove_var(AUTH_POLICY_ENV);
        });
        assert!(logs.is_empty(), "the cheap peek must emit no log line, got: {logs}");
    }

    #[test]
    fn the_derived_file_name_is_the_one_refarm_auth_enroll_writes() {
        // One convention, both sides. `apps/refarm/src/commands/auth.ts`'s
        // DEFAULT_POLICY_PATH is `.refarm/auth-policy.json`; the daemon joins this name
        // onto the refarm dir it was given. If either side renames the file alone, the
        // writer and the reader silently stop meeting — which was the original defect.
        assert_eq!(AUTH_POLICY_FILE_NAME, "auth-policy.json");
        // `resolve_policy_path` READS `REFARM_AUTH_POLICY`, so this asserts about the DERIVED
        // path only while no concurrent test has an override set. It was missing the lane its
        // sibling below takes, and passed on scheduling luck; adding eleven tests to this
        // module changed the luck and it began failing about half the time. A pre-existing
        // race in the test, not in the gate.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let source = AuthPolicySource::new(std::path::PathBuf::from("/farm/.refarm"), true);
        let located = resolve_policy_path(&source).expect("declared ⇒ a path");
        assert_eq!(located.path, std::path::PathBuf::from("/farm/.refarm/auth-policy.json"));
        assert!(located.derived, "no env ⇒ derived, not an override");
    }

    #[test]
    fn the_derived_path_comes_from_the_given_refarm_dir_not_a_hardcoded_dot_refarm() {
        // The daemon is GIVEN `--refarm-dir`; re-deriving `.refarm` from cwd (or hardcoding
        // it) is how two readers start disagreeing about which farm they are reading.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let source = AuthPolicySource::new(std::path::PathBuf::from("/srv/other-farm"), true);
        let located = resolve_policy_path(&source).expect("declared ⇒ a path");
        assert_eq!(located.path, std::path::PathBuf::from("/srv/other-farm/auth-policy.json"));
    }

    // ── ONE resolution per daemon start: the answer travels, not the source ───────

    /// A `WsServer` holding `resolved`, on a host its own bind guard REFUSES (non-loopback
    /// with no declaration — S1). The refusal happens inside the real `start`, after all of
    /// its policy handling and before `TcpListener::bind`, so these tests drive the true
    /// production entry point without ever opening a socket.
    fn ws_gate(resolved: ResolvedAuthPolicy) -> crate::daemon::WsServer {
        let storage = crate::NativeStorage::open(":memory:").unwrap();
        crate::daemon::WsServer::new(
            std::sync::Arc::new(crate::NativeSync::new(storage, ":memory:").unwrap()),
            "0.0.0.0".to_string(),
            0,
            crate::TelemetryBus::new(4),
            std::sync::Arc::new(std::sync::RwLock::new(std::collections::HashMap::new())),
            crate::EventRouter::default(),
            None,
            resolved,
        )
    }

    /// The HTTP sidecar's real entry point, refused by its own bind guard for the same
    /// reason and at the same point — after the policy is handled, before the reaper spawns
    /// or anything binds.
    async fn http_gate(dir: &std::path::Path, resolved: ResolvedAuthPolicy) -> anyhow::Result<()> {
        let state = crate::sidecar::SidecarState::for_test(dir, ":memory:").unwrap();
        crate::sidecar::start(state, Some("0.0.0.0".to_string()), 0, None, resolved).await
    }

    #[tokio::test]
    async fn a_daemon_start_logs_the_deny_all_line_exactly_once_across_both_gates() {
        // THE BUG, pinned. `sidecar::start` and `daemon::WsServer::start` each used to call
        // `resolve_auth_policy` for themselves, so a real boot with a declared-but-unenrolled
        // gate printed the derived-but-ABSENT warning TWICE, ~10µs apart — and the noise was
        // the mild half: two independent reads of one file are two answers that can disagree.
        //
        // This reproduces a boot against the REAL entry points — resolve once, hand the same
        // value to both gates — and counts the line. Two is the defect; one is the contract.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        let source = source_for(dir.path(), true);
        assert!(
            !dir.path().join(AUTH_POLICY_FILE_NAME).exists(),
            "the gate is declared and enrollment has not happened — the case that warns"
        );

        let (logs, guard) = capture_logs_until_dropped();

        // Exactly what main.rs does: ONE resolution per daemon start …
        let resolved = ResolvedAuthPolicy::resolve(&source);
        // … then the SAME value into both gates, neither of which holds a source to
        // re-resolve from. Both refuse the bind, which is how they return without a socket.
        assert!(
            http_gate(dir.path(), resolved.clone()).await.is_err(),
            "the sidecar's bind guard must refuse 0.0.0.0 with no declaration (S1)"
        );
        assert!(
            ws_gate(resolved).start().await.is_err(),
            "the WS bind guard must refuse 0.0.0.0 with no declaration (S1)"
        );

        drop(guard);
        let logs = drain(&logs);
        assert_eq!(
            logs.matches("ABSENT").count(),
            1,
            "the deny-all line must be emitted EXACTLY ONCE per daemon start — not once per \
             gate. A second count here means a gate resolved the policy for itself again: \
             {logs}"
        );
    }

    #[tokio::test]
    async fn a_policy_readable_at_resolution_time_reaches_both_gates_as_one_value() {
        // The other half of "resolve once": the value that travels must be the RESOLVED one,
        // not an empty placeholder each gate is expected to fill in later. With a real policy
        // file on disk, one resolution must produce one policy that BOTH gates carry — the
        // sidecar into its middleware layer, the WS server into its handshake gate — and it
        // must authenticate the enrolled credential in both. (That both ENFORCE it over a
        // real socket is proven end-to-end in `daemon::ws_server`'s
        // `one_resolution_is_the_policy_both_gates_really_enforce`.)
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        write_policy(&dir.path().join(AUTH_POLICY_FILE_NAME), "shared-token", "id-shared");

        let resolved = ResolvedAuthPolicy::resolve(&source_for(dir.path(), true));
        assert!(resolved.is_gated(), "a readable declared policy ⇒ the gate is bound");
        assert_eq!(
            resolved.gate().expect("gated ⇒ Some").authenticate("shared-token").as_deref(),
            Some("id-shared"),
            "the value handed to both gates must be the policy that was actually READ"
        );

        // Deleting the file changes nothing until the daemon LOOKS again: the gates hold the
        // resolved value, not a promise to re-read on every request. (What happens when it
        // does look is `a_disappeared_policy_file_reloads_to_deny_all`, below.)
        std::fs::remove_file(dir.path().join(AUTH_POLICY_FILE_NAME)).unwrap();
        let for_http = resolved.gate().expect("gated ⇒ Some");
        let for_ws = resolved.gate().expect("gated ⇒ Some");
        assert_eq!(
            for_http.authenticate("shared-token"),
            for_ws.authenticate("shared-token"),
            "both gates must hold the same answer, from the same single read"
        );
        assert_eq!(for_ws.authenticate("some-other-token"), None);
    }

    #[test]
    fn resolving_through_the_shared_value_keeps_all_four_cases_intact() {
        // The wrapper is PLUMBING — who calls the resolution, not what it decides. All four
        // cases must answer exactly as they did when each gate resolved for itself.
        let _env = crate::test_support::env_lock();
        let dir = tempfile::tempdir().unwrap();
        let derived = dir.path().join(AUTH_POLICY_FILE_NAME);
        let override_path = dir.path().join("elsewhere.json");
        write_policy(&derived, "derived-token", "id-derived");
        write_policy(&override_path, "override-token", "id-override");

        // 1. env override wins over the derivation.
        std::env::set_var(AUTH_POLICY_ENV, &override_path);
        let overridden = ResolvedAuthPolicy::resolve(&source_for(dir.path(), true));
        std::env::remove_var(AUTH_POLICY_ENV);
        let gate = overridden.gate().expect("override ⇒ Some");
        assert_eq!(gate.authenticate("override-token").as_deref(), Some("id-override"));
        assert_eq!(gate.authenticate("derived-token"), None, "the derived file is ignored");

        // 2. declared gate, env unset ⇒ the derived path.
        let derived_only = ResolvedAuthPolicy::resolve(&source_for(dir.path(), true));
        assert_eq!(
            derived_only.gate().expect("declared ⇒ Some").authenticate("derived-token").as_deref(),
            Some("id-derived")
        );

        // 3. declared gate, file absent ⇒ bound and deny-all, never None.
        let empty = tempfile::tempdir().unwrap();
        let absent = ResolvedAuthPolicy::resolve(&source_for(empty.path(), true));
        assert!(absent.is_gated(), "absent must still BIND the gate");
        assert_eq!(absent.gate().unwrap().authenticate("anything"), None, "deny ALL");

        // 4. nothing declared, no env ⇒ no gate at all, even with a file sitting there.
        let undeclared = ResolvedAuthPolicy::resolve(&source_for(dir.path(), false));
        assert!(!undeclared.is_gated());
        assert!(undeclared.gate().is_none(), "no declaration ⇒ no gate");
    }

    #[test]
    fn the_cheap_peek_agrees_with_the_one_resolution_in_every_case() {
        // The WS bind preflight still runs BEFORE the single resolution and still answers
        // from `auth_policy_configured` — no file read, no log line, so it can refuse a bad
        // `--ws-host` as the daemon's first act. That ordering is only honest while the peek
        // and the resolution cannot disagree: both are exactly "`resolve_policy_path` is
        // `Some`". If they ever diverge, the preflight would permit a bind the gate does not
        // actually guard (or refuse one it does).
        let _env = crate::test_support::env_lock();
        let dir = tempfile::tempdir().unwrap();
        write_policy(&dir.path().join(AUTH_POLICY_FILE_NAME), "tok", "id");
        let missing = dir.path().join("not-there.json");

        for (label, env, gate) in [
            ("nothing declared, no env", None, false),
            ("declared, no env (derived)", None, true),
            ("env override, no declaration", Some(missing.clone()), false),
            ("env override + declaration", Some(missing.clone()), true),
            ("blank env, declared", Some(std::path::PathBuf::from("  ")), true),
            ("blank env, undeclared", Some(std::path::PathBuf::from("  ")), false),
        ] {
            match &env {
                Some(v) => std::env::set_var(AUTH_POLICY_ENV, v),
                None => std::env::remove_var(AUTH_POLICY_ENV),
            }
            let source = source_for(dir.path(), gate);
            let peeked = auth_policy_configured(&source);
            let resolved = ResolvedAuthPolicy::resolve(&source).is_gated();
            std::env::remove_var(AUTH_POLICY_ENV);
            assert_eq!(peeked, resolved, "peek and resolution disagree for: {label}");
        }
    }

    // ── hot reload: the policy follows the FILE, and no gate restarts ─────────────
    //
    // The operational fact these pin: `refarm auth enroll` writes this file while the daemon
    // is running. Reading it only at boot made enrolling a device require a full runtime
    // restart before its credential was accepted — and, in the direction that actually
    // matters, made REVOKING one require a restart before it stopped being accepted.

    /// The one resolution, on a declared gate over a real temp refarm dir, with `enrolled`
    /// already written. Returns the dir (kept alive), the policy path, and the live gate —
    /// exactly the handle `sidecar::start` and `WsServer::start` each clone.
    fn resolved_gate(enrolled: &[(&str, &str)]) -> (tempfile::TempDir, PathBuf, AuthGate) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(AUTH_POLICY_FILE_NAME);
        write_policy_many(&path, enrolled);
        let gate = ResolvedAuthPolicy::resolve(&source_for(dir.path(), true))
            .gate()
            .expect("a declared gate ⇒ a bound gate");
        (dir, path, gate)
    }

    #[test]
    fn a_credential_added_to_the_file_is_accepted_without_a_restart() {
        // The operator's Tuesday: the daemon is up, the phone is enrolled, and the phone
        // works. Before this, the enrolment landed in the file and the running daemon never
        // looked again — a 401 with no explanation for anyone who enrolled after the boot.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let (_dir, path, gate) = resolved_gate(&[("laptop-token", "id-laptop")]);
        assert_eq!(gate.authenticate("phone-token"), None, "not enrolled yet ⇒ rejected");

        write_policy_many(&path, &[("laptop-token", "id-laptop"), ("phone-token", "id-phone")]);
        assert!(gate.reload_if_changed(), "the file changed ⇒ the policy is re-read");

        assert_eq!(
            gate.authenticate("phone-token").as_deref(),
            Some("id-phone"),
            "the newly enrolled device must be admitted by the RUNNING daemon"
        );
        assert_eq!(
            gate.authenticate("laptop-token").as_deref(),
            Some("id-laptop"),
            "and the device that was already enrolled must not be disturbed"
        );
    }

    #[test]
    fn a_credential_removed_from_the_file_stops_being_accepted_without_a_restart() {
        // MUTATION GUARD, and the more important direction. Revocation is the one that is
        // dangerous to get wrong: a stolen phone whose credential the operator has deleted
        // must stop working NOW, not at the next restart — and a reload that only ever ADDS
        // (merging into the policy in force instead of REPLACING it) would pass the
        // enrolment test above and silently fail here forever.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let (_dir, path, gate) =
            resolved_gate(&[("laptop-token", "id-laptop"), ("phone-token", "id-phone")]);
        assert_eq!(gate.authenticate("phone-token").as_deref(), Some("id-phone"));

        // The revocation: the file is rewritten WITHOUT the phone.
        write_policy_many(&path, &[("laptop-token", "id-laptop")]);
        assert!(gate.reload_if_changed(), "the file changed ⇒ the policy is re-read");

        assert_eq!(
            gate.authenticate("phone-token"),
            None,
            "a REVOKED credential must stop authenticating in the running daemon"
        );
        assert_eq!(
            gate.authenticate("laptop-token").as_deref(),
            Some("id-laptop"),
            "revoking one device must not evict the others"
        );
    }

    #[test]
    fn a_policy_that_becomes_invalid_never_widens_access() {
        // MUTATION GUARD. Fail-closed on re-read, by the SAME rule as boot
        // (`a_derived_policy_that_exists_but_is_invalid_is_deny_all`): a policy that cannot
        // be believed locks the door. The dangerous mutations are silent — parse failure
        // leaving the previous policy in force (a revoked credential surviving a corrupt
        // write, indefinitely), or worse, a failed parse being treated as "no constraints".
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let (_dir, path, gate) = resolved_gate(&[("laptop-token", "id-laptop")]);
        assert_eq!(gate.authenticate("laptop-token").as_deref(), Some("id-laptop"));

        std::fs::write(&path, "{ not json").unwrap();
        let logs = captured_logs(|| {
            assert!(gate.reload_if_changed(), "a broken file is a CHANGE, and must be acted on");
        });

        assert_eq!(gate.authenticate("laptop-token"), None, "deny-all, not last-known-good");
        assert_eq!(gate.authenticate("anything-else"), None, "and certainly not ungated");
        assert!(logs.contains("DENY-ALL"), "the operator must be told the door shut: {logs}");
        assert!(
            !logs.contains("auth policy reloaded"),
            "a broken file must never be reported as a successful reload: {logs}"
        );
    }

    #[test]
    fn an_unreadable_policy_file_never_widens_access() {
        // The other half of "cannot be believed": the bytes are there but the process may
        // not have them (a permission change, a mount going away). Same answer as invalid —
        // deny-all — because "I could not read the policy" is not "there is no policy".
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let (_dir, path, gate) = resolved_gate(&[("laptop-token", "id-laptop")]);
        assert_eq!(gate.authenticate("laptop-token").as_deref(), Some("id-laptop"));

        // A DIRECTORY where the file was: `read_to_string` fails with something that is
        // neither NotFound nor a parse error — the third branch, reached without needing to
        // run as a non-root user (in a container, chmod 000 does not stop root).
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();

        assert!(gate.reload_if_changed(), "unreadable is a change");
        assert_eq!(gate.authenticate("laptop-token"), None, "deny-all, not last-known-good");
    }

    #[test]
    fn a_truncated_write_is_never_observed_as_a_valid_empty_policy() {
        // Enrolment WRITES this file, so a partial read is a real race, not a theory. The
        // failure to design against is a half-written file being taken for a policy: parsed
        // as "no credentials" and reported as a clean reload, which reads in the log exactly
        // like a deliberate revocation of every device. It cannot be — truncated JSON does
        // not parse — and the log must say so.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let (_dir, path, gate) = resolved_gate(&[("laptop-token", "id-laptop")]);

        let complete = policy_bytes(&[("laptop-token", "id-laptop"), ("phone-token", "id-phone")]);
        for cut in [1, complete.len() / 3, complete.len() / 2, complete.len() - 1] {
            std::fs::write(&path, &complete[..cut]).unwrap();
            let logs = captured_logs(|| {
                gate.reload_if_changed();
            });
            assert!(
                !logs.contains("auth policy reloaded"),
                "a {cut}-byte prefix must not be reported as a successful reload: {logs}"
            );
            assert_eq!(gate.authenticate("phone-token"), None, "a prefix enrols nobody");
            assert_eq!(gate.authenticate("laptop-token"), None, "and admits nobody: deny-all");
        }

        // …and the write COMPLETING is itself a change, so the gate is not wedged shut by
        // having observed the prefix: the enrolment lands on the very next read.
        std::fs::write(&path, &complete).unwrap();
        assert!(gate.reload_if_changed(), "the completed write is a change");
        assert_eq!(gate.authenticate("phone-token").as_deref(), Some("id-phone"));
        assert_eq!(gate.authenticate("laptop-token").as_deref(), Some("id-laptop"));
    }

    #[test]
    fn a_disappeared_policy_file_reloads_to_deny_all() {
        // Deleting the policy is not "the gate is off" — the gate is DECLARED, and a
        // declaration is turned off by editing the declaration, never by removing a file.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let (_dir, path, gate) = resolved_gate(&[("laptop-token", "id-laptop")]);
        std::fs::remove_file(&path).unwrap();

        let logs = captured_logs(|| assert!(gate.reload_if_changed()));
        assert_eq!(gate.authenticate("laptop-token"), None, "deny ALL");
        assert!(logs.contains("DENY-ALL"), "and say so: {logs}");
    }

    #[test]
    fn both_gates_observe_the_same_value_after_a_reload() {
        // The single-resolution contract, extended through time. Each gate takes its own
        // clone at boot — the HTTP sidecar into its middleware layer
        // (`AuthGate::authenticate`), the WS server into its handshake callback
        // (`AuthGate::snapshot`) — and a clone is an `Arc` bump, not a copy of the
        // credentials. If either gate ever held a SNAPSHOT for the process lifetime, one
        // would keep honouring a credential the other had revoked, with nothing in the log
        // to explain it: the exact drift resolving once was meant to make impossible.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(AUTH_POLICY_FILE_NAME);
        write_policy_many(&path, &[("laptop-token", "id-laptop")]);
        let resolved = ResolvedAuthPolicy::resolve(&source_for(dir.path(), true));

        let for_http = resolved.gate().expect("gated");
        let for_ws = resolved.gate().expect("gated");

        // Enrolment, observed by ONE of them …
        write_policy_many(&path, &[("laptop-token", "id-laptop"), ("phone-token", "id-phone")]);
        assert!(for_http.reload_if_changed());
        // … is in force for the OTHER, at the exact call its gate makes.
        assert_eq!(
            for_ws.snapshot().authenticate("phone-token"),
            Some("id-phone"),
            "the WS handshake must see an enrolment applied by the HTTP side"
        );

        // And the reverse, for the direction that matters: a revocation applied by the WS
        // side is in force for the HTTP middleware.
        write_policy_many(&path, &[("laptop-token", "id-laptop")]);
        assert!(for_ws.reload_if_changed());
        assert_eq!(
            for_http.authenticate("phone-token"),
            None,
            "the HTTP gate must see a revocation applied by the WS side"
        );
        assert_eq!(for_http.authenticate("laptop-token").as_deref(), Some("id-laptop"));
        assert_eq!(
            for_http.authenticate("laptop-token").as_deref(),
            for_ws.snapshot().authenticate("laptop-token"),
            "one value, two gates — always"
        );
    }

    #[test]
    fn a_reload_emits_exactly_one_line_and_an_unchanged_file_emits_none() {
        // The one-emitter discipline the boot line already keeps, applied to reloads. Two
        // lines per reload and the operator stops reading them; a line per POLL (every two
        // seconds, forever) and the log is unusable. And the count is what makes a
        // revocation legible — `identities` going down is the confirmation the operator is
        // looking for at the moment they most need it.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let (_dir, path, gate) =
            resolved_gate(&[("laptop-token", "id-laptop"), ("phone-token", "id-phone")]);

        let quiet = captured_logs(|| {
            assert!(!gate.reload_if_changed(), "nothing changed ⇒ no reload");
            assert!(!gate.reload_if_changed(), "still nothing changed");
        });
        assert!(quiet.is_empty(), "an unchanged file must say nothing at all: {quiet}");

        write_policy_many(&path, &[("laptop-token", "id-laptop")]);
        let logs = captured_logs(|| {
            assert!(gate.reload_if_changed(), "the revocation is a change");
            assert!(!gate.reload_if_changed(), "and re-reading it is not a second one");
        });
        assert_eq!(
            logs.matches("auth policy reloaded").count(),
            1,
            "exactly ONE line per reload: {logs}"
        );
        assert!(logs.contains("identities=1"), "the new count, so a revocation is visible: {logs}");
        assert!(logs.contains("previously=2"), "and what it was, so the DELTA is visible: {logs}");
        assert!(!logs.contains("id-phone"), "never an identity name: {logs}");
        assert!(!logs.contains(&sha256_hex("phone-token")), "and never a hash: {logs}");
    }

    #[test]
    fn no_declared_gate_means_no_watcher_and_nothing_to_reload() {
        // The secure default stays off-by-absence, watcher included: nothing declared ⇒ no
        // path is watched and no task is spawned. Called OUTSIDE a tokio runtime on purpose
        // — a `tokio::spawn` here would panic, which is the assertion.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        write_policy(&dir.path().join(AUTH_POLICY_FILE_NAME), "stray-token", "id-stray");

        let resolved = ResolvedAuthPolicy::resolve(&source_for(dir.path(), false));
        assert!(!resolved.is_gated());
        resolved.spawn_reload_watcher();
        assert!(resolved.gate().is_none(), "no declaration ⇒ no gate, and nothing to watch");
    }

    #[tokio::test]
    async fn the_watcher_applies_an_enrolment_and_then_a_revocation_on_its_own() {
        // `reload_if_changed` is what the tests above drive directly; this is the thing that
        // CALLS it in a running daemon. Without this, every assertion above holds and an
        // operator still has to restart, because nothing ever looks at the file.
        //
        // The real loop, at a 5ms period instead of the production two seconds — see
        // `spawn_reload_watcher_every`.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(AUTH_POLICY_FILE_NAME);
        write_policy_many(&path, &[("laptop-token", "id-laptop")]);

        let resolved = ResolvedAuthPolicy::resolve(&source_for(dir.path(), true));
        let gate = resolved.gate().expect("gated");
        resolved.spawn_reload_watcher_every(Duration::from_millis(5));

        /// Wait for the watcher to reach `expected`, or give up. Never a bare sleep: the
        /// assertion is what the watcher DID, not how long the test was willing to wait.
        async fn until(gate: &AuthGate, token: &str, expected: Option<&str>) -> bool {
            for _ in 0..200 {
                if gate.authenticate(token).as_deref() == expected {
                    return true;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            false
        }

        write_policy_many(&path, &[("laptop-token", "id-laptop"), ("phone-token", "id-phone")]);
        assert!(
            until(&gate, "phone-token", Some("id-phone")).await,
            "the watcher must apply the enrolment with no restart and no prompting"
        );

        write_policy_many(&path, &[("laptop-token", "id-laptop")]);
        assert!(
            until(&gate, "phone-token", None).await,
            "and the revocation, which is the one that must not wait for a restart"
        );
        assert_eq!(
            gate.authenticate("laptop-token").as_deref(),
            Some("id-laptop"),
            "without evicting the device that was never revoked"
        );
    }

    // ── scoped credentials: narrow authority, and it DIES ─────────────────────────
    //
    // The operational fact these pin: `refarm auth verify` (the emoji-SAS exchange) writes a
    // `scopedCredentials` entry into this same file so a BROWSER can answer the operator's
    // pending questions without holding a device token. Everything below is about that entry
    // being honoured for exactly what it says and nothing more — the right routes, and only
    // until its deadline.

    /// Route requirements, spelled short. Undeclared routes remain device-only.
    const ANSWER: RouteRequirement = RouteRequirement::Scoped(Scope::AnswerPrompts);
    const READ_OPERATIONS: RouteRequirement = RouteRequirement::Scoped(Scope::ReadOperations);
    const START_OPERATIONS: RouteRequirement = RouteRequirement::Scoped(Scope::StartOperations);
    const DEVICE_ONLY: RouteRequirement = RouteRequirement::DeviceOnly;

    /// An epoch-ms instant to hang the tests off, so "expired" and "live" are statements
    /// about the credential rather than about how fast the suite runs.
    const NOW: i64 = 1_800_000_000_000;

    #[test]
    fn scope_vocabulary_matches_the_minting_runtime_fixture() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../emoji-sas-v1/scopes.fixture.json"
        ))
        .expect("scope fixture parses");
        assert_eq!(
            fixture["scopes"],
            serde_json::json!([
                SCOPE_ANSWER_PROMPTS,
                SCOPE_READ_OPERATIONS,
                SCOPE_START_OPERATIONS
            ])
        );
    }

    /// One scoped credential's JSON, in the exact shape `apps/refarm`'s `auth verify` writes
    /// (`packages/emoji-sas-v1`'s `ScopedCredential`).
    fn scoped_entry(
        token: &str,
        identity: &str,
        scope: &[&str],
        expires_at_ms: i64,
    ) -> serde_json::Value {
        serde_json::json!({
            "wire": SCOPED_CREDENTIAL_WIRE,
            "id": format!("scr_{identity}"),
            "identity": identity,
            "tokenSha256": sha256_hex(token),
            "scope": scope,
            "surface": "web",
            "issuedVia": "emoji-sas.v1",
            "issuedAt": NOW - 60_000,
            "expiresAt": expires_at_ms,
        })
    }

    /// A live `prompt:answer` credential — the ordinary case.
    fn live_scoped(token: &str, identity: &str) -> serde_json::Value {
        scoped_entry(token, identity, &[Scope::AnswerPrompts.wire()], NOW + 60_000)
    }

    /// The bytes of a policy carrying BOTH arrays — devices, and whatever raw scoped entries
    /// a test wants to put in front of the parser.
    fn policy_bytes_with_scoped(
        enrolled: &[(&str, &str)],
        scoped: &[serde_json::Value],
    ) -> Vec<u8> {
        let credentials: Vec<_> = enrolled
            .iter()
            .map(|(token, identity)| {
                serde_json::json!({ "identity": identity, "tokenSha256": sha256_hex(token) })
            })
            .collect();
        serde_json::to_vec_pretty(&serde_json::json!({
            "credentials": credentials,
            "scopedCredentials": scoped,
        }))
        .unwrap()
    }

    fn parse_with_scoped(enrolled: &[(&str, &str)], scoped: &[serde_json::Value]) -> AuthPolicy {
        let bytes = policy_bytes_with_scoped(enrolled, scoped);
        parse_policy(std::str::from_utf8(&bytes).unwrap()).expect("valid JSON")
    }

    // ── the route table: what each route DECLARES ────────────────────────────────

    #[test]
    fn route_requirement_declares_each_narrow_browser_authority() {
        // The table, stated as a test so a widening is a diff. Note the method split on the
        // SAME path: reading the questions is scoped, publishing one is not — an asking
        // process is not an answering device.
        assert_eq!(route_requirement(&Method::GET, "/prompts"), ANSWER);
        assert_eq!(route_requirement(&Method::POST, "/prompts/p-1/answer"), ANSWER);
        assert_eq!(route_requirement(&Method::GET, "/operations"), READ_OPERATIONS);
        assert_eq!(route_requirement(&Method::GET, "/operations/r-one"), READ_OPERATIONS);
        assert_eq!(route_requirement(&Method::POST, "/operations"), START_OPERATIONS);
        assert_eq!(
            route_requirement(&Method::POST, "/operations/r-one/cancel"),
            START_OPERATIONS
        );

        assert_eq!(
            route_requirement(&Method::POST, "/prompts"),
            DEVICE_ONLY,
            "publishing a question is an ASKER's act — a browser session must not be able to"
        );
        for (method, path) in [
            (Method::GET, "/efforts"),
            (Method::POST, "/efforts"),
            (Method::GET, "/sessions"),
            (Method::GET, "/plugins"),
            (Method::POST, "/plugins/reload"),
            (Method::GET, "/connections"),
            (Method::POST, "/connections/vpn/up"),
            (Method::GET, "/stream/activity"),
            (Method::GET, "/nodes"),
            (Method::GET, "/tasks"),
        ] {
            assert_eq!(
                route_requirement(&method, path),
                DEVICE_ONLY,
                "{method} {path} declares no scope ⇒ device credentials only"
            );
        }
    }

    #[test]
    fn a_route_that_declares_nothing_is_device_only_including_ones_nobody_wrote_down() {
        // THE fail-closed reading of silence, and the half that has to survive future edits:
        // a path this table has never heard of — a route added tomorrow, a typo, a nesting
        // that is one segment off — is DEVICE-ONLY. Not "unknown ⇒ allow", and not
        // "unknown ⇒ inherit the nearest match".
        for path in [
            "/",
            "/prompts/p-1",
            "/prompts/p-1/answer/extra",
            "/prompts/answer",
            "/some/route/invented/later",
            "//prompts//answer",
        ] {
            assert_eq!(
                route_requirement(&Method::GET, path),
                DEVICE_ONLY,
                "GET {path} was never declared scoped ⇒ device-only"
            );
            assert_eq!(route_requirement(&Method::POST, path), DEVICE_ONLY, "POST {path}");
        }
        // …and an unexpected METHOD on a declared path is equally undeclared.
        for method in [Method::PUT, Method::DELETE, Method::PATCH, Method::HEAD] {
            assert_eq!(route_requirement(&method, "/prompts"), DEVICE_ONLY, "{method} /prompts");
        }
    }

    #[test]
    fn route_requirement_matches_the_patterns_the_router_actually_registers() {
        // The two spellings — axum's `:id` pattern (what `sidecar_routes` registers) and this
        // module's segment matcher (what the gate judges) — must describe the same route. A
        // rename of one alone is exactly how a scoped route silently becomes device-only, or
        // a device-only route silently becomes reachable by a browser session.
        assert_eq!(ROUTE_PROMPTS, "/prompts");
        assert_eq!(ROUTE_PROMPT_ANSWER, "/prompts/:id/answer");
        let concrete = ROUTE_PROMPT_ANSWER.replace(":id", "prm_01HZY");
        assert_eq!(route_requirement(&Method::POST, &concrete), ANSWER);
        assert_eq!(route_requirement(&Method::GET, ROUTE_PROMPTS), ANSWER);
        // A percent-encoded id is still ONE segment to axum's matcher, so it is still this
        // route — and must be judged as this route. The two matchers agreeing on the same
        // request is the property; treating it as an unknown path would refuse a legitimate
        // answer, and treating an unknown path as this one would grant a scope to a route
        // that never declared it.
        assert_eq!(route_requirement(&Method::POST, "/prompts/p%2F1/answer"), ANSWER);
    }

    // ── accepted for its scope, refused for anything else ────────────────────────

    #[test]
    fn a_scoped_credential_is_accepted_for_its_scope_and_refused_for_every_other_route() {
        let policy = parse_with_scoped(&[], &[live_scoped("browser-token", "web-session-abc")]);

        let verified = policy
            .verify("browser-token", ANSWER, Some(NOW))
            .expect("the scope it holds ⇒ admitted");
        assert_eq!(verified.identity, "web-session-abc");
        assert_eq!(
            verified.kind,
            CredentialKind::Scoped,
            "honoured AS a scoped credential — never promoted to a device one"
        );

        // MUTATION GUARD (silent + dangerous): a scoped credential accepted by a route that
        // never declared its scope. Most sidecar routes are this case and remain full-authority.
        assert_eq!(
            policy.verify("browser-token", DEVICE_ONLY, Some(NOW)),
            None,
            "a route that declared NO scope must never be reachable by a scoped credential"
        );
        assert_eq!(policy.verify("some-other-token", ANSWER, Some(NOW)), None);
    }

    #[test]
    fn a_scoped_credential_that_does_not_hold_the_required_scope_is_refused() {
        // MUTATION GUARD for the scope check itself, isolated from the route table. With one
        // wire scope defined today, "does not hold it" is expressed by an EMPTY scope set —
        // which the parser refuses to produce, so it can only exist here. If
        // `scope.contains(required)` ever becomes `true`, or the check is dropped, this is
        // the test that notices; the route-table guard above would not, because the route
        // there declares no scope at all.
        let policy = AuthPolicy::from_parts(
            vec![],
            vec![ScopedCredential {
                token_sha256: sha256_hex("browser-token"),
                identity: "web-session-abc".to_string(),
                scope: vec![],
                expires_at_ms: NOW + 60_000,
            }],
        );
        assert_eq!(
            policy.verify("browser-token", ANSWER, Some(NOW)),
            None,
            "a credential that does not HOLD the required scope is refused, deadline or no"
        );
    }

    // ── expiry: enforced at the door, at every request ───────────────────────────

    #[test]
    fn an_expired_scoped_credential_is_refused_and_the_deadline_itself_is_already_past() {
        // MUTATION GUARD (silent + dangerous): an expired credential accepted. A browser
        // session that outlives its deadline is a device token with extra steps — the exact
        // thing the scoped shape exists to avoid.
        let policy = parse_with_scoped(&[], &[live_scoped("browser-token", "web-session-abc")]);

        // …live before the deadline …
        assert!(policy.verify("browser-token", ANSWER, Some(NOW + 59_999)).is_some());
        // … dead AT it (`now >= expiresAt`, the same boundary emoji-sas-v1 uses) …
        assert_eq!(
            policy.verify("browser-token", ANSWER, Some(NOW + 60_000)),
            None,
            "the deadline instant is already expired — `>=`, not `>`"
        );
        // … and dead after.
        assert_eq!(policy.verify("browser-token", ANSWER, Some(NOW + 60_001)), None);
    }

    #[test]
    fn an_expiry_already_past_at_load_time_parses_and_is_refused_at_the_door() {
        // THE stated clock policy, pinned: an already-expired entry is a RUNTIME refusal, not
        // a parse error. Parsing must be a pure function of the bytes (the reload is
        // fingerprint-driven — same bytes, no re-read), so a clock inside the parser would
        // make the same file mean two different things at two different times, and a deadline
        // that passes while the file sits unchanged would never be noticed at all.
        let policy = parse_with_scoped(
            &[("laptop-token", "id-laptop")],
            &[scoped_entry("stale-token", "web-session-old", &[SCOPE_ANSWER_PROMPTS], NOW - 1)],
        );
        assert_eq!(policy.scoped_count(), 1, "it PARSES — the bytes are well formed");
        assert_eq!(policy.refused_scoped_count(), 0, "and is not a parse refusal");
        assert_eq!(
            policy.verify("stale-token", ANSWER, Some(NOW)),
            None,
            "…and it authenticates NOTHING, which is where expiry is actually enforced"
        );
        assert_eq!(
            policy.authenticate("laptop-token"),
            Some("id-laptop"),
            "a dead scoped entry must not disturb the devices in the same file"
        );
    }

    #[test]
    fn an_unreadable_host_clock_refuses_every_scoped_credential_and_no_device_one() {
        // The skew policy's edge: a clock that cannot be read as a point after the UNIX epoch
        // cannot be used to say a deadline has NOT passed, so it says nothing and everything
        // scoped is refused. Device credentials have no deadline and are untouched — the
        // operator is never locked out of their own node by a bad clock.
        let policy = parse_with_scoped(
            &[("laptop-token", "id-laptop")],
            &[live_scoped("browser-token", "web-session-abc")],
        );
        assert_eq!(policy.verify("browser-token", ANSWER, None), None, "no clock ⇒ no grant");
        assert_eq!(
            policy.verify("laptop-token", ANSWER, None).map(|v| v.kind),
            Some(CredentialKind::Device),
            "a device credential does not consult the clock and never did"
        );
    }

    // ── a device credential is unscoped, and stays unscoped ──────────────────────

    #[test]
    fn a_device_credential_satisfies_every_route_scoped_or_not() {
        let policy = parse_with_scoped(
            &[("laptop-token", "id-laptop")],
            &[live_scoped("browser-token", "web-session-abc")],
        );
        for required in [DEVICE_ONLY, ANSWER] {
            let verified = policy
                .verify("laptop-token", required, Some(NOW))
                .unwrap_or_else(|| panic!("a device credential must satisfy {required:?}"));
            assert_eq!(verified.identity, "id-laptop");
            assert_eq!(verified.kind, CredentialKind::Device);
        }
        // …including long after any scoped credential in the same file would have died: a
        // device credential has no expiry, and acquiring one would be a narrowing.
        assert!(policy.verify("laptop-token", DEVICE_ONLY, Some(NOW + 10_000_000)).is_some());
    }

    #[test]
    fn a_scoped_entry_is_never_a_device_credential() {
        // MUTATION GUARD (silent + dangerous), and the whole reason `emoji-sas-v1` refused to
        // write into `credentials[]` in the first place: a scoped entry treated as a device
        // credential would be full authority over every route, forever.
        let policy = parse_with_scoped(&[], &[live_scoped("browser-token", "web-session-abc")]);

        assert_eq!(
            policy.authenticate("browser-token"),
            None,
            "the DEVICE lookup — which is what the WS handshake enforces — must not see it"
        );
        assert_eq!(policy.identity_count(), 0, "it is not an enrolled device identity");
        assert_eq!(policy.scoped_count(), 1);
        assert_eq!(
            policy.verify("browser-token", ANSWER, Some(NOW)).map(|v| v.kind),
            Some(CredentialKind::Scoped),
            "admitted, and admitted AS scoped"
        );
    }

    #[test]
    fn credentials_keep_their_exact_meaning_when_scoped_looking_fields_appear_beside_them() {
        // REQUIREMENT, pinned in both directions: a field appearing in one array must not
        // change the other array's semantics. A `credentials[]` entry carrying `scope` and
        // `expiresAt` is STILL a full, unscoped, non-expiring device credential — those keys
        // are ignored there exactly as every unknown key always has been. Reading them would
        // silently reclassify an enrolled device.
        let raw = serde_json::json!({
            "credentials": [{
                "identity": "id-arthur",
                "tokenSha256": sha256_hex("phone-token"),
                "scope": ["prompt:answer"],
                "expiresAt": NOW - 10_000_000,
                "wire": SCOPED_CREDENTIAL_WIRE,
            }],
            "scopedCredentials": [live_scoped("browser-token", "web-session-abc")],
        })
        .to_string();
        let policy = parse_policy(&raw).expect("valid policy");

        assert_eq!(policy.identity_count(), 1, "still an enrolled device");
        assert_eq!(policy.authenticate("phone-token"), Some("id-arthur"));
        for required in [DEVICE_ONLY, ANSWER] {
            assert_eq!(
                policy.verify("phone-token", required, Some(NOW)).map(|v| v.kind),
                Some(CredentialKind::Device),
                "an ignored `expiresAt`/`scope` beside a device credential changes NOTHING"
            );
        }
        assert!(
            policy.verify("phone-token", DEVICE_ONLY, None).is_some(),
            "and it is still clock-independent"
        );
    }

    // ── one bad entry refuses itself, and only itself ────────────────────────────

    #[test]
    fn a_malformed_scoped_entry_refuses_only_itself() {
        // FAIL-CLOSED, and BOUNDED. Two ways this rots, both bad: a malformed entry being
        // honoured, or a malformed entry taking the whole file down with it (which is
        // deny-all — a browser session's bad entry revoking the operator's phone).
        let good = live_scoped("browser-token", "web-session-abc");
        let mut entries = vec![
            serde_json::json!("not even an object"),
            serde_json::json!({}),
            serde_json::json!([1, 2, 3]),
            serde_json::Value::Null,
        ];
        // Each REQUIRED field, removed one at a time — every one of them refuses the entry.
        for missing in
            ["wire", "id", "identity", "tokenSha256", "scope", "surface", "issuedVia", "issuedAt", "expiresAt"]
        {
            let mut entry = live_scoped("mutant-token", "web-session-mutant");
            entry.as_object_mut().unwrap().remove(missing);
            entries.push(entry);
        }
        // …and each one BLANKED, which is not a value either.
        for blanked in ["wire", "id", "identity", "tokenSha256", "surface", "issuedVia"] {
            let mut entry = live_scoped("mutant-token", "web-session-mutant");
            entry[blanked] = serde_json::json!("   ");
            entries.push(entry);
        }
        // …plus the shapes that are present but wrong.
        entries.push(scoped_entry("mutant-token", "web-session-mutant", &[], NOW + 60_000));
        let mut wrong_wire = live_scoped("mutant-token", "web-session-mutant");
        wrong_wire["wire"] = serde_json::json!("device-credential.v1");
        entries.push(wrong_wire);
        let mut string_deadline = live_scoped("mutant-token", "web-session-mutant");
        string_deadline["expiresAt"] = serde_json::json!("2026-07-31T00:00:00Z");
        entries.push(string_deadline);
        let mut scope_not_an_array = live_scoped("mutant-token", "web-session-mutant");
        scope_not_an_array["scope"] = serde_json::json!("prompt:answer");
        entries.push(scope_not_an_array);
        let mut scope_of_numbers = live_scoped("mutant-token", "web-session-mutant");
        scope_of_numbers["scope"] = serde_json::json!([7]);
        entries.push(scope_of_numbers);

        let refused_count = entries.len();
        entries.push(good);
        let policy = parse_with_scoped(&[("laptop-token", "id-laptop")], &entries);

        assert_eq!(policy.refused_scoped_count(), refused_count, "every mutant refused");
        assert_eq!(policy.scoped_count(), 1, "and exactly the good one survived");
        assert_eq!(
            policy.verify("mutant-token", ANSWER, Some(NOW)),
            None,
            "no malformed entry authenticates anything"
        );
        assert_eq!(
            policy.verify("browser-token", ANSWER, Some(NOW)).map(|v| v.kind),
            Some(CredentialKind::Scoped),
            "the well-formed neighbour is untouched"
        );
        assert_eq!(
            policy.authenticate("laptop-token"),
            Some("id-laptop"),
            "and the DEVICE credentials in the same file are untouched — a bad browser entry \
             must never revoke the operator's phone"
        );
    }

    #[test]
    fn an_unknown_scope_string_refuses_that_credential_and_leaves_the_others() {
        // Fail-closed on vocabulary: authority this node cannot describe is authority it must
        // not grant. Refused whole rather than narrowed to the scopes it DOES understand —
        // narrowing would silently hand back a grant nobody asked to have narrowed, and hide
        // that the two halves disagree about what scopes exist.
        let policy = parse_with_scoped(
            &[],
            &[
                scoped_entry("invented-token", "web-session-x", &["effort:dispatch"], NOW + 60_000),
                scoped_entry(
                    "mixed-token",
                    "web-session-y",
                    &[SCOPE_ANSWER_PROMPTS, "plugins:load"],
                    NOW + 60_000,
                ),
                live_scoped("browser-token", "web-session-abc"),
            ],
        );
        assert_eq!(policy.refused_scoped_count(), 2);
        assert_eq!(policy.scoped_count(), 1);
        assert_eq!(policy.verify("invented-token", ANSWER, Some(NOW)), None);
        assert_eq!(
            policy.verify("mixed-token", ANSWER, Some(NOW)),
            None,
            "an entry that ALSO names an unknown scope is refused whole, never narrowed to \
             the known half"
        );
        assert!(policy.verify("browser-token", ANSWER, Some(NOW)).is_some());
    }

    #[test]
    fn a_scoped_credentials_key_that_is_not_an_array_never_disables_the_gate() {
        // The key itself malformed. Fail-closed on the SCOPED set (nothing under an unusable
        // key is honoured) without touching the devices — deny-all here would mean a
        // hand-edit of a browser-session key locks the operator out of their own runtime.
        for shape in [
            serde_json::json!({ "web": "token" }),
            serde_json::json!("scoped"),
            serde_json::json!(7),
            serde_json::json!(true),
        ] {
            let raw = serde_json::json!({
                "credentials": [{
                    "identity": "id-laptop",
                    "tokenSha256": sha256_hex("laptop-token"),
                }],
                "scopedCredentials": shape,
            })
            .to_string();
            let policy = parse_policy(&raw).expect("the DOCUMENT is still valid JSON");
            assert_eq!(policy.scoped_count(), 0, "nothing under an unusable key is honoured");
            assert_eq!(policy.refused_scoped_count(), 1, "and the refusal is visible");
            assert_eq!(
                policy.authenticate("laptop-token"),
                Some("id-laptop"),
                "the device credentials in the same file must survive"
            );
        }
    }

    #[test]
    fn the_operators_real_policy_shape_parses_exactly_as_it_always_has() {
        // PIN of the file that is actually on this node: `{"credentials":[{"identity",
        // "tokenSha256"}]}` — device credentials only, and NO `scopedCredentials` key at all.
        // The shape that must not acquire a new requirement, a new default, or a new refusal.
        // Byte-for-byte the file's structure (`refarm auth enroll`'s two-space-indented
        // output), with the operator's own digest replaced by one this test can also present
        // a raw token for.
        let raw = format!(
            "{{\n  \"credentials\": [\n    {{\n      \"identity\": \"id-operator-phone\",\n      \
             \"tokenSha256\": \"{}\"\n    }}\n  ]\n}}\n",
            sha256_hex("operator-phone-token")
        );
        let policy = parse_policy(&raw).expect("the operator's shape must parse");
        assert_eq!(policy.identity_count(), 1);
        assert_eq!(policy.scoped_count(), 0, "no key ⇒ no scoped credentials");
        assert_eq!(
            policy.refused_scoped_count(),
            0,
            "an ABSENT key is absence, never a malformation — a policy written before scoped \
             credentials existed must not start reporting a refusal"
        );
        assert_eq!(policy.authenticate("operator-phone-token"), Some("id-operator-phone"));
        // And it is a FULL device credential on every route, unscoped and clock-free.
        for required in [DEVICE_ONLY, ANSWER] {
            assert_eq!(
                policy.verify("operator-phone-token", required, Some(NOW)).map(|v| v.kind),
                Some(CredentialKind::Device),
                "the operator's enrolled phone satisfies {required:?}, exactly as before"
            );
        }
        assert!(
            policy.verify("operator-phone-token", DEVICE_ONLY, None).is_some(),
            "and it never consults the clock"
        );
    }

    // ── hot reload covers scoped credentials too ─────────────────────────────────

    /// The one resolution over a temp refarm dir, with both arrays already written.
    fn resolved_gate_with_scoped(
        enrolled: &[(&str, &str)],
        scoped: &[serde_json::Value],
    ) -> (tempfile::TempDir, PathBuf, AuthGate) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(AUTH_POLICY_FILE_NAME);
        std::fs::write(&path, policy_bytes_with_scoped(enrolled, scoped)).unwrap();
        let gate = ResolvedAuthPolicy::resolve(&source_for(dir.path(), true))
            .gate()
            .expect("a declared gate ⇒ a bound gate");
        (dir, path, gate)
    }

    #[test]
    fn a_scoped_credential_issued_into_the_file_is_accepted_without_a_restart() {
        // `refarm auth verify` writes this file while the daemon is running — the browser is
        // sitting on the confirmation screen. If the gate only read scoped credentials at
        // boot, the operator would compare seven emoji and then be told to restart their
        // runtime before the session they just approved could do anything.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let (_dir, path, gate) = resolved_gate_with_scoped(&[("laptop-token", "id-laptop")], &[]);
        assert_eq!(gate.verify_at("browser-token", ANSWER, NOW), None, "not issued yet");

        std::fs::write(
            &path,
            policy_bytes_with_scoped(
                &[("laptop-token", "id-laptop")],
                &[live_scoped("browser-token", "web-session-abc")],
            ),
        )
        .unwrap();
        assert!(gate.reload_if_changed(), "the file changed ⇒ the policy is re-read");

        assert_eq!(
            gate.verify_at("browser-token", ANSWER, NOW).map(|v| v.kind),
            Some(CredentialKind::Scoped),
            "the newly issued browser session must be admitted by the RUNNING daemon"
        );
        assert_eq!(
            gate.verify_at("browser-token", DEVICE_ONLY, NOW),
            None,
            "…and admitted for its scope ONLY, reload or no reload"
        );
        assert_eq!(
            gate.authenticate("laptop-token").as_deref(),
            Some("id-laptop"),
            "without disturbing the device that was already enrolled"
        );
    }

    #[test]
    fn a_scoped_credential_revoked_from_the_file_stops_being_accepted_without_a_restart() {
        // MUTATION GUARD, and the direction that matters. A browser session the operator has
        // just revoked (`refarm auth revoke <id>`) must stop working NOW. A reload that only
        // ever ADDS scoped credentials — merging into the set in force rather than REPLACING
        // it — passes the issue test above and silently fails here forever.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let (_dir, path, gate) = resolved_gate_with_scoped(
            &[("laptop-token", "id-laptop")],
            &[live_scoped("browser-token", "web-session-abc"), live_scoped("kiosk-token", "web-session-kiosk")],
        );
        assert!(gate.verify_at("browser-token", ANSWER, NOW).is_some());

        std::fs::write(
            &path,
            policy_bytes_with_scoped(
                &[("laptop-token", "id-laptop")],
                &[live_scoped("kiosk-token", "web-session-kiosk")],
            ),
        )
        .unwrap();
        assert!(gate.reload_if_changed());

        assert_eq!(
            gate.verify_at("browser-token", ANSWER, NOW),
            None,
            "a REVOKED scoped credential must stop authenticating in the running daemon"
        );
        assert!(
            gate.verify_at("kiosk-token", ANSWER, NOW).is_some(),
            "revoking one session must not evict the others"
        );
        assert_eq!(gate.authenticate("laptop-token").as_deref(), Some("id-laptop"));
    }

    #[tokio::test]
    async fn the_watcher_applies_a_scoped_issue_and_revoke_on_its_own() {
        // The reload tests above drive `reload_if_changed` by hand; this is the thing that
        // CALLS it in a running daemon — the same real loop the device credentials get, at a
        // 5ms period. Without it, every assertion above holds and the operator still has to
        // restart, because nothing ever looks at the file.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(AUTH_POLICY_FILE_NAME);
        std::fs::write(&path, policy_bytes_with_scoped(&[("laptop-token", "id-laptop")], &[]))
            .unwrap();

        let resolved = ResolvedAuthPolicy::resolve(&source_for(dir.path(), true));
        let gate = resolved.gate().expect("gated");
        resolved.spawn_reload_watcher_every(Duration::from_millis(5));

        async fn until_scoped(gate: &AuthGate, token: &str, expected: bool) -> bool {
            for _ in 0..200 {
                if gate.verify_at(token, ANSWER, NOW).is_some() == expected {
                    return true;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            false
        }

        std::fs::write(
            &path,
            policy_bytes_with_scoped(
                &[("laptop-token", "id-laptop")],
                &[live_scoped("browser-token", "web-session-abc")],
            ),
        )
        .unwrap();
        assert!(
            until_scoped(&gate, "browser-token", true).await,
            "the watcher must apply the ISSUE with no restart and no prompting"
        );

        std::fs::write(&path, policy_bytes_with_scoped(&[("laptop-token", "id-laptop")], &[]))
            .unwrap();
        assert!(
            until_scoped(&gate, "browser-token", false).await,
            "and the REVOKE, which is the one that must not wait for a restart"
        );
        assert_eq!(
            gate.authenticate("laptop-token").as_deref(),
            Some("id-laptop"),
            "without evicting the device that was never revoked"
        );
    }

    #[test]
    fn a_broken_policy_file_denies_scoped_credentials_too() {
        // The module's fail-closed doctrine, extended to the new set: a policy that cannot be
        // believed locks the door for browser sessions exactly as it does for devices. Not
        // last-known-good, and certainly not "no constraints".
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let (_dir, path, gate) = resolved_gate_with_scoped(
            &[("laptop-token", "id-laptop")],
            &[live_scoped("browser-token", "web-session-abc")],
        );
        assert!(gate.verify_at("browser-token", ANSWER, NOW).is_some());

        std::fs::write(&path, "{ not json").unwrap();
        assert!(gate.reload_if_changed());
        assert_eq!(gate.verify_at("browser-token", ANSWER, NOW), None, "deny-all");
        assert_eq!(gate.authenticate("laptop-token"), None, "for both sets alike");
    }

    #[test]
    fn parse_policy_reads_credentials_and_ignores_slice2_fields() {
        let raw = r#"{
            "credentials": [{ "identity": "id-arthur", "tokenSha256": "ABC123" }],
            "workspaces": [{ "id": "personal-arthur", "kind": "personal", "namespace": "personal-arthur" }],
            "memberships": [{ "identity": "id-arthur", "workspaces": ["personal-arthur"] }]
        }"#;
        let policy = parse_policy(raw).expect("valid policy");
        // hash is normalized to lowercase; the extra Slice-2 fields are ignored, not an error
        assert_eq!(policy.authenticate_by_hash("abc123"), Some("id-arthur"));
    }

    impl AuthPolicy {
        /// Test helper: look up by an already-hashed value (bypasses sha256 of a raw token).
        fn authenticate_by_hash(&self, hash: &str) -> Option<&str> {
            self.credentials
                .iter()
                .find(|c| c.token_sha256 == hash)
                .map(|c| c.identity.as_str())
        }
    }

    // ══════════════════════════════════════════════════════════════════════════════════
    // THE FAILURE LIMITER
    // ══════════════════════════════════════════════════════════════════════════════════
    //
    // The limiter's decision is a pure function of (state, tag, Instant), so every property
    // below is asserted at NAMED instants — no sleeping, no wall clock, and no flake.

    /// An instant `secs` after a fixed origin. `Instant` cannot be constructed from an epoch,
    /// so the origin is "now" and every test instant is an offset from it.
    fn at(origin: Instant, secs: u64) -> Instant {
        origin + Duration::from_secs(secs)
    }

    #[test]
    fn the_limits_themselves_are_the_policy_and_are_pinned_to_their_values() {
        // Every other test here is written in terms of these constants, which makes them all
        // pass when a constant CHANGES — the mechanism still works, at whatever number it was
        // given. That is exactly how a bound silently stops being one: raise the threshold to
        // 5000 and every behavioural test still passes while the limit protects nothing.
        // (Verified by mutation: without this test, FAILURE_THRESHOLD = 50 passed the whole
        // suite.)
        //
        // So the values are pinned here, literally. These four numbers ARE the policy this
        // node enforces; changing one is an operator-visible decision about how much guessing
        // is tolerated and how much memory a stranger may occupy, and it should have to be
        // made deliberately, in a diff that says so, rather than tuned in passing.
        assert_eq!(FAILURE_THRESHOLD, 5, "failures allowed per credential before it is refused");
        assert_eq!(FAILURE_WINDOW, Duration::from_secs(60), "how long a lockout lasts");
        assert_eq!(FAILURE_TABLE_CAPACITY, 256, "THE memory bound — buckets held at once");
        assert_eq!(OVERFLOW_THRESHOLD, 64, "failures against untracked credentials before 429");
    }

    #[test]
    fn the_fifth_failure_is_the_one_that_trips_the_limit() {
        // The threshold's CONSEQUENCE, in literal numbers rather than in terms of the constant
        // — so that raising the constant breaks this test rather than relocating it, and so
        // that an off-by-one in the comparison is caught on the attempt it changes.
        let mut limiter = FailureLimiter::default();
        let origin = Instant::now();
        let tag = credential_tag("a-wrong-token");

        for attempt in 1..=4 {
            assert_eq!(
                limiter.on_failure(Budget::Authentication, tag, at(origin, 0)),
                Refusal::Invalid,
                "attempt {attempt} of 5 must be an ordinary 401 refusal"
            );
        }
        assert_eq!(
            limiter.on_failure(Budget::Authentication, tag, at(origin, 0)),
            Refusal::RateLimited { retry_after: Duration::from_secs(60) },
            "the FIFTH failure trips the limit, and the wait is 60 seconds"
        );
        assert_eq!(
            limiter.blocked(Budget::Authentication, tag, at(origin, 0)),
            Some(Duration::from_secs(60)),
            "and from that moment the credential is refused before the policy is consulted"
        );
    }

    #[test]
    fn a_credential_is_refused_outright_once_it_has_failed_the_threshold() {
        let mut limiter = FailureLimiter::default();
        let origin = Instant::now();
        let tag = credential_tag("a-wrong-token");

        // Below the threshold: refused `401`, and NOT blocked — the gate keeps looking.
        for attempt in 1..FAILURE_THRESHOLD {
            assert_eq!(
                limiter.on_failure(Budget::Authentication, tag, at(origin, 0)),
                Refusal::Invalid,
                "attempt {attempt} is below the threshold and must be an ordinary refusal"
            );
            assert_eq!(
                limiter.blocked(Budget::Authentication, tag, at(origin, 0)),
                None,
                "attempt {attempt} must not have locked the credential out yet"
            );
        }

        // THE threshold attempt trips it.
        assert_eq!(
            limiter.on_failure(Budget::Authentication, tag, at(origin, 0)),
            Refusal::RateLimited { retry_after: FAILURE_WINDOW },
            "the {FAILURE_THRESHOLD}th failure must trip the limit"
        );
        assert_eq!(
            limiter.blocked(Budget::Authentication, tag, at(origin, 0)),
            Some(FAILURE_WINDOW),
            "and the credential must now be refused BEFORE the policy is consulted"
        );
    }

    #[test]
    fn the_lockout_releases_itself_after_the_window_and_nothing_has_to_run() {
        let mut limiter = FailureLimiter::default();
        let origin = Instant::now();
        let tag = credential_tag("a-wrong-token");
        for _ in 0..FAILURE_THRESHOLD {
            limiter.on_failure(Budget::Authentication, tag, at(origin, 0));
        }

        // One second before the window closes: still shut, and the remaining time is stated.
        let remaining = limiter
            .blocked(Budget::Authentication, tag, at(origin, FAILURE_WINDOW.as_secs() - 1))
            .expect("still locked out one second before the window closes");
        assert_eq!(remaining, Duration::from_secs(1), "the wait must be counted down honestly");

        // At the window: open, with nothing scheduled and nothing swept.
        assert_eq!(
            limiter.blocked(Budget::Authentication, tag, at(origin, FAILURE_WINDOW.as_secs())),
            None,
            "the lockout must expire on its own — waiting is the whole recovery path"
        );
        assert_eq!(
            limiter.tracked(),
            0,
            "and the expired bucket must be released, not merely ignored"
        );
    }

    #[test]
    fn hammering_a_locked_out_credential_does_not_extend_the_lockout() {
        // The operator's recovery guarantee: waiting WORKS, unconditionally. If attempts made
        // during a lockout refreshed the bucket, a client retrying in a loop — which is what
        // clients do — would hold its own door shut forever, and "wait 60s" would be a lie.
        let mut limiter = FailureLimiter::default();
        let origin = Instant::now();
        let tag = credential_tag("a-wrong-token");
        for _ in 0..FAILURE_THRESHOLD {
            limiter.on_failure(Budget::Authentication, tag, at(origin, 0));
        }
        // Hammer all the way through the window. `blocked` short-circuits, so `on_failure` is
        // never reached — exactly as the middleware arranges it.
        for second in 0..FAILURE_WINDOW.as_secs() {
            assert!(limiter.blocked(Budget::Authentication, tag, at(origin, second)).is_some(), "shut at second {second}");
        }
        assert_eq!(
            limiter.blocked(Budget::Authentication, tag, at(origin, FAILURE_WINDOW.as_secs())),
            None,
            "the window must close on schedule regardless of how hard it was hammered"
        );
    }

    #[test]
    fn a_successful_authentication_clears_that_credentials_failures() {
        // A client with a stale token in its config fails four times, is fixed, and succeeds.
        // It must not carry those four failures into the next window.
        let mut limiter = FailureLimiter::default();
        let origin = Instant::now();
        let tag = credential_tag("the-real-token");
        for _ in 0..FAILURE_THRESHOLD - 1 {
            assert_eq!(limiter.on_failure(Budget::Authentication, tag, at(origin, 0)), Refusal::Invalid);
        }
        limiter.on_success(tag);
        assert_eq!(limiter.tracked(), 0, "success must forget the bucket entirely");

        // The next failure starts from one, so the threshold is a fresh five away.
        assert_eq!(
            limiter.on_failure(Budget::Authentication, tag, at(origin, 1)),
            Refusal::Invalid,
            "the count must restart at one, not resume at five"
        );
    }

    #[test]
    fn one_credentials_failures_never_touch_another_credentials_budget() {
        // THE property the key was chosen for. A third party grinding cannot spend the
        // operator's budget, because a budget is spent only by presenting the credential that
        // owns it — and presenting it is authenticating.
        let mut limiter = FailureLimiter::default();
        let origin = Instant::now();
        let attacker = credential_tag("attacker-guess");
        let operator = credential_tag("the-operators-real-token");

        for _ in 0..FAILURE_THRESHOLD * 4 {
            limiter.on_failure(Budget::Authentication, attacker, at(origin, 0));
        }
        assert!(limiter.blocked(Budget::Authentication, attacker, at(origin, 0)).is_some(), "the grinder is shut out");
        assert_eq!(
            limiter.blocked(Budget::Authentication, operator, at(origin, 0)),
            None,
            "and the operator's own credential is entirely unaffected by it"
        );
    }

    #[test]
    fn the_limiters_memory_is_bounded_under_a_flood_of_distinct_credentials() {
        // The requirement stated as an assertion: an attacker must not be able to grow this
        // structure without bound. Ten times the capacity in distinct tokens, and the table
        // stops at the capacity — the rest lands in the ONE shared overflow bucket.
        let mut limiter = FailureLimiter::default();
        let origin = Instant::now();
        for n in 0..FAILURE_TABLE_CAPACITY * 10 {
            limiter.on_failure(Budget::Authentication, credential_tag(&format!("flood-token-{n}")), at(origin, 0));
            assert!(
                limiter.tracked() <= FAILURE_TABLE_CAPACITY,
                "the table exceeded its capacity at attempt {n} — the bound is not a bound"
            );
        }
        assert_eq!(
            limiter.tracked(),
            FAILURE_TABLE_CAPACITY,
            "and it should be full: the flood is what fills it"
        );
    }

    #[test]
    fn a_flood_cannot_evict_a_live_lockout() {
        // Eviction under pressure would be an escape hatch: trip your own lockout, flood the
        // table until your bucket is evicted, resume guessing. Only STALE buckets are
        // reclaimed, so a live lockout survives a table-filling flood.
        let mut limiter = FailureLimiter::default();
        let origin = Instant::now();
        let locked = credential_tag("the-locked-out-credential");
        for _ in 0..FAILURE_THRESHOLD {
            limiter.on_failure(Budget::Authentication, locked, at(origin, 0));
        }
        assert!(limiter.blocked(Budget::Authentication, locked, at(origin, 1)).is_some(), "locked out to begin with");

        for n in 0..FAILURE_TABLE_CAPACITY * 4 {
            limiter.on_failure(Budget::Authentication, credential_tag(&format!("evictor-{n}")), at(origin, 1));
        }
        assert!(
            limiter.blocked(Budget::Authentication, locked, at(origin, 1)).is_some(),
            "a flood must not buy an attacker their way out of their own lockout"
        );
    }

    #[test]
    fn stale_buckets_are_reclaimed_so_a_full_table_is_not_permanent() {
        // The other half of the bound: without reclamation the table would fill once and stay
        // full forever, and every later credential would be judged by the shared counter.
        let mut limiter = FailureLimiter::default();
        let origin = Instant::now();
        for n in 0..FAILURE_TABLE_CAPACITY {
            limiter.on_failure(Budget::Authentication, credential_tag(&format!("old-{n}")), at(origin, 0));
        }
        assert_eq!(limiter.tracked(), FAILURE_TABLE_CAPACITY, "full");

        // A failure a full window later: the stale entries go, and this one is tracked.
        limiter.on_failure(Budget::Authentication, credential_tag("fresh"), at(origin, FAILURE_WINDOW.as_secs() + 1));
        assert_eq!(limiter.tracked(), 1, "stale buckets must be reclaimed, not accumulated");
    }

    #[test]
    fn the_shared_overflow_counter_only_ever_shapes_a_refusal_never_an_admission() {
        // The overflow tier is consulted ONLY after verification has already failed (see
        // `auth_middleware`). Here we pin its own behaviour: it escalates a refusal to `429`
        // once a flood is unmistakable, and it is reached only when the table is full.
        let mut limiter = FailureLimiter::default();
        let origin = Instant::now();
        for n in 0..FAILURE_TABLE_CAPACITY {
            limiter.on_failure(Budget::Authentication, credential_tag(&format!("filler-{n}")), at(origin, 0));
        }
        let mut escalated = false;
        for n in 0..OVERFLOW_THRESHOLD {
            let refusal = limiter.on_failure(Budget::Authentication, credential_tag(&format!("overflow-{n}")), at(origin, 0));
            if refusal == (Refusal::RateLimited { retry_after: FAILURE_WINDOW }) {
                escalated = true;
            }
        }
        assert!(escalated, "a flood past the overflow threshold must be told to slow down");
        assert_eq!(
            limiter.tracked(),
            FAILURE_TABLE_CAPACITY,
            "and it must have cost the limiter no additional memory at all"
        );
    }

    // ══════════════════════════════════════════════════════════════════════════════════
    // THE AUDIT LINE
    // ══════════════════════════════════════════════════════════════════════════════════

    /// Every rendering of the audit line, for the tests that must hold across ALL of them.
    /// Covers the WHOLE vocabulary — including a rate limit engaging on each budget — so the
    /// credential-material rule and the shape rule are asserted over every event the gate can
    /// emit, not over the three it used to have.
    fn every_audit_line(token: &str) -> Vec<String> {
        let _ = token;
        vec![
            audit_line(
                1_753_900_000_000,
                SecurityEvent::Accepted,
                Some("id-arthur"),
                Some(CredentialKind::Device),
                RouteRequirement::DeviceOnly,
                "GET",
            ),
            audit_line(
                1_753_900_000_001,
                SecurityEvent::Accepted,
                Some("id-browser"),
                Some(CredentialKind::Scoped),
                RouteRequirement::Scoped(Scope::AnswerPrompts),
                "POST",
            ),
            audit_line(
                1_753_900_000_002,
                SecurityEvent::AuthenticationFailed,
                None,
                None,
                RouteRequirement::DeviceOnly,
                "GET",
            ),
            audit_line(
                1_753_900_000_003,
                SecurityEvent::AuthorizationRefused,
                Some("id-browser"),
                Some(CredentialKind::Scoped),
                RouteRequirement::DeviceOnly,
                "GET",
            ),
            audit_line(
                1_753_900_000_004,
                SecurityEvent::CredentialExpired,
                Some("id-browser"),
                Some(CredentialKind::Scoped),
                RouteRequirement::Scoped(Scope::AnswerPrompts),
                "POST",
            ),
            audit_line(
                1_753_900_000_005,
                SecurityEvent::RateLimitEngaged(Budget::Authentication),
                None,
                None,
                RouteRequirement::Scoped(Scope::AnswerPrompts),
                "GET",
            ),
            audit_line(
                1_753_900_000_006,
                SecurityEvent::RateLimitEngaged(Budget::Authorization),
                Some("id-browser"),
                Some(CredentialKind::Scoped),
                RouteRequirement::DeviceOnly,
                "GET",
            ),
        ]
    }

    #[test]
    fn an_accepted_line_names_who_when_what_kind_and_which_scope() {
        let line = audit_line(
            1_753_900_000_000,
            SecurityEvent::Accepted,
            Some("id-arthur"),
            Some(CredentialKind::Device),
            RouteRequirement::Scoped(Scope::AnswerPrompts),
            "GET",
        );
        let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid JSON");
        assert_eq!(parsed["event"], "auth:accepted");
        assert_eq!(parsed["outcome"], "accepted");
        assert_eq!(parsed["identity"], "id-arthur");
        assert_eq!(parsed["credential"], "device");
        assert_eq!(parsed["scope"], SCOPE_ANSWER_PROMPTS);
        assert_eq!(parsed["ts"], 1_753_900_000_000_i64);
        assert_eq!(parsed["method"], "GET");
    }

    #[test]
    fn a_failed_attempt_is_recorded_as_fully_as_a_successful_one() {
        // "A failed attempt is as interesting as a successful one — arguably more." Both
        // outcomes must produce a line, with the same keys, so a trail can be read as one
        // sequence rather than two.
        let refused = audit_line(
            1_753_900_000_000,
            SecurityEvent::AuthenticationFailed,
            None,
            None,
            RouteRequirement::DeviceOnly,
            "POST",
        );
        let parsed: serde_json::Value = serde_json::from_str(&refused).expect("valid JSON");
        assert_eq!(parsed["event"], "auth:authentication-failed");
        assert_eq!(parsed["outcome"], "authentication-failed");
        // A failed AUTHENTICATION has no identity — the gate never learned one, and a CLAIMED
        // one is not a thing this module can be handed. (An authorization refusal DOES name
        // one, because there the credential verified; see the vocabulary test below.)
        assert_eq!(parsed["identity"], AUDIT_ABSENT);
        assert_eq!(parsed["credential"], AUDIT_ABSENT);

        let locked = audit_line(
            1_753_900_000_001,
            SecurityEvent::RateLimitEngaged(Budget::Authentication),
            None,
            None,
            RouteRequirement::DeviceOnly,
            "POST",
        );
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&locked).unwrap()["event"],
            "auth:rate-limit-engaged",
            "the attempt that trips the limit is its own, distinguishable event"
        );
    }

    #[test]
    fn every_audit_line_has_the_same_keys_whatever_the_outcome() {
        let expected =
            ["ts", "event", "outcome", "budget", "identity", "credential", "scope", "method"];
        for line in every_audit_line("any-token") {
            let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid JSON");
            let object = parsed.as_object().expect("an object");
            assert_eq!(
                object.len(),
                expected.len(),
                "line has an unexpected number of fields: {line}"
            );
            for key in expected {
                assert!(object.contains_key(key), "line is missing {key:?}: {line}");
            }
        }
    }

    #[test]
    fn no_audit_line_can_contain_credential_material() {
        // THE rule, and it is asserted as a property of the function rather than of a file:
        // `audit_line` is not given the token, its digest, or the limiter's tag, so no
        // rendering of it can contain any of them. The assertion is over every outcome.
        let token = "arthur-device-1-secret";
        let digest = sha256_hex(token);
        let tag = credential_tag(token).to_string();
        for line in every_audit_line(token) {
            assert!(!line.contains(token), "the raw token appears in an audit line: {line}");
            assert!(!line.contains(&digest), "the token's sha256 appears: {line}");
            assert!(
                !line.contains(&tag),
                "the limiter's tag for the token appears: {line}"
            );
            // A truncated hash is still credential material. Nothing that looks like a hex
            // digest of any length beyond a plausible identity may appear.
            assert!(
                !line.contains(&digest[..8]),
                "even a truncated digest is credential material: {line}"
            );
            assert!(
                !contains_hex_run(&line, 16),
                "an audit line contains a long hex run, which is what a hash looks like: {line}"
            );
        }
    }

    /// Does `text` contain an unbroken run of at least `len` hex digits? The shape of a hash,
    /// caught regardless of what anyone decides to call the field it lands in.
    fn contains_hex_run(text: &str, len: usize) -> bool {
        let mut run = 0usize;
        for ch in text.chars() {
            if ch.is_ascii_hexdigit() {
                run += 1;
                if run >= len {
                    return true;
                }
            } else {
                run = 0;
            }
        }
        false
    }

    #[test]
    fn the_limiter_tag_is_not_a_prefix_of_the_stored_credential_hash() {
        // Domain separation, asserted. Both are digests of the same token; if the tag were a
        // prefix of the stored `tokenSha256`, rendering the tag anywhere would leak a partial
        // match for the hash the policy file stores.
        for token in ["arthur-device-1", "another", ""] {
            let stored = sha256_hex(token);
            let tag = format!("{:016x}", credential_tag(token));
            assert!(
                !stored.starts_with(&tag),
                "the limiter tag is a prefix of the stored hash for {token:?}"
            );
        }
    }

    #[test]
    fn the_audit_trail_is_the_one_the_rest_of_the_runtime_already_writes() {
        // Reuse, pinned: the auth trail must be the SAME file the host-effect trail uses, in
        // the refarm dir, so it inherits that file's rotation and retention rather than
        // needing its own. A second security log is the thing this must not become.
        let audit = AuthAudit::for_refarm_dir(std::path::Path::new("/tmp/some-refarm-dir"));
        assert_eq!(
            audit.path,
            std::path::Path::new("/tmp/some-refarm-dir").join(crate::observer::AUDIT_FILE)
        );
    }

    #[test]
    fn the_audit_is_bounded_by_the_rotation_it_inherits() {
        // Bounded growth is inherited, not reimplemented — and it must actually be finite.
        let audit = AuthAudit::for_refarm_dir(std::path::Path::new("/tmp/some-refarm-dir"));
        assert!(audit.config.rotate_bytes > 0, "a zero rotation size is no rotation");
        assert!(audit.config.max_segments > 0, "keeping zero segments would delete the trail");
        // The ceiling is a real number of bytes, not "eventually someone notices".
        let ceiling = audit.config.rotate_bytes * (audit.config.max_segments as u64 + 1);
        assert!(
            ceiling <= 1024 * 1024 * 1024,
            "the audit's worst case must be a bounded, defensible amount of disk"
        );
    }

    // ══════════════════════════════════════════════════════════════════════════════════
    // THE OPERATOR'S REAL POLICY SHAPE
    // ══════════════════════════════════════════════════════════════════════════════════

    #[test]
    fn the_operators_real_policy_shape_still_parses_unchanged() {
        // A FIXTURE of the shape the operator's own `.refarm/auth-policy.json` has: device
        // credentials only, no `scopedCredentials` key at all. Nothing in this slice touches
        // the parser, and this is what pins that: the same bytes, the same credentials, no
        // scoped entries and none refused.
        //
        // The hashes here are of the literal strings named beside them — fixture values, never
        // the operator's.
        let raw = r#"{
  "credentials": [
    { "identity": "id-workstation", "tokenSha256": "PLACEHOLDER_A" },
    { "identity": "id-phone", "tokenSha256": "PLACEHOLDER_B" }
  ]
}"#
        .replace("PLACEHOLDER_A", &sha256_hex("fixture-workstation-token"))
        .replace("PLACEHOLDER_B", &sha256_hex("fixture-phone-token"));

        let policy = parse_policy(&raw).expect("the operator's policy shape must still parse");
        assert_eq!(policy.identity_count(), 2, "both device credentials must survive");
        assert_eq!(
            policy.scoped_count(),
            0,
            "a policy with no scopedCredentials key has no scoped credentials"
        );
        assert_eq!(
            policy.refused_scoped_count(),
            0,
            "and an ABSENT key must refuse nothing — absence is not a malformed entry"
        );
        assert_eq!(
            policy.authenticate("fixture-workstation-token"),
            Some("id-workstation"),
            "a device credential must still authenticate exactly as before"
        );
        assert_eq!(
            policy.verify("fixture-phone-token", RouteRequirement::DeviceOnly, Some(0)),
            Some(Verified {
                identity: "id-phone".to_string(),
                kind: CredentialKind::Device
            }),
            "and must still satisfy a device-only route"
        );
    }

    // ══════════════════════════════════════════════════════════════════════════════════
    // THE SEPARATION: AUTHENTICATION FAILED vs AUTHORIZATION REFUSED vs EXPIRED
    // ══════════════════════════════════════════════════════════════════════════════════
    //
    // These pin the fact that the gate now KNOWS which of the three happened, that the three
    // spend the budgets they should, and — the property that makes the separation safe —
    // that a caller cannot tell any of it from the wire.

    /// A policy with one device credential and one live `prompt:answer` browser session.
    fn policy_device_and_browser() -> AuthPolicy {
        parse_with_scoped(
            &[("laptop-token", "id-laptop")],
            &[live_scoped("browser-token", "id-browser")],
        )
    }

    #[test]
    fn the_gate_tells_a_guess_from_a_scope_bug_from_an_expiry() {
        let policy = parse_with_scoped(
            &[("laptop-token", "id-laptop")],
            &[
                live_scoped("browser-token", "id-browser"),
                scoped_entry("stale-token", "id-stale", &[Scope::AnswerPrompts.wire()], NOW - 1),
            ],
        );

        // A token nothing recognises. The one fact that is evidence of guessing.
        assert_eq!(
            policy.decide("invented-token", ANSWER, Some(NOW)),
            Decision::AuthenticationFailed,
            "a token matching nothing is a failed AUTHENTICATION and nothing else"
        );

        // A real credential on a route it has no authority for. THE case this change exists
        // for: before it, this was indistinguishable from the line above.
        assert_eq!(
            policy.decide("browser-token", DEVICE_ONLY, Some(NOW)),
            Decision::AuthorizationRefused { identity: "id-browser".to_string() },
            "a credential this node issued, asked for authority it does not hold, is a \
             refused AUTHORIZATION — not a guess"
        );

        // A real credential whose deadline passed.
        assert_eq!(
            policy.decide("stale-token", ANSWER, Some(NOW)),
            Decision::CredentialExpired { identity: "id-stale".to_string() },
            "an expired credential is its own fact, with its own remedy"
        );

        // And the ordinary successes, unchanged.
        assert_eq!(
            policy.decide("browser-token", ANSWER, Some(NOW)),
            Decision::Verified(Verified {
                identity: "id-browser".to_string(),
                kind: CredentialKind::Scoped
            })
        );
        assert_eq!(
            policy.decide("laptop-token", DEVICE_ONLY, Some(NOW)),
            Decision::Verified(Verified {
                identity: "id-laptop".to_string(),
                kind: CredentialKind::Device
            })
        );
    }

    #[test]
    fn a_credential_that_holds_the_wrong_scope_is_refused_authorization_not_authentication() {
        // A scoped credential carrying a scope that is not the one the route declares. The
        // parser cannot produce this today (there is one scope), so it is built through
        // `from_parts` — which is also the mutation guard for a `scope.contains(..)` that got
        // optimised into `true`.
        let policy = AuthPolicy::from_parts(
            vec![],
            vec![ScopedCredential {
                token_sha256: sha256_hex("empty-scope-token"),
                identity: "id-empty".to_string(),
                scope: vec![],
                expires_at_ms: NOW + 60_000,
            }],
        );
        assert_eq!(
            policy.decide("empty-scope-token", ANSWER, Some(NOW)),
            Decision::AuthorizationRefused { identity: "id-empty".to_string() },
            "holding no scope is a scope problem, not an identity problem"
        );
    }

    #[test]
    fn an_unreadable_clock_is_an_expiry_and_not_a_guess() {
        // The clock rule is unchanged (`None` refuses every scoped credential); what changes is
        // that refusing for want of a clock no longer looks like somebody guessing tokens.
        let policy = policy_device_and_browser();
        assert_eq!(
            policy.decide("browser-token", ANSWER, None),
            Decision::CredentialExpired { identity: "id-browser".to_string() },
            "a clock that cannot be read cannot assert a deadline has NOT passed"
        );
        assert_eq!(
            policy.decide("laptop-token", ANSWER, None),
            Decision::Verified(Verified {
                identity: "id-laptop".to_string(),
                kind: CredentialKind::Device
            }),
            "and a device credential is untouched by any of it"
        );
    }

    /// THE regression proof. `verify` is the old question; `decide` is the new one. Asked over
    /// every credential this module can hold and both route requirements, they must agree
    /// exactly — otherwise the finer answer has quietly widened or narrowed the door.
    #[test]
    fn the_finer_answer_admits_exactly_what_the_coarse_one_always_did() {
        let policy = parse_with_scoped(
            &[("laptop-token", "id-laptop")],
            &[
                live_scoped("browser-token", "id-browser"),
                scoped_entry("stale-token", "id-stale", &[Scope::AnswerPrompts.wire()], NOW - 1),
            ],
        );
        let mut admitted = 0;
        let mut refused = 0;
        for token in ["laptop-token", "browser-token", "stale-token", "invented-token", ""] {
            for required in [ANSWER, DEVICE_ONLY] {
                for clock in [Some(NOW), Some(NOW - 120_000), None] {
                    let coarse = policy.verify(token, required, clock);
                    let fine = policy.decide(token, required, clock);
                    assert_eq!(
                        coarse.is_some(),
                        matches!(fine, Decision::Verified(_)),
                        "{token:?} on {required:?} at {clock:?}: the two answers disagree \
                         about whether the request is admitted"
                    );
                    if let Some(verified) = coarse {
                        admitted += 1;
                        assert_eq!(
                            Decision::Verified(verified),
                            fine,
                            "and when both admit, they must admit the same identity and kind"
                        );
                    } else {
                        refused += 1;
                    }
                }
            }
        }
        // Pinned literally so a policy that stopped admitting anything (or admitted
        // everything) could not pass this test by making both answers uniformly wrong.
        assert_eq!(admitted, 9, "the matrix must contain exactly these admissions");
        assert_eq!(refused, 21, "and exactly these refusals");
    }

    #[test]
    fn each_fact_spends_the_budget_it_should() {
        let policy = policy_device_and_browser();
        assert_eq!(
            policy.decide("invented-token", ANSWER, Some(NOW)).budget(),
            Some(Budget::Authentication),
            "guessing spends the guessing budget — that is what it is for"
        );
        assert_eq!(
            policy.decide("browser-token", DEVICE_ONLY, Some(NOW)).budget(),
            Some(Budget::Authorization),
            "THE POINT: a valid credential on the wrong route must NOT spend the budget that \
             exists to stop credential guessing"
        );
        assert_eq!(
            policy.decide("browser-token", ANSWER, None).budget(),
            Some(Budget::Authorization),
            "nor may an expiry"
        );
        assert_eq!(
            policy.decide("laptop-token", DEVICE_ONLY, Some(NOW)).budget(),
            None,
            "and a success spends nothing at all"
        );
    }

    #[test]
    fn each_fact_names_its_own_event_and_the_right_identity() {
        let policy = policy_device_and_browser();
        assert_eq!(
            policy.decide("invented-token", ANSWER, Some(NOW)).refusal_event(),
            Some(SecurityEvent::AuthenticationFailed)
        );
        assert_eq!(
            policy.decide("browser-token", DEVICE_ONLY, Some(NOW)).refusal_event(),
            Some(SecurityEvent::AuthorizationRefused)
        );
        assert_eq!(
            policy.decide("browser-token", ANSWER, None).refusal_event(),
            Some(SecurityEvent::CredentialExpired)
        );
        assert_eq!(policy.decide("laptop-token", ANSWER, Some(NOW)).refusal_event(), None);

        // A failed authentication resolves NOBODY — there is no identity to carry, which is
        // also why it can never name a victim. A recognised refusal does, because the gate
        // genuinely knows whose credential it just declined.
        assert_eq!(policy.decide("invented-token", ANSWER, Some(NOW)).identity(), None);
        assert_eq!(
            policy.decide("browser-token", DEVICE_ONLY, Some(NOW)).identity(),
            Some("id-browser")
        );
        assert_eq!(
            policy.decide("browser-token", DEVICE_ONLY, Some(NOW)).kind(),
            Some(CredentialKind::Scoped),
            "only a scoped credential can reach a recognised refusal"
        );
    }

    // ── the two budgets, in the limiter ───────────────────────────────────────────────

    #[test]
    fn the_two_budgets_do_not_share_a_counter() {
        // Spend the authorization budget to exhaustion against one credential; the guessing
        // budget for that same credential must be untouched, and the credential must not be
        // blocked at the position the guessing budget is read from.
        let mut limiter = FailureLimiter::default();
        let origin = Instant::now();
        let tag = credential_tag("a-real-scoped-token");
        for _ in 0..FAILURE_THRESHOLD * 2 {
            limiter.on_failure(Budget::Authorization, tag, at(origin, 0));
        }
        assert_eq!(
            limiter.tracked_in(Budget::Authentication),
            0,
            "THE separation: scope refusals must leave the guessing table empty"
        );
        assert_eq!(limiter.tracked_in(Budget::Authorization), 1);
        assert_eq!(
            limiter.blocked(Budget::Authentication, tag, at(origin, 0)),
            None,
            "and the credential must be free to walk through the pre-verification check that \
             the guessing budget guards — which is what stops a scope bug locking an app out \
             of the routes it IS entitled to"
        );
        assert!(
            limiter.blocked(Budget::Authorization, tag, at(origin, 0)).is_some(),
            "while still being bounded on the refusals themselves"
        );
    }

    #[test]
    fn the_budgets_are_indistinguishable_from_outside() {
        // The no-oracle rule as it applies to the LIMITER rather than to the response bytes.
        // If the two budgets tripped after different numbers of attempts, or counted down from
        // different windows, the COUNT would be the oracle: a caller could tell "this
        // credential is real" from how long it took to be rate-limited.
        let origin = Instant::now();
        let mut refusals: Vec<Vec<Refusal>> = Vec::new();
        for budget in Budget::ALL {
            let mut limiter = FailureLimiter::default();
            let tag = credential_tag("the-same-token-either-way");
            refusals.push(
                (0..FAILURE_THRESHOLD + 2)
                    .map(|n| limiter.on_failure(budget, tag, at(origin, u64::from(n) / 1000)))
                    .collect(),
            );
        }
        assert_eq!(
            refusals[0], refusals[1],
            "the two budgets must refuse on the same attempt, with the same retry-after — a \
             difference here is a credential-validity oracle measured with a stopwatch"
        );
        // And pinned literally, so "identical" cannot be satisfied by both being wrong.
        assert_eq!(
            refusals[0],
            vec![
                Refusal::Invalid,
                Refusal::Invalid,
                Refusal::Invalid,
                Refusal::Invalid,
                Refusal::RateLimited { retry_after: FAILURE_WINDOW },
                Refusal::RateLimited { retry_after: FAILURE_WINDOW },
                Refusal::RateLimited { retry_after: FAILURE_WINDOW },
            ]
        );
    }

    #[test]
    fn a_success_clears_the_guessing_count_and_not_the_refusal_count() {
        // A success proves the caller was not guessing, so the guessing count goes. It proves
        // nothing about whether they keep asking for authority they do not have — and clearing
        // that would let a caller alternate one good request with one refused one and generate
        // refusals for ever, which is the unbounded trail the second budget exists to prevent.
        let mut limiter = FailureLimiter::default();
        let origin = Instant::now();
        let tag = credential_tag("mixed-behaviour-token");
        limiter.on_failure(Budget::Authentication, tag, at(origin, 0));
        limiter.on_failure(Budget::Authorization, tag, at(origin, 0));
        limiter.on_success(tag);
        assert_eq!(limiter.tracked_in(Budget::Authentication), 0);
        assert_eq!(
            limiter.tracked_in(Budget::Authorization),
            1,
            "a success on an entitled route says nothing about the unentitled ones"
        );
    }

    // ── the vocabulary, as the audit renders it ───────────────────────────────────────

    #[test]
    fn every_fact_renders_its_own_event_name_and_names_the_budget_it_moved() {
        let rendered: Vec<(String, String, String)> = every_audit_line("any-token")
            .iter()
            .map(|line| {
                let parsed: serde_json::Value = serde_json::from_str(line).unwrap();
                (
                    parsed["event"].as_str().unwrap().to_string(),
                    parsed["budget"].as_str().unwrap().to_string(),
                    parsed["identity"].as_str().unwrap().to_string(),
                )
            })
            .collect();
        assert_eq!(
            rendered,
            vec![
                ("auth:accepted".into(), "-".into(), "id-arthur".into()),
                ("auth:accepted".into(), "-".into(), "id-browser".into()),
                ("auth:authentication-failed".into(), "authentication".into(), "-".into()),
                ("auth:authorization-refused".into(), "authorization".into(), "id-browser".into()),
                ("auth:credential-expired".into(), "authorization".into(), "id-browser".into()),
                ("auth:rate-limit-engaged".into(), "authentication".into(), "-".into()),
                ("auth:rate-limit-engaged".into(), "authorization".into(), "id-browser".into()),
            ],
            "each fact must be its own event, and a rate limit must say WHICH bound engaged — \
             `authentication` means this node is being ground, `authorization` means one \
             caller is asking for the wrong thing, and no status code distinguishes them"
        );
    }

    /// The vocabulary is a contract with a SECOND RUNTIME, and this is what keeps the two
    /// halves honest: one file of wire lines, asserted by the Rust that writes them and by the
    /// TypeScript that parses them (`packages/event-contract-v1/src/security.test.ts`). A name
    /// or a field changed on one side alone fails on both.
    #[test]
    fn the_wire_lines_are_exactly_what_the_shared_fixture_pins() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../event-contract-v1/security-events.fixture.ndjson");
        let raw = std::fs::read_to_string(&path).unwrap_or_else(|error| {
            panic!(
                "the shared wire fixture must exist — it is the only thing keeping the Rust \
                 vocabulary and the TypeScript one in step ({}): {error}",
                path.display()
            )
        });
        let expected: Vec<&str> = raw.lines().filter(|line| !line.trim().is_empty()).collect();
        let rendered = every_audit_line("any-token");
        assert_eq!(
            rendered.len(),
            expected.len(),
            "the fixture must carry one line per rendering, no more and no fewer"
        );
        for (n, (got, want)) in rendered.iter().zip(expected).enumerate() {
            assert_eq!(got, want, "fixture line {} has drifted from what the gate writes", n + 1);
        }
    }
}
