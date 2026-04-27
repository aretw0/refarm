pub(crate) fn tool_loop_max_iter() -> u32 {
    std::env::var("LLM_TOOL_CALL_MAX_ITER")
        .ok()
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(5)
}

pub(crate) fn anthropic_headers() -> Vec<(String, String)> {
    vec![
        ("content-type".to_string(), "application/json".to_string()),
        ("anthropic-version".to_string(), "2023-06-01".to_string()),
    ]
}

pub(crate) fn openai_compat_headers() -> Vec<(String, String)> {
    vec![("content-type".to_string(), "application/json".to_string())]
}

pub(crate) fn openai_compat_path(provider: &str) -> &'static str {
    match provider {
        "groq" => "/openai/v1/chat/completions",
        "openrouter" => "/api/v1/chat/completions",
        "gemini" => "/v1beta/openai/chat/completions",
        _ => "/v1/chat/completions",
    }
}

pub(crate) fn build_anthropic_body(
    model: &str,
    system: &str,
    wire_msgs: &[serde_json::Value],
    tools: serde_json::Value,
) -> String {
    serde_json::json!({
        "model": model,
        "max_tokens": 1024,
        "system": system,
        "tools": tools,
        "messages": wire_msgs,
    })
    .to_string()
}

pub(crate) fn build_openai_body(
    model: &str,
    wire_msgs: &[serde_json::Value],
    tools: serde_json::Value,
) -> String {
    serde_json::json!({
        "model": model,
        "max_tokens": 1024,
        "tools": tools,
        "messages": wire_msgs,
    })
    .to_string()
}

