pub(crate) struct AgentResponsePayload<'a> {
    pub prompt_ref: &'a str,
    pub content: &'a str,
    pub tool_calls: serde_json::Value,
    pub model: &'a str,
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub duration_ms: u64,
    pub sequence: u32,
    pub is_final: bool,
}

pub(crate) struct UsageRecordPayload<'a> {
    pub prompt_ref: &'a str,
    pub provider: &'a str,
    pub model: &'a str,
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub cache_read_tokens: u32,
    pub cache_creation_tokens: u32,
    pub tokens_reasoning: u32,
    pub usage_raw: &'a str,
    pub duration_ms: u64,
    /// The "4" of *"died at 4/25"* — how many completion-loop STEPS this
    /// dispatch ran (`provider_runtime::loop_progress`). 1-based, so it equals
    /// the `step N/…` the sidecar printed for the last iteration the operator
    /// saw. `None` when no completion loop ran in this dispatch (a context-limit
    /// refusal, the native stub): D6, absent rather than a fabricated `0`.
    pub steps_completed: Option<u32>,
    /// The "25" of *"died at 4/25"* — the step ceiling that governed THIS
    /// dispatch's loop, taken from the same `for` statement as the numerator
    /// above so the two can only ever count the same notion. `None` whenever the
    /// numerator is `None`; NEVER re-derived from `tool_loop_max_iter()` at
    /// record time, which would stamp the default `25` onto a run that no
    /// ceiling of 25 ever governed.
    pub steps_planned: Option<u32>,
    /// How many TURNS (whole dispatches) this run had folded in as of this
    /// record — `RunTotals::turns` (`runtime/policy.rs`) via
    /// `runtime::react_loop::current_run_turns`, the same accumulator that
    /// tracks cumulative tokens/spend across a run.
    ///
    /// A different notion from `steps_*` above and deliberately not spelled as
    /// half of a fraction: one `refarm ask` is one turn however many steps it
    /// takes, and nothing anywhere declares a maximum number of turns. This
    /// field used to be called `steps_completed`, which put a turn count beside
    /// a step ceiling — a fraction whose halves counted different things.
    pub turns_completed: u32,
}

pub(crate) fn user_prompt_node(prompt_ref: &str, prompt: &str) -> serde_json::Value {
    serde_json::json!({
        "@type":        "UserPrompt",
        "@id":          prompt_ref,
        "content":      prompt,
        "timestamp_ns": crate::now_ns(),
    })
}

pub(crate) fn agent_response_node(payload: AgentResponsePayload<'_>) -> serde_json::Value {
    serde_json::json!({
        "@type":        "Response",
        "@id":          crate::mint_urn("resp"),
        "prompt_ref":   payload.prompt_ref,
        "content":      payload.content,
        "sequence":     payload.sequence,
        "is_final":     payload.is_final,
        "tool_calls":   payload.tool_calls,
        "timestamp_ns": crate::now_ns(),
        "inference": {
            "model":       payload.model,
            "tokens_in":   payload.tokens_in,
            "tokens_out":  payload.tokens_out,
            "duration_ms": payload.duration_ms,
        },
    })
}

pub(crate) fn usage_record_node(payload: UsageRecordPayload<'_>) -> serde_json::Value {
    let mut node = serde_json::json!({
        "@type":         "UsageRecord",
        "@id":           crate::mint_urn("usage"),
        "prompt_ref":    payload.prompt_ref,
        "provider":      payload.provider,
        "model":         payload.model,
        "tokens_in":     payload.tokens_in,
        "tokens_out":    payload.tokens_out,
        "pricing_mode":  crate::pricing_mode_for_provider(payload.provider),
        "estimated_usd": crate::estimate_billable_usd(payload.provider, payload.model, payload.tokens_in, payload.tokens_out, payload.cache_read_tokens, payload.cache_creation_tokens),
        // Whether the estimate above is a REAL price or a structural/unpriced
        // zero (F5) — "I could not price this" must not read as "this was
        // cheap". See `price_is_known`'s doc for the exact rule.
        "price_known":   crate::price_is_known(payload.provider, payload.model),
        // Which rate table priced this run. `packages/tractor` has no Cargo dependency
        // on this crate (the agent is a WASM guest loaded at runtime, not linked), so
        // the sidecar cannot read RATE_TABLE_VERSION directly — it joins this field in
        // from the UsageRecord instead, like every other usage field. The version
        // belongs to whoever computed the price, so it travels WITH the price.
        "rate_table_version": crate::RATE_TABLE_VERSION,
        // How many DISPATCHES this run folded in, beside `rate_table_version`
        // for the identical reason: `packages/tractor` has no Cargo dependency
        // on this crate (the agent is a WASM guest loaded at runtime, not
        // linked), so the sidecar cannot count a run's turns itself. The count
        // belongs to whoever ran the turns, so it travels WITH the record,
        // exactly like the rate table travels with the price it computed. The
        // step pair `steps_completed`/`steps_planned` is inserted below, and
        // only when a loop actually established one.
        "turns_completed": payload.turns_completed,
        // OTel gen_ai.usage.cache_read.input_tokens / cache_creation.input_tokens,
        // spelled flat because this node is not an OTel span.
        "cache_read_input_tokens":     payload.cache_read_tokens,
        "cache_creation_input_tokens": payload.cache_creation_tokens,
        // Retained for readers written before the split. Derived, never authoritative.
        "tokens_cached": payload.cache_read_tokens + payload.cache_creation_tokens,
        "tokens_reasoning": payload.tokens_reasoning,
        "usage_raw":        payload.usage_raw,
        "duration_ms":      payload.duration_ms,
        "timestamp_ns":     crate::now_ns(),
    });

    // *"died at 4/25"*, made recoverable. Inserted rather than spelled inline
    // above because an absent half must leave NO KEY — a `null`, a `0` or a
    // defaulted `25` all read to a downstream reader as a measurement that was
    // taken. `put_opt` on the sidecar side (`tractor/src/sidecar/observation.rs`)
    // applies the same rule to the same pair one join later.
    if let Some(map) = node.as_object_mut() {
        if let Some(steps_completed) = payload.steps_completed {
            map.insert("steps_completed".into(), steps_completed.into());
        }
        if let Some(steps_planned) = payload.steps_planned {
            map.insert("steps_planned".into(), steps_planned.into());
        }
    }
    node
}
