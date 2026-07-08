//! The CLI watch/read engines for the tractor binary: the generic node-row
//! reader and the AgentResponse event reader, plus their stream-kind consts.
//! Extracted verbatim from main.rs to shrink the binary entry (behavior
//! unchanged). Shared types (OutputFormat, ResponseEvent,
//! PlainResponseOutput) stay in main.rs and are imported here.

use std::collections::HashSet;
use std::io::Write;

use anyhow::{Context, Result};
use tokio::time::{sleep, Duration, Instant};
use tractor::NativeStorage;

use super::{OutputFormat, PlainResponseOutput, PlainResponseOutputState, ResponseEvent};

// Stream-kind consts used only by node_row_is_terminal below.
pub(crate) const STREAM_CHUNK_PAYLOAD_KIND_FINAL_TEXT: &str = "final_text";
pub(crate) const STREAM_CHUNK_PAYLOAD_KIND_FINAL_TOOL_CALL: &str = "final_tool_call";
pub(crate) const STREAM_CHUNK_PAYLOAD_KIND_FINAL_EMPTY: &str = "final_empty";
pub(crate) const STREAM_SESSION_STATUS_COMPLETED: &str = "completed";
pub(crate) const AGENT_RESPONSE_STREAM_REF_PREFIX: &str = "urn:tractor:stream:response:";
pub(crate) const STREAM_SESSION_STATUS_FAILED: &str = "failed";

pub(crate) fn resolve_stream_ref_filter(
    stream_ref: Option<&str>,
    prompt_ref: Option<&str>,
) -> Result<Option<String>> {
    match (stream_ref, prompt_ref) {
        (Some(_), Some(_)) => {
            anyhow::bail!("use either --stream-ref or --prompt-ref, not both")
        }
        (Some(stream_ref), None) => Ok(Some(stream_ref.to_string())),
        (None, Some("")) => anyhow::bail!("--prompt-ref must not be empty"),
        (None, Some(prompt_ref)) => Ok(Some(agent_response_stream_ref(prompt_ref))),
        (None, None) => Ok(None),
    }
}

pub(crate) fn agent_response_stream_ref(prompt_ref: &str) -> String {
    format!("{AGENT_RESPONSE_STREAM_REF_PREFIX}{prompt_ref}")
}

pub(crate) fn row_matches_cli_filters(
    row: &tractor::storage::NodeRow,
    agent_filter: &str,
    stream_ref_filter: Option<&str>,
) -> bool {
    if !agent_filter.is_empty() && row.source_plugin.as_deref() != Some(agent_filter) {
        return false;
    }

    let Some(stream_ref_filter) = stream_ref_filter else {
        return true;
    };

    serde_json::from_str::<serde_json::Value>(&row.payload)
        .ok()
        .and_then(|value| {
            value
                .get("stream_ref")
                .and_then(|stream_ref| stream_ref.as_str())
                .map(|stream_ref| stream_ref == stream_ref_filter)
        })
        .unwrap_or(false)
}

pub(crate) fn cli_node_order(
    left: &tractor::storage::NodeRow,
    right: &tractor::storage::NodeRow,
) -> std::cmp::Ordering {
    cli_node_time_key(left)
        .cmp(&cli_node_time_key(right))
        .then(left.id.cmp(&right.id))
}

pub(crate) fn cli_node_time_key(row: &tractor::storage::NodeRow) -> (u64, u64) {
    let value = serde_json::from_str::<serde_json::Value>(&row.payload).ok();
    let timestamp = value
        .as_ref()
        .and_then(|v| {
            v.get("timestamp_ns")
                .or_else(|| v.get("updated_at_ns"))
                .or_else(|| v.get("started_at_ns"))
                .and_then(|field| field.as_u64())
        })
        .unwrap_or(0);
    let sequence = value
        .as_ref()
        .and_then(|v| v.get("sequence").and_then(|field| field.as_u64()))
        .unwrap_or(0);
    (timestamp, sequence)
}

pub(crate) fn node_row_fingerprint(row: &tractor::storage::NodeRow) -> String {
    format!("{}\u{0}{}", row.id, row.payload)
}

pub(crate) fn snapshot_seen_node_fingerprints(
    namespace: &str,
    node_type: &str,
    agent_filter: &str,
    stream_ref_filter: Option<&str>,
) -> Result<HashSet<String>> {
    let storage = NativeStorage::open(namespace)
        .with_context(|| format!("open storage namespace '{namespace}'"))?;

    let seen = storage
        .query_nodes(node_type)?
        .into_iter()
        .filter(|row| row_matches_cli_filters(row, agent_filter, stream_ref_filter))
        .map(|row| node_row_fingerprint(&row))
        .collect::<HashSet<_>>();

    Ok(seen)
}

