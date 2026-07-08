//! Effort lifecycle tests — submit, dispatch (respond + router), retry, cancel, summary.
//! Body-only child of `sidecar::tests` (see the `#[path]` decls in tests.rs).
//! `use super::*;` pulls the shared helpers + every sidecar item the parent glob-imports.

use super::*;

#[tokio::test]
async fn sidecar_post_efforts_returns_effort_id() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();
    let effort_id = uuid::Uuid::new_v4().to_string();

    let res = client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&effort_id))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["effortId"].as_str().unwrap(), effort_id);
}

#[tokio::test]
async fn sidecar_get_efforts_lists_submitted() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();
    let id = uuid::Uuid::new_v4().to_string();

    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&id))
        .send()
        .await
        .unwrap();

    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let res = client
        .get(format!("{}/efforts", base(port)))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 200);
    let list: serde_json::Value = res.json().await.unwrap();
    let arr = list.as_array().unwrap();
    assert!(
        !arr.is_empty(),
        "effort list should contain the submitted effort"
    );
    let ids: Vec<&str> = arr.iter().filter_map(|e| e["effortId"].as_str()).collect();
    assert!(ids.contains(&id.as_str()));
}

#[tokio::test]
async fn sidecar_get_effort_by_id_returns_result() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();
    let id = uuid::Uuid::new_v4().to_string();

    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&id))
        .send()
        .await
        .unwrap();

    tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;

    let res = client
        .get(format!("{}/efforts/{id}", base(port)))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["effortId"].as_str().unwrap(), id);
    assert!(body.get("status").is_some());
}

#[tokio::test]
async fn sidecar_get_unknown_effort_returns_404() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();

    let res = client
        .get(format!("{}/efforts/nonexistent-id", base(port)))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 404);
    let body: serde_json::Value = res.json().await.unwrap();
    assert!(body.get("error").is_some());
}

#[tokio::test]
async fn sidecar_summary_reflects_submitted_efforts() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();

    for _ in 0..3 {
        client
            .post(format!("{}/efforts", base(port)))
            .json(&test_effort(&uuid::Uuid::new_v4().to_string()))
            .send()
            .await
            .unwrap();
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let res = client
        .get(format!("{}/efforts/summary", base(port)))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    let total = body["total"].as_u64().unwrap_or(0);
    assert!(
        total >= 3,
        "summary total should include all submitted efforts"
    );
}

#[tokio::test]
async fn sidecar_get_logs_returns_array() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();
    let id = uuid::Uuid::new_v4().to_string();

    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&id))
        .send()
        .await
        .unwrap();

    let res = client
        .get(format!("{}/efforts/{id}/logs", base(port)))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 200);
    let body: serde_json::Value = res.json().await.unwrap();
    assert!(body.is_array(), "logs must return an array");
}

#[tokio::test]
async fn sidecar_retry_unknown_effort_returns_404() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();

    let res = client
        .post(format!("{}/efforts/nonexistent/retry", base(port)))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 404);
}

#[tokio::test]
async fn sidecar_cancel_unknown_effort_returns_404() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();

    let res = client
        .post(format!("{}/efforts/nonexistent/cancel", base(port)))
        .send()
        .await
        .unwrap();

    assert_eq!(res.status(), 404);
}

#[tokio::test]
async fn sidecar_no_plugin_writes_error_stream_chunk() {
    // No agent channel registered → agent not loaded.
    // The sidecar must write an is_final=true error chunk so refarm ask doesn't timeout.
    let (_state, port, tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();
    let id = uuid::Uuid::new_v4().to_string();

    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&id))
        .send()
        .await
        .unwrap();

    // give the async dispatch task time to run
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let streams_dir = tmp.join("streams");
    let found = std::fs::read_dir(&streams_dir)
        .unwrap()
        .filter_map(|e| e.ok())
        .any(|entry| {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("ndjson") {
                return false;
            }
            let content = std::fs::read_to_string(&path).unwrap_or_default();
            content.contains("\"is_final\":true") && content.contains("refarm plugin status")
        });

    assert!(
        found,
        "sidecar must write an is_final stream chunk when plugin is not loaded"
    );
}

