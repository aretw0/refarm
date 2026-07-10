//! Reversible context fold — the guest-side mirror of the TS contract
//! `@refarm.dev/session-contract-v1` (`context-folding.ts`).
//!
//! `compact_history` folds old turns into a summary but the turns themselves stay
//! in the CRDT — what was missing is a RECORD of the fold (which entries were folded,
//! with a digest) so a later `unfoldSessionContextFold` (TS) can reconstruct them and
//! verify integrity. This module emits exactly that record, `SessionContextFold`, from
//! the guest.
//!
//! FIDELITY IS THE WHOLE POINT: the digest here must match the TS contract byte-for-byte
//! (a TS `unfold` verifying a Rust-emitted digest must agree), so it mirrors the TS
//! `stableHash`/`stableStringify` precisely — including the two gotchas a byte-wise Rust
//! hash would get wrong:
//!   1. the hash iterates UTF-16 code units (`charCodeAt`), NOT UTF-8 bytes — matters for
//!      any non-ASCII content (pt-BR turns!).
//!   2. object digests go through `stableStringify` (sorted keys, `undefined`→`"null"`,
//!      JSON-escaped strings), not `serde_json`'s default ordering.
//! A conformance test pins this against shared fixtures so it cannot silently drift.

pub(crate) const SESSION_CONTEXT_FOLD_SCHEMA: &str = "refarm.session-context-fold.v1";
pub(crate) const SESSION_CONTEXT_FOLD_DIGEST_ALGORITHM: &str = "refarm-stable-fnv1a64-v1";

/// FNV-1a 64-bit over UTF-16 code units — the mirror of the TS `stableHash` loop
/// (`hash ^= text.charCodeAt(i)`). Returns the lowercase, zero-padded 16-hex digest.
///
/// NOTE: this is deliberately NOT `crate::fnv1a_hash` (which folds over UTF-8 bytes).
/// The two agree only for ASCII; for anything else they diverge, and the contract is
/// defined over `charCodeAt`.
pub(crate) fn stable_hash_str(text: &str) -> String {
    const BASIS: u64 = 0xcbf29ce484222325;
    const PRIME: u64 = 0x100000001b3;
    let mut hash = BASIS;
    for code_unit in text.encode_utf16() {
        hash ^= code_unit as u64;
        hash = hash.wrapping_mul(PRIME);
    }
    format!("{hash:016x}")
}

/// Mirror of TS `JSON.stringify(s)` for a string: wrap in quotes and escape the JSON
/// control set exactly as ECMA-404 / V8 do. (serde_json escapes the same set, but we
/// keep an explicit, contract-pinned version so the mirror is self-evidently faithful.)
fn json_escape_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Mirror of the TS `stableStringify`: deterministic, sorted-key JSON with
/// `undefined`→`"null"`. Operates on `serde_json::Value` (the object/array/scalar the
/// fold digest is taken over). Keys are sorted the same way TS `localeCompare` sorts
/// the ASCII field names used here (plain code-point order for `[a-z_]`).
pub(crate) fn stable_stringify(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "null".to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::String(s) => json_escape_string(s),
        serde_json::Value::Array(items) => {
            let inner: Vec<String> = items.iter().map(stable_stringify).collect();
            format!("[{}]", inner.join(","))
        }
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let inner: Vec<String> = keys
                .into_iter()
                .map(|k| format!("{}:{}", json_escape_string(k), stable_stringify(&map[k])))
                .collect();
            format!("{{{}}}", inner.join(","))
        }
    }
}

/// The digest over an object value: `stableHash(stableStringify(value))`.
pub(crate) fn stable_hash_value(value: &serde_json::Value) -> String {
    stable_hash_str(&stable_stringify(value))
}

/// One folded entry's reference (id + parentage + kind + time + content digest) — the
/// mirror of TS `SessionContextFoldEntryRef`. `entry` is a stored SessionEntry JSON.
fn entry_ref(entry: &serde_json::Value) -> Option<serde_json::Value> {
    let content = entry.get("content")?.as_str()?;
    Some(serde_json::json!({
        "entry_id": entry.get("@id")?.as_str()?,
        "parent_entry_id": entry.get("parent_entry_id").cloned().unwrap_or(serde_json::Value::Null),
        "kind": entry.get("kind")?.as_str()?,
        "timestamp_ns": entry.get("timestamp_ns")?.as_u64()?,
        "content_digest": {
            "algorithm": SESSION_CONTEXT_FOLD_DIGEST_ALGORITHM,
            "value": stable_hash_str(content),
        },
    }))
}

/// Build a `SessionContextFold` record from the entries being folded and the ids kept
/// in the protected tail. Mirrors TS `planSessionContextFold`'s fold-object shape (the
/// digest is over `{schema, session_id, folded_entry_refs, protected_tail_entry_ids}`,
/// stable-stringified) so a TS `unfold` verifies it. `summary` is the human digest that
/// went into the prompt; `created_at_ns` is passed in (no clock in this pure builder).
///
/// Returns `None` if there is nothing to fold (no folded entries or a session mismatch).
pub(crate) fn build_session_context_fold(
    folded_entries: &[serde_json::Value],
    protected_tail_entry_ids: &[String],
    summary: Option<&str>,
    created_at_ns: u64,
) -> Option<serde_json::Value> {
    if folded_entries.is_empty() {
        return None;
    }
    let session_id = folded_entries[0].get("session_id")?.as_str()?.to_string();
    // Single-session invariant, matching TS `assertSingleSession`.
    for e in folded_entries {
        if e.get("session_id").and_then(|v| v.as_str()) != Some(session_id.as_str()) {
            return None;
        }
    }

    let refs: Vec<serde_json::Value> = folded_entries.iter().filter_map(entry_ref).collect();
    if refs.len() != folded_entries.len() {
        return None; // a malformed entry — refuse to emit a partial fold
    }

    let tail_ids: Vec<serde_json::Value> = protected_tail_entry_ids
        .iter()
        .map(|s| serde_json::Value::String(s.clone()))
        .collect();

    let digest_input = serde_json::json!({
        "schema": SESSION_CONTEXT_FOLD_SCHEMA,
        "session_id": session_id,
        "folded_entry_refs": refs,
        "protected_tail_entry_ids": tail_ids,
    });
    let digest_value = stable_hash_value(&digest_input);
    let session_hash = stable_hash_str(&session_id);
    let fold_id =
        format!("urn:refarm:session-context-fold:v1:{session_hash}:{digest_value}");

    let first = &folded_entries[0];
    let last = &folded_entries[folded_entries.len() - 1];

    Some(serde_json::json!({
        "@type": "SessionContextFold",
        "@id": fold_id,
        "schema": SESSION_CONTEXT_FOLD_SCHEMA,
        "session_id": session_id,
        "range": {
            "from_entry_id": first.get("@id").and_then(|v| v.as_str()).unwrap_or(""),
            "to_entry_id": last.get("@id").and_then(|v| v.as_str()).unwrap_or(""),
            "entry_count": folded_entries.len(),
        },
        "digest": {
            "algorithm": SESSION_CONTEXT_FOLD_DIGEST_ALGORITHM,
            "value": digest_value,
        },
        "folded_entry_refs": refs,
        "protected_tail_entry_ids": tail_ids,
        "summary": summary,
        "created_at_ns": created_at_ns,
    }))
}
