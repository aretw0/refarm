// CONFORMANCE (the anti-drift sensor): the guest-side digest MUST match the TS
// contract `@refarm.dev/session-contract-v1` (`context-folding.ts`) byte-for-byte,
// or a TS `unfoldSessionContextFold` would report a false `digest_mismatch` on an
// intact entry. These vectors are the OUTPUT of the real TS `stableHash`/
// `stableStringify` (captured from node running the contract's own algorithm); if the
// Rust mirror drifts, they stop matching and this test fails.
//
// The `ação👍` vector is load-bearing: it has a pt-BR accent (BMP, `charCodeAt` == 1
// unit) AND an astral emoji (surrogate PAIR, `charCodeAt` == 2 units). This is exactly
// where a naive UTF-8-byte hash diverges from the contract's UTF-16 `charCodeAt`.

use crate::session::{
    build_session_context_fold, stable_hash_str, stable_hash_value, stable_stringify,
};

#[test]
fn stable_hash_str_matches_ts_contract_vectors() {
    // (input, expected TS stableHash) — captured from the TS contract algorithm.
    let vectors = [
        ("hello", "a430d84680aabd0b"),
        ("olá", "1a0f321921cfaf75"),   // pt-BR accent (UTF-16 ≠ UTF-8 bytes)
        ("ação👍", "92d4fd7c7b14970d"), // accent + astral emoji (surrogate pair)
        ("", "cbf29ce484222325"),      // empty = the FNV basis
    ];
    for (input, expected) in vectors {
        assert_eq!(
            stable_hash_str(input),
            expected,
            "stable_hash_str({input:?}) must match the TS contract digest"
        );
    }
}

#[test]
fn stable_stringify_matches_ts_deterministic_order() {
    // TS stableStringify sorts keys and escapes strings via JSON.stringify.
    let v = serde_json::json!({ "b": 1, "a": "x", "c": [3, 2] });
    assert_eq!(stable_stringify(&v), r#"{"a":"x","b":1,"c":[3,2]}"#);
}

#[test]
fn stable_hash_value_matches_ts_object_vectors() {
    // Object digests: stableHash(stableStringify(obj)) — the fold-digest path.
    let a = serde_json::json!({ "b": 1, "a": 2 });
    assert_eq!(stable_hash_value(&a), "f85f5878cbf2dc03");

    let nested = serde_json::json!({
        "schema": "x",
        "refs": [{ "id": "a", "n": 1 }],
        "tail": ["t1"],
    });
    assert_eq!(stable_hash_value(&nested), "c227e514b4bf9966");
}

#[test]
fn stable_hash_str_is_not_the_agent_byte_hash() {
    // Guardrail: `stable_hash_str` must NOT be `crate::fnv1a_hash`. They differ for TWO
    // reasons and this pins both so a "simplification" to the existing hash is caught:
    //   - encoding: stable_hash_str folds UTF-16 code units (charCodeAt), fnv1a_hash
    //     folds UTF-8 bytes — diverges on any non-ASCII (pt-BR);
    //   - operation order: the contract is canonical FNV-1a (XOR-then-multiply), while
    //     `crate::fnv1a_hash` is actually FNV-1 (multiply-then-XOR) despite its name —
    //     so they differ even on pure ASCII.
    // Only `stable_hash_str` matches the TS contract vectors above; the byte hash cannot.
    assert_ne!(
        stable_hash_str("hello"),
        format!("{:016x}", crate::fnv1a_hash("hello")),
        "differs even on ASCII (FNV-1a vs the agent's FNV-1)"
    );
    assert_ne!(
        stable_hash_str("olá"),
        format!("{:016x}", crate::fnv1a_hash("olá")),
        "differs on non-ASCII (UTF-16 charCodeAt vs UTF-8 bytes)"
    );
}

// ── build_session_context_fold ───────────────────────────────────────────────

fn entry(id: &str, parent: Option<&str>, kind: &str, content: &str, ts: u64) -> serde_json::Value {
    serde_json::json!({
        "@type": "SessionEntry",
        "@id": id,
        "session_id": "sess-1",
        "parent_entry_id": parent,
        "kind": kind,
        "content": content,
        "timestamp_ns": ts,
    })
}

#[test]
fn build_fold_emits_reversible_record_with_refs_and_digest() {
    let folded = vec![
        entry("e1", None, "user", "primeiro", 100),
        entry("e2", Some("e1"), "assistant", "resposta", 200),
    ];
    let tail = vec!["e3".to_string()];
    let fold = build_session_context_fold(&folded, &tail, Some("digest text"), 999).unwrap();

    assert_eq!(fold["@type"], "SessionContextFold");
    assert_eq!(fold["schema"], "refarm.session-context-fold.v1");
    assert_eq!(fold["session_id"], "sess-1");
    assert_eq!(fold["range"]["from_entry_id"], "e1");
    assert_eq!(fold["range"]["to_entry_id"], "e2");
    assert_eq!(fold["range"]["entry_count"], 2);
    // Each folded turn is REFERENCED (id + content digest) — the reversibility.
    assert_eq!(fold["folded_entry_refs"].as_array().unwrap().len(), 2);
    assert_eq!(fold["folded_entry_refs"][0]["entry_id"], "e1");
    assert_eq!(
        fold["folded_entry_refs"][0]["content_digest"]["value"],
        stable_hash_str("primeiro")
    );
    // The protected tail is recorded so unfold knows what stayed live.
    assert_eq!(fold["protected_tail_entry_ids"][0], "e3");
    assert_eq!(fold["digest"]["algorithm"], "refarm-stable-fnv1a64-v1");
    assert_eq!(fold["created_at_ns"], 999);
    // The @id is the URN the contract expects.
    assert!(fold["@id"].as_str().unwrap().starts_with("urn:refarm:session-context-fold:v1:"));
}

#[test]
fn build_fold_none_when_nothing_to_fold() {
    assert!(build_session_context_fold(&[], &[], None, 1).is_none());
}

#[test]
fn build_fold_none_on_session_mismatch() {
    let mixed = vec![
        entry("e1", None, "user", "a", 1),
        serde_json::json!({ "@id": "e2", "session_id": "OTHER", "kind": "user", "content": "b", "timestamp_ns": 2 }),
    ];
    assert!(build_session_context_fold(&mixed, &[], None, 1).is_none());
}

/// The Rust-emitted fold captured here is pinned as the fixture for the TS round-trip
/// test (`context-folding.roundtrip.test.ts`): that test feeds THIS exact fold to the
/// contract's `unfoldSessionContextFold` and asserts it reconstructs with zero digest
/// mismatches — proving the cross-language reversibility end to end, not just the
/// digest. This test regenerates it and asserts the pinned shape so the fixture can't
/// silently drift from what Rust actually emits.
#[test]
fn emitted_fold_matches_pinned_ts_roundtrip_fixture() {
    let folded = vec![
        entry("urn:e1", None, "user", "olá mundo", 100),
        entry("urn:e2", Some("urn:e1"), "agent", "resposta ação👍", 200),
    ];
    let tail = vec!["urn:e3".to_string()];
    let fold = build_session_context_fold(&folded, &tail, Some("digest"), 999).unwrap();
    // These two digests are what the TS fixture pins; if the Rust emit changes, both
    // this and the TS round-trip must be updated together (they share the fixture).
    assert_eq!(fold["digest"]["value"], "62dc47ffa6e7e9d6");
    assert_eq!(fold["folded_entry_refs"][1]["content_digest"]["value"], "9ccba8cadcf2e4b2");
}