#[tokio::test]
async fn sidecar_effort_status_is_failed_when_no_plugin() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();
    let id = uuid::Uuid::new_v4().to_string();

    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&id))
        .send()
        .await
        .unwrap();

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let body: serde_json::Value = client
        .get(format!("{}/efforts/{id}", base(port)))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(
        body["status"].as_str().unwrap(),
        "failed",
        "effort must be failed when @refarm/agent channel is not registered"
    );
}

#[tokio::test]
async fn sidecar_effort_result_survives_state_reopen() {
    let (_state, port, tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();
    let id = uuid::Uuid::new_v4().to_string();

    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&id))
        .send()
        .await
        .unwrap();

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let rehydrated = SidecarState::for_test(&tmp, ":memory:").unwrap();
    let store = rehydrated.efforts.read().expect("effort store poisoned");
    let result = store.get(&id).expect("persisted effort must be rehydrated");

    assert_eq!(result.effort_id, id);
    assert_eq!(result.status, "failed");
    assert!(
        result.completed_at.is_some(),
        "terminal effort must retain completion timestamp"
    );
    assert!(
        result.results.iter().any(|task| task.status == "error"),
        "rehydrated effort must retain task result details"
    );
}

#[tokio::test]
async fn sidecar_effort_fails_when_no_active_agent_loaded() {
    // When no plugin has declared "integration:respond" capability and no channel
    // matches the task's plugin_id, the effort must fail with a clear error.
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();
    let id = uuid::Uuid::new_v4().to_string();

    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort_with_plugin(&id, "@refarm/some-agent"))
        .send()
        .await
        .unwrap();

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let body: serde_json::Value = client
        .get(format!("{}/efforts/{id}", base(port)))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(body["status"].as_str().unwrap(), "failed");
    let error = body["results"][0]["error"].as_str().unwrap();
    assert!(
        error.contains("not loaded"),
        "error should mention 'not loaded', got: {error}"
    );
}

// ── session history tests ─────────────────────────────────────────────────────
//
// These tests use a real SQLite file (not :memory:) so that nodes written in
// test setup are visible when the handler opens its own NativeStorage connection.

/// The operator loop: an effort with fn != respond routes to a non-agent plugin
/// via the neutral router (as <pluginKey>:dispatch), NOT the agent. This is what
/// lets `refarm vault dispatch extract ...` reach the vault plugin from outside.
#[tokio::test]
async fn sidecar_non_respond_effort_dispatches_via_router() {
    let (state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();

    // Stand a mock "vault" plugin: a channel registered in plugin_channels and
    // subscribed to vault:dispatch in the router (what register_for_events does).
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<crate::EventEnvelope>();
    state
        .plugin_channels
        .write()
        .unwrap()
        .insert("vault".to_string(), tx);
    state.event_router.subscribe("vault:dispatch", "vault");

    // Submit an effort whose fn is a verb (extract), not respond.
    let effort = serde_json::json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "direction": "dispatch",
        "tasks": [{
            "id": uuid::Uuid::new_v4().to_string(),
            "pluginId": "vault",
            "fn": "extract",
            "args": { "note": { "path": "n.md", "text": "x" } }
        }],
        "source": "operator",
        "submittedAt": "2026-01-01T00:00:00Z"
    });
    let res = client
        .post(format!("{}/efforts", base(port)))
        .json(&effort)
        .send()
        .await
        .unwrap();
    assert_eq!(res.status(), 200);

    // The mock plugin received the vault:dispatch event carrying the verb.
    let msg = tokio::time::timeout(std::time::Duration::from_secs(2), rx.recv())
        .await
        .expect("router must deliver the event within 2s")
        .expect("the mock vault plugin must receive a message");
    assert_eq!(msg.event, "vault:dispatch");
    let payload: serde_json::Value = serde_json::from_str(msg.payload.as_deref().unwrap()).unwrap();
    assert_eq!(
        payload["verb"], "extract",
        "the payload carries the effort's fn as the verb"
    );
    assert_eq!(
        payload["note"]["path"], "n.md",
        "the args ride along in the payload"
    );

    // Once the event is accepted by a subscriber, the effort's whole job is done:
    // it is `delivered` (terminal, honest), NOT `done`. `done` would lie — the
    // verb result lives out of band as a dispatch-result:v1 node read by replyRef,
    // it is not carried by the effort.
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    let effort_id = effort["id"].as_str().unwrap();
    let body: serde_json::Value = client
        .get(format!("{}/efforts/{effort_id}", base(port)))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        body["status"], "delivered",
        "a dispatched event effort is `delivered` (terminal), not `done`"
    );
    assert!(
        body["completedAt"].is_string(),
        "a terminal (delivered) effort carries a completion timestamp"
    );
    assert_eq!(
        body["results"][0]["status"], "ok",
        "the delivery receipt records the dispatch as ok"
    );
}

