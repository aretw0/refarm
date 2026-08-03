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

#[test]
fn a_run_that_starts_small_and_grows_is_stopped_at_the_ceiling() {
    // The old guard only measured the FIRST prompt. A run that begins under the
    // ceiling and then burns ten times it across tool loops was never stopped.
    assert!(cumulative_limit_error(9_999, Some(10_000)).is_none());
    let stopped = cumulative_limit_error(10_001, Some(10_000));
    assert!(stopped.is_some(), "cumulative spend past the ceiling must stop the run");
    let (content, _, _, _, _, _, _, model, _) = stopped.unwrap();
    assert!(content.contains("10000"), "the message must name the ceiling: {content}");
    assert_eq!(model, "blocked");
}

#[test]
fn no_ceiling_means_no_stop() {
    assert!(cumulative_limit_error(u32::MAX, None).is_none());
}

#[test]
fn a_currency_ceiling_never_binds_under_a_subscription() {
    // openai-codex bills a subscription; estimate_billable_usd returns 0.0 there
    // by design, so a USD ceiling would be theatre.
    assert!(spend_limit_error("openai-codex", 999.0, Some(0.01)).is_none());
    assert!(spend_limit_error("anthropic", 999.0, Some(0.01)).is_some());
}

#[test]
fn a_paid_provider_serving_an_open_weight_model_is_not_free() {
    // Groq and Together SELL Llama. Ollama serves it free, and never reaches
    // this table: estimate_billable_usd short-circuits on `local` pricing mode
    // before the lookup runs. A model id cannot tell you who is charging.
    assert!(matches!(rate_for_model("llama-3.3-70b-versatile"), RateLookup::Unknown));
    assert!(matches!(rate_for_model("mistral-medium-3-5"), RateLookup::Unknown));
    assert_eq!(
        estimate_billable_usd("ollama", "llama3.2", 10_000, 5_000, 0, 0),
        0.0,
        "local pricing mode still costs nothing, decided before the table"
    );
}

#[test]
fn an_unpriced_new_model_is_unknown_rather_than_free() {
    // The measured drift this task closes: the table's Claude branches stop at
    // the 4 family, so a Claude 5 id matched nothing and fell through to the
    // return value meaning "local model, genuinely free". It is now UNKNOWN —
    // still estimated at zero, but no longer indistinguishable from free, and
    // it says its own name in the log.
    assert!(matches!(rate_for_model("claude-opus-5"), RateLookup::Unknown));
    assert!(matches!(rate_for_model("claude-sonnet-5"), RateLookup::Unknown));
    // The 4 family still prices, so nothing in use today regressed.
    assert!(matches!(rate_for_model("claude-sonnet-4-6"), RateLookup::Priced { .. }));
}

#[test]
fn a_more_specific_model_id_wins_over_its_family_prefix() {
    // Substring matching is order-dependent: "gpt-5.5" must be tested before
    // the generic "gpt-5", or a point release lands on the wrong rate while
    // looking perfectly plausible.
    let RateLookup::Priced { rate_in: specific, .. } = rate_for_model("gpt-5.5") else {
        panic!("gpt-5.5 must be priced");
    };
    let RateLookup::Priced { rate_in: family, .. } = rate_for_model("gpt-5") else {
        panic!("gpt-5 must be priced");
    };
    assert_ne!(specific, family, "the point release must not inherit the family rate");
}

#[test]
fn the_rate_table_names_a_version() {
    assert!(!RATE_TABLE_VERSION.is_empty());
}

#[test]
fn a_haiku_generation_that_regrouped_at_a_new_price_does_not_inherit_the_old_one() {
    // Verified against Anthropic's official pricing page while assembling v1
    // of this table: Haiku 4.5 ($1/$5) and Haiku 3.5 ($0.80/$4, retired except
    // on Bedrock/Google Cloud) share the "claude-haiku" prefix but NOT a rate.
    // Before this test existed, the bare "claude-haiku" branch would have
    // caught 4.5 too and silently billed it at 3.5's lower, wrong rate — a
    // confident lie, not an absent one.
    let RateLookup::Priced { rate_in: haiku_45, rate_out: haiku_45_out } =
        rate_for_model("claude-haiku-4-5")
    else {
        panic!("claude-haiku-4-5 must be priced");
    };
    let RateLookup::Priced { rate_in: haiku_35, rate_out: haiku_35_out } =
        rate_for_model("claude-haiku-3-5")
    else {
        panic!("claude-haiku-3-5 must be priced");
    };
    assert_eq!((haiku_45, haiku_45_out), (1.0, 5.0));
    assert_eq!((haiku_35, haiku_35_out), (0.8, 4.0));
    assert_ne!(haiku_45, haiku_35, "the current generation must not inherit the retired one's rate");
}

#[test]
fn an_opus_generation_that_regrouped_at_a_new_price_does_not_inherit_the_old_one() {
    // Same shape as the Haiku test above, found while checking the rest of the
    // table for the same defect after the Haiku correction: Opus 4.5-4.8 price
    // at 1/3 of Opus 4 / 4.1's rate on Anthropic's official page, but all share
    // the "claude-opus-4" prefix.
    let RateLookup::Priced { rate_in: opus_47, rate_out: opus_47_out } =
        rate_for_model("claude-opus-4-7")
    else {
        panic!("claude-opus-4-7 must be priced");
    };
    let RateLookup::Priced { rate_in: opus_41, rate_out: opus_41_out } =
        rate_for_model("claude-opus-4-1")
    else {
        panic!("claude-opus-4-1 must be priced");
    };
    assert_eq!((opus_47, opus_47_out), (5.0, 25.0));
    assert_eq!((opus_41, opus_41_out), (15.0, 75.0));
    assert_ne!(opus_47, opus_41, "the current generation must not inherit the deprecated one's rate");
}
