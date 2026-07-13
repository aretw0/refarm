pub(crate) const ANTHROPIC_DEFAULT_MODEL: &str = "claude-sonnet-4-6";

pub(crate) fn choose_model(explicit_model: &str, default_model: &'static str) -> String {
    if explicit_model.is_empty() {
        default_model.to_owned()
    } else {
        explicit_model.to_owned()
    }
}

pub(crate) fn openai_compat_defaults(provider: &str) -> (&'static str, &'static str) {
    match provider {
        "openai" => ("https://api.openai.com", "gpt-5.5"),
        "openai-codex" => ("https://chatgpt.com", "gpt-5.5"),
        "groq" => ("https://api.groq.com", "llama-3.3-70b-versatile"),
        "mistral" => ("https://api.mistral.ai", "mistral-medium-3-5"),
        "xai" => ("https://api.x.ai", "grok-4.3"),
        "deepseek" => ("https://api.deepseek.com", "deepseek-v4-flash"),
        "together" => (
            "https://api.together.xyz",
            "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        ),
        "openrouter" => ("https://openrouter.ai", "anthropic/claude-sonnet-4.6"),
        "gemini" => (
            "https://generativelanguage.googleapis.com",
            "gemini-3-flash-preview",
        ),
        _ => ("http://localhost:11434", "llama3.2"),
    }
}

// ── ADR-012: capability map + routing profiles (agent-side) ──────────────────────
//
// ADR-012 (revised 2026-07-13) fixed the router's LOCUS in the agent, not the host.
// The fallback mechanics already existed (`try_fallback_completion` + the per-provider
// spend guard); what was missing was (1) a capability map to route BY, (2) named
// profiles that pick a route by capability+cost rather than an explicit id, and
// (3) an audit trail of the decision. This block is (1) and (2); the audit event is
// `agent:route:selected` in `agent_events.rs`. All PURE and native-testable, right
// beside the resolution they parameterize — the wasm route path just calls them.

/// A route's cost tier, cheapest first. Used to order candidates within a profile
/// and to expose "why this route" in the audit trail. `Local` is the keyless floor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CostTier {
    Local,
    Cheap,
    Mid,
    Premium,
}

impl CostTier {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            CostTier::Local => "local",
            CostTier::Cheap => "cheap",
            CostTier::Mid => "mid",
            CostTier::Premium => "premium",
        }
    }
}

/// The declared capabilities of a `(provider, model)` route — the metadata a profile
/// routes BY. Kept deliberately small: the axes the ADR named (tool-call, structured
/// JSON, a cost tier, a rough context window). Extend here as routing needs grow.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ModelCapabilities {
    pub tool_call: bool,
    pub structured_json: bool,
    pub cost_tier: CostTier,
    /// Rough max context window in tokens (0 = unknown/unbounded floor).
    pub context_window: u32,
}

/// The capability map: what a provider's DEFAULT model is known to support. Keyed by
/// provider (not model) to match `openai_compat_defaults` — a per-model map is a later
/// refinement once profiles need to pick among a provider's models. Unknown providers
/// fall to the conservative local floor (tool-call/JSON true so a local model is still
/// usable as a route, but tagged `Local` so cost-ordered profiles rank it last... or
/// first, for `cheap`). PURE.
pub(crate) fn provider_capabilities(provider: &str) -> ModelCapabilities {
    match provider {
        "anthropic" => ModelCapabilities {
            tool_call: true,
            structured_json: true,
            cost_tier: CostTier::Premium,
            context_window: 200_000,
        },
        "openai" | "openai-codex" => ModelCapabilities {
            tool_call: true,
            structured_json: true,
            cost_tier: CostTier::Premium,
            context_window: 128_000,
        },
        "openrouter" => ModelCapabilities {
            tool_call: true,
            structured_json: true,
            cost_tier: CostTier::Mid,
            context_window: 200_000,
        },
        "mistral" | "xai" => ModelCapabilities {
            tool_call: true,
            structured_json: true,
            cost_tier: CostTier::Mid,
            context_window: 128_000,
        },
        "groq" | "deepseek" | "together" => ModelCapabilities {
            tool_call: true,
            structured_json: true,
            cost_tier: CostTier::Cheap,
            context_window: 128_000,
        },
        "gemini" => ModelCapabilities {
            tool_call: true,
            structured_json: true,
            cost_tier: CostTier::Cheap,
            context_window: 1_000_000,
        },
        // ollama + any unknown provider: the keyless local floor.
        _ => ModelCapabilities {
            tool_call: true,
            structured_json: false,
            cost_tier: CostTier::Local,
            context_window: 8_192,
        },
    }
}

/// A named routing profile: the operator's INTENT ("give me the cheap route", "give me
/// the reliable one") independent of a specific provider id. Resolving a profile yields
/// an ORDERED candidate list of providers (best-first for that intent); the router
/// takes the first whose provider is configured/reachable. PURE.
///
/// - `cheap`    — minimize cost: local floor first, then the cheap-tier providers.
/// - `balanced` — good capability at moderate cost: mid tier, then cheap, then premium.
/// - `reliable` — maximize capability/robustness: premium first, then mid.
pub(crate) fn profile_candidates(profile: &str) -> Option<&'static [&'static str]> {
    match profile {
        "cheap" => Some(&["ollama", "groq", "deepseek", "gemini", "together"]),
        "balanced" => Some(&["openrouter", "mistral", "groq", "anthropic"]),
        "reliable" => Some(&["anthropic", "openai", "openrouter", "mistral"]),
        _ => None,
    }
}

/// Resolve a profile name to a chosen provider, given which providers are configured.
/// Walks the profile's best-first candidates and returns the first the operator has
/// actually configured, plus its capabilities for the audit trail. Returns `None` when
/// the profile is unknown OR no candidate is configured (caller then falls back to the
/// explicit/env resolution — the profile is a preference, never a hard requirement that
/// can strand a run). PURE — `is_configured` is injected so the config source stays out
/// of this logic and it is unit-testable.
pub(crate) fn resolve_profile(
    profile: &str,
    is_configured: impl Fn(&str) -> bool,
) -> Option<(String, ModelCapabilities)> {
    let candidates = profile_candidates(profile)?;
    candidates
        .iter()
        .find(|p| is_configured(p))
        .map(|p| ((*p).to_owned(), provider_capabilities(p)))
}

/// Parse the host-injected `MODEL_CONFIGURED_PROVIDERS` list into a set of provider
/// names. The guest CANNOT see the API keys themselves (they are secret-shaped and the
/// host's env-forward gate blocks them — see ADR-012 revision + the MODEL_SKILLS
/// gate lesson); instead the host injects a NON-secret comma/space-separated list of
/// which providers have a key configured. The keyless local floor (`ollama`) is always
/// implicitly present so a zero-config run can still resolve a profile. PURE.
pub(crate) fn configured_providers(list: &str) -> std::collections::BTreeSet<String> {
    let mut set: std::collections::BTreeSet<String> = list
        .split([',', ' ', '\t', '\n'])
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_ascii_lowercase())
        .collect();
    set.insert("ollama".to_owned()); // keyless local floor is always a valid route
    set
}
