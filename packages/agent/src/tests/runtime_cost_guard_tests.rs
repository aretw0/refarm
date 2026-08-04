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
fn rate_table_prices_xai_grok_4_3() {
    let RateLookup::Priced { rate_in, rate_out } = rate_for_model("grok-4.3") else {
        panic!("grok-4.3 must be priced");
    };
    assert_eq!((rate_in, rate_out), (1.25, 2.5));
}

#[test]
fn rate_table_prices_deepseek_v4_flash() {
    let RateLookup::Priced { rate_in, rate_out } = rate_for_model("deepseek-v4-flash") else {
        panic!("deepseek-v4-flash must be priced");
    };
    assert_eq!((rate_in, rate_out), (0.14, 0.28));
}

#[test]
fn rate_table_prices_gemini_3_flash_preview() {
    let RateLookup::Priced { rate_in, rate_out } = rate_for_model("gemini-3-flash-preview") else {
        panic!("gemini-3-flash-preview must be priced");
    };
    assert_eq!((rate_in, rate_out), (0.5, 3.0));
}

#[test]
fn rate_table_prices_groq_llama_3_3_70b_versatile() {
    let RateLookup::Priced { rate_in, rate_out } = rate_for_model("llama-3.3-70b-versatile") else {
        panic!("llama-3.3-70b-versatile must be priced");
    };
    assert_eq!((rate_in, rate_out), (0.59, 0.79));
}

#[test]
fn rate_table_prices_mistral_medium_3_5() {
    let RateLookup::Priced { rate_in, rate_out } = rate_for_model("mistral-medium-3-5") else {
        panic!("mistral-medium-3-5 must be priced");
    };
    assert_eq!((rate_in, rate_out), (1.5, 7.5));
}

#[test]
fn rate_table_prices_claude_fable_5() {
    let RateLookup::Priced { rate_in, rate_out } = rate_for_model("claude-fable-5") else {
        panic!("claude-fable-5 must be priced");
    };
    assert_eq!((rate_in, rate_out), (10.0, 50.0));
}

#[test]
fn rate_table_prices_claude_opus_5() {
    let RateLookup::Priced { rate_in, rate_out } = rate_for_model("claude-opus-5") else {
        panic!("claude-opus-5 must be priced");
    };
    assert_eq!((rate_in, rate_out), (5.0, 25.0));
}

#[test]
fn rate_table_prices_claude_sonnet_5_introductory_rate() {
    let RateLookup::Priced { rate_in, rate_out } = rate_for_model("claude-sonnet-5") else {
        panic!("claude-sonnet-5 must be priced");
    };
    assert_eq!((rate_in, rate_out), (2.0, 10.0));
}

#[test]
fn rate_table_prices_openai_gpt_5_6_sol() {
    let RateLookup::Priced { rate_in, rate_out } = rate_for_model("gpt-5.6-sol") else {
        panic!("gpt-5.6-sol must be priced");
    };
    assert_eq!((rate_in, rate_out), (5.0, 30.0));
}

#[test]
fn rate_table_prices_openai_gpt_5_6_terra() {
    let RateLookup::Priced { rate_in, rate_out } = rate_for_model("gpt-5.6-terra") else {
        panic!("gpt-5.6-terra must be priced");
    };
    assert_eq!((rate_in, rate_out), (2.0, 12.0));
}

