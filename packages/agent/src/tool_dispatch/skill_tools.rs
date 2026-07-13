//! `load_skill` — the second half of progressive disclosure (the skill leg,
//! ADR-086 + the skill-runtime-activation spec).
//!
//! The system prompt already lists installed skills CHEAPLY (name + description,
//! packed by the host into `MODEL_SKILLS` — `runtime::policy::skill_prompts_section`).
//! What was missing is the second jump: once the model decides a skill matches, it
//! must be able to LOAD that skill's full SKILL.md instructions on demand. This tool
//! is that jump.
//!
//! The full bodies ride a SEPARATE env, `MODEL_SKILL_BODIES` — a JSON object mapping
//! skill name → its SKILL.md instructions — packed by the host alongside the index.
//! Keeping it out of `MODEL_SKILLS` preserves the cheap index (the model pays body
//! tokens only when it calls this tool). The resolution logic lives in
//! `runtime::policy::resolve_skill_body` (pure, native-tested, beside the skill index
//! it complements); this wasm-side wrapper only reads the env.

/// The `load_skill` tool: read the skill body map from `MODEL_SKILL_BODIES` and
/// resolve `input.name` via the pure `resolve_skill_body`. The env read is the only
/// impurity.
pub(crate) fn load_skill(input: &serde_json::Value) -> String {
    let name = input["name"].as_str().unwrap_or("");
    let bodies = std::env::var("MODEL_SKILL_BODIES").unwrap_or_default();
    crate::runtime::resolve_skill_body(&bodies, name)
}
