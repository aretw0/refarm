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
/// below is one that shipped in `estimate_usd` before this table was named, or
/// was corrected while v1 was still being assembled, against a source cited
/// inline — no placeholder rates are carried here (see `rate_for_model`: an
/// unpriced model resolves to `Unknown`, never a guess). "First version" means
/// assembled and checked against the vendor sources below as they stood on
/// 2026-08-03; it is not a claim that nothing here will ever need correcting.
/// Bump this string whenever a rate changes or a branch is added AFTER this
/// version ships — the first bump will be a real one, carrying a price someone
/// confirmed after the fact. Task 10 stamps the current value onto every cost
/// observation; Task 11 uses it to tell which historical records predate a
/// correction. Correcting a rate before anything has been stamped is free;
/// correcting it after is a version bump that marks every prior observation as
/// stale — which is why verification happens now, not as follow-up.
///
/// Sources: every priced branch in `rate_for_model` below cites the vendor's
/// own OFFICIAL pricing page inline — never a third-party aggregator, which is
/// convenient but not authoritative; an unverified number presented as fact is
/// the exact failure this table exists to prevent.
///
/// One MACHINE-READABLE source is also on record: `https://openrouter.ai/api/
/// v1/models` returns per-model prompt/completion pricing as JSON across many
/// providers, and a future task can poll it as a DRIFT DETECTOR against the
/// rates below. It is not itself a source of truth for anything but
/// OpenRouter's own resale prices — it can legitimately disagree with a
/// vendor's first-party rate and be right about OpenRouter's markup, so it
/// verifies "did our number move", never "is our number correct".
pub(crate) const RATE_TABLE_VERSION: &str = "2026-08-03.1";

/// The outcome of looking up a per-token rate for a model id.
pub(crate) enum RateLookup {
    /// A rate is on file: dollars per million input/output tokens.
    Priced { rate_in: f64, rate_out: f64 },
    /// No rate on file. This used to also mean "known-free" for a model whose
    /// NAME matched a locally-run family (llama/mistral/...) — that concept
    /// was deleted. Whether a model is free depends on WHO SERVES IT, not what
    /// it is called: Groq and Together SELL the exact Llama ids that Ollama
    /// runs for free, and `pricing_mode_for_provider` already answers that,
    /// earlier, on the provider axis — `estimate_billable_usd` short-circuits
    /// `local` and `subscription` providers to $0.00 before this lookup ever
    /// runs, so nothing genuinely free reaches `rate_for_model` at all.
    /// Anything that does reach it is being sold by an `api`-mode provider;
    /// without a rate it is simply unpriced.
    Unknown,
}

/// Look up the per-million-token rate for a model id by substring match.
/// Order matters within a family: a more specific id ("gpt-5.5") is tested
/// before its family prefix ("gpt-5"), or a point release would silently
/// inherit the family's rate while looking perfectly plausible.
pub(crate) fn rate_for_model(model: &str) -> RateLookup {
    let (rate_in, rate_out): (f64, f64) = if model.contains("claude-opus-4-5")
        || model.contains("claude-opus-4-6")
        || model.contains("claude-opus-4-7")
        || model.contains("claude-opus-4-8")
    {
        // Anthropic, Opus 4.5/4.6/4.7/4.8, official pricing (verified 2026-08-03):
        // https://platform.claude.com/docs/en/about-claude/pricing
        // Checked BEFORE the bare "claude-opus-4" branch below: that literal is a
        // substring of every id here too, and Opus 4.5-4.8 price at 1/3 of Opus
        // 4/4.1's rate — matching the bare branch first would silently overcharge
        // by 3x while looking perfectly plausible (the same order-dependence this
        // function's own doc comment already warns about, and a real collision,
        // not a hypothetical one: verifying this table is what surfaced it).
        (5.0, 25.0)
    } else if model.contains("claude-opus-4") {
        // Anthropic, Opus 4 (retired except Google Cloud) / Opus 4.1 (deprecated),
        // official pricing (verified 2026-08-03):
        // https://platform.claude.com/docs/en/about-claude/pricing
        (15.0, 75.0)
    } else if model.contains("claude-sonnet-4") || model.contains("claude-sonnet-3-7") {
        // Anthropic, Sonnet 4 / 4.5 / 4.6 (all three share this rate on the
        // official page — no split needed, unlike Opus above), official pricing
        // (verified 2026-08-03): https://platform.claude.com/docs/en/about-claude/pricing
        // claude-sonnet-3-7 predates the current pricing page (fully retired, not
        // listed) and could not be re-verified; left unchanged.
        (3.0, 15.0)
    } else if model.contains("claude-haiku-4-5") {
        // Anthropic, Haiku 4.5, official pricing (verified 2026-08-03):
        // https://platform.claude.com/docs/en/about-claude/pricing
        // Checked BEFORE the bare "claude-haiku" branch below, same reason as
        // Opus above: Haiku 4.5 is priced differently from the 3.5 generation
        // that branch actually covers, and "claude-haiku" is a substring of
        // "claude-haiku-4-5" too.
        (1.0, 5.0)
    } else if model.contains("claude-haiku") {
        // Anthropic, Haiku 3.5 (retired except Bedrock/Google Cloud), official
        // pricing (verified 2026-08-03 — this is the rate this task corrected FROM
        // being applied to Haiku 4.5 as well; Haiku 4.5 now has its own branch
        // above): https://platform.claude.com/docs/en/about-claude/pricing
        (0.8, 4.0)
    } else if model.contains("gpt-5.5") {
        // OpenAI, official pricing (verified 2026-08-03): https://developers.openai.com/api/docs/pricing
        (5.0, 30.0)
    } else if model.contains("gpt-5-mini") || model.contains("gpt-5.1-codex-mini") {
        // OpenAI, official pricing (verified 2026-08-03 for gpt-5-mini; gpt-5.1-codex-mini
        // is not listed on the page as its own line item and could not be independently
        // re-verified, so it stays grouped with gpt-5-mini's rate, unchanged):
        // https://developers.openai.com/api/docs/pricing
        (0.25, 2.0)
    } else if model.contains("gpt-5-nano") {
        // OpenAI, official pricing (verified 2026-08-03): https://developers.openai.com/api/docs/pricing
        (0.05, 0.4)
    } else if model.contains("gpt-5") {
        // OpenAI, official pricing (verified 2026-08-03): https://developers.openai.com/api/docs/pricing
        (1.25, 10.0)
    } else if model.contains("gpt-4o") && !model.contains("mini") {
        // OpenAI, official pricing (verified 2026-08-03): https://developers.openai.com/api/docs/pricing
        (2.5, 10.0)
    } else if model.contains("gpt-4o-mini") {
        // OpenAI, official pricing (verified 2026-08-03): https://developers.openai.com/api/docs/pricing
        (0.15, 0.6)
    } else {
        return RateLookup::Unknown;
    };

    RateLookup::Priced { rate_in, rate_out }
}

/// Estimate API cost in USD using public per-million-token rates, each cited
/// at its source in `rate_for_model`.
///
/// `rate_for_model` answers `Priced` or `Unknown`; an `Unknown` model (no rate
/// on file — see `RateLookup::Unknown` for why there is no third "Free"
/// answer) still estimates $0.00 here today — that value has not changed,
/// only its recoverability has: it now names itself once so it can be priced
/// instead of costing nothing in silence forever.
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