pub(crate) fn parse_response_json(bytes: &[u8]) -> Result<serde_json::Value, String> {
    serde_json::from_slice(bytes).map_err(|e| format!("parse: {e}"))
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn execute_json_request(
    provider: &str,
    base_url: &str,
    path: &str,
    headers: &[(String, String)],
    body: &str,
) -> Result<serde_json::Value, String> {
    let bytes = crate::provider::http_post_via_host(
        provider,
        base_url,
        path,
        headers,
        body.as_bytes(),
    )?;
    parse_response_json(&bytes)
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn anthropic_iteration_response(
    model: &str,
    system: &str,
    wire_msgs: &[serde_json::Value],
    headers: &[(String, String)],
) -> Result<serde_json::Value, String> {
    let body = build_anthropic_body(model, system, wire_msgs, crate::tools_anthropic());
    execute_json_request(
        "anthropic",
        "https://api.anthropic.com",
        "/v1/messages",
        headers,
        &body,
    )
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn anthropic_iteration_response_and_phase(
    model: &str,
    system: &str,
    wire_msgs: &[serde_json::Value],
    headers: &[(String, String)],
    usage_totals: &mut UsageTotals,
) -> Result<(serde_json::Value, AnthropicIterationPhase), String> {
    let response = anthropic_iteration_response(model, system, wire_msgs, headers)?;
    let phase = anthropic_phase_after_usage(usage_totals, &response);
    Ok((response, phase))
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn openai_iteration_response(
    provider: &str,
    base_url: &str,
    model: &str,
    wire_msgs: &[serde_json::Value],
    headers: &[(String, String)],
) -> Result<serde_json::Value, String> {
    let body = build_openai_body(model, wire_msgs, crate::tools_openai());
    execute_json_request(
        provider,
        base_url,
        openai_compat_path(provider),
        headers,
        &body,
    )
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn openai_iteration_response_and_phase(
    provider: &str,
    base_url: &str,
    model: &str,
    wire_msgs: &[serde_json::Value],
    headers: &[(String, String)],
    usage_totals: &mut UsageTotals,
) -> Result<(serde_json::Value, OpenAiIterationPhase), String> {
    let response = openai_iteration_response(provider, base_url, model, wire_msgs, headers)?;
    let phase = openai_phase_after_usage(usage_totals, &response);
    Ok((response, phase))
}

pub(crate) fn initial_anthropic_wire_messages(
    messages: &[(String, String)],
) -> Vec<serde_json::Value> {
    messages
        .iter()
        .map(|(role, content)| serde_json::json!({"role": role, "content": content}))
        .collect()
}

pub(crate) fn initial_openai_wire_messages(
    system: &str,
    messages: &[(String, String)],
) -> Vec<serde_json::Value> {
    let mut v = vec![serde_json::json!({"role": "system", "content": system})];
    v.extend(
        messages
            .iter()
            .map(|(r, c)| serde_json::json!({"role": r, "content": c})),
    );
    v
}

pub(crate) struct ProviderLoopState {
    pub wire_msgs: Vec<serde_json::Value>,
    pub usage_totals: UsageTotals,
    pub executed_calls: Vec<serde_json::Value>,
    pub seen_hashes: std::collections::HashSet<u64>,
}

pub(crate) struct ProviderLoopPlan {
    pub max_iter: u32,
    pub state: ProviderLoopState,
}

pub(crate) struct AnthropicRunnerConfig<'a> {
    pub model: &'a str,
    pub system: &'a str,
    pub headers: Vec<(String, String)>,
    pub plan: ProviderLoopPlan,
}

pub(crate) struct OpenAiRunnerConfig<'a> {
    pub provider: &'a str,
    pub base_url: &'a str,
    pub model: &'a str,
    pub headers: Vec<(String, String)>,
    pub plan: ProviderLoopPlan,
}

pub(crate) fn provider_loop_state(initial_wire_msgs: Vec<serde_json::Value>) -> ProviderLoopState {
    ProviderLoopState {
        wire_msgs: initial_wire_msgs,
        usage_totals: UsageTotals::default(),
        executed_calls: Vec::new(),
        seen_hashes: std::collections::HashSet::new(),
    }
}

pub(crate) fn provider_loop_plan_with_max_iter(
    initial_wire_msgs: Vec<serde_json::Value>,
    max_iter: u32,
) -> ProviderLoopPlan {
    ProviderLoopPlan {
        max_iter,
        state: provider_loop_state(initial_wire_msgs),
    }
}

#[allow(dead_code)]
pub(crate) fn anthropic_loop_state(messages: &[(String, String)]) -> ProviderLoopState {
    provider_loop_state(initial_anthropic_wire_messages(messages))
}

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) fn anthropic_loop_plan(messages: &[(String, String)]) -> ProviderLoopPlan {
    provider_loop_plan_with_max_iter(initial_anthropic_wire_messages(messages), tool_loop_max_iter())
}

#[allow(dead_code)]
pub(crate) fn openai_loop_state(
    system: &str,
    messages: &[(String, String)],
) -> ProviderLoopState {
    provider_loop_state(initial_openai_wire_messages(system, messages))
}

#[cfg(any(test, target_arch = "wasm32"))]
pub(crate) fn openai_loop_plan(
    system: &str,
    messages: &[(String, String)],
) -> ProviderLoopPlan {
    provider_loop_plan_with_max_iter(
        initial_openai_wire_messages(system, messages),
        tool_loop_max_iter(),
    )
}

pub(crate) fn anthropic_runner_config<'a>(
    model: &'a str,
    system: &'a str,
    messages: &[(String, String)],
) -> AnthropicRunnerConfig<'a> {
    AnthropicRunnerConfig {
        model,
        system,
        headers: anthropic_headers(),
        plan: anthropic_loop_plan(messages),
    }
}

pub(crate) fn openai_runner_config<'a>(
    provider: &'a str,
    base_url: &'a str,
    model: &'a str,
    system: &str,
    messages: &[(String, String)],
) -> OpenAiRunnerConfig<'a> {
    OpenAiRunnerConfig {
        provider,
        base_url,
        model,
        headers: openai_compat_headers(),
        plan: openai_loop_plan(system, messages),
    }
}

pub(crate) fn anthropic_content_array(v: &serde_json::Value) -> Vec<serde_json::Value> {
    v["content"].as_array().cloned().unwrap_or_default()
}

pub(crate) fn openai_tool_calls_array(msg: &serde_json::Value) -> Vec<serde_json::Value> {
    msg["tool_calls"].as_array().cloned().unwrap_or_default()
}