pub(crate) fn collect_new_node_rows(
    namespace: &str,
    node_type: &str,
    agent_filter: &str,
    stream_ref_filter: Option<&str>,
    seen: &HashSet<String>,
) -> Result<Vec<tractor::storage::NodeRow>> {
    let storage = NativeStorage::open(namespace)
        .with_context(|| format!("open storage namespace '{namespace}'"))?;

    let mut rows = storage
        .query_nodes(node_type)?
        .into_iter()
        .filter(|row| row_matches_cli_filters(row, agent_filter, stream_ref_filter))
        .filter(|row| !seen.contains(&node_row_fingerprint(row)))
        .collect::<Vec<_>>();
    rows.sort_by(cli_node_order);
    Ok(rows)
}

pub(crate) fn print_node_row(row: &tractor::storage::NodeRow, format: OutputFormat) {
    match format {
        OutputFormat::Json => {
            let payload = serde_json::from_str::<serde_json::Value>(&row.payload)
                .unwrap_or_else(|_| serde_json::Value::String(row.payload.clone()));
            let line = serde_json::json!({
                "id": row.id,
                "type": row.type_,
                "source_plugin": row.source_plugin,
                "updated_at": row.updated_at,
                "payload": payload,
            });
            println!("{}", line);
        }
        OutputFormat::Plain => {
            println!("{}", row.payload);
        }
    }
}

pub(crate) fn node_row_is_terminal(row: &tractor::storage::NodeRow) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&row.payload) else {
        return false;
    };

    if value.get("is_final").and_then(|field| field.as_bool()) == Some(true) {
        return true;
    }

    if matches!(
        value.get("payload_kind").and_then(|field| field.as_str()),
        Some(
            STREAM_CHUNK_PAYLOAD_KIND_FINAL_TEXT
                | STREAM_CHUNK_PAYLOAD_KIND_FINAL_TOOL_CALL
                | STREAM_CHUNK_PAYLOAD_KIND_FINAL_EMPTY,
        )
    ) {
        return true;
    }

    matches!(
        value.get("status").and_then(|field| field.as_str()),
        Some(STREAM_SESSION_STATUS_COMPLETED | STREAM_SESSION_STATUS_FAILED)
    )
}

pub(crate) fn snapshot_seen_response_ids(
    namespace: &str,
    agent_filter: &str,
) -> Result<HashSet<String>> {
    let storage = NativeStorage::open(namespace)
        .with_context(|| format!("open storage namespace '{namespace}'"))?;

    let rows = storage.query_nodes("Response")?;
    let seen = rows
        .into_iter()
        .filter(|row| agent_filter.is_empty() || row.source_plugin.as_deref() == Some(agent_filter))
        .map(|row| row.id)
        .collect::<HashSet<_>>();

    Ok(seen)
}

pub(crate) fn collect_new_response_events(
    namespace: &str,
    agent_filter: &str,
    seen: &HashSet<String>,
) -> Result<Vec<ResponseEvent>> {
    let storage = NativeStorage::open(namespace)
        .with_context(|| format!("open storage namespace '{namespace}'"))?;

    let mut out = Vec::new();
    for row in storage.query_nodes("Response")? {
        if seen.contains(&row.id) {
            continue;
        }
        if !agent_filter.is_empty() && row.source_plugin.as_deref() != Some(agent_filter) {
            continue;
        }

        let Ok(v) = serde_json::from_str::<serde_json::Value>(&row.payload) else {
            continue;
        };

        let sequence = v.get("sequence").and_then(|x| x.as_u64()).unwrap_or(0);
        let is_final = v.get("is_final").and_then(|x| x.as_bool()).unwrap_or(false);
        let content = v
            .get("content")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let prompt_ref = v
            .get("prompt_ref")
            .and_then(|x| x.as_str())
            .map(ToOwned::to_owned);
        let timestamp_ns = v.get("timestamp_ns").and_then(|x| x.as_u64()).unwrap_or(0);

        let llm = v.get("llm").and_then(|x| x.as_object());
        let llm_tokens_in = llm
            .and_then(|m| m.get("tokens_in"))
            .and_then(|x| x.as_u64())
            .unwrap_or(0);
        let llm_tokens_out = llm
            .and_then(|m| m.get("tokens_out"))
            .and_then(|x| x.as_u64())
            .unwrap_or(0);
        let llm_estimated_usd = llm
            .and_then(|m| m.get("estimated_usd"))
            .and_then(|x| x.as_f64())
            .unwrap_or(0.0);
        let llm_duration_ms = llm
            .and_then(|m| m.get("duration_ms"))
            .and_then(|x| x.as_u64())
            .unwrap_or(0);

        out.push(ResponseEvent {
            id: row.id,
            source_plugin: row.source_plugin,
            updated_at: row.updated_at,
            sequence,
            is_final,
            prompt_ref,
            content,
            timestamp_ns,
            llm_tokens_in,
            llm_tokens_out,
            llm_estimated_usd,
            llm_duration_ms,
        });
    }

    out.sort_by(|a, b| {
        a.timestamp_ns
            .cmp(&b.timestamp_ns)
            .then(a.sequence.cmp(&b.sequence))
            .then(a.id.cmp(&b.id))
    });

    Ok(out)
}

