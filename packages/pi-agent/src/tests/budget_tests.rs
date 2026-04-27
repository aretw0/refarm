use super::*;

#[test]
fn budget_sum_filters_by_provider_and_window() {
    let now = now_ns();
    let window = 30u64 * 24 * 3600 * 1_000_000_000;
    let recent = now - 1_000_000_000; // 1s ago — inside window
    let records = vec![
        serde_json::json!({"provider":"anthropic","estimated_usd":1.5,"timestamp_ns":recent})
            .to_string(),
        serde_json::json!({"provider":"openai","estimated_usd":0.5,"timestamp_ns":recent})
            .to_string(),
        serde_json::json!({"provider":"anthropic","estimated_usd":0.3,"timestamp_ns":recent})
            .to_string(),
    ];
    let spend = sum_provider_spend_usd(&records, "anthropic", now, window);
    assert!(
        (spend - 1.8).abs() < 1e-10,
        "anthropic spend should be 1.8, got {spend}"
    );
    let openai_spend = sum_provider_spend_usd(&records, "openai", now, window);
    assert!(
        (openai_spend - 0.5).abs() < 1e-10,
        "openai spend should be 0.5, got {openai_spend}"
    );
}

#[test]
fn budget_sum_excludes_records_outside_window() {
    let now = now_ns();
    let window = 30u64 * 24 * 3600 * 1_000_000_000;
    let stale_ts = now.saturating_sub(window + 1_000_000_000); // 1s beyond 30d
    let records = vec![
        serde_json::json!({"provider":"anthropic","estimated_usd":100.0,"timestamp_ns":stale_ts})
            .to_string(),
        serde_json::json!({"provider":"anthropic","estimated_usd":2.0,"timestamp_ns":now - 1_000_000_000})
            .to_string(),
    ];
    let spend = sum_provider_spend_usd(&records, "anthropic", now, window);
    assert!(
        (spend - 2.0).abs() < 1e-10,
        "stale record must be excluded: {spend}"
    );
}

#[test]
fn budget_sum_returns_zero_for_empty_records() {
    let spend = sum_provider_spend_usd(&[], "anthropic", now_ns(), 30 * 24 * 3600 * 1_000_000_000);
    assert_eq!(spend, 0.0);
}

#[test]
fn budget_sum_ignores_malformed_records() {
    let records = vec!["not-json".to_string(), "{}".to_string()];
    let spend = sum_provider_spend_usd(
        &records,
        "anthropic",
        now_ns(),
        30 * 24 * 3600 * 1_000_000_000,
    );
    assert_eq!(
        spend, 0.0,
        "malformed records must not panic or contribute spend"
    );
}