pub(crate) struct ParsedAnthropicToolUse {
    pub name: String,
    pub input: serde_json::Value,
    pub id: String,
}

pub(crate) struct AnthropicIterationPhase {
    pub content_arr: Vec<serde_json::Value>,
    pub tool_uses: Vec<ParsedAnthropicToolUse>,
}

pub(crate) fn parse_anthropic_tool_uses(
    content_arr: &[serde_json::Value],
) -> Vec<ParsedAnthropicToolUse> {
    content_arr
        .iter()
        .filter(|c| c["type"] == "tool_use")
        .map(|c| ParsedAnthropicToolUse {
            name: c["name"].as_str().unwrap_or("").to_owned(),
            input: c["input"].clone(),
            id: c["id"].as_str().unwrap_or("").to_owned(),
        })
        .collect()
}

pub(crate) fn anthropic_iteration_phase(response: &serde_json::Value) -> AnthropicIterationPhase {
    let content_arr = anthropic_content_array(response);
    let tool_uses = parse_anthropic_tool_uses(&content_arr);
    AnthropicIterationPhase {
        content_arr,
        tool_uses,
    }
}

pub(crate) fn anthropic_has_tool_calls(phase: &AnthropicIterationPhase) -> bool {
    !phase.tool_uses.is_empty()
}

pub(crate) fn anthropic_completion_text_if_terminate(
    phase: &AnthropicIterationPhase,
    iter_idx: u32,
    max_iter: u32,
    response: &serde_json::Value,
) -> Result<Option<String>, String> {
    completion_text_if_terminate(
        anthropic_has_tool_calls(phase),
        iter_idx,
        max_iter,
        require_anthropic_text_content(&phase.content_arr, response),
    )
}

pub(crate) fn anthropic_text_content(content_arr: &[serde_json::Value]) -> Option<String> {
    content_arr
        .iter()
        .find(|c| c["type"] == "text")
        .and_then(|c| c["text"].as_str())
        .map(ToOwned::to_owned)
}

pub(crate) struct ParsedOpenAiToolCall {
    pub name: String,
    pub input: serde_json::Value,
    pub id: String,
}

pub(crate) struct OpenAiIterationPhase {
    pub msg: serde_json::Value,
    pub tool_calls_json: Vec<serde_json::Value>,
    pub parsed_calls: Vec<ParsedOpenAiToolCall>,
}

pub(crate) fn parse_openai_tool_calls(
    tool_calls_json: &[serde_json::Value],
) -> Vec<ParsedOpenAiToolCall> {
    tool_calls_json
        .iter()
        .map(|tc| {
            let fn_obj = &tc["function"];
            ParsedOpenAiToolCall {
                name: fn_obj["name"].as_str().unwrap_or("").to_owned(),
                input: parse_json_arguments(fn_obj["arguments"].as_str().unwrap_or("{}")),
                id: tc["id"].as_str().unwrap_or("").to_owned(),
            }
        })
        .collect()
}

pub(crate) fn openai_iteration_phase(response: &serde_json::Value) -> OpenAiIterationPhase {
    let msg = openai_choice_message(response).clone();
    let tool_calls_json = openai_tool_calls_array(&msg);
    let parsed_calls = parse_openai_tool_calls(&tool_calls_json);
    OpenAiIterationPhase {
        msg,
        tool_calls_json,
        parsed_calls,
    }
}

pub(crate) fn openai_has_tool_calls(phase: &OpenAiIterationPhase) -> bool {
    !phase.tool_calls_json.is_empty()
}

pub(crate) fn openai_completion_text_if_terminate(
    phase: &OpenAiIterationPhase,
    iter_idx: u32,
    max_iter: u32,
    response: &serde_json::Value,
) -> Result<Option<String>, String> {
    completion_text_if_terminate(
        openai_has_tool_calls(phase),
        iter_idx,
        max_iter,
        require_openai_message_content(&phase.msg, response),
    )
}

