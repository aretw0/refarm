//! THE security event vocabulary — the names this framework gives to the facts a gate
//! learns, so a plugin, an app or an extension can act on them.
//!
//! # Why a vocabulary, and why here
//!
//! The gate has always known four different things and has only ever been able to say two.
//! `auth:refused` meant "the credential does not verify" AND "the credential is fine, the
//! scope is wrong" AND "the credential was fine yesterday" — three facts under one word, with
//! three different remedies (revoke a device / fix a caller's route / re-issue a credential).
//! A consumer that wanted to tell them apart had one option: parse HTTP status codes, which
//! deliberately do not distinguish them, or read log prose, which is not a contract.
//!
//! These names ARE the contract. They are the discriminant — a consumer matches on
//! [`SecurityEvent::name`] and knows what happened without reading anything else.
//!
//! # Identical outward, distinguished inward
//!
//! The distinction lives HERE and in the limiter, and it never reaches the caller. Returning a
//! different status for "valid credential, wrong scope" would tell an attacker holding a
//! guessed token that the token EXISTS — a credential-validity oracle, handed out for free.
//! So `sidecar::auth` answers every refusal with the same bytes it answered yesterday
//! (`401 {"error":"unauthorized","reason":"invalid"}`), and writes the precise fact to the
//! operator's own audit trail instead. The rate limiter, the trail, and these events know the
//! difference; the wire does not.
//!
//! # One vocabulary, two runtimes
//!
//! These names are mirrored, string for string, in
//! `packages/event-contract-v1/src/security.ts` — the TypeScript side is where a plugin
//! subscribes, because `@refarm.dev/event-contract-v1` is this repository's event transport
//! and a transport with no vocabulary is what it was until now.
//!
//! The two lists are not kept in step by good intentions. `packages/event-contract-v1/security-events.fixture.ndjson`
//! holds one wire line per fact, and BOTH suites assert against it: the Rust side that
//! [`crate::sidecar::auth::audit_line`] renders exactly those bytes, the TypeScript side that
//! its parser types exactly those bytes. A name changed on one side and not the other fails
//! on both.
//!
//! Same doctrine as `AUTH_POLICY_FILE_NAME` and `SCOPE_ANSWER_PROMPTS`: one convention, named
//! once, pinned by a test that the writer and the reader both run.

/// The namespace every security event carries, beside `host-effect:` and `agent:` in the same
/// trail. A consumer routes the whole family on this prefix and needs no allow-list to do it.
pub const SECURITY_EVENT_PREFIX: &str = "auth:";

/// A credential verified and the route's authority was satisfied. The request proceeded.
pub const ACCEPTED: &str = "auth:accepted";

/// The credential does not verify — nothing in force matches the token presented. THE
/// credential-guessing signal, and the only fact that spends the guessing budget.
pub const AUTHENTICATION_FAILED: &str = "auth:authentication-failed";

/// The credential verifies and does not hold the authority this route requires. A caller
/// bug, not an attack: this node issued this credential and still honours it.
pub const AUTHORIZATION_REFUSED: &str = "auth:authorization-refused";

/// The credential verifies and its deadline has passed. Not a bug and not an attack — the
/// ordinary end of a scoped credential's life, and the one refusal whose remedy is "issue
/// another".
pub const CREDENTIAL_EXPIRED: &str = "auth:credential-expired";

/// A budget reached its bound. Carries WHICH budget, because the two mean opposite things:
/// the authentication budget engaging says this node is being ground; the authorization
/// budget engaging says a caller is asking for authority it does not have, loudly.
pub const RATE_LIMIT_ENGAGED: &str = "auth:rate-limit-engaged";

/// Every name in the vocabulary, in the order this module declares them. The list a
/// conformance test walks, and the list a consumer can enumerate rather than transcribe.
pub const SECURITY_EVENT_NAMES: [&str; 5] = [
    ACCEPTED,
    AUTHENTICATION_FAILED,
    AUTHORIZATION_REFUSED,
    CREDENTIAL_EXPIRED,
    RATE_LIMIT_ENGAGED,
];