#[test]
fn rate_table_prices_openai_gpt_5_6_luna() {
    let RateLookup::Priced { rate_in, rate_out } = rate_for_model("gpt-5.6-luna") else {
        panic!("gpt-5.6-luna must be priced");
    };
    assert_eq!((rate_in, rate_out), (0.2, 1.2));
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
fn spend_accumulates_across_turns_rather_than_resetting_each_one() {
    // F6's actual finding: a run that starts under the ceiling and burns ten
    // times it across tool loops. A per-turn check never sees it.
    let mut run = RunTotals::default();
    run.add_turn(4_000, 1_000); // turn 1: 5k, under a 10k ceiling
    assert!(cumulative_limit_error(run.total(), Some(10_000)).is_none());
    run.add_turn(4_000, 1_000); // turn 2: 10k cumulative, exactly at it
    assert!(cumulative_limit_error(run.total(), Some(10_000)).is_none());
    run.add_turn(1, 0); // turn 3: past it
    assert!(
        cumulative_limit_error(run.total(), Some(10_000)).is_some(),
        "three small turns that together exceed the ceiling must stop the run"
    );
}

#[test]
fn a_ceiling_that_never_arrives_leaves_the_run_unbounded() {
    // Backward compatibility: an installation that declares nothing behaves
    // exactly as it did before this task.
    let mut run = RunTotals::default();
    run.add_turn(u32::MAX / 2, u32::MAX / 2);
    assert!(cumulative_limit_error(run.total(), None).is_none());
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
    // Groq and Mistral SELL these model ids; they are now explicitly priced.
    // Ollama serves local models for free and still bypasses the table entirely
    // through `pricing_mode_for_provider`.
    assert!(matches!(
        rate_for_model("llama-3.3-70b-versatile"),
        RateLookup::Priced { .. }
    ));
    assert!(matches!(
        rate_for_model("mistral-medium-3-5"),
        RateLookup::Priced { .. }
    ));
    assert_eq!(
        estimate_billable_usd("ollama", "llama3.2", 10_000, 5_000, 0, 0),
        0.0,
        "local pricing mode still costs nothing, decided before the table"
    );
}

#[test]
fn an_unpriced_new_model_is_unknown_rather_than_free() {
    // Future families that are not on file should remain UNKNOWN instead of
    // being interpreted as genuinely free.
    assert!(matches!(rate_for_model("claude-opus-6"), RateLookup::Unknown));
    assert!(matches!(rate_for_model("claude-sonnet-6"), RateLookup::Unknown));
    // Current families still price.
    assert!(matches!(rate_for_model("claude-sonnet-4-6"), RateLookup::Priced { .. }));
    assert!(matches!(rate_for_model("claude-sonnet-5"), RateLookup::Priced { .. }));
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

#[test]
fn an_id_dropped_from_a_branch_for_lacking_verification_is_unknown_not_grouped() {
    // Both of these used to ride a verified sibling's rate on an UNVERIFIED
    // assumption: claude-sonnet-3-7 was grouped with claude-sonnet-4 (not on
    // Anthropic's current pricing page at all — fully retired, unverifiable),
    // and gpt-5.1-codex-mini was grouped with gpt-5-mini (not listed on
    // OpenAI's page as its own line item either). This table's own rule is
    // that only verified rates ship — an id nobody could re-verify is now
    // Unknown, not silently priced by association with a neighbour that DOES
    // verify.
    assert!(matches!(rate_for_model("claude-sonnet-3-7"), RateLookup::Unknown));
    assert!(matches!(rate_for_model("gpt-5.1-codex-mini"), RateLookup::Unknown));
    // Their former group-mates still price correctly — dropping the
    // unverified sibling must not have broken the verified one.
    assert!(matches!(rate_for_model("claude-sonnet-4-6"), RateLookup::Priced { .. }));
    assert!(matches!(rate_for_model("gpt-5-mini"), RateLookup::Priced { .. }));
}

// ── price_is_known (F5, whole-branch review) ──────────────────────────────

#[test]
fn price_is_known_true_for_a_priced_api_model() {
    assert!(price_is_known("anthropic", "claude-sonnet-4-6"));
}

#[test]
fn price_is_known_false_for_an_unrated_api_model() {
    // api pricing mode, no rate on file — the estimate is $0.00 but the price
    // was never actually known.
    assert!(!price_is_known("openai", "some-future-model-nobody-priced-yet"));
}

#[test]
fn price_is_known_true_under_a_structural_zero_pricing_mode() {
    // subscription/local: the zero is deliberate, never "could not price" —
    // rate_for_model is never even consulted (estimate_billable_usd
    // short-circuits before it).
    assert!(price_is_known("openai-codex", "gpt-5.5"));
    assert!(price_is_known("ollama", "llama3.2"));
}

// ── the host-injected rate catalog (D1) ───────────────────────────────────
//
// The catalog reaches this guest as a STRING on the env, resolved to the window in
// force by the host. Nothing here may branch on WHERE it came from — an embedded
// default, a node's file, or (later) a loaded plugin are the same fact from inside.

/// Every model id the built-in table has an opinion about, priced or not. Used to
/// pin that an absent catalog changes nothing.
const EVERY_MODEL_THE_TABLE_KNOWS: &[&str] = &[
    "claude-fable-5",
    "claude-mythos-5",
    "claude-opus-5",
    "claude-sonnet-5",
    "claude-opus-4-5",
    "claude-opus-4-6",
    "claude-opus-4-7",
    "claude-opus-4-8",
    "claude-opus-4",
    "claude-opus-4-1",
    "claude-sonnet-4",
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
    "claude-haiku-3-5",
    "claude-haiku",
    "grok-4.3",
    "deepseek-v4-flash",
    "gemini-3-flash-preview",
    "llama-3.3-70b-versatile",
    "mistral-medium-3-5",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5-mini",
    "gpt-5-nano",
    "gpt-5",
    "gpt-4o",
    "gpt-4o-mini",
    // Deliberately unpriced.
    "claude-sonnet-3-7",
    "claude-opus-6",
    "gpt-5.1-codex-mini",
    "some-future-model-nobody-priced-yet",
];

#[test]
fn an_absent_catalog_leaves_rate_for_model_byte_identical_to_the_built_in_table() {
    // The whole point of catalog-FIRST-with-fallback: with nothing injected, this
    // guest must answer exactly what it answered before the catalog existed. This
    // test process sets no MODEL_RATE_CATALOG, so the lookup is pure fallback.
    assert!(
        injected_rate_catalog().is_none(),
        "this suite runs with no catalog injected — that is what makes the comparison meaningful"
    );
    for model in EVERY_MODEL_THE_TABLE_KNOWS {
        let via_lookup = rate_for_model(model);
        let via_table = rate_from_builtin_table(model);
        match (via_lookup, via_table) {
            (
                RateLookup::Priced { rate_in: a_in, rate_out: a_out },
                RateLookup::Priced { rate_in: b_in, rate_out: b_out },
            ) => {
                assert_eq!(a_in, b_in, "{model}: input rate drifted from the built-in table");
                assert_eq!(a_out, b_out, "{model}: output rate drifted from the built-in table");
            }
            (RateLookup::Unknown, RateLookup::Unknown) => {}
            _ => panic!("{model}: rate_for_model disagrees with the built-in table"),
        }
    }
}

#[test]
fn a_catalog_entry_wins_over_the_built_in_table() {
    // The Sonnet 5 post-intro rate: the host injects THIS row on 2026-09-01, while
    // the built-in table still carries the introductory $2/$10 inline.
    let catalog = parse_rate_catalog(
        r#"{"schemaVersion":"model-rate-catalog.v1","catalogVersion":"t","entries":[
          {"provider":"anthropic","match":{"mode":"contains","value":"claude-sonnet-5"},
           "rate":{"inputPerMTokenUsd":3,"outputPerMTokenUsd":15},
           "pricingUrl":"https://example.invalid","verifiedAt":"2026-08-04"}]}"#,
    )
    .expect("valid catalog");
    assert_eq!(rate_from_catalog(&catalog, "claude-sonnet-5"), Some((3.0, 15.0)));
    // …and the built-in table is still the pre-switch number, so this is a real override.
    let RateLookup::Priced { rate_in, rate_out } = rate_from_builtin_table("claude-sonnet-5") else {
        panic!("built-in table prices claude-sonnet-5");
    };
    assert_eq!((rate_in, rate_out), (2.0, 10.0));
}

