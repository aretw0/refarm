pub(crate) fn tool_loop_max_iter() -> u32 {
    std::env::var("MODEL_TOOL_CALL_MAX_ITER")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(5)
}

/// The default output-token ceiling when `MODEL_MAX_TOKENS` is unset. A modern
/// coding-agent must be able to emit a full file or a long patch in one turn;
/// the previous hardcoded 1024 silently truncated those. 4096 is a safe default
/// across current providers, overridable up (or down) per deployment.
pub(crate) const DEFAULT_MAX_OUTPUT_TOKENS: u32 = 4096;

/// The per-turn output-token ceiling, from `MODEL_MAX_TOKENS` (else the default).
/// Threaded into every provider request body so the model is never capped below
/// what the deployment allows.
pub(crate) fn max_output_tokens() -> u32 {
    std::env::var("MODEL_MAX_TOKENS")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .filter(|&n| n > 0)
        .unwrap_or(DEFAULT_MAX_OUTPUT_TOKENS)
}