/// A non-respond effort for a plugin that subscribes to NOTHING fails honestly —
/// no optimistic done-with-empty-result, an actual error naming the missing
/// subscription.
#[tokio::test]
async fn sidecar_non_respond_effort_with_no_subscriber_fails_honestly() {
    let (_state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();

    let effort_id = uuid::Uuid::new_v4().to_string();
    let effort = serde_json::json!({
        "id": effort_id,
        "direction": "dispatch",
        "tasks": [{
            "id": uuid::Uuid::new_v4().to_string(),
            "pluginId": "ghost",
            "fn": "extract",
            "args": {}
        }],
        "source": "operator",
        "submittedAt": "2026-01-01T00:00:00Z"
    });
    client
        .post(format!("{}/efforts", base(port)))
        .json(&effort)
        .send()
        .await
        .unwrap();

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let res = client
        .get(format!("{}/efforts/{effort_id}", base(port)))
        .send()
        .await
        .unwrap();
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(
        body["status"], "failed",
        "an unrouted event must fail, not fake success"
    );
    let err = body["results"][0]["error"].as_str().unwrap_or("");
    assert!(
        err.contains("ghost:dispatch") || err.contains("subscribed"),
        "the error must name the missing subscription, got: {err}"
    );
}

/// A respond effort whose prompt is accepted by a loaded agent channel does NOT
/// jump to `done`. The answer has not landed yet — the runner will stream it —
/// so the effort stays `in-progress` (non-terminal, no completion timestamp).
/// Previously this optimistically marked `done` the instant the send succeeded,
/// a lie: the effort asserted a result it did not yet carry.
#[tokio::test]
async fn sidecar_respond_effort_stays_in_progress_until_result_lands() {
    let (state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();

    // A loaded agent channel: the send will succeed, but nothing in the test
    // writes the streamed result back, so the effort must remain in-progress.
    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel::<crate::EventEnvelope>();
    state
        .plugin_channels
        .write()
        .unwrap()
        .insert("@refarm/agent".to_string(), tx);

    let id = uuid::Uuid::new_v4().to_string();
    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&id))
        .send()
        .await
        .unwrap();

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let body: serde_json::Value = client
        .get(format!("{}/efforts/{id}", base(port)))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    assert_eq!(
        body["status"], "in-progress",
        "a respond effort whose result has not landed is in-progress, not done"
    );
    assert!(
        body["completedAt"].is_null(),
        "a non-terminal (in-progress) effort must not carry a completion timestamp"
    );
}

/// Cancel is real at the store level: a non-terminal effort transitions to the
/// terminal `cancelled` state and reports it, instead of returning a fake
/// `accepted:true` that changes nothing. (Interrupting a wedged runner thread is
/// a separate concern — the wasmtime timeout slice.)
#[tokio::test]
async fn sidecar_cancel_marks_effort_cancelled() {
    let (state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();

    // Load an agent channel so the respond effort stays in-progress (cancellable).
    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel::<crate::EventEnvelope>();
    state
        .plugin_channels
        .write()
        .unwrap()
        .insert("@refarm/agent".to_string(), tx);

    let id = uuid::Uuid::new_v4().to_string();
    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&id))
        .send()
        .await
        .unwrap();

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    let cancel = client
        .post(format!("{}/efforts/{id}/cancel", base(port)))
        .send()
        .await
        .unwrap();
    assert_eq!(
        cancel.status(),
        202,
        "cancel of an in-progress effort is accepted"
    );

    let body: serde_json::Value = client
        .get(format!("{}/efforts/{id}", base(port)))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        body["status"], "cancelled",
        "cancel actually transitions the effort to the terminal cancelled state"
    );
    assert!(
        body["completedAt"].is_string(),
        "a cancelled (terminal) effort carries a completion timestamp"
    );

    // A second cancel is refused: the effort is already terminal.
    let again = client
        .post(format!("{}/efforts/{id}/cancel", base(port)))
        .send()
        .await
        .unwrap();
    assert_eq!(
        again.status(),
        409,
        "cancel of an already-terminal effort is a conflict"
    );
}

