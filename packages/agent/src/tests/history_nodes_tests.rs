use super::*;

#[test]
fn history_from_nodes_sorts_by_timestamp_and_caps_turns() {
    let now = now_ns();
    let nodes = vec![
        serde_json::json!({"@type":"Response","content":"resp1","timestamp_ns":now+200})
            .to_string(),
        serde_json::json!({"@type":"UserPrompt",   "content":"q2",   "timestamp_ns":now+100})
            .to_string(),
        serde_json::json!({"@type":"UserPrompt",   "content":"q1",   "timestamp_ns":now+10 })
            .to_string(),
    ];
    let h = history_from_nodes(&nodes, 10);
    assert_eq!(h.len(), 3);
    assert_eq!(h[0], ("user".into(), "q1".into()));
    assert_eq!(h[1], ("user".into(), "q2".into()));
    assert_eq!(h[2], ("assistant".into(), "resp1".into()));
}

#[test]
fn history_from_nodes_caps_at_max_turns() {
    let now = now_ns();
    let nodes: Vec<String> = (0..8u64)
        .map(|i| {
            serde_json::json!({"@type":"UserPrompt","content":format!("q{i}"),"timestamp_ns":now+i})
                .to_string()
        })
        .collect();
    let h = history_from_nodes(&nodes, 3);
    assert_eq!(h.len(), 3);
    assert_eq!(h[2].1, "q7"); // most recent
}

#[test]
fn history_from_nodes_skips_unknown_types() {
    let now = now_ns();
    let nodes = vec![
        serde_json::json!({"@type":"UsageRecord","content":"ignored","timestamp_ns":now})
            .to_string(),
        serde_json::json!({"@type":"UserPrompt", "content":"ok",     "timestamp_ns":now+1})
            .to_string(),
    ];
    let h = history_from_nodes(&nodes, 10);
    assert_eq!(h.len(), 1);
    assert_eq!(h[0].1, "ok");
}

#[test]
fn history_from_nodes_returns_empty_for_empty_input() {
    let h = history_from_nodes(&[], 10);
    assert!(h.is_empty());
}

#[test]
fn history_disabled_by_default_when_env_unset() {
    // MODEL_HISTORY_TURNS defaults to 0 — no history injected without opt-in.
    // history_from_nodes with max_turns=0 must return empty regardless of records.
    let now = now_ns();
    let nodes = vec![
        serde_json::json!({"@type":"UserPrompt","content":"q","timestamp_ns":now}).to_string(),
    ];
    let h = history_from_nodes(&nodes, 0);
    assert!(h.is_empty(), "max_turns=0 must produce empty history");
}

// ── compact_history (ADR-058 on_overflow) ────────────────────────────────────

/// A pair whose content is `n` chars, so token math (chars/4) is predictable.
fn pair(role: &str, chars: usize) -> (String, String) {
    (role.to_string(), "x".repeat(chars))
}

#[test]
fn compact_history_is_noop_under_budget() {
    let pairs = vec![pair("user", 40), pair("assistant", 40)];
    // ~10+10 tokens + overhead, well under 1000.
    let out = compact_history(pairs.clone(), 1000);
    assert_eq!(out, pairs, "fits under budget → unchanged");
}

#[test]
fn compact_history_disabled_when_budget_zero() {
    let pairs = vec![pair("user", 10_000), pair("assistant", 10_000)];
    let out = compact_history(pairs.clone(), 0);
    assert_eq!(out, pairs, "budget 0 = disabled → unchanged even if huge");
}

#[test]
fn compact_history_folds_old_prefix_and_keeps_recent_tail() {
    // Six turns, each ~100 tokens (400 chars). Total ~600 tokens; budget 300 forces a fold.
    let pairs = vec![
        ("user".into(), "GOAL build the thing ".to_string() + &"a".repeat(380)),
        ("assistant".into(), "b".repeat(400)),
        ("user".into(), "c".repeat(400)),
        ("assistant".into(), "d".repeat(400)),
        ("user".into(), "NEXT ship it ".to_string() + &"e".repeat(387)),
        ("assistant".into(), "f".repeat(400)),
    ];
    let out = compact_history(pairs, 300);

    // First element is the summary block, not an original turn.
    assert_eq!(out[0].0, "system");
    assert!(out[0].1.contains("compacted history"), "summary marker present");
    // The recent tail is preserved verbatim as the LAST element.
    assert_eq!(out.last().unwrap().0, "assistant");
    assert!(out.last().unwrap().1.starts_with("ffff"), "newest turn kept verbatim");
    // Fewer messages than the original six (older ones folded into one).
    assert!(out.len() < 6, "folding reduced the message count");
}

#[test]
fn compact_history_summary_has_goal_progress_next_steps() {
    let pairs = vec![
        ("user".into(), "GOAL_MARKER build a parser ".to_string() + &"a".repeat(400)),
        ("assistant".into(), "did step one ".to_string() + &"b".repeat(400)),
        ("user".into(), "NEXT_MARKER add tests ".to_string() + &"c".repeat(400)),
        ("assistant".into(), "z".repeat(400)),
        ("user".into(), "current turn".into()),
    ];
    let out = compact_history(pairs, 200);
    let summary = &out[0].1;
    assert!(summary.contains("Goal:"), "has Goal");
    assert!(summary.contains("Progress:"), "has Progress");
    assert!(summary.contains("Next Steps:"), "has Next Steps");
    assert!(summary.contains("GOAL_MARKER"), "Goal = first user turn");
    assert!(summary.contains("NEXT_MARKER"), "Next Steps = last folded user turn");
}

#[test]
fn compact_history_keeps_at_least_the_current_turn() {
    // One gigantic single turn that alone blows the budget: must not be dropped.
    let pairs = vec![("user".into(), "z".repeat(10_000))];
    let out = compact_history(pairs, 100);
    assert_eq!(out.len(), 1, "the only/current turn is always kept");
    assert_eq!(out[0].0, "user");
}

#[test]
fn compact_history_reduces_estimated_tokens_below_budget() {
    // Ten turns of ~100 tokens each = ~1000 tokens; a 400-token budget must bring the
    // compacted total at or under budget — this is the token WIN, measured, not just a
    // smaller message count.
    let mut pairs = Vec::new();
    for i in 0..10 {
        let role = if i % 2 == 0 { "user" } else { "assistant" };
        pairs.push((role.to_string(), format!("turn {i} ").to_string() + &"w".repeat(390)));
    }
    let before: usize = pairs
        .iter()
        .map(|(r, c)| (r.len() + c.len()) / 4 + 4)
        .sum();
    assert!(before > 400, "precondition: history exceeds budget ({before} tokens)");

    let out = compact_history(pairs, 400);
    let after: usize = out
        .iter()
        .map(|(r, c)| (r.len() + c.len()) / 4 + 4)
        .sum();

    assert!(after < before, "compaction cut tokens: {before} → {after}");
    assert!(after <= 400, "compacted total fits the budget ({after} ≤ 400)");
}
