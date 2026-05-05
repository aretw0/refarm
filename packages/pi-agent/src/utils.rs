use std::sync::atomic::{AtomicU64, Ordering};

/// FNV-1a 64-bit hash — no external dep, O(n) in input size.
/// Used for cross-call exact deduplication within a single agentic turn.
pub(crate) fn fnv1a_hash(s: &str) -> u64 {
    const BASIS: u64 = 14695981039346656037;
    const PRIME: u64 = 1099511628211;
    s.bytes()
        .fold(BASIS, |h, b| h.wrapping_mul(PRIME) ^ b as u64)
}

/// Estimate cost in USD using public 2025 per-million-token rates.
/// Cached tokens are billed at ~10% of normal input rate (Anthropic/OpenAI prompt caching).
/// Returns 0.0 for local/unknown models — sovereign infra is free.
pub(crate) fn estimate_usd(
    model: &str,
    tokens_in: u32,
    tokens_out: u32,
    tokens_cached: u32,
) -> f64 {
    let (rate_in, rate_out): (f64, f64) = if model.contains("claude-opus-4") {
        (15.0, 75.0)
    } else if model.contains("claude-sonnet-4") || model.contains("claude-sonnet-3-7") {
        (3.0, 15.0)
    } else if model.contains("claude-haiku") {
        (0.8, 4.0)
    } else if model.contains("gpt-4o") && !model.contains("mini") {
        (2.5, 10.0)
    } else if model.contains("gpt-4o-mini") {
        (0.15, 0.6)
    } else {
        return 0.0; // ollama, llama*, local models — free
    };
    let uncached = tokens_in.saturating_sub(tokens_cached) as f64;
    let cached = tokens_cached as f64;
    (uncached / 1_000_000.0) * rate_in
        + (cached / 1_000_000.0) * rate_in * 0.1   // cache hit discount
        + (tokens_out as f64 / 1_000_000.0) * rate_out
}

static SEQ: AtomicU64 = AtomicU64::new(0);

pub(crate) fn new_id() -> String {
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let hex = format!("{:016x}{:04x}", now_ns(), seq);
    match std::env::var("LLM_AGENT_ID") {
        Ok(agent_id) if !agent_id.is_empty() => format!("urn:farmhand:{agent_id}:{hex}"),
        _ => hex,
    }
}

pub(crate) fn now_ns() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

/// Build a pi-agent URN id with canonical prefix and a fresh local id.
/// Example: new_pi_urn("prompt") => "urn:pi-agent:prompt-<id>"
pub(crate) fn new_pi_urn(kind: &str) -> String {
    format!("urn:pi-agent:{kind}-{}", new_id())
}