/// WHICH bound a refusal spends. The separation this module exists for, as a type rather than
/// as a comment — the compiler now asks "which budget?" at every call site that spends one.
///
/// The two are not two names for one counter. They are consulted at different moments in the
/// request path, and that difference is the whole design:
///
/// | | [`Budget::Authentication`] | [`Budget::Authorization`] |
/// |---|---|---|
/// | keyed on | the presented credential | the presented credential |
/// | consulted | BEFORE verification | only AFTER a refusal is decided |
/// | can block a request that would have succeeded | yes — but only a credential that has itself failed | **never**, structurally |
/// | spent by | a token nothing recognises | a token this node recognises and will not honour here |
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Budget {
    /// Bounds GUESSING. Spent only by a token that matches nothing in force, so filling it
    /// requires not holding a credential — which is exactly the population it exists to slow.
    Authentication,
    /// Bounds the VOLUME of refusals against a credential this node recognises. Spent by a
    /// scope refusal and by an expiry, never by a guess.
    ///
    /// Consulted only once a refusal has already been decided, so it cannot deny service to a
    /// request that would have been served. That is the fix: a legitimate app with a scope bug
    /// keeps working on the routes it IS entitled to while it is being told, at a bounded
    /// rate, about the ones it is not.
    Authorization,
}

impl Budget {
    /// The wire string. Named, not `Debug`-derived: a `Debug` rendering is a formatting
    /// detail that changes when someone renames a variant, and this value is a contract.
    pub const fn wire(self) -> &'static str {
        match self {
            Budget::Authentication => "authentication",
            Budget::Authorization => "authorization",
        }
    }

    /// Both budgets, for the tests that must cover every one and for a consumer enumerating.
    pub const ALL: [Budget; 2] = [Budget::Authentication, Budget::Authorization];
}

/// One fact the gate learned. THE vocabulary, as a closed type: a fact that is not in this
/// enum cannot be emitted, and a consumer matching on it exhaustively cannot miss one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecurityEvent {
    /// [`ACCEPTED`].
    Accepted,
    /// [`AUTHENTICATION_FAILED`].
    AuthenticationFailed,
    /// [`AUTHORIZATION_REFUSED`].
    AuthorizationRefused,
    /// [`CREDENTIAL_EXPIRED`].
    CredentialExpired,
    /// [`RATE_LIMIT_ENGAGED`], naming the budget that engaged.
    RateLimitEngaged(Budget),
}

