pub(crate) const ANTHROPIC_DEFAULT_MODEL: &str = "claude-sonnet-5";

pub(crate) fn choose_model(explicit_model: &str, default_model: &'static str) -> String {
    if explicit_model.is_empty() {
        default_model.to_owned()
    } else {
        explicit_model.to_owned()
    }
}

pub(crate) fn openai_compat_defaults(provider: &str) -> (&'static str, &'static str) {
    match provider {
        "openai" => ("https://api.openai.com", "gpt-5.6-sol"),
        // Still gpt-5.5, and deliberately so. This route does not talk to api.openai.com; it
        // talks to the ChatGPT backend, whose model list is behind an account and cannot be
        // read from any public page. gpt-5.6-sol is verified to exist on the API — that says
        // nothing about what THIS endpoint serves, and swapping in an id this backend may not
        // accept would break a working route to fix a suspected one. The API's own gpt-5.5 is
        // gone (2026-08-04), so this id is probably stale here too; confirming it needs a live
        // call from an account that has the entitlement, which is the operator's to make.
        "openai-codex" => ("https://chatgpt.com", "gpt-5.5"),
        "groq" => ("https://api.groq.com", "llama-3.3-70b-versatile"),
        "mistral" => ("https://api.mistral.ai", "mistral-medium-3-5"),
        "xai" => ("https://api.x.ai", "grok-4.3"),
        "deepseek" => ("https://api.deepseek.com", "deepseek-v4-flash"),
        "together" => (
            "https://api.together.xyz",
            "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        ),
        "openrouter" => ("https://openrouter.ai", "anthropic/claude-sonnet-5"),
        "gemini" => (
            "https://generativelanguage.googleapis.com",
            "gemini-3-flash-preview",
        ),
        // GitHub Copilot speaks the OpenAI chat shape, and its BASE URL IS PER-ACCOUNT: the token
        // exchange announces where that seat talks (`api.business.` for a business seat,
        // `api.individual.` for a personal one — measured on two real accounts 2026-08-17). The
        // value here is only the last resort; the real endpoint arrives in MODEL_PROVIDER_BASE_URLS.
        "github-copilot" => ("https://api.githubcopilot.com", "gpt-4o"),
        _ => ("http://localhost:11434", "llama3.2"),
    }
}

/// PURE. One provider's endpoint from a `MODEL_PROVIDER_BASE_URLS` value.
///
/// THE HOST PARSES THE SAME STRING WITH THE SAME RULE (`parse_provider_base_url` in the tractor
/// bridge), and that lockstep is the point: the host validates every request against its own
/// resolution of this map, so a guest that read it differently would build a request the host
/// refuses. A pair either side cannot read is DROPPED rather than guessed, which leaves only two
/// outcomes — both agree, or both fall back to the static default above.
///
/// Format: `provider=url` pairs joined by `,`, no whitespace, ASCII.
pub(crate) fn provider_base_url_from(raw: &str, provider: &str) -> Option<String> {
    let wanted = provider.trim().to_ascii_lowercase();
    for pair in raw.split(',') {
        let Some((name, url)) = pair.split_once('=') else {
            continue;
        };
        if name.trim().to_ascii_lowercase() != wanted {
            continue;
        }
        let url = url.trim();
        if url.is_empty() || (!url.starts_with("http://") && !url.starts_with("https://")) {
            return None;
        }
        if !url.is_ascii() || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return None;
        }
        return Some(url.to_string());
    }
    None
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
/// routes BY. Kept deliberately small: the axes the ADR named that a ROUTER actually
/// decides on (tool-call, structured JSON, a cost tier). Per-model facts about the
/// vendor's product — window sizes, prices — belong in the model catalog, where the
/// schema makes them carry a source and a date; see `provider_capabilities` below.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ModelCapabilities {
    pub tool_call: bool,
    pub structured_json: bool,
    pub cost_tier: CostTier,
}

