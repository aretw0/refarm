use crate::provider::CompletionResult;

pub(crate) fn complete(
    model: &str,
    system: &str,
    messages: &[(String, String)],
) -> Result<CompletionResult, String> {
    crate::provider_runtime::run_anthropic_completion_loop(model, system, messages)
}
