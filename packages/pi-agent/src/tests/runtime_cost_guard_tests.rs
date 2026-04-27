use super::*;

#[test]
fn react_blocks_prompt_over_context_limit() {
    std::env::set_var("LLM_MAX_CONTEXT_TOKENS", "1");
    let (content, _, tokens_in, _, _, _, model, _) = react("este prompt tem muitos tokens");
    assert!(
        content.contains("LLM_MAX_CONTEXT_TOKENS"),
        "deve mencionar o guard: {content}"
    );
    assert_eq!(tokens_in, 0);
    assert_eq!(model, "blocked");
    std::env::remove_var("LLM_MAX_CONTEXT_TOKENS");
}

#[test]
fn estimate_usd_sonnet_no_cache() {
    // 1000 in (uncached) @ $3/1M + 500 out @ $15/1M = $0.003 + $0.0075 = $0.0105
    let cost = estimate_usd("claude-sonnet-4-6", 1000, 500, 0);
    let expected = (1000.0 / 1_000_000.0) * 3.0 + (500.0 / 1_000_000.0) * 15.0;
    assert!((cost - expected).abs() < 1e-10);
}

#[test]
fn estimate_usd_sonnet_with_cache_discount() {
    // 800 uncached + 200 cached; cached at 10% rate
    let cost = estimate_usd("claude-sonnet-4-6", 1000, 500, 200);
    let expected = (800.0 / 1_000_000.0) * 3.0
        + (200.0 / 1_000_000.0) * 3.0 * 0.1
        + (500.0 / 1_000_000.0) * 15.0;
    assert!((cost - expected).abs() < 1e-10);
    assert!(cost < estimate_usd("claude-sonnet-4-6", 1000, 500, 0));
}

#[test]
fn estimate_usd_ollama_is_zero() {
    assert_eq!(estimate_usd("llama3.2", 10000, 5000, 0), 0.0);
    assert_eq!(estimate_usd("mistral", 1000, 1000, 0), 0.0);
}

