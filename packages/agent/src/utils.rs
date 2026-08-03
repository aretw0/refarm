use std::sync::atomic::{AtomicU64, Ordering};

/// FNV-1a 64-bit hash — no external dep, O(n) in input size.
/// Used for cross-call exact deduplication within a single agentic turn.
pub(crate) fn fnv1a_hash(s: &str) -> u64 {
    const BASIS: u64 = 14695981039346656037;
    const PRIME: u64 = 1099511628211;
    s.bytes()
        .fold(BASIS, |h, b| h.wrapping_mul(PRIME) ^ b as u64)
}

pub(crate) fn pricing_mode_for_provider(provider: &str) -> &'static str {
    match provider.trim().to_ascii_lowercase().as_str() {
        "openai-codex" | "github-copilot" => "subscription",
        "ollama" => "local",
        _ => "api",
    }
}

/// Anthropic bills a 5-minute cache write at 1.25x base input and a 1-hour write
/// at 2x. The usage payload does not say which TTL was used, so this is the
/// documented FLOOR: a 1-hour write is under-counted, never over-counted.
const CACHE_WRITE_MULTIPLIER: f64 = 1.25;
/// Cache reads bill at 10% of base input on both providers.
const CACHE_READ_MULTIPLIER: f64 = 0.1;

/// How a provider reports input tokens relative to its cache buckets.
pub(crate) enum InputAccounting {
    /// `input_tokens` EXCLUDES the cache buckets; total input is the sum of all
    /// three. (Anthropic)
    Disjoint,
    /// `prompt_tokens` INCLUDES cache reads; subtract them to get full-rate
    /// input. (OpenAI and every openai-compatible provider)
    Subset,
}

pub(crate) fn input_accounting_for_provider(provider: &str) -> InputAccounting {
    match provider.trim().to_ascii_lowercase().as_str() {
        "anthropic" => InputAccounting::Disjoint,
        _ => InputAccounting::Subset,
    }
}

pub(crate) fn estimate_billable_usd(
    provider: &str,
    model: &str,
    tokens_in: u32,
    tokens_out: u32,
    cache_read: u32,
    cache_creation: u32,
) -> f64 {
    if pricing_mode_for_provider(provider) != "api" {
        return 0.0;
    }
    estimate_usd(provider, model, tokens_in, tokens_out, cache_read, cache_creation)
}

/// Rate table identity. This is the FIRST version of the table: every rate
/// below is one that shipped in `estimate_usd` before this table was named, not
/// a provisional number — no placeholder rates are carried here (see
/// `rate_for_model`: an unpriced model resolves to `Unknown`, never a guess).
/// Bump this string whenever a rate changes or a branch is added — the first
/// bump will be a real one, carrying a price someone confirmed. Task 10 stamps
/// the current value onto every cost observation; Task 11 uses it to tell which
/// historical records predate a correction.
pub(crate) const RATE_TABLE_VERSION: &str = "2026-08-03.1";

/// Model ids known to run locally at zero cost, matched as substrings of the
/// MODEL id — not the provider. `pricing_mode_for_provider` already owns the
/// provider axis (subscription/local/api); duplicating that here would give one
/// decision two sources of truth. This list exists only to tell a genuinely free
/// model apart from one this table has simply never priced.
const KNOWN_FREE_MODEL_SUBSTRINGS: &[&str] =
    &["llama", "mistral", "qwen", "gemma", "phi", "deepseek-r1"];

/// The outcome of looking up a per-token rate for a model id.
pub(crate) enum RateLookup {
    /// A rate is on file: dollars per million input/output tokens.
    Priced { rate_in: f64, rate_out: f64 },
    /// Matched the known-free list (ollama and friends) — genuinely $0 to run.
    Free,
    /// No rate on file and not on the known-free list either. Distinct from
    /// `Free` so a model nobody has priced yet can be reported instead of
    /// silently costing nothing — see `estimate_usd`.
    Unknown,
}