pub(crate) fn anthropic_step_text_or_advance_with<F>(
    state: &mut ProviderLoopState,
    phase: &AnthropicIterationPhase,
    iter_idx: u32,
    max_iter: u32,
    response: &serde_json::Value,
    dispatch: F,
) -> Result<Option<String>, String>
where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    if let Some(text) = anthropic_completion_text_if_terminate(phase, iter_idx, max_iter, response)? {
        return Ok(Some(text));
    }

    advance_anthropic_tool_phase_from_phase_with(
        &mut state.wire_msgs,
        phase,
        &mut state.executed_calls,
        &mut state.seen_hashes,
        dispatch,
    );
    Ok(None)
}

pub(crate) fn openai_step_text_or_advance_with<F>(
    state: &mut ProviderLoopState,
    phase: &OpenAiIterationPhase,
    iter_idx: u32,
    max_iter: u32,
    response: &serde_json::Value,
    dispatch: F,
) -> Result<Option<String>, String>
where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    if let Some(text) = openai_completion_text_if_terminate(phase, iter_idx, max_iter, response)? {
        return Ok(Some(text));
    }

    advance_openai_tool_phase_from_phase_with(
        &mut state.wire_msgs,
        phase,
        &mut state.executed_calls,
        &mut state.seen_hashes,
        dispatch,
    );
    Ok(None)
}

pub(crate) fn openai_message_content(msg: &serde_json::Value) -> Option<String> {
    msg["content"].as_str().map(ToOwned::to_owned)
}

pub(crate) fn require_anthropic_text_content(
    content_arr: &[serde_json::Value],
    response: &serde_json::Value,
) -> Result<String, String> {
    anthropic_text_content(content_arr)
        .ok_or_else(|| error_message(response, "no text in response"))
}

pub(crate) fn openai_choice_message(response: &serde_json::Value) -> &serde_json::Value {
    &response["choices"][0]["message"]
}

pub(crate) fn require_openai_message_content(
    msg: &serde_json::Value,
    response: &serde_json::Value,
) -> Result<String, String> {
    openai_message_content(msg).ok_or_else(|| error_message(response, "no content"))
}

pub(crate) fn anthropic_tool_result(tool_use_id: &str, content: String) -> serde_json::Value {
    serde_json::json!({
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": content,
    })
}

pub(crate) fn record_anthropic_tool_execution(
    executed_calls: &mut Vec<serde_json::Value>,
    tool_use: &ParsedAnthropicToolUse,
    result: &str,
) -> serde_json::Value {
    push_executed_call(executed_calls, &tool_use.name, tool_use.input.clone(), result);
    anthropic_tool_result(&tool_use.id, result.to_owned())
}

pub(crate) fn record_openai_tool_execution(
    executed_calls: &mut Vec<serde_json::Value>,
    tool_call: &ParsedOpenAiToolCall,
    result: &str,
) {
    push_executed_call(executed_calls, &tool_call.name, tool_call.input.clone(), result);
}

pub(crate) fn execute_anthropic_tools_with<F>(
    tool_uses: &[ParsedAnthropicToolUse],
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    mut dispatch: F,
) -> Vec<serde_json::Value>
where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    let mut tool_results = Vec::with_capacity(tool_uses.len());
    for tc in tool_uses {
        let result = dispatch(&tc.name, &tc.input, seen_hashes);
        tool_results.push(record_anthropic_tool_execution(executed_calls, tc, &result));
    }
    tool_results
}

pub(crate) struct OpenAiToolMessage {
    pub id: String,
    pub content: String,
}

pub(crate) fn execute_openai_tools_with<F>(
    parsed_calls: &[ParsedOpenAiToolCall],
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    mut dispatch: F,
) -> Vec<OpenAiToolMessage>
where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    let mut tool_messages = Vec::with_capacity(parsed_calls.len());
    for tc in parsed_calls {
        let result = dispatch(&tc.name, &tc.input, seen_hashes);
        record_openai_tool_execution(executed_calls, tc, &result);
        tool_messages.push(OpenAiToolMessage {
            id: tc.id.clone(),
            content: result,
        });
    }
    tool_messages
}

pub(crate) fn append_openai_tool_messages(
    wire_msgs: &mut Vec<serde_json::Value>,
    tool_messages: Vec<OpenAiToolMessage>,
) {
    for tm in tool_messages {
        append_openai_tool_message(wire_msgs, &tm.id, tm.content);
    }
}