/// The capability map: what a provider's DEFAULT model is known to support. Keyed by
/// provider (not model) to match `openai_compat_defaults` — a per-model map is a later
/// refinement once profiles need to pick among a provider's models. Unknown providers
/// fall to the conservative local floor (tool-call/JSON true so a local model is still
/// usable as a route, but tagged `Local` so cost-ordered profiles rank it last... or
/// first, for `cheap`). PURE.
///
/// `context_window` USED TO LIVE HERE and was removed on 2026-08-04. It is recorded rather than
/// silently dropped, because the reason generalises to anything else that might be added here.
///
/// It had no vendor citation, and the reason it had none was structural, not sloppy: five
/// providers with five different default models shared two match arms and two numbers, so the
/// figures were assigned by COST TIER, never looked up per model. Checking them against the
/// vendors confirmed it — Sonnet 4.6 is 1M, not the 200_000 recorded; grok-4.3 is 1M and
/// deepseek-v4-flash is 1M, not 128_000; llama-3.3-70b-versatile is 131_072, not 128_000. Every
/// verifiable figure was wrong, all in the same direction: the round numbers of an earlier era,
/// frozen while the market moved.
///
/// Nothing ever read the field — `tool_call` and `structured_json` are read by
/// `profile_requirement`, `cost_tier` by profile ordering, and `context_window` by nobody — which
/// is exactly why it could rot undisturbed. A wrong number nobody reads is worse than no number:
/// it is correct-looking until the day something reads it.
///
/// Its home is `packages/model-catalog-v1`, whose schema REQUIRES a source and a verification
/// date per fact (`contextWindow: { tokens, sourceUrl, verifiedAt }`) and where the verified
/// windows now live. Where a figure is missing, the catalog records WHY — `not-published` (the
/// vendor's page was read and states none) or `source-not-found` (the page was never reached, so
/// nothing is known about the vendor either way). Wiring this crate to read that catalog is real,
/// unstarted work; until it happens, a routing decision that needs a context window must go and
/// get it from there, not from a constant here.
pub(crate) fn provider_capabilities(provider: &str) -> ModelCapabilities {
    match provider {
        "anthropic" => ModelCapabilities {
            tool_call: true,
            structured_json: true,
            cost_tier: CostTier::Premium,
        },
        "openai" | "openai-codex" => ModelCapabilities {
            tool_call: true,
            structured_json: true,
            cost_tier: CostTier::Premium,
        },
        "openrouter" => ModelCapabilities {
            tool_call: true,
            structured_json: true,
            cost_tier: CostTier::Mid,
        },
        "mistral" | "xai" => ModelCapabilities {
            tool_call: true,
            structured_json: true,
            cost_tier: CostTier::Mid,
        },
        "groq" | "deepseek" | "together" => ModelCapabilities {
            tool_call: true,
            structured_json: true,
            cost_tier: CostTier::Cheap,
        },
        "gemini" => ModelCapabilities {
            tool_call: true,
            structured_json: true,
            cost_tier: CostTier::Cheap,
        },
        // ollama + any unknown provider: the keyless local floor.
        _ => ModelCapabilities {
            tool_call: true,
            structured_json: false,
            cost_tier: CostTier::Local,
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

/// The CAPABILITY requirement a profile imposes on a candidate, beyond cost/order. This
/// is where the capability map earns its keep: a profile does not just prefer a tier, it
/// REQUIRES the route actually support what that intent needs. Returns `true` if `caps`
/// satisfy the profile. Unknown profiles impose nothing (caller already guards). PURE.
///
/// - `cheap`    — no capability floor: cost dominates, the keyless local model is fine
///   even without reliable structured JSON.
/// - `balanced` — must support tool-calling (an agent turn calls tools).
/// - `reliable` — must support tool-calling AND structured JSON (robustness intent).
pub(crate) fn profile_capability_requirement(profile: &str, caps: &ModelCapabilities) -> bool {
    match profile {
        "cheap" => true,
        "balanced" => caps.tool_call,
        "reliable" => caps.tool_call && caps.structured_json,
        _ => true,
    }
}

/// Resolve a profile name to a chosen provider, given which providers are configured.
/// Walks the profile's best-first candidates and returns the first that is BOTH
/// configured AND satisfies the profile's capability requirement (via the capability
/// map), plus its capabilities for the audit trail. Returns `None` when the profile is
/// unknown OR no candidate qualifies (caller then falls back to the explicit/env
/// resolution — the profile is a preference, never a hard requirement that can strand a
/// run). PURE — `is_configured` is injected so the config source stays out of this logic
/// and it is unit-testable.
pub(crate) fn resolve_profile(
    profile: &str,
    is_configured: impl Fn(&str) -> bool,
) -> Option<(String, ModelCapabilities)> {
    let candidates = profile_candidates(profile)?;
    candidates
        .iter()
        .map(|p| (*p, provider_capabilities(p)))
        .find(|(p, caps)| is_configured(p) && profile_capability_requirement(profile, caps))
        .map(|(p, caps)| (p.to_owned(), caps))
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

#[cfg(test)]
mod provider_base_url_tests {
    use super::provider_base_url_from;

    /// ISS-141. The guest and the tractor host parse the SAME string with the SAME rule, and this
    /// is the guest half of that lockstep. The host validates every request against its own
    /// resolution of this map, so any divergence here builds requests the host refuses.
    #[test]
    fn reads_one_providers_endpoint() {
        let raw =
            "github-copilot=https://api.business.githubcopilot.com,openai-codex=https://chatgpt.com";
        assert_eq!(
            provider_base_url_from(raw, "github-copilot").as_deref(),
            Some("https://api.business.githubcopilot.com")
        );
        assert_eq!(
            provider_base_url_from(raw, "openai-codex").as_deref(),
            Some("https://chatgpt.com")
        );
        assert!(provider_base_url_from(raw, "groq").is_none());
        assert!(provider_base_url_from("", "github-copilot").is_none());
    }

    #[test]
    fn drops_what_it_cannot_read_rather_than_guessing() {
        assert!(provider_base_url_from("github-copilot=ftp://x.example", "github-copilot").is_none());
        assert!(provider_base_url_from("github-copilot=", "github-copilot").is_none());
        assert!(provider_base_url_from("no-equals-sign", "github-copilot").is_none());
    }

    #[test]
    fn copilot_has_a_default_that_is_not_the_ollama_floor() {
        // The whole failure this closes: a dispatch routed to github-copilot resolved to
        // http://localhost:11434 and reported "Model provider unavailable: ollama" for a request
        // nobody made to ollama.
        let (base, model) = super::openai_compat_defaults("github-copilot");
        assert!(base.contains("githubcopilot.com"), "got {base}");
        assert_ne!(model, "llama3.2");
    }
}
