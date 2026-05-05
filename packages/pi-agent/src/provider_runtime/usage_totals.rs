#[derive(Default)]
pub(crate) struct UsageTotals {
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub tokens_cached: u32,
    pub tokens_reasoning: u32,
}

impl UsageTotals {
    pub(crate) fn ingest_anthropic_usage(&mut self, usage: &serde_json::Value) {
        self.tokens_in += usage["input_tokens"].as_u64().unwrap_or(0) as u32;
        self.tokens_out += usage["output_tokens"].as_u64().unwrap_or(0) as u32;
        self.tokens_cached += (usage["cache_read_input_tokens"].as_u64().unwrap_or(0)
            + usage["cache_creation_input_tokens"].as_u64().unwrap_or(0))
            as u32;
    }

    pub(crate) fn ingest_openai_usage(&mut self, usage: &serde_json::Value) {
        self.tokens_in += usage["prompt_tokens"].as_u64().unwrap_or(0) as u32;
        self.tokens_out += usage["completion_tokens"].as_u64().unwrap_or(0) as u32;
        self.tokens_cached += usage["prompt_tokens_details"]["cached_tokens"]
            .as_u64()
            .unwrap_or(0) as u32;
        self.tokens_reasoning += usage["completion_tokens_details"]["reasoning_tokens"]
            .as_u64()
            .unwrap_or(0) as u32;
    }
}
