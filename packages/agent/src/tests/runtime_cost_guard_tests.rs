use super::*;

#[test]
fn react_blocks_prompt_over_context_limit() {
    std::env::set_var("MODEL_MAX_CONTEXT_TOKENS", "1");
    let (content, _, tokens_in, _, _, _, _, model, _) = react("este prompt tem muitos tokens");
    assert!(
        content.contains("MODEL_MAX_CONTEXT_TOKENS"),
        "deve mencionar o guard: {content}"
    );
    assert_eq!(tokens_in, 0);
    assert_eq!(model, "blocked");
    std::env::remove_var("MODEL_MAX_CONTEXT_TOKENS");
}

#[test]
fn estimate_usd_sonnet_no_cache() {
    // 1000 in (uncached) @ $3/1M + 500 out @ $15/1M = $0.003 + $0.0075 = $0.0105
    let cost = estimate_usd("anthropic", "claude-sonnet-4-6", 1000, 500, 0, 0);
    let expected = (1000.0 / 1_000_000.0) * 3.0 + (500.0 / 1_000_000.0) * 15.0;
    assert!((cost - expected).abs() < 1e-10);
}

#[test]
fn anthropic_uncached_input_is_not_swallowed_by_a_large_cache_read() {
    // Anthropic's own documented example: 100k read, 0 written, 50 after the
    // breakpoint. The 50 are genuinely uncached and must be billed at full rate.
    // The old code did tokens_in.saturating_sub(cached) = 50 - 100_000 = 0 and
    // billed them at nothing.
    let cost = estimate_usd("anthropic", "claude-sonnet-4-6", 50, 0, 100_000, 0);
    let expected = (50.0 / 1_000_000.0) * 3.0 + (100_000.0 / 1_000_000.0) * 3.0 * 0.1;
    assert!(
        (cost - expected).abs() < 1e-12,
        "expected {expected}, got {cost}"
    );
}

#[test]
fn anthropic_cache_writes_cost_more_than_input_not_less() {
    // A cache write is billed at 1.25x base input on the 5-minute cache, not at
    // the 0.1x read discount. Same token count, opposite direction.
    let write_cost = estimate_usd("anthropic", "claude-sonnet-4-6", 0, 0, 0, 10_000);
    let read_cost = estimate_usd("anthropic", "claude-sonnet-4-6", 0, 0, 10_000, 0);
    assert!(
        write_cost > read_cost * 12.0,
        "a write must not be priced like a read: write={write_cost} read={read_cost}"
    );
    let expected = (10_000.0 / 1_000_000.0) * 3.0 * 1.25;
    assert!((write_cost - expected).abs() < 1e-12);
}

#[test]
fn openai_cached_tokens_remain_a_subset_of_prompt_tokens() {
    // Unchanged behaviour for the subset model: 1000 prompt tokens of which 200
    // were cache reads bills 800 at full rate.
    let cost = estimate_usd("openai", "gpt-5.5", 1_000, 500, 200, 0);
    let expected = (800.0 / 1_000_000.0) * 5.0
        + (200.0 / 1_000_000.0) * 5.0 * 0.1
        + (500.0 / 1_000_000.0) * 30.0;
    assert!((cost - expected).abs() < 1e-12, "expected {expected}, got {cost}");
}

#[test]
fn subscription_and_local_pricing_modes_stay_at_zero() {
    // openai-codex is a subscription; ollama is local. A currency figure over
    // either is meaningless, and D1 depends on this staying true.
    assert_eq!(
        estimate_billable_usd("openai-codex", "gpt-5.5", 10_000, 5_000, 1_000, 500),
        0.0
    );
    assert_eq!(
        estimate_billable_usd("ollama", "llama3", 10_000, 5_000, 0, 0),
        0.0
    );
}

#[test]
fn estimate_usd_openai_gpt_5_5() {
    // 1000 in @ $5/1M + 500 out @ $30/1M = $0.005 + $0.015 = $0.020
    let cost = estimate_usd("openai", "gpt-5.5", 1000, 500, 0, 0);
    let expected = (1000.0 / 1_000_000.0) * 5.0 + (500.0 / 1_000_000.0) * 30.0;
    assert!((cost - expected).abs() < 1e-10);
}

#[test]
fn estimate_usd_openai_worker_codex_uses_gpt_5_family_rate() {
    let cost = estimate_usd("openai", "gpt-5.3-codex-spark", 1000, 500, 100, 0);
    let expected = (900.0 / 1_000_000.0) * 1.25
        + (100.0 / 1_000_000.0) * 1.25 * 0.1
        + (500.0 / 1_000_000.0) * 10.0;
    assert!((cost - expected).abs() < 1e-10);
}

#[test]
fn estimate_billable_usd_subscription_providers_are_not_api_billed() {
    assert_eq!(pricing_mode_for_provider("openai-codex"), "subscription");
    assert_eq!(
        estimate_billable_usd("openai-codex", "gpt-5.5", 1000, 500, 0, 0),
        0.0
    );
    assert!(estimate_usd("openai", "gpt-5.5", 1000, 500, 0, 0) > 0.0);
}

#[test]
fn estimate_usd_ollama_is_zero() {
    assert_eq!(estimate_usd("ollama", "llama3.2", 10000, 5000, 0, 0), 0.0);
    assert_eq!(estimate_usd("ollama", "mistral", 1000, 1000, 0, 0), 0.0);
}