pub(crate) fn advance_anthropic_tool_phase_from_phase_with<F>(
    wire_msgs: &mut Vec<serde_json::Value>,
    phase: &AnthropicIterationPhase,
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    dispatch: F,
) where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    advance_anthropic_tool_phase_with(
        wire_msgs,
        &phase.content_arr,
        &phase.tool_uses,
        executed_calls,
        seen_hashes,
        dispatch,
    );
}

pub(crate) fn advance_openai_tool_phase_from_phase_with<F>(
    wire_msgs: &mut Vec<serde_json::Value>,
    phase: &OpenAiIterationPhase,
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    dispatch: F,
) where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    advance_openai_tool_phase_with(
        wire_msgs,
        &phase.msg["content"],
        &phase.tool_calls_json,
        &phase.parsed_calls,
        executed_calls,
        seen_hashes,
        dispatch,
    );
}

pub(crate) fn advance_anthropic_tool_phase_with<F>(
    wire_msgs: &mut Vec<serde_json::Value>,
    content_arr: &[serde_json::Value],
    tool_uses: &[ParsedAnthropicToolUse],
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    dispatch: F,
) where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    append_anthropic_assistant_message(wire_msgs, content_arr);
    let tool_results = execute_anthropic_tools_with(
        tool_uses,
        executed_calls,
        seen_hashes,
        dispatch,
    );
    append_anthropic_tool_results_message(wire_msgs, tool_results);
}

pub(crate) fn advance_openai_tool_phase_with<F>(
    wire_msgs: &mut Vec<serde_json::Value>,
    content: &serde_json::Value,
    tool_calls_json: &[serde_json::Value],
    parsed_calls: &[ParsedOpenAiToolCall],
    executed_calls: &mut Vec<serde_json::Value>,
    seen_hashes: &mut std::collections::HashSet<u64>,
    dispatch: F,
) where
    F: FnMut(&str, &serde_json::Value, &mut std::collections::HashSet<u64>) -> String,
{
    append_openai_assistant_message(wire_msgs, content, tool_calls_json);
    let tool_messages =
        execute_openai_tools_with(parsed_calls, executed_calls, seen_hashes, dispatch);
    append_openai_tool_messages(wire_msgs, tool_messages);
}

pub(crate) fn response_usage(response: &serde_json::Value) -> &serde_json::Value {
    &response["usage"]
}

pub(crate) fn ingest_anthropic_usage_from_response(
    totals: &mut UsageTotals,
    response: &serde_json::Value,
) {
    totals.ingest_anthropic_usage(response_usage(response));
}

pub(crate) fn anthropic_phase_after_usage(
    totals: &mut UsageTotals,
    response: &serde_json::Value,
) -> AnthropicIterationPhase {
    ingest_anthropic_usage_from_response(totals, response);
    anthropic_iteration_phase(response)
}

pub(crate) fn ingest_openai_usage_from_response(
    totals: &mut UsageTotals,
    response: &serde_json::Value,
) {
    totals.ingest_openai_usage(response_usage(response));
}

pub(crate) fn openai_phase_after_usage(
    totals: &mut UsageTotals,
    response: &serde_json::Value,
) -> OpenAiIterationPhase {
    ingest_openai_usage_from_response(totals, response);
    openai_iteration_phase(response)
}