impl SecurityEvent {
    /// The wire name — namespaced, and the discriminant a consumer routes on.
    pub const fn name(self) -> &'static str {
        match self {
            SecurityEvent::Accepted => ACCEPTED,
            SecurityEvent::AuthenticationFailed => AUTHENTICATION_FAILED,
            SecurityEvent::AuthorizationRefused => AUTHORIZATION_REFUSED,
            SecurityEvent::CredentialExpired => CREDENTIAL_EXPIRED,
            SecurityEvent::RateLimitEngaged(_) => RATE_LIMIT_ENGAGED,
        }
    }

    /// The un-prefixed form, carried as its own field so a consumer that has already routed on
    /// the namespace does not have to strip it back off. Equal to [`Self::name`] minus
    /// [`SECURITY_EVENT_PREFIX`] for every variant — pinned, not assumed.
    pub const fn outcome(self) -> &'static str {
        match self {
            SecurityEvent::Accepted => "accepted",
            SecurityEvent::AuthenticationFailed => "authentication-failed",
            SecurityEvent::AuthorizationRefused => "authorization-refused",
            SecurityEvent::CredentialExpired => "credential-expired",
            SecurityEvent::RateLimitEngaged(_) => "rate-limit-engaged",
        }
    }

    /// Which budget this fact MOVED, if any.
    ///
    /// Derivable from the name for three of the five, and NOT derivable for
    /// [`Self::RateLimitEngaged`] — which is the whole reason it is carried as a field rather
    /// than left for a consumer to infer. A consumer that had to infer it would get the one
    /// case wrong that matters: telling "this node is being ground" from "one app is asking
    /// for the wrong thing".
    pub const fn budget(self) -> Option<Budget> {
        match self {
            // An acceptance CLEARS the authentication budget rather than spending it, and a
            // cleared budget is not a moved one — the accepted line is an attribution, not a
            // limiter event.
            SecurityEvent::Accepted => None,
            SecurityEvent::AuthenticationFailed => Some(Budget::Authentication),
            SecurityEvent::AuthorizationRefused | SecurityEvent::CredentialExpired => {
                Some(Budget::Authorization)
            }
            SecurityEvent::RateLimitEngaged(budget) => Some(budget),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The names are a CONTRACT with a second runtime, so they are pinned literally here
    /// rather than only through the enum — a rename that compiles is exactly the change this
    /// test exists to stop.
    #[test]
    fn the_vocabulary_is_pinned_to_its_literal_names() {
        assert_eq!(ACCEPTED, "auth:accepted");
        assert_eq!(AUTHENTICATION_FAILED, "auth:authentication-failed");
        assert_eq!(AUTHORIZATION_REFUSED, "auth:authorization-refused");
        assert_eq!(CREDENTIAL_EXPIRED, "auth:credential-expired");
        assert_eq!(RATE_LIMIT_ENGAGED, "auth:rate-limit-engaged");
        assert_eq!(SECURITY_EVENT_PREFIX, "auth:");
        assert_eq!(Budget::Authentication.wire(), "authentication");
        assert_eq!(Budget::Authorization.wire(), "authorization");
    }

    #[test]
    fn every_name_sits_in_the_one_namespace() {
        for name in SECURITY_EVENT_NAMES {
            assert!(
                name.starts_with(SECURITY_EVENT_PREFIX),
                "{name} is not in the {SECURITY_EVENT_PREFIX} namespace — a consumer routing \
                 the family on the prefix would never see it"
            );
        }
    }

    /// `event` and `outcome` are the same statement twice, and a line where they disagree is a
    /// line a consumer could route two ways.
    #[test]
    fn the_outcome_is_the_name_with_the_namespace_taken_off() {
        for event in [
            SecurityEvent::Accepted,
            SecurityEvent::AuthenticationFailed,
            SecurityEvent::AuthorizationRefused,
            SecurityEvent::CredentialExpired,
            SecurityEvent::RateLimitEngaged(Budget::Authentication),
            SecurityEvent::RateLimitEngaged(Budget::Authorization),
        ] {
            assert_eq!(
                event.name().strip_prefix(SECURITY_EVENT_PREFIX),
                Some(event.outcome()),
                "{:?} renders a name and an outcome that are not the same statement",
                event
            );
        }
    }

    #[test]
    fn every_declared_name_is_reachable_from_a_variant_and_no_two_share_one() {
        let mut rendered: Vec<&str> = vec![
            SecurityEvent::Accepted.name(),
            SecurityEvent::AuthenticationFailed.name(),
            SecurityEvent::AuthorizationRefused.name(),
            SecurityEvent::CredentialExpired.name(),
            SecurityEvent::RateLimitEngaged(Budget::Authentication).name(),
        ];
        rendered.sort_unstable();
        rendered.dedup();
        let mut declared = SECURITY_EVENT_NAMES.to_vec();
        declared.sort_unstable();
        assert_eq!(rendered, declared, "the enum and SECURITY_EVENT_NAMES have drifted apart");
    }

    /// The separation, asserted at the vocabulary level: a scope refusal and an expiry name
    /// the authorization budget, and ONLY a failed authentication names the guessing one.
    #[test]
    fn only_a_failed_authentication_names_the_guessing_budget() {
        assert_eq!(
            SecurityEvent::AuthenticationFailed.budget(),
            Some(Budget::Authentication),
            "the guessing budget must be the one a guess spends"
        );
        assert_eq!(SecurityEvent::AuthorizationRefused.budget(), Some(Budget::Authorization));
        assert_eq!(SecurityEvent::CredentialExpired.budget(), Some(Budget::Authorization));
        assert_eq!(SecurityEvent::Accepted.budget(), None);
        for budget in Budget::ALL {
            assert_eq!(SecurityEvent::RateLimitEngaged(budget).budget(), Some(budget));
        }
    }
}