/// Closing the state machine: a respond effort transitions in-progress -> done
/// when the agent's terminal AgentResponse node lands, carrying the real answer.
/// The watcher correlates by prompt_ref (derived from effort_id) and finalises
/// on the first is_final node — NOT a fake done on send.
#[tokio::test]
async fn sidecar_respond_effort_finalises_done_when_terminal_response_lands() {
    let (state, port, _tmp, ns) = start_effort_sidecar_ns().await;
    let client = reqwest::Client::new();

    // Loaded agent channel so the prompt send succeeds and the watcher starts.
    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel::<crate::EventEnvelope>();
    state
        .plugin_channels
        .write()
        .unwrap()
        .insert("@refarm/agent".to_string(), tx);

    let id = uuid::Uuid::new_v4().to_string();
    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&id))
        .send()
        .await
        .unwrap();

    // The effort is in-progress until the answer lands.
    tokio::time::sleep(tokio::time::Duration::from_millis(80)).await;
    let mid: serde_json::Value = client
        .get(format!("{}/efforts/{id}", base(port)))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        mid["status"], "in-progress",
        "still in-progress before the answer lands"
    );

    // The agent writes its terminal AgentResponse (what wasi_bridge does).
    let prompt_ref = prompt_ref_from_effort(&id);
    write_agent_response(&ns, "urn:node:resp-1", &prompt_ref, "the answer", true);

    // The watcher polls (100ms) and finalises to done with the real content.
    let mut done = false;
    for _ in 0..40 {
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        let body: serde_json::Value = client
            .get(format!("{}/efforts/{id}", base(port)))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        if body["status"] == "done" {
            assert!(
                body["completedAt"].is_string(),
                "done effort carries completedAt"
            );
            assert_eq!(
                body["results"][0]["result"]["content"], "the answer",
                "the finalised effort carries the real agent answer, not a fake"
            );
            done = true;
            break;
        }
    }
    assert!(
        done,
        "respond effort must finalise to done once the terminal AgentResponse lands"
    );
}

/// A respond effort whose agent never produces a terminal node finalises to the
/// terminal `timed-out` state after the (env-overridable) deadline — the watcher
/// never leaks and the effort never sits in-progress forever.
#[tokio::test]
async fn sidecar_respond_effort_times_out_when_agent_silent() {
    // Shrink the watch timeout so the test is fast — injected via config, not
    // process env (which leaks across threads under --test-threads>1).
    let (state, port, _tmp, _ns) =
        start_effort_sidecar_ns_with_watch(crate::sidecar::RespondWatchConfig {
            timeout_ms: 150,
            interval_ms: 100,
        })
        .await;
    let client = reqwest::Client::new();

    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel::<crate::EventEnvelope>();
    state
        .plugin_channels
        .write()
        .unwrap()
        .insert("@refarm/agent".to_string(), tx);

    let id = uuid::Uuid::new_v4().to_string();
    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&id))
        .send()
        .await
        .unwrap();

    // No AgentResponse node is ever written. After the deadline the watcher must
    // finalise to timed-out.
    let mut timed_out = false;
    for _ in 0..40 {
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        let body: serde_json::Value = client
            .get(format!("{}/efforts/{id}", base(port)))
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        if body["status"] == "timed-out" {
            assert!(
                body["completedAt"].is_string(),
                "timed-out effort carries completedAt"
            );
            timed_out = true;
            break;
        }
    }
    assert!(
        timed_out,
        "a silent respond effort must finalise to timed-out, not sit in-progress forever"
    );
}

