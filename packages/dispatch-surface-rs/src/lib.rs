use chrono::SecondsFormat;
use chrono::Utc;
use percent_encoding::{percent_decode_str, utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::fmt;
use std::time::SystemTime;

wit_bindgen::generate!({
    world: "dispatch-surface",
    path: "wit",
});

use exports::refarm::dispatch_surface::dispatch_surface_control::{
    DispatchTransport as GuestDispatchTransport, Guest,
};

pub const TASK_TRANSPORTS: [&str; 2] = ["file", "http"];

pub const INVALID_TRANSPORT_MESSAGE: &str =
    "Invalid task transport \"{value}\". Use: file, http, channel:<name>";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DispatchTransport {
    #[serde(rename = "file")]
    File,
    #[serde(rename = "http")]
    Http,
    #[serde(rename = "channel")]
    Channel(String),
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParseTransportError {
    pub value: String,
}

impl fmt::Display for ParseTransportError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Invalid task transport \"{}\". Use: file, http, channel:<name>",
            self.value,
        )
    }
}

impl std::error::Error for ParseTransportError {}

pub fn parse_task_transport(value: &str) -> Result<DispatchTransport, ParseTransportError> {
    if value == "file" {
        return Ok(DispatchTransport::File);
    }
    if value == "http" {
        return Ok(DispatchTransport::Http);
    }
    if is_channel_dispatch_transport(value) {
        let channel = value["channel:".len()..].to_string();
        return Ok(DispatchTransport::Channel(channel));
    }

    Err(ParseTransportError {
        value: value.to_string(),
    })
}

pub fn is_channel_dispatch_transport(value: &str) -> bool {
    value.starts_with("channel:") && !value["channel:".len()..].trim().is_empty()
}