pub(crate) fn render_plain_response_event(
    event: &ResponseEvent,
    state: &mut PlainResponseOutputState,
) -> PlainResponseOutput {
    let prompt_key = event
        .prompt_ref
        .clone()
        .unwrap_or_else(|| "__tractor:no-prompt-ref__".to_string());
    let mut output = PlainResponseOutput::default();

    if event.is_final {
        if state.partial_prompt_refs.remove(&prompt_key) {
            output.stdout.push('\n');
        } else {
            output.stdout.push_str(&event.content);
            output.stdout.push('\n');
        }
        output.stderr = plain_response_metadata(event);
    } else {
        state.partial_prompt_refs.insert(prompt_key);
        output.stdout.push_str(&event.content);
    }

    output
}

pub(crate) fn plain_response_metadata(event: &ResponseEvent) -> String {
    if event.llm_tokens_in == 0 && event.llm_tokens_out == 0 {
        return String::new();
    }

    format!(
        "# {}→{} tokens  ${:.4}  {}ms\n",
        event.llm_tokens_in, event.llm_tokens_out, event.llm_estimated_usd, event.llm_duration_ms,
    )
}

pub(crate) struct PollResponsesOptions {
    pub(crate) poll_interval: Duration,
    pub(crate) timeout: Option<Duration>,
    pub(crate) stop_after_first: bool,
    pub(crate) stop_on_final: bool,
    pub(crate) format: OutputFormat,
}

pub(crate) async fn poll_responses(
    namespace: &str,
    agent_filter: &str,
    seen: &mut HashSet<String>,
    options: PollResponsesOptions,
) -> Result<bool> {
    let deadline = options.timeout.map(|d| Instant::now() + d);
    let mut plain_output_state = PlainResponseOutputState::default();

    loop {
        if let Some(deadline) = deadline {
            if Instant::now() >= deadline {
                return Ok(false);
            }
        }

        let events = collect_new_response_events(namespace, agent_filter, seen)?;
        let mut got_final = false;

        for event in events {
            seen.insert(event.id.clone());

            match options.format {
                OutputFormat::Json => {
                    let line = serde_json::json!({
                        "id": event.id,
                        "source_plugin": event.source_plugin,
                        "updated_at": event.updated_at,
                        "sequence": event.sequence,
                        "is_final": event.is_final,
                        "prompt_ref": event.prompt_ref,
                        "timestamp_ns": event.timestamp_ns,
                        "content": event.content,
                    });
                    println!("{}", line);
                }
                OutputFormat::Plain => {
                    let output = render_plain_response_event(&event, &mut plain_output_state);
                    print!("{}", output.stdout);
                    std::io::stdout()
                        .flush()
                        .context("flush plain AgentResponse output")?;
                    if !output.stderr.is_empty() {
                        eprint!("{}", output.stderr);
                    }
                }
            }

            if event.is_final {
                got_final = true;
            }

            if options.stop_after_first {
                return Ok(got_final);
            }
        }

        if options.stop_on_final && got_final {
            return Ok(true);
        }

        sleep(options.poll_interval).await;
    }
}

pub(crate) struct PollNodeRowsOptions {
    pub(crate) poll_interval: Duration,
    pub(crate) timeout: Option<Duration>,
    pub(crate) stop_after_first: bool,
    pub(crate) stop_on_terminal: bool,
    pub(crate) format: OutputFormat,
}

pub(crate) async fn poll_node_rows(
    namespace: &str,
    node_type: &str,
    agent_filter: &str,
    stream_ref_filter: Option<&str>,
    seen: &mut HashSet<String>,
    options: PollNodeRowsOptions,
) -> Result<bool> {
    let deadline = options.timeout.map(|d| Instant::now() + d);

    loop {
        if let Some(deadline) = deadline {
            if Instant::now() >= deadline {
                return Ok(false);
            }
        }

        let rows =
            collect_new_node_rows(namespace, node_type, agent_filter, stream_ref_filter, seen)?;
        let mut got_terminal = false;

        for row in rows {
            seen.insert(node_row_fingerprint(&row));
            got_terminal |= node_row_is_terminal(&row);
            print_node_row(&row, options.format);

            if options.stop_after_first {
                return Ok(got_terminal);
            }
        }

        if options.stop_on_terminal && got_terminal {
            return Ok(true);
        }

        sleep(options.poll_interval).await;
    }
}