#[test]
fn entry_order_is_precedence_first_match_wins_and_nothing_is_sorted() {
    // The authored order is the contract. A general rule placed first WINS over the
    // specific rule after it — which is why both sides refuse that arrangement at
    // validation time rather than quietly re-sorting it here.
    let general_first = parse_rate_catalog(
        r#"{"entries":[
          {"match":{"mode":"contains","value":"claude-opus-4"},
           "rate":{"inputPerMTokenUsd":15,"outputPerMTokenUsd":75}},
          {"match":{"mode":"contains","value":"claude-opus-4-5"},
           "rate":{"inputPerMTokenUsd":5,"outputPerMTokenUsd":25}}]}"#,
    )
    .expect("valid");
    assert_eq!(
        rate_from_catalog(&general_first, "claude-opus-4-5"),
        Some((15.0, 75.0)),
        "first match wins — the order received is the order used"
    );

    // The correctly authored order (specific first) reaches the specific rate.
    let specific_first = parse_rate_catalog(
        r#"{"entries":[
          {"match":{"mode":"contains","value":"claude-opus-4-5"},
           "rate":{"inputPerMTokenUsd":5,"outputPerMTokenUsd":25}},
          {"match":{"mode":"contains","value":"claude-opus-4"},
           "rate":{"inputPerMTokenUsd":15,"outputPerMTokenUsd":75}}]}"#,
    )
    .expect("valid");
    assert_eq!(rate_from_catalog(&specific_first, "claude-opus-4-5"), Some((5.0, 25.0)));
    assert_eq!(rate_from_catalog(&specific_first, "claude-opus-4-1"), Some((15.0, 75.0)));
}

