//! The sovereign guarantee, proven behaviorally.
//!
//! These run as a plain native cargo test (`cargo test --lib`) — they exercise
//! the logic without the WASM/WIT layer. The structural guarantee (no import can
//! exfiltrate the key) is enforced by the `identity-plugin` world; these tests
//! cover the behavior the code adds on top of it.

use super::*;

/// Sign then verify against the managed public key — the roundtrip works with
/// the key held module-local, `sign` never receiving key material.
#[test]
fn sign_then_verify_roundtrips() {
    KEY.with(|c| *c.borrow_mut() = None);
    let payload = b"a sovereign citizen's consent".to_vec();

    let sig = SovereignIdentity::sign(payload.clone()).expect("sign");
    let pubkey = SovereignIdentity::public_key().expect("public key");

    let ok = SovereignIdentity::verify(payload, sig, pubkey).expect("verify");
    assert!(ok, "signature must verify against the managed public key");
}

/// A signature does not verify under a different key — the check is real, not a
/// rubber stamp.
#[test]
fn signature_rejects_wrong_key() {
    KEY.with(|c| *c.borrow_mut() = Some(signing_key_from_seed(b"alice")));
    let payload = b"transfer".to_vec();
    let sig = SovereignIdentity::sign(payload.clone()).expect("sign");

    // Bob's public key, not the signer's.
    let bob_pub = signing_key_from_seed(b"bob").verifying_key().to_bytes().to_vec();
    let ok = SovereignIdentity::verify(payload, sig, bob_pub).expect("verify");
    assert!(!ok, "a signature must not verify under a foreign public key");
}

/// `derive-from-session` is deterministic: the same session key unlocks the same
/// identity (same public key, same handle) — the OPAQUE unlock path is stable.
#[test]
fn derive_from_session_is_deterministic() {
    let session = b"opaque-session-key-xyz".to_vec();

    let handle_a = SovereignIdentity::derive_from_session(session.clone()).expect("derive");
    let pub_a = SovereignIdentity::public_key().expect("pub");

    // Clobber, then derive again from the same session key.
    KEY.with(|c| *c.borrow_mut() = None);
    let handle_b = SovereignIdentity::derive_from_session(session).expect("derive");
    let pub_b = SovereignIdentity::public_key().expect("pub");

    assert_eq!(handle_a, handle_b, "handle must be stable for a session key");
    assert_eq!(pub_a, pub_b, "public key must be stable for a session key");
}

/// Distinct session keys unlock distinct identities — no collision.
#[test]
fn distinct_sessions_yield_distinct_identities() {
    let h1 = SovereignIdentity::derive_from_session(b"session-1".to_vec()).expect("derive");
    let p1 = SovereignIdentity::public_key().expect("pub");
    let h2 = SovereignIdentity::derive_from_session(b"session-2".to_vec()).expect("derive");
    let p2 = SovereignIdentity::public_key().expect("pub");

    assert_ne!(h1, h2, "different sessions must yield different handles");
    assert_ne!(p1, p2, "different sessions must yield different keys");
}

/// An empty session key is rejected — a caller cannot unlock a null identity.
#[test]
fn empty_session_key_is_rejected() {
    let err = SovereignIdentity::derive_from_session(vec![]);
    assert!(matches!(err, Err(PluginError::InvalidSchema(_))));
}

/// The public key is exactly 32 bytes (Ed25519) — the only key material that
/// crosses the boundary, and it is the PUBLIC half.
#[test]
fn public_key_is_32_bytes() {
    KEY.with(|c| *c.borrow_mut() = None);
    let pubkey = SovereignIdentity::public_key().expect("pub");
    assert_eq!(pubkey.len(), 32);
}

// ── identity:whoami dispatch (the SPI provider half of the host's get_identity) ──

/// `whoami` reports a sovereign identity whose identifier is the DID form of the
/// PUBLIC key — never the private half.
#[test]
fn whoami_reports_sovereign_identity_with_public_did() {
    KEY.with(|c| *c.borrow_mut() = Some(signing_key_from_seed(b"citizen")));
    let info = whoami();
    assert_eq!(info["identity_type"], "sovereign");
    assert_eq!(info["storage_tier"], "persistent");
    let id = info["identifier"].as_str().expect("identifier");
    assert!(id.starts_with("did:refarm-wasm:"));
    // The identifier carries the 64-hex public key, and matches public_key().
    let pub_hex = to_hex(&SovereignIdentity::public_key().expect("pub"));
    assert_eq!(id, format!("did:refarm-wasm:{pub_hex}"));
}

/// A dispatch payload parses into (verb, replyRef); a malformed one is ignored.
#[test]
fn parse_dispatch_reads_verb_and_reply_ref() {
    let parsed = parse_dispatch(r#"{"verb":"whoami","replyRef":"r-1"}"#);
    assert_eq!(parsed, Some(("whoami".to_string(), "r-1".to_string())));
    assert_eq!(parse_dispatch(r#"{"verb":"whoami"}"#), None); // no replyRef
    assert_eq!(parse_dispatch("not json"), None);
}

/// An unknown verb yields an `{error}` result — the caller's await gets a node, never hangs.
#[test]
fn unknown_verb_yields_error_result_not_silence() {
    let result = run_dispatched_verb("delete-everything");
    assert!(result.get("error").is_some());
    // whoami still routes to a real answer.
    assert_eq!(run_dispatched_verb("whoami")["identity_type"], "sovereign");
}

/// The dispatch result node carries the canonical shape the host reads back by replyRef.
#[test]
fn dispatch_result_node_has_canonical_shape() {
    let node = build_dispatch_result_node("r-42", whoami());
    assert_eq!(node["@type"], "DispatchResult");
    assert_eq!(node["replyRef"], "r-42");
    assert_eq!(node["result"]["identity_type"], "sovereign");
}
