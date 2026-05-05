use super::*;

#[test]
fn fnv1a_hash_same_input_same_output() {
    assert_eq!(fnv1a_hash("hello"), fnv1a_hash("hello"));
}

#[test]
fn fnv1a_hash_different_inputs_differ() {
    assert_ne!(fnv1a_hash("a"), fnv1a_hash("b"));
    assert_ne!(fnv1a_hash(""), fnv1a_hash("x"));
}

#[test]
fn strip_ansi_removes_color_codes() {
    let colored = "\x1b[32mgreen\x1b[0m normal";
    assert_eq!(strip_ansi(colored), "green normal");
}

#[test]
fn strip_ansi_passthrough_plain() {
    let plain = "no escape codes here";
    assert_eq!(strip_ansi(plain), plain);
}

#[test]
fn dedup_lines_collapses_consecutive_repeats() {
    let lines = vec!["warn", "warn", "warn", "ok"];
    let result = dedup_lines(&lines);
    assert_eq!(result, vec!["warn [×3]", "ok"]);
}

#[test]
fn dedup_lines_passthrough_unique() {
    let lines = vec!["a", "b", "a"]; // non-consecutive, must not collapse
    let result = dedup_lines(&lines);
    assert_eq!(result, vec!["a", "b", "a"]);
}

#[test]
fn dedup_lines_collapses_run_of_two() {
    let lines = vec!["x", "x"];
    let result = dedup_lines(&lines);
    assert_eq!(result, vec!["x [×2]"]);
}

#[test]
fn compress_tool_output_passthrough_when_under_limit() {
    std::env::set_var("LLM_TOOL_OUTPUT_MAX_LINES", "100");
    let output = "line1\nline2\nline3";
    assert_eq!(compress_tool_output(output), output);
    std::env::remove_var("LLM_TOOL_OUTPUT_MAX_LINES");
}

#[test]
fn compress_tool_output_truncates_with_header() {
    std::env::set_var("LLM_TOOL_OUTPUT_MAX_LINES", "2");
    let output = "a\nb\nfoo\nbar";
    let result = compress_tool_output(output);
    assert!(
        result.starts_with("[truncated: 4 lines → first 2 shown]"),
        "header missing: {result}"
    );
    assert!(result.contains("a"), "kept lines must appear: {result}");
    std::env::remove_var("LLM_TOOL_OUTPUT_MAX_LINES");
}

#[test]
fn compress_tool_output_dedup_reduces_before_truncation() {
    std::env::set_var("LLM_TOOL_OUTPUT_MAX_LINES", "5");
    // 10 identical lines → deduped to 1 → well under limit
    let output = "warn: something\n".repeat(10).trim_end().to_string();
    let result = compress_tool_output(&output);
    assert!(
        !result.starts_with("[truncated"),
        "dedup must prevent truncation: {result}"
    );
    assert!(
        result.contains("[×10]"),
        "dedup annotation must appear: {result}"
    );
    std::env::remove_var("LLM_TOOL_OUTPUT_MAX_LINES");
}

#[test]
fn compress_tool_output_strips_ansi_before_dedup() {
    std::env::remove_var("LLM_TOOL_OUTPUT_MAX_LINES");
    let output = "\x1b[31mERROR\x1b[0m\n\x1b[31mERROR\x1b[0m\nok";
    let result = compress_tool_output(output);
    assert!(
        result.contains("[×2]"),
        "ANSI-stripped lines must dedup: {result}"
    );
    assert!(
        !result.contains("\x1b"),
        "ANSI codes must be stripped: {result}"
    );
}

#[test]
fn compress_tool_output_unlimited_by_default() {
    std::env::remove_var("LLM_TOOL_OUTPUT_MAX_LINES");
    let big = (0..1000)
        .map(|i| i.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    let result = compress_tool_output(&big);
    assert_eq!(result, big, "without env var, output must be unchanged");
}
