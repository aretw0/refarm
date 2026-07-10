pub(crate) fn parse_json_arguments(arguments: &str) -> serde_json::Value {
    serde_json::from_str(arguments).unwrap_or_else(|_| serde_json::json!({}))
}

pub(crate) fn should_terminate_tool_loop(
    has_tool_calls: bool,
    iter_idx: u32,
    max_iter: u32,
) -> bool {
    !has_tool_calls || iter_idx == max_iter
}

/// The loop terminates for TWO different reasons, and they must be handled
/// differently:
///   - NATURAL FINISH (`!has_tool_calls`): the model chose to stop and produced its
///     final text. Return it (or an empty string if somehow absent — a finished turn
///     with no text is degenerate, not an error).
///   - FORCED CUTOFF (`iter_idx == max_iter` while tool calls are still pending): the
///     model wanted MORE tool turns but hit the iteration ceiling, so it emitted only
///     tool_uses and NO final text. Do NOT error (the old bug: `require`-ing text here
///     returned `Err("no text")` and discarded the whole loop's work). Instead
///     synthesize a graceful final: prefer any partial text the model did emit, else a
///     clear "reached the tool-iteration limit" message so the operator sees progress
///     stopped at a boundary, not a failure.
///
/// Returns `None` when the loop should CONTINUE (not terminating).
pub(crate) fn resolve_termination_text(
    has_tool_calls: bool,
    iter_idx: u32,
    max_iter: u32,
    text: Option<String>,
) -> Option<String> {
    if !should_terminate_tool_loop(has_tool_calls, iter_idx, max_iter) {
        return None;
    }
    // Terminating. A forced cutoff is when tool calls are still pending at the ceiling.
    if has_tool_calls && iter_idx == max_iter {
        return Some(text.unwrap_or_else(|| {
            format!(
                "Reached the tool-iteration limit ({max_iter}) before finishing. \
                 Increase MODEL_TOOL_CALL_MAX_ITER to allow more tool turns, \
                 or narrow the task."
            )
        }));
    }
    // Natural finish: the model's text (empty string if degenerate — never an error).
    Some(text.unwrap_or_default())
}

pub(crate) fn completion_text_if_terminate(
    has_tool_calls: bool,
    iter_idx: u32,
    max_iter: u32,
    content: Result<String, String>,
) -> Result<Option<String>, String> {
    if should_terminate_tool_loop(has_tool_calls, iter_idx, max_iter) {
        content.map(Some)
    } else {
        Ok(None)
    }
}

pub(crate) fn error_message(v: &serde_json::Value, fallback: &str) -> String {
    v["error"]["message"]
        .as_str()
        .unwrap_or(fallback)
        .to_owned()
}