/// DEBT B: retry of a terminal effort re-dispatches the RETAINED original effort
/// (tasks/args), instead of the old fake accepted:true (or the 501 that replaced
/// it). The effort here fails fast (no plugin) → terminal `failed` → retry is
/// accepted and re-runs it (failing again, but really re-dispatched).
#[tokio::test]
async fn sidecar_retry_redispatches_retained_effort() {
    let (state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();

    let id = uuid::Uuid::new_v4().to_string();
    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&id))
        .send()
        .await
        .unwrap();

    // No agent loaded → the effort finalises to `failed` (terminal).
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    let before: serde_json::Value = client
        .get(format!("{}/efforts/{id}", base(port)))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        before["status"], "failed",
        "unrouted respond effort is terminal failed"
    );

    // The original Effort was retained, so retry re-dispatches it (202 accepted).
    let retry = client
        .post(format!("{}/efforts/{id}/retry", base(port)))
        .send()
        .await
        .unwrap();
    assert_eq!(
        retry.status(),
        202,
        "retry of a retained terminal effort is accepted"
    );
    let retry_body: serde_json::Value = retry.json().await.unwrap();
    assert_eq!(retry_body["accepted"], true);

    // Proof it actually re-ran: the input map still holds it and it is terminal
    // again after the re-dispatch cycle.
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    let after: serde_json::Value = client
        .get(format!("{}/efforts/{id}", base(port)))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        after["status"], "failed",
        "re-dispatched effort ran again and re-reached terminal"
    );
    assert!(
        state.efforts_input.read().unwrap().contains_key(&id),
        "the retained effort input survives a retry cycle"
    );
}

/// Retry of an unknown effort is 404; retry of a non-terminal effort is 409.
#[tokio::test]
async fn sidecar_retry_guards_unknown_and_non_terminal() {
    let (state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();

    // Unknown → 404.
    let unknown = client
        .post(format!("{}/efforts/does-not-exist/retry", base(port)))
        .send()
        .await
        .unwrap();
    assert_eq!(unknown.status(), 404);

    // A live agent channel keeps a respond effort in-progress (non-terminal).
    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel::<crate::EventEnvelope>();
    state
        .plugin_channels
        .write()
        .unwrap()
        .insert("@refarm/agent".to_string(), tx);
    let id = uuid::Uuid::new_v4().to_string();
    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&id))
        .send()
        .await
        .unwrap();
    tokio::time::sleep(tokio::time::Duration::from_millis(80)).await;

    let non_terminal = client
        .post(format!("{}/efforts/{id}/retry", base(port)))
        .send()
        .await
        .unwrap();
    assert_eq!(
        non_terminal.status(),
        409,
        "retry of an in-progress effort is a conflict"
    );
}

/// Cancel force-interrupt wiring: cancelling an effort flips the target plugin's
/// cancel flag (which its store epoch callback observes to trap a wedged guest).
/// This is the sidecar half of SLICE 2 — the host half (a set flag actually
/// interrupting a spinning guest) is proven in the P1 loader tests.
#[tokio::test]
async fn sidecar_cancel_sets_plugin_cancel_flag() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let (state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();

    // A loaded agent channel keeps the respond effort in-progress (cancellable),
    // and it is the active agent (the effort's dispatch target).
    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel::<crate::EventEnvelope>();
    state
        .plugin_channels
        .write()
        .unwrap()
        .insert("@refarm/agent".to_string(), tx);
    *state.default_responder_id.write().unwrap() = Some("@refarm/agent".to_string());

    // Register the plugin's cancel flag (as register_for_events would).
    let flag = Arc::new(AtomicBool::new(false));
    state
        .cancel_flags
        .write()
        .unwrap()
        .insert("@refarm/agent".to_string(), flag.clone());

    let id = uuid::Uuid::new_v4().to_string();
    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&id))
        .send()
        .await
        .unwrap();
    tokio::time::sleep(tokio::time::Duration::from_millis(80)).await;

    assert!(!flag.load(Ordering::SeqCst), "flag starts unset");

    let cancel = client
        .post(format!("{}/efforts/{id}/cancel", base(port)))
        .send()
        .await
        .unwrap();
    assert_eq!(cancel.status(), 202);

    assert!(
        flag.load(Ordering::SeqCst),
        "cancel must set the target plugin's cancel flag to force-interrupt a wedged guest"
    );
}

