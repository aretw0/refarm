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

/// Whether `estimate_billable_usd`'s `0.0` (when it IS zero) means "genuinely
/// free/not billed" or "could not find a rate" — F5, whole-branch review.
/// `RateLookup::Unknown` still estimates $0.00 (unchanged; see `estimate_usd`'s
/// own doc), and that $0.00 was indistinguishable on the record from a cheap
/// run. `false` in EXACTLY the case `RateLookup::Unknown` fires: `api` pricing
/// mode with no rate on file for `model`. `subscription`/`local` pricing modes
/// report `true` — their zero is a deliberate STRUCTURAL fact (`estimate_
/// billable_usd` short-circuits before `rate_for_model` ever runs), never
/// "could not price," so it must never be confused with the api-mode Unknown
/// case this field exists to name.
pub(crate) fn price_is_known(provider: &str, model: &str) -> bool {
    if pricing_mode_for_provider(provider) != "api" {
        return true;
    }
    matches!(rate_for_model(model), RateLookup::Priced { .. })
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
pub(crate) const RATE_TABLE_VERSION: &str = "2026-08-04.1";

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
        // Anthropic, official pricing (verified 2026-08-03):
        // https://platform.claude.com/docs/en/about-claude/pricing
        // Each of the four is its OWN row on the page, not one row extrapolated
        // to the rest — checked twice, individually, to be sure: Opus 4.5, 4.6,
        // 4.7 and 4.8 each list Base Input $5/MTok and Output $25/MTok, and the
        // grouping only happened because all four independently verify to that
        // same number, not the other way around.
        //
        // Checked BEFORE the bare "claude-opus-4" branch below: that literal is a
        // substring of every id here too, and this generation prices at 1/3 of
        // Opus 4/4.1's rate — matching the bare branch first would silently
        // overcharge by 3x while looking perfectly plausible (the same order-
        // dependence this function's own doc comment already warns about, and a
        // real collision, not a hypothetical one: verifying this table is what
        // surfaced it).
        (5.0, 25.0)
    } else if model.contains("claude-opus-4") {
        // Anthropic, official pricing (verified 2026-08-03):
        // https://platform.claude.com/docs/en/about-claude/pricing
        // Covers exactly "claude-opus-4" (bare, Opus 4, retired except Google
        // Cloud) and "claude-opus-4-1" (Opus 4.1, deprecated) — both individually
        // listed at Base Input $15/MTok, Output $75/MTok. Any FUTURE opus-4.x
        // point release not already carved out above would also match this bare
        // prefix; that is the file's known, general substring-matching limitation
        // (see this function's own doc comment on ordering), not something this
        // task's verification pass can close for ids that don't exist yet.
        (15.0, 75.0)
    } else if model.contains("claude-sonnet-4") {
        // Anthropic, official pricing (verified 2026-08-03):
        // https://platform.claude.com/docs/en/about-claude/pricing
        // Sonnet 4, 4.5 and 4.6 are each their own row and each independently
        // verify to Base Input $3/MTok, Output $15/MTok — no split needed here,
        // unlike Opus above. "claude-sonnet-3-7" USED to be grouped into this
        // same branch (pre-dating this task); it is not on the current pricing
        // page at all (fully retired, unlisted) and its rate could not be
        // re-verified, so per this table's own rule — only verified rates ship —
        // it was dropped from this branch and now resolves `Unknown` instead of
        // silently inheriting the 4/4.5/4.6 rate on an unverified assumption.
        (3.0, 15.0)
    } else if model.contains("claude-haiku-4-5") {
        // Anthropic, official pricing (verified 2026-08-03):
        // https://platform.claude.com/docs/en/about-claude/pricing
        // Base Input $1/MTok, Output $5/MTok — its own row on the page.
        // Checked BEFORE the bare "claude-haiku" branch below, same reason as
        // Opus above: Haiku 4.5 is priced differently from the 3.5 generation
        // that branch actually covers, and "claude-haiku" is a substring of
        // "claude-haiku-4-5" too.
        (1.0, 5.0)
    } else if model.contains("claude-haiku") {
        // Anthropic, official pricing (verified 2026-08-03):
        // https://platform.claude.com/docs/en/about-claude/pricing
        // Covers "claude-haiku-3-5" (Haiku 3.5, retired except Bedrock/Google
        // Cloud) and bare "claude-haiku" — Base Input $0.80/MTok, Output
        // $4/MTok, its own row on the page. This is the rate this task corrected
        // FROM being applied to Haiku 4.5 as well; Haiku 4.5 now has its own
        // branch above.
        (0.8, 4.0)
    } else if model.contains("grok-4.3") {
        // xAI, official pricing (verified 2026-08-04): https://docs.x.ai/docs/models
        // The page lists two prompt-size tiers for this SAME model id. This
        // table carries one input/output pair, so it uses the <200k prompt tier
        // values; long-context requests are billed higher on xAI.
        (1.25, 2.5)
    } else if model.contains("deepseek-v4-flash") {
        // DeepSeek, official pricing (verified 2026-08-04): https://api-docs.deepseek.com/quick_start/pricing
        // Input here uses the listed cache-miss input rate; cache-hit pricing is
        // provider-specific and lower than this table's generic cache discount.
        (0.14, 0.28)
    } else if model.contains("gemini-3-flash-preview") {
        // Google Gemini API, official pricing (verified 2026-08-04): https://ai.google.dev/gemini-api/docs/pricing
        // This model has modality-specific input pricing on the same row; this
        // branch uses the text/image/video input price.
        (0.5, 3.0)
    } else if model.contains("llama-3.3-70b-versatile") {
        // Groq, official pricing (verified 2026-08-04): https://groq.com/pricing
        (0.59, 0.79)
    } else if model.contains("mistral-medium-3-5") {
        // Mistral, official pricing (verified 2026-08-04): https://mistral.ai/pricing/api
        // Pricing card lists Mistral Medium 3.5 with input/output per million
        // tokens; API aliases point to this model generation.
        (1.5, 7.5)
    } else if model.contains("gpt-5.5") {
        // OpenAI, official pricing (verified 2026-08-03): http
40   setup.replace(/^Set up credentials:/, "Run") + " when ready.",s://developers.openai.com/api/docs/pricing
        (5.0, 30.0)
    } else if model.contains("gpt-5-mini") {
        // OpenAI, official pricing (verified 2026-08-03): https://developers.openai.com/api/docs/pricing
        // "gpt-5.1-codex-mini" USED to be grouped into this branch (pre-dating
        // this task); it is not listed on the page as its own line item and its
        // rate could not be independently verified, so — same rule as
        // claude-sonnet-3-7 above — it was dropped and now resolves `Unknown`
        // rather than silently inheriting gpt-5-mini's verified rate on an
        // unverified assumption.
        (0.25, 2.0)
    } else if model.contains("gpt-5-nano") {
        // OpenAI, official pricing (verified 2026-08-03): https://developers.openai.com/api/docs/pricing
        (0.05, 0.4)
    } else if model.contains("gpt-5") && !model.contains("gpt-5.1-codex-mini") {
        // OpenAI, official pricing (verified 2026-08-03): https://developers.openai.com/api/docs/pricing
        // "gpt-5.1-codex-mini" is explicitly excluded here too — dropping it
        // from the gpt-5-mini branch above (unverified rate) is worthless if it
        // just falls through and silently inherits THIS family rate instead;
        // either way is a confident lie about a number nobody checked. Only
        // Unknown is honest for an id nobody has verified.
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