pub fn resolve_channel_from_transport(transport: &DispatchTransport) -> Option<&str> {
    match transport {
        DispatchTransport::Channel(channel) => Some(channel.as_str()),
        _ => None,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RawChannelEffortPayload {
    pub direction: String,
    pub tasks: Value,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub context: Option<Value>,
    #[serde(rename = "replyTo", default)]
    pub reply_to: Option<Value>,
    #[serde(rename = "traceIds", default)]
    pub trace_ids: Option<Value>,
    #[serde(default)]
    pub priority: Option<u32>,
    #[serde(rename = "submittedAt", default)]
    pub submitted_at: Option<String>,
    #[serde(default)]
    pub tags: Option<Value>,
}

pub fn is_channel_effort_payload_json(value: &str) -> bool {
    match serde_json::from_str::<Value>(value) {
        Ok(value) => is_channel_effort_payload(&value),
        Err(_) => false,
    }
}

pub fn is_channel_effort_payload(value: &Value) -> bool {
    if let Value::Object(obj) = value {
        let direction = obj.get("direction").and_then(Value::as_str);
        let tasks = obj.get("tasks");
        return matches!(direction, Some(v) if !v.trim().is_empty())
            && tasks.is_some_and(Value::is_array);
    }
    false
}

pub fn encode_channel(channel: &str) -> String {
    utf8_percent_encode(channel, NON_ALPHANUMERIC).to_string()
}

pub fn decode_channel(channel: &str) -> String {
    match percent_decode_str(channel).decode_utf8() {
        Ok(decoded) => decoded.to_string(),
        Err(_) => String::new(),
    }
}

pub fn normalize_channel_source(channel: &str, source: Option<&str>) -> String {
    match source {
        Some(value) if !value.trim().is_empty() => value.to_string(),
        _ => format!("channel:{}", channel),
    }
}

pub fn normalize_channel_context(
    context: Option<&Value>,
    channel: &str,
    reply_to: Option<&Value>,
    trace_ids: Option<&Value>,
) -> Value {
    let mut result = match context {
        Some(Value::Object(obj)) => obj.clone(),
        _ => Map::new(),
    };

    result.insert("channel".to_string(), Value::String(channel.to_string()));
    if let Some(reply_to) = reply_to {
        result.insert("replyTo".to_string(), reply_to.clone());
    }
    if let Some(trace_ids) = trace_ids {
        if trace_ids.is_array() {
            result.insert("traceIds".to_string(), trace_ids.clone());
        }
    }
    Value::Object(result)
}

pub fn build_channel_effort(payload: &RawChannelEffortPayload, channel: &str) -> Value {
    let mut effort = Map::new();
    effort.insert(
        "id".to_string(),
        json!(payload.id.clone().unwrap_or_else(random_effort_id)),
    );
    effort.insert("direction".to_string(), json!(payload.direction.clone()));
    effort.insert("tasks".to_string(), payload.tasks.clone());
    effort.insert(
        "source".to_string(),
        json!(normalize_channel_source(channel, payload.source.as_deref())),
    );
    effort.insert(
        "context".to_string(),
        normalize_channel_context(
            payload.context.as_ref(),
            channel,
            payload.reply_to.as_ref(),
            payload.trace_ids.as_ref(),
        ),
    );
    effort.insert(
        "submittedAt".to_string(),
        json!(payload
            .submitted_at
            .clone()
            .unwrap_or_else(default_submitted_at)),
    );
    if let Some(priority) = payload.priority {
        effort.insert("priority".to_string(), json!(priority));
    }
    if let Some(tags) = payload.tags.clone() {
        effort.insert("tags".to_string(), tags);
    }

    Value::Object(effort)
}

pub fn build_channel_efforts_path(base_url: &str, channel: &str) -> String {
    format!(
        "{}/channels/{}/efforts",
        base_url.trim_end_matches('/'),
        encode_channel(channel),
    )
}

pub fn build_channel_effort_path(
    base_url: &str,
    channel: &str,
    effort_id: &str,
    segment: Option<&str>,
) -> String {
    match segment {
        Some(segment) => format!(
            "{}/{}/{}{}",
            build_channel_efforts_path(base_url, channel),
            encode_channel(effort_id),
            "/",
            segment,
        ),
        None => format!(
            "{}/{}",
            build_channel_efforts_path(base_url, channel),
            encode_channel(effort_id),
        ),
    }
}

fn random_effort_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    format!("{nanos}")
}

fn default_submitted_at() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn parse_json_object(value: &str) -> Option<Value> {
    serde_json::from_str(value).ok()
}

fn parse_optional_json_string(value: Option<String>) -> Option<Value> {
    value.and_then(|raw| parse_json_object(&raw))
}

struct DispatchSurface;

impl Guest for DispatchSurface {
    fn parse_task_transport(transport: String) -> Result<GuestDispatchTransport, String> {
        parse_task_transport(&transport)
            .map(Into::into)
            .map_err(|err| err.to_string())
    }

    fn resolve_channel_from_transport(transport: GuestDispatchTransport) -> Option<String> {
        let transport = dispatch_transport_from_host(&transport);
        resolve_channel_from_transport(&transport).map(ToString::to_string)
    }

    fn is_channel_effort_payload(payload_json: String) -> bool {
        is_channel_effort_payload_json(&payload_json)
    }

    fn normalize_channel_source(channel: String, source: Option<String>) -> String {
        normalize_channel_source(&channel, source.as_deref())
    }

    fn normalize_channel_context(
        context_json: String,
        channel: String,
        reply_to: Option<String>,
        trace_ids_json: Option<String>,
    ) -> String {
        let context = parse_json_object(&context_json);
        let reply_to_value = reply_to.map(Value::String);
        let trace_ids_value = parse_optional_json_string(trace_ids_json);
        normalize_channel_context(
            context.as_ref(),
            &channel,
            reply_to_value.as_ref(),
            trace_ids_value.as_ref(),
        )
        .to_string()
    }

    fn build_channel_effort(payload_json: String, channel: String) -> Result<String, String> {
        let raw = parse_json_object(&payload_json)
            .ok_or_else(|| "Invalid effort payload json".to_string())?;
        let payload = serde_json::from_value::<RawChannelEffortPayload>(raw)
            .map_err(|e| format!("Invalid effort payload: {e}"))?;
        let effort = build_channel_effort(&payload, &channel);
        serde_json::to_string(&effort).map_err(|e| format!("Failed to serialize effort: {e}"))
    }

    fn encode_channel(channel: String) -> String {
        encode_channel(&channel)
    }

    fn decode_channel(channel: String) -> String {
        decode_channel(&channel)
    }

    fn build_channel_efforts_path(base_url: String, channel: String) -> String {
        build_channel_efforts_path(&base_url, &channel)
    }

    fn build_channel_effort_path(
        base_url: String,
        channel: String,
        effort_id: String,
        segment: Option<String>,
    ) -> String {
        build_channel_effort_path(&base_url, &channel, &effort_id, segment.as_deref())
    }
}

fn dispatch_transport_from_host(transport: &GuestDispatchTransport) -> DispatchTransport {
    match transport {
        GuestDispatchTransport::File => DispatchTransport::File,
        GuestDispatchTransport::Http => DispatchTransport::Http,
        GuestDispatchTransport::Channel(inner) => DispatchTransport::Channel(inner.clone()),
    }
}

impl From<DispatchTransport> for GuestDispatchTransport {
    fn from(value: DispatchTransport) -> Self {
        match value {
            DispatchTransport::File => Self::File,
            DispatchTransport::Http => Self::Http,
            DispatchTransport::Channel(channel) => Self::Channel(channel),
        }
    }
}

export!(DispatchSurface);

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn transport_parser_accepts_static_and_channel() {
        assert_eq!(parse_task_transport("file"), Ok(DispatchTransport::File));
        assert_eq!(parse_task_transport("http"), Ok(DispatchTransport::Http));
        assert!(matches!(
            parse_task_transport("channel:matrix"),
            Ok(DispatchTransport::Channel(_))
        ));
        assert!(parse_task_transport("grpc").is_err());
    }

    #[test]
    fn effort_payload_validation() {
        assert!(is_channel_effort_payload(
            &json!({"direction":"x","tasks":[]})
        ));
        assert!(!is_channel_effort_payload(
            &json!({"direction":"","tasks":[]})
        ));
        assert!(!is_channel_effort_payload(
            &json!({"direction":"x","tasks":"bad"})
        ));
        assert!(!is_channel_effort_payload(&json!(null)));
        assert!(is_channel_effort_payload_json(
            r#"{"direction":"x","tasks":[]}"#
        ));
        assert!(!is_channel_effort_payload_json("invalid json"));
    }

    #[test]
    fn build_channel_effort_normalizes_context() {
        let payload = RawChannelEffortPayload {
            direction: "prompt".to_string(),
            tasks: json!([]),
            id: None,
            source: None,
            context: Some(json!({"existing": true})),
            reply_to: Some(json!("thread-1")),
            trace_ids: Some(json!(["t1", "t2"])),
            priority: None,
            submitted_at: None,
            tags: Some(json!(["a", "b"])),
        };
        let effort = build_channel_effort(&payload, "matrix");
        let obj = effort.as_object().expect("effort is object");
        assert_eq!(
            obj.get("source").and_then(Value::as_str),
            Some("channel:matrix")
        );
        let context = obj
            .get("context")
            .and_then(Value::as_object)
            .expect("context object");
        assert_eq!(context.get("channel"), Some(&json!("matrix")));
        assert_eq!(context.get("replyTo"), Some(&json!("thread-1")));
        assert_eq!(context.get("traceIds"), Some(&json!(["t1", "t2"])));
    }

    #[test]
    fn guest_exports_round_trip() {
        let payload = json!({
            "direction": "prompt",
            "tasks": [
                {"type": "llm", "model": "x"}
            ],
            "replyTo": "thread-1"
        })
        .to_string();
        let effort_json =
            DispatchSurface::build_channel_effort(payload, "matrix".to_string()).unwrap();
        let effort: Value = serde_json::from_str(&effort_json).expect("effort json");
        assert_eq!(effort["source"], json!("channel:matrix"));
        assert_eq!(effort["context"]["channel"], json!("matrix"));
    }
}
