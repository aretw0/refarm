pub(crate) struct OpenAiToolMessage {
    pub id: String,
    pub content: String,
}

pub(crate) fn anthropic_tool_result(tool_use_id: &str, content: String) -> serde_json::Value {
    serde_json::json!({
        "type": "tool_result",
        "tool_use_id": tool_use_id,
        "content": content,
    })
}

pub(crate) fn append_openai_tool_messages(
    wire_msgs: &mut Vec<serde_json::Value>,
    tool_messages: Vec<OpenAiToolMessage>,
) {
    for tm in tool_messages {
        append_openai_tool_message(wire_msgs, &tm.id, tm.content);
    }
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
