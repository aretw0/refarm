pub(crate) struct FinalStreamChunkInput<'a> {
    pub stream_ref: &'a str,
    pub content: &'a str,
    pub model: &'a str,
    pub provider: &'a str,
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub tokens_cached: u32,
}

pub(crate) fn final_stream_chunk_ndjson(input: FinalStreamChunkInput<'_>) -> String {
    let pricing_mode = crate::pricing_mode_for_provider(input.provider);
    let estimated_usd = crate::estimate_billable_usd(
        input.provider,
        input.model,
        input.tokens_in,
        input.tokens_out,
        input.tokens_cached,
    );
    format!(
        "{{\"stream_ref\":{stream_ref_json},\"sequence\":0,\"content\":{content_json},\"is_final\":true,\"metadata\":{{\"model\":{model_json},\"provider\":{provider_json},\"tokens_in\":{tokens_in},\"tokens_out\":{tokens_out},\"pricing_mode\":{pricing_mode_json},\"estimated_usd\":{estimated_usd:.6}}}}}\n",
        stream_ref_json = json_string(input.stream_ref),
        content_json = json_string(input.content),
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