#[test]
fn an_exact_rule_matches_only_itself() {
    let catalog = parse_rate_catalog(
        r#"{"entries":[{"match":{"mode":"exact","value":"gpt-5"},
          "rate":{"inputPerMTokenUsd":1.25,"outputPerMTokenUsd":10}}]}"#,
    )
    .expect("valid");
    assert_eq!(rate_from_catalog(&catalog, "gpt-5"), Some((1.25, 10.0)));
    assert_eq!(rate_from_catalog(&catalog, "gpt-5-nano"), None);
}

#[test]
fn a_catalog_without_this_model_falls_back_instead_of_answering_zero() {
    let catalog = parse_rate_catalog(
        r#"{"entries":[{"match":{"mode":"contains","value":"claude-sonnet-5"},
          "rate":{"inputPerMTokenUsd":3,"outputPerMTokenUsd":15}}]}"#,
    )
    .expect("valid");
    assert_eq!(
        rate_from_catalog(&catalog, "grok-4.3"),
        None,
        "no entry for this model is a MISS, and a miss must reach the fallback"
    );
    // And the fallback still prices it — the miss did not become a free run.
    let RateLookup::Priced { rate_in, rate_out } = rate_from_builtin_table("grok-4.3") else {
        panic!("built-in table prices grok-4.3");
    };
    assert_eq!((rate_in, rate_out), (1.25, 2.5));
}

#[test]
fn an_unusable_catalog_means_prices_unknown_never_prices_zero() {
    // Not JSON.
    assert!(parse_rate_catalog("{ not json").is_none());
    // JSON, but not a catalog.
    assert!(parse_rate_catalog(r#"{"schemaVersion":"model-rate-catalog.v1"}"#).is_none());
    assert!(parse_rate_catalog("[]").is_none());
    // One malformed entry rejects the whole list: half-trusting a price list silently
    // changes which rule wins under first-match-wins.
    assert!(parse_rate_catalog(
        r#"{"entries":[
          {"match":{"mode":"contains","value":"claude-sonnet-5"},
           "rate":{"inputPerMTokenUsd":3,"outputPerMTokenUsd":15}},
          {"match":{"mode":"contains","value":"gpt-5"}}]}"#
    )
    .is_none());
    // A negative rate is not a discount.
    assert!(parse_rate_catalog(
        r#"{"entries":[{"match":{"mode":"contains","value":"gpt-5"},
          "rate":{"inputPerMTokenUsd":-1,"outputPerMTokenUsd":10}}]}"#
    )
    .is_none());
    // An unknown match mode is not "contains by default".
    assert!(parse_rate_catalog(
        r#"{"entries":[{"match":{"mode":"regex","value":"gpt-.*"},
          "rate":{"inputPerMTokenUsd":1,"outputPerMTokenUsd":2}}]}"#
    )
    .is_none());

    // An EMPTY catalog is well-formed and means "this catalog prices nothing" — every
    // lookup misses and reaches the fallback. It is not "everything is free".
    let empty = parse_rate_catalog(r#"{"entries":[]}"#).expect("an empty catalog is valid");
    assert_eq!(rate_from_catalog(&empty, "claude-sonnet-5"), None);
    assert!(matches!(rate_for_model("claude-sonnet-5"), RateLookup::Priced { .. }));
}

