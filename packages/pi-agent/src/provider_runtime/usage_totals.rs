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
        self.tokens_in += usage_u32(usage, &["prompt_tokens", "input_tokens"]);
        self.tokens_out += usage_u32(usage, &["completion_tokens", "output_tokens"]);
        self.tokens_cached += nested_usage_u32(
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
