pub(crate) struct FinalStreamChunkInput<'a> {
    pub stream_ref: &'a str,
    pub content: &'a str,
    pub model: &'a str,
    pub provider: &'a str,
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub cache_read_tokens: u32,
    pub cache_creation_tokens: u32,
    /// True when incremental partial chunks (is_final:false, carrying the deltas)
    /// were already written to this stream file before the final line.
    pub partials_present: bool,
    /// The final line's sequence: last_partial + 1 when partials preceded it,
    /// else 0 for the single-shot case.
    pub sequence: u32,
}

/// The final NDJSON line for a response stream. The CLI reader accumulates
/// `content += chunk.content` over EVERY line (including the final), so the
/// final line's content is CONDITIONAL to avoid double-counting:
///   - partials_present → content:"" (a pure end-marker: the deltas already
///     carried the whole answer, so the final must add nothing to the accumulator).
///   - no partials (single-shot / non-SSE) → content:<whole answer>, sequence:0
///     (today's exact behavior — the final IS the only line, so it carries the text).
/// Either way `sum(partial deltas) + final.content` == whole answer, exactly once.
pub(crate) fn final_stream_chunk_ndjson(input: FinalStreamChunkInput<'_>) -> String {
    let pricing_mode = crate::pricing_mode_for_provider(input.provider);
    let estimated_usd = crate::estimate_billable_usd(
        input.provider,
        input.model,
        input.tokens_in,
        input.tokens_out,
        input.cache_read_tokens,
        input.cache_creation_tokens,
    );
    let content = if input.partials_present { "" } else { input.content };
    format!(
        "{{\"stream_ref\":{stream_ref_json},\"sequence\":{sequence},\"content\":{content_json},\"is_final\":true,\"metadata\":{{\"model\":{model_json},\"provider\":{provider_json},\"tokens_in\":{tokens_in},\"tokens_out\":{tokens_out},\"pricing_mode\":{pricing_mode_json},\"estimated_usd\":{estimated_usd:.6}}}}}\n",
        stream_ref_json = json_string(input.stream_ref),
        sequence = input.sequence,
        content_json = json_string(content),
        model_json = json_string(input.model),
        provider_json = json_string(input.provider),
        pricing_mode_json = json_string(pricing_mode),
        tokens_in = input.tokens_in,
        tokens_out = input.tokens_out,
    )
}

fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}