/// Precise effort→store cancel (the pool case): a runner registers its store's
/// cancel flag under the prompt_ref it is running. Cancelling ONE effort must
/// flip ONLY that store's flag — not a neighbour store running a different
/// prompt (which, under a pool, drains the same queue). This proves the cancel
/// targets the exact in-flight store, with or without a pool.
#[tokio::test]
async fn sidecar_cancel_targets_only_the_in_flight_store() {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let (state, port, _tmp) = start_test_sidecar().await;
    let client = reqwest::Client::new();

    let (tx, _rx) = tokio::sync::mpsc::unbounded_channel::<crate::EventEnvelope>();
    state
        .plugin_channels
        .write()
        .unwrap()
        .insert("@refarm/agent".to_string(), tx);

    // Two efforts, each "running" on its own store — register each store's flag
    // under its own prompt_ref, as a pooled runner would.
    let target_id = uuid::Uuid::new_v4().to_string();
    let neighbour_id = uuid::Uuid::new_v4().to_string();
    let target_flag = Arc::new(AtomicBool::new(false));
    let neighbour_flag = Arc::new(AtomicBool::new(false));
    {
        let mut inflight = state.in_flight_cancels.write().unwrap();
        inflight.insert(
            super::super::prompt_ref_from_effort(&target_id),
            target_flag.clone(),
        );
        inflight.insert(
            super::super::prompt_ref_from_effort(&neighbour_id),
            neighbour_flag.clone(),
        );
    }

    // Submit the target effort so it's a known, non-terminal effort to cancel.
    client
        .post(format!("{}/efforts", base(port)))
        .json(&test_effort(&target_id))
        .send()
        .await
        .unwrap();
    tokio::time::sleep(tokio::time::Duration::from_millis(80)).await;

    let cancel = client
        .post(format!("{}/efforts/{target_id}/cancel", base(port)))
        .send()
        .await
        .unwrap();
    assert_eq!(cancel.status(), 202);

    assert!(
        target_flag.load(Ordering::SeqCst),
        "cancel must flip the flag of the store running the target effort"
    );
    assert!(
        !neighbour_flag.load(Ordering::SeqCst),
        "cancel must NOT flip a neighbour store running a different prompt"
    );
}

// ── generalized terminal-result watcher (de-agent-ified) ──────────────────────

#[test]
fn find_terminal_result_matches_by_descriptor_and_surfaces_is_error() {
    use crate::sidecar::dispatch::{find_terminal_result, TerminalResultSpec};

    let ns = format!("/tmp/tractor-find-terminal-{}.db", uuid::Uuid::new_v4());
    let storage = crate::storage::NativeStorage::open(&ns).unwrap();
    let store = |id: &str, type_: &str, payload: serde_json::Value| {
        storage
            .store_node(id, type_, None, &payload.to_string(), None)
            .unwrap();
    };

    // A GENERIC (non-agent) terminal result node — any plugin could write this.
    store(
        "n1",
        "VaultResult",
        serde_json::json!({ "corr": "job-1", "done": true, "content": "ok-body" }),
    );
    // A terminal ERROR node for a different correlation.
    store(
        "n2",
        "VaultResult",
        serde_json::json!({ "corr": "job-2", "done": true, "is_error": true, "content": "boom" }),
    );
    // A non-terminal node — must be ignored.
    store(
        "n3",
        "VaultResult",
        serde_json::json!({ "corr": "job-3", "done": false, "content": "partial" }),
    );

    let spec = |corr: &str| TerminalResultSpec {
        node_type: "VaultResult".to_string(),
        correlation_key: "corr".to_string(),
        correlation_value: corr.to_string(),
        terminal_flag_field: "done".to_string(),
    };

    // Success terminal node → found, not an error.
    let ok = find_terminal_result(&ns, &spec("job-1")).expect("job-1 terminal found");
    assert_eq!(ok.content, "ok-body");
    assert!(!ok.is_error);

    // Error terminal node → found, is_error surfaced (this is how a guest failure
    // finalises `failed` instead of a 45s false `timed-out`).
    let err = find_terminal_result(&ns, &spec("job-2")).expect("job-2 terminal found");
    assert_eq!(err.content, "boom");
    assert!(
        err.is_error,
        "an is_error node must surface as a terminal error"
    );

    // Non-terminal node → not found.
    assert!(
        find_terminal_result(&ns, &spec("job-3")).is_none(),
        "a non-terminal node must not be treated as a terminal result"
    );

    // The agent default spec still resolves the AgentResponse shape.
    store(
        "n4",
        "Response",
        serde_json::json!({ "prompt_ref": "urn:p:1", "is_final": true, "content": "answer" }),
    );
    let agent = find_terminal_result(&ns, &TerminalResultSpec::agent_response("urn:p:1"))
        .expect("agent default spec finds AgentResponse");
    assert_eq!(agent.content, "answer");
    assert!(!agent.is_error);

    let _ = std::fs::remove_file(&ns);
}