#[test]
fn a_full_entry_shape_parses_with_its_citations_ignored_not_rejected() {
    // The host sends the full entry (pricingUrl, verifiedAt, contextWindow) because a
    // narrow projection would be a second schema. Fields this lookup does not read
    // must travel harmlessly.
    let catalog = parse_rate_catalog(
        r#"{"schemaVersion":"model-rate-catalog.v1","catalogVersion":"2026-08-04.5","entries":[
          {"provider":"anthropic","match":{"mode":"contains","value":"claude-opus-5"},
           "rate":{"inputPerMTokenUsd":5,"outputPerMTokenUsd":25},
           "pricingUrl":"https://platform.claude.com/docs/en/about-claude/pricing",
           "verifiedAt":"2026-08-04",
           "contextWindow":{"tokens":1000000,"sourceUrl":"https://example.invalid","verifiedAt":"2026-08-04"}}]}"#,
    )
    .expect("the full entry shape parses");
    assert_eq!(rate_from_catalog(&catalog, "claude-opus-5"), Some((5.0, 25.0)));
}

/// The artifact the host embeds, read here at TEST time only (no bytes reach the
/// shipped `.wasm`). Parsing the real 27 entries is the only way this side can prove
/// it agrees with what the host will actually send.
const REAL_ARTIFACT: &str =
    include_str!("../../../model-catalog-v1/catalog/model-rates.v1.json");

#[test]
fn the_real_artifact_prices_what_the_built_in_table_prices_and_agrees_on_the_number() {
    let catalog = parse_rate_catalog(REAL_ARTIFACT).expect("the shipped artifact parses");

    // The superset condition for retiring the built-in chain: every id the table
    // prices, the catalog prices — at the same number.
    let mut disagreements: Vec<String> = Vec::new();
    for model in EVERY_MODEL_THE_TABLE_KNOWS {
        let from_catalog = rate_from_catalog(&catalog, model);
        let from_table = match rate_from_builtin_table(model) {
            RateLookup::Priced { rate_in, rate_out } => Some((rate_in, rate_out)),
            RateLookup::Unknown => None,
        };
        if from_catalog != from_table {
            disagreements.push(format!("{model}: catalog={from_catalog:?} table={from_table:?}"));
        }
    }

    assert_eq!(
        disagreements,
        vec![
            // The ONE divergence, recorded rather than papered over. The built-in chain
            // carves "gpt-5.1-codex-mini" out of the "gpt-5" family branch on purpose:
            // it is not listed on OpenAI's page as its own line item, so its rate could
            // not be verified, and this table's rule is that only verified rates ship.
            // The catalog has no such carve-out — "gpt-5.1-codex-mini".contains("gpt-5")
            // is true, so under first-match-wins it inherits the family rate.
            //
            // Catalog-first therefore turns a deliberate Unknown into a confident
            // $1.25/$10. The TypeScript resolver ALREADY answers that way for the same
            // id, so this is the two sides converging on the catalog's answer rather
            // than a new opinion — but it is a behaviour change, and the fix belongs in
            // the artifact (an `exact`-mode carve-out, or a narrower family rule), not
            // in a second exclusion list here. Pinned so it cannot drift unnoticed.
            "gpt-5.1-codex-mini: catalog=Some((1.25, 10.0)) table=None".to_string(),
        ],
        "the catalog and the built-in table must agree except where it is recorded here"
    );
}

#[test]
fn the_real_artifacts_order_reaches_the_specific_rule_before_its_family() {
    // The order-dependence that once billed Opus 4.5 at Opus 4's rate, checked against
    // the shipped ordering rather than a fixture that could drift from it.
    let catalog = parse_rate_catalog(REAL_ARTIFACT).expect("the shipped artifact parses");
    assert_eq!(rate_from_catalog(&catalog, "claude-opus-4-5"), Some((5.0, 25.0)));
    assert_eq!(rate_from_catalog(&catalog, "claude-opus-4-1"), Some((15.0, 75.0)));
    assert_eq!(rate_from_catalog(&catalog, "claude-haiku-4-5"), Some((1.0, 5.0)));
    assert_eq!(rate_from_catalog(&catalog, "claude-haiku-3-5"), Some((0.8, 4.0)));
    assert_eq!(rate_from_catalog(&catalog, "gpt-5-nano"), Some((0.05, 0.4)));
    assert_eq!(rate_from_catalog(&catalog, "gpt-4o-mini"), Some((0.15, 0.6)));
    assert_eq!(rate_from_catalog(&catalog, "gpt-4o"), Some((2.5, 10.0)));
}