pub(crate) fn dedup_tool_output(
    raw: String,
    seen_hashes: &mut std::collections::HashSet<u64>,
) -> String {
    if seen_hashes.insert(crate::fnv1a_hash(&raw)) {
        raw
    } else {
        "[duplicate: same output already in this context — ask for specifics if needed]".to_string()
    }
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn dispatch_tool_dedup(
    name: &str,
    input: &serde_json::Value,
    seen_hashes: &mut std::collections::HashSet<u64>,
) -> String {
    let raw = crate::tool_dispatch::dispatch_tool(name, input);
    dedup_tool_output(raw, seen_hashes)
}

pub(crate) fn push_executed_call(
    executed_calls: &mut Vec<serde_json::Value>,
    name: &str,
    input: serde_json::Value,
    result: &str,
) {
    executed_calls.push(serde_json::json!({
        "name": name,
        "input": input,
        "result": result,
    }));
}

pub(crate) fn parse_json_arguments(arguments: &str) -> serde_json::Value {
    serde_json::from_str(arguments).unwrap_or_else(|_| serde_json::json!({}))
}

pub(crate) fn append_anthropic_assistant_message(
    wire_msgs: &mut Vec<serde_json::Value>,
    content_arr: &[serde_json::Value],
) {
    wire_msgs.push(serde_json::json!({
        "role": "assistant",
        "content": content_arr,
    }));
}

pub(crate) fn append_anthropic_tool_results_message(
    wire_msgs: &mut Vec<serde_json::Value>,
    tool_results: Vec<serde_json::Value>,
) {
    wire_msgs.push(serde_json::json!({
        "role": "user",
        "content": tool_results,
    }));
}

pub(crate) fn append_openai_assistant_message(
    wire_msgs: &mut Vec<serde_json::Value>,
    content: &serde_json::Value,
    tool_calls_json: &[serde_json::Value],
) {
    wire_msgs.push(serde_json::json!({
        "role": "assistant",
        "content": content,
        "tool_calls": tool_calls_json,
    }));
}

pub(crate) fn append_openai_tool_message(
    wire_msgs: &mut Vec<serde_json::Value>,
    tool_call_id: &str,
    content: String,
) {
    wire_msgs.push(serde_json::json!({
        "role": "tool",
        "tool_call_id": tool_call_id,
        "content": content,
    }));
}

pub(crate) fn should_terminate_tool_loop(
    has_tool_calls: bool,
    iter_idx: u32,
    max_iter: u32,
) -> bool {
    !has_tool_calls || iter_idx == max_iter
}

pub(crate) fn completion_text_if_terminate(
    has_tool_calls: bool,
    iter_idx: u32,
    max_iter: u32,
    content: Result<String, String>,
) -> Result<Option<String>, String> {
    if should_terminate_tool_loop(has_tool_calls, iter_idx, max_iter) {
        content.map(Some)
    } else {
        Ok(None)
    }
}

pub(crate) fn error_message(v: &serde_json::Value, fallback: &str) -> String {
    v["error"]["message"]
        .as_str()
        .unwrap_or(fallback)
        .to_owned()
}

pub(crate) fn run_completion_loop_with<P, FR, FS>(
    max_iter: u32,
    mut state: ProviderLoopState,
    mut response_and_phase: FR,
    mut step: FS,
) -> Result<CompletionLoopOutcome, String>
where
    FR: FnMut(&mut ProviderLoopState) -> Result<(serde_json::Value, P), String>,
    FS: FnMut(
        &mut ProviderLoopState,
        &P,
        u32,
        u32,
        &serde_json::Value,
    ) -> Result<Option<String>, String>,
{
    for iter_idx in 0..=max_iter {
        let (response, phase) = response_and_phase(&mut state)?;
        if let Some(text) = step(&mut state, &phase, iter_idx, max_iter, &response)? {
            return Ok(CompletionLoopOutcome {
                state,
                response,
                text,
            });
        }
    }
    unreachable!()
}

pub(crate) fn run_completion_loop_from_plan_with<P, FR, FS>(
    plan: ProviderLoopPlan,
    response_and_phase: FR,
    step: FS,
) -> Result<CompletionLoopOutcome, String>
where
    FR: FnMut(&mut ProviderLoopState) -> Result<(serde_json::Value, P), String>,
    FS: FnMut(
        &mut ProviderLoopState,
        &P,
        u32,
        u32,
        &serde_json::Value,
    ) -> Result<Option<String>, String>,
{
    run_completion_loop_with(plan.max_iter, plan.state, response_and_phase, step)
}

pub(crate) struct CompletionLoopOutcome {
    pub state: ProviderLoopState,
    pub response: serde_json::Value,
    pub text: String,
}

#[derive(Default)]
pub(crate) struct UsageTotals {
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub tokens_cached: u32,
    pub tokens_reasoning: u32,
}

impl UsageTotals {
    pub(crate) fn ingest_anthropic_usage(&mut self, usage: &serde_json::Value) {
        self.tokens_in += usage["input_tokens"].as_u64().unwrap_or(0) as u32;
        self.tokens_out += usage["output_tokens"].as_u64().unwrap_or(0) as u32;
        self.tokens_cached += (usage["cache_read_input_tokens"].as_u64().unwrap_or(0)
            + usage["cache_creation_input_tokens"].as_u64().unwrap_or(0))
            as u32;
    }

    pub(crate) fn ingest_openai_usage(&mut self, usage: &serde_json::Value) {
        self.tokens_in += usage["prompt_tokens"].as_u64().unwrap_or(0) as u32;
        self.tokens_out += usage["completion_tokens"].as_u64().unwrap_or(0) as u32;
        self.tokens_cached += usage["prompt_tokens_details"]["cached_tokens"]
            .as_u64()
            .unwrap_or(0) as u32;
        self.tokens_reasoning += usage["completion_tokens_details"]["reasoning_tokens"]
            .as_u64()
            .unwrap_or(0) as u32;
    }
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn completion_result(
    content: String,
    executed_calls: Vec<serde_json::Value>,
    usage: &serde_json::Value,
    totals: UsageTotals,
) -> crate::provider::CompletionResult {
    crate::provider::CompletionResult {
        content,
        tool_calls: serde_json::Value::Array(executed_calls),
        tokens_in: totals.tokens_in,
        tokens_out: totals.tokens_out,
        tokens_cached: totals.tokens_cached,
        tokens_reasoning: totals.tokens_reasoning,
        usage_raw: usage.to_string(),
    }
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn completion_result_from_response(
    content: String,
    executed_calls: Vec<serde_json::Value>,
    response: &serde_json::Value,
    totals: UsageTotals,
) -> crate::provider::CompletionResult {
    completion_result(content, executed_calls, response_usage(response), totals)
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn finalize_completion_from_response(
    content: String,
    response: &serde_json::Value,
    state: ProviderLoopState,
) -> crate::provider::CompletionResult {
    completion_result_from_response(content, state.executed_calls, response, state.usage_totals)
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn finalize_completion_from_outcome(
    outcome: CompletionLoopOutcome,
) -> crate::provider::CompletionResult {
    finalize_completion_from_response(outcome.text, &outcome.response, outcome.state)
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn run_anthropic_completion_loop(
    model: &str,
    system: &str,
    messages: &[(String, String)],
) -> Result<crate::provider::CompletionResult, String> {
    let config = anthropic_runner_config(model, system, messages);
    let outcome = run_completion_loop_from_plan_with(
        config.plan,
        |state| {
            anthropic_iteration_response_and_phase(
                config.model,
                config.system,
                &state.wire_msgs,
                &config.headers,
                &mut state.usage_totals,
            )
        },
        |state, phase, iter_idx, max_iter, response| {
            anthropic_step_text_or_advance_with(
                state,
                phase,
                iter_idx,
                max_iter,
                response,
                dispatch_tool_dedup,
            )
        },
    )?;
    Ok(finalize_completion_from_outcome(outcome))
}

#[cfg(target_arch = "wasm32")]
pub(crate) fn run_openai_completion_loop(
    provider: &str,
    base_url: &str,
    model: &str,
    system: &str,
    messages: &[(String, String)],
) -> Result<crate::provider::CompletionResult, String> {
    let config = openai_runner_config(provider, base_url, model, system, messages);
    let outcome = run_completion_loop_from_plan_with(
        config.plan,
        |state| {
            openai_iteration_response_and_phase(
                config.provider,
                config.base_url,
                config.model,
                &state.wire_msgs,
                &config.headers,
                &mut state.usage_totals,
            )
        },
        |state, phase, iter_idx, max_iter, response| {
            openai_step_text_or_advance_with(
                state,
                phase,
                iter_idx,
                max_iter,
                response,
                dispatch_tool_dedup,
            )
        },
    )?;
    Ok(finalize_completion_from_outcome(outcome))
}
