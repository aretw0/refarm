#[derive(Default)]
pub(crate) struct UsageTotals {
    pub tokens_in: u32,
    pub tokens_out: u32,
    /// Input tokens served FROM the provider's cache. Billed at a discount.
    /// OTel: gen_ai.usage.cache_read.input_tokens
    pub cache_read_tokens: u32,
    /// Input tokens WRITTEN INTO the provider's cache. Billed at a SURCHARGE.
    /// Kept apart from reads because the two are priced in opposite directions;
    /// summing them made every cache write look like a discount.
    /// OTel: gen_ai.usage.cache_creation.input_tokens
    pub cache_creation_tokens: u32,
    pub tokens_reasoning: u32,
}

impl UsageTotals {
    /// Anthropic's accounting model: `input_tokens` EXCLUDES both cache buckets
    /// (it is the tokens after the last cache breakpoint). Total input processed
    /// is the sum of all three.
    pub(crate) fn ingest_anthropic_usage(&mut self, usage: &serde_json::Value) {
        self.tokens_in += usage["input_tokens"].as_u64().unwrap_or(0) as u32;
        self.tokens_out += usage["output_tokens"].as_u64().unwrap_or(0) as u32;
        self.cache_read_tokens += usage["cache_read_input_tokens"].as_u64().unwrap_or(0) as u32;
        self.cache_creation_tokens +=
            usage["cache_creation_input_tokens"].as_u64().unwrap_or(0) as u32;
    }

    /// OpenAI's accounting model: `prompt_tokens` INCLUDES cached reads, and there
    /// is no cache-write token count because caching is automatic and carries no
    /// write surcharge. `cache_creation_tokens` stays zero here BY DESIGN.
    pub(crate) fn ingest_openai_usage(&mut self, usage: &serde_json::Value) {
        self.tokens_in += usage_u32(usage, &["prompt_tokens", "input_tokens"]);
        self.tokens_out += usage_u32(usage, &["completion_tokens", "output_tokens"]);
        self.cache_read_tokens += nested_usage_u32(
            usage,
            &["prompt_tokens_details", "input_tokens_details"],
            "cached_tokens",
        );
        self.tokens_reasoning += nested_usage_u32(
            usage,
            &["completion_tokens_details", "output_tokens_details"],
            "reasoning_tokens",
        );
    }
}

fn usage_u32(usage: &serde_json::Value, keys: &[&str]) -> u32 {
    keys.iter()
        .find_map(|key| usage[*key].as_u64())
        .unwrap_or(0) as u32
}

fn nested_usage_u32(usage: &serde_json::Value, parents: &[&str], key: &str) -> u32 {
    parents
        .iter()
        .find_map(|parent| usage[*parent][key].as_u64())
        .unwrap_or(0) as u32
}