/// Look up the per-million-token rate for a model id by substring match.
/// Order matters within a family: a more specific id ("gpt-5.5") is tested
/// before its family prefix ("gpt-5"), or a point release would silently
/// inherit the family's rate while looking perfectly plausible.
pub(crate) fn rate_for_model(model: &str) -> RateLookup {
    let (rate_in, rate_out): (f64, f64) = if model.contains("claude-opus-4") {
        (15.0, 75.0)
    } else if model.contains("claude-sonnet-4") || model.contains("claude-sonnet-3-7") {
        (3.0, 15.0)
    } else if model.contains("claude-haiku") {
        (0.8, 4.0)
    } else if model.contains("gpt-5.5") {
        (5.0, 30.0)
    } else if model.contains("gpt-5-mini") || model.contains("gpt-5.1-codex-mini") {
        (0.25, 2.0)
    } else if model.contains("gpt-5-nano") {
        (0.05, 0.4)
    } else if model.contains("gpt-5") {
        (1.25, 10.0)
    } else if model.contains("gpt-4o") && !model.contains("mini") {
        (2.5, 10.0)
    } else if model.contains("gpt-4o-mini") {
        (0.15, 0.6)
    } else if KNOWN_FREE_MODEL_SUBSTRINGS
        .iter()
        .any(|needle| model.contains(needle))
    {
        return RateLookup::Free;
    } else {
        return RateLookup::Unknown;
    };

    RateLookup::Priced { rate_in, rate_out }
}

/// Estimate API cost in USD using public per-million-token rates.
///
/// `rate_for_model` answers `Priced`, `Free` or `Unknown`; both `Free` (a known
/// local model, e.g. ollama-served llama/mistral/...) and `Unknown` (no rate on
/// file) still estimate $0.00 here today — that value has not changed, only its
/// recoverability has: an `Unknown` model now names itself once so it can be
/// priced instead of costing nothing in silence forever.
pub(crate) fn estimate_usd(
    provider: &str,
    model: &str,
    tokens_in: u32,
    tokens_out: u32,
    cache_read: u32,
    cache_creation: u32,
) -> f64 {
    let (rate_in, rate_out) = match rate_for_model(model) {
        RateLookup::Priced { rate_in, rate_out } => (rate_in, rate_out),
        RateLookup::Free => return 0.0,
        RateLookup::Unknown => {
            // This crate has no `tracing` dependency (not in Cargo.toml/Cargo.lock)
            // and no existing logging convention in this module, so this warns via
            // `eprintln!` instead: std-only, no new dependency, and it works under
            // both native `cargo test` and the wasm32-wasip1 target (WASI exposes
            // stderr) — unlike a wasm-only host telemetry bridge call.
            eprintln!(
                "cost estimator: no rate on file for model \"{model}\" — estimating $0.00, not free"
            );
            return 0.0;
        }
    };

    // The full-rate share depends on whether the provider counts cache reads
    // inside tokens_in or beside it. Getting this backwards is the F5 defect.
    let full_rate_input = match input_accounting_for_provider(provider) {
        InputAccounting::Disjoint => tokens_in as f64,
        InputAccounting::Subset => tokens_in.saturating_sub(cache_read) as f64,
    };

    (full_rate_input / 1_000_000.0) * rate_in
        + (cache_read as f64 / 1_000_000.0) * rate_in * CACHE_READ_MULTIPLIER
        + (cache_creation as f64 / 1_000_000.0) * rate_in * CACHE_WRITE_MULTIPLIER
        + (tokens_out as f64 / 1_000_000.0) * rate_out
}

static SEQ: AtomicU64 = AtomicU64::new(0);

pub(crate) fn new_id() -> String {
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    let hex = format!("{:016x}{:04x}", now_ns(), seq);
    match std::env::var("MODEL_AGENT_ID") {
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

/// Build an agent URN id with canonical prefix and a fresh local id.
/// Example: mint_urn("prompt") => "urn:sovereign:prompt-<id>"
pub(crate) fn mint_urn(kind: &str) -> String {
    format!("urn:sovereign:{kind}-{}", new_id())
}
