//! THE TEETH OF "RUST NEVER CONSTRUCTS A COMMAND LINE".
//!
//! Body-only child of `sidecar::remote_initiation` (see the `#[path]` decl there).
//!
//! Run: `cargo test --lib remote_initiation --quiet`
//!
//! Four of these are load-bearing and were mutation-verified — the mutation is named in each,
//! and applying it makes exactly that test fail:
//!
//!   1. [`every_byte_a_caller_sends_lands_in_exactly_one_argv_element`] — replace the single
//!      `push` in `start_invocation` with `extend(operation.split_whitespace())` (or any
//!      other splitting/joining) and the constant-length assertion fails on the first
//!      adversarial id.
//!   2. [`this_module_builds_exactly_one_command_and_never_a_shell`] — add a second
//!      `Command::new`, or route the spawn through `sh -c`, and the source-text guard fails.
//!   3. [`a_prompt_only_credential_cannot_operate`] — confuse prompt authority with operation
//!      authority and the scoped credential starts getting through.
//!   4. [`the_ceiling_holds`] — raise `MAX_STARTED_OPERATIONS`, or drop the claim, and a
//!      second start is admitted.

use super::*;

use crate::sidecar::auth::{
    sha256_hex, AuthGate, AuthPolicy, Credential, RouteRequirement, ScopedCredential, Scope,
};
use crate::sidecar::node_local::ListenRole;
use crate::sidecar::{listener_router, sidecar_routes, SidecarState};
use axum::http::Method;
use tokio::net::TcpListener;

/// The module's own source, so the rule the compiler cannot check is checked by reading it.
/// Lives HERE rather than in the scanned file on purpose: a needle spelled in the file it
/// searches would match itself.
const MODULE_SOURCE: &str = include_str!("remote_initiation.rs");

// ══════════════════════════════════════════════════════════════════════════════════
// THE ARGV — no request input becomes command STRUCTURE
// ══════════════════════════════════════════════════════════════════════════════════

/// Ids chosen to be exactly what a command-line-building bug would mangle: shell
/// metacharacters, whitespace, option-looking tokens, newlines, NUL-adjacent control
/// characters, and something absurdly long.
fn adversarial_operations() -> Vec<String> {
    vec![
        "delivery add".to_string(),
        "delivery add; rm -rf ~".to_string(),
        "delivery add && curl evil".to_string(),
        "delivery add | tee /tmp/x".to_string(),
        "$(whoami)".to_string(),
        "`whoami`".to_string(),
        "--help".to_string(),
        "-rf".to_string(),
        "  leading and trailing  ".to_string(),
        "a\nb\nc".to_string(),
        "a\tb".to_string(),
        "'quoted'".to_string(),
        "\"quoted\"".to_string(),
        "..\\/../etc/passwd".to_string(),
        String::new(),
        "x".repeat(100_000),
    ]
}

#[test]
fn every_byte_a_caller_sends_lands_in_exactly_one_argv_element() {
    // MUTATION-VERIFIED. This is the rule, stated as arithmetic: whatever a caller sends,
    // the argument VECTOR has the same shape and the same length. Nothing a request carries
    // can add an argument, remove one, or become part of one it did not start in.
    let entrypoint = Path::new("/opt/refarm/bin/refarm");
    for operation in adversarial_operations() {
        let invocation = start_invocation(entrypoint, &operation);
        assert_eq!(
            invocation.program, entrypoint,
            "the program is the resolved entrypoint, never anything derived from input"
        );
        assert_eq!(
            invocation.args.len(),
            START_SUBCOMMAND.len() + 1,
            "argv length is a CONSTANT — {operation:?} must not become more (or fewer) arguments"
        );
        assert_eq!(
            &invocation.args[..START_SUBCOMMAND.len()],
            &START_SUBCOMMAND
                .iter()
                .map(|token| token.to_string())
                .collect::<Vec<_>>()[..],
            "the subcommand is three constants and stays three constants"
        );
        assert_eq!(
            invocation.args[START_SUBCOMMAND.len()], operation,
            "the caller's bytes are passed through verbatim, in one element — not trimmed, \
             not quoted, not escaped, not split"
        );
    }
}

#[test]
fn the_catalog_argv_has_no_room_for_input_at_all() {
    let invocation = catalog_invocation(Path::new("/opt/refarm/bin/refarm"));
    assert_eq!(invocation.args, vec!["auth", "remote", "--json"]);
    assert_eq!(invocation.args.len(), CATALOG_SUBCOMMAND.len());
}

#[test]
fn this_module_builds_exactly_one_command_and_never_a_shell() {
    // MUTATION-VERIFIED. The structural claim in the header, enforced by reading the source:
    // there is ONE process constructor in this module and it takes the resolved entrypoint
    // path. A second one, or a shell, is the bug this catches.
    assert_eq!(
        MODULE_SOURCE.matches("Command::new(").count(),
        1,
        "exactly one process constructor may exist in this module"
    );
    assert!(
        MODULE_SOURCE.contains("Command::new(&invocation.program)"),
        "and it must be fed the resolved entrypoint path, never a string built from a request"
    );
    for forbidden in [
        "\"sh\"",
        "\"bash\"",
        "\"-c\"",
        "sh -c",
        "shell",
        "args.join",
        "split_whitespace",
        "shlex",
    ] {
        assert!(
            !MODULE_SOURCE.contains(forbidden),
            "{forbidden:?} has no business in a module that must never build a command line"
        );
    }
}

// ══════════════════════════════════════════════════════════════════════════════════
// THE ENTRYPOINT — the operator's declaration, in declared order
// ══════════════════════════════════════════════════════════════════════════════════

#[test]
fn the_entrypoint_is_found_in_the_declared_order_and_nowhere_else() {
    let declared = vec![
        "/first".to_string(),
        "/second".to_string(),
        "/third".to_string(),
    ];
    // Present in two of them: declared order decides, exactly as it decides PATH search.
    let found = find_entrypoint(&declared, |path| {
        path == Path::new("/second/refarm") || path == Path::new("/third/refarm")
    });
    assert_eq!(found, Some(PathBuf::from("/second/refarm")));

    // Present in none of them: refused, never widened to somewhere undeclared.
    assert_eq!(find_entrypoint(&declared, |_| false), None);
    // An empty declaration searches nothing at all.
    assert_eq!(find_entrypoint(&[], |_| true), None);
}

#[test]
fn only_a_file_named_refarm_inside_a_declared_directory_is_ever_a_candidate() {
    let probed: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());
    let declared = vec!["/a".to_string(), "/b".to_string()];
    let _ = find_entrypoint(&declared, |path| {
        probed.lock().unwrap().push(path.to_path_buf());
        false
    });
    assert_eq!(
        probed.into_inner().unwrap(),
        vec![PathBuf::from("/a/refarm"), PathBuf::from("/b/refarm")],
        "the only filesystem question asked is 'is THIS path executable' — never 'what does \
         the ambient PATH say'"
    );
}

// ══════════════════════════════════════════════════════════════════════════════════
// THE VERDICT — three answers kept apart, and a fourth that is not believed
// ══════════════════════════════════════════════════════════════════════════════════

#[test]
fn a_verdict_is_relayed_and_never_reinterpreted() {
    assert_eq!(
        parse_verdict(r#"{"wire":"remote-initiation.v1","ok":true,"operation":"delivery add"}"#),
        Some(Verdict::Started {
            operation: "delivery add".to_string()
        })
    );
    assert_eq!(
        parse_verdict(
            r#"{"wire":"remote-initiation.v1","ok":false,"reason":"unknown-operation","detail":"d"}"#
        ),
        Some(Verdict::UnknownOperation {
            detail: "d".to_string()
        })
    );
    assert_eq!(
        parse_verdict(
            r#"{"wire":"remote-initiation.v1","ok":false,"reason":"not-remotely-invocable","detail":"d"}"#
        ),
        Some(Verdict::NotRemotelyInvocable {
            detail: "d".to_string()
        })
    );
}

#[test]
fn anything_that_is_not_a_verdict_is_not_read_as_one() {
    for line in [
        "",
        "   ",
        "not json at all",
        r#"{"ok":true,"operation":"delivery add"}"#,               // no wire
        r#"{"wire":"pending-prompt.v1","ok":true,"operation":"x"}"#, // wrong wire
        r#"{"wire":"remote-initiation.v1"}"#,                      // no ok
        r#"{"wire":"remote-initiation.v1","ok":true}"#,            // ok, but names nothing
        r#"{"wire":"remote-initiation.v1","ok":false}"#,           // refused, but says nothing
        // A reason this build does not know is NOT narrowed to one it does. Fail-closed:
        // the caller is told `could-not-start`, which is true, rather than a refusal this
        // node invented.
        r#"{"wire":"remote-initiation.v1","ok":false,"reason":"whatever","detail":"d"}"#,
        r#"[{"wire":"remote-initiation.v1","ok":true,"operation":"x"}]"#,
    ] {
        assert_eq!(parse_verdict(line), None, "{line:?} must not parse as a verdict");
    }
}

#[tokio::test]
async fn the_verdict_read_is_bounded_by_lines_and_by_bytes() {
    // A child that floods stdout must not make the daemon buffer it, and must not be able to
    // hide a verdict past the ceiling and have it honoured.
    let noise = "not a verdict\n".repeat(MAX_VERDICT_LINES + 10);
    let mut reader = BufReader::new(noise.as_bytes());
    assert_eq!(read_verdict(&mut reader).await, None, "the line ceiling holds");

    let mut huge = "x".repeat(MAX_VERDICT_BYTES + 1);
    huge.push('\n');
    huge.push_str(r#"{"wire":"remote-initiation.v1","ok":true,"operation":"delivery add"}"#);
    huge.push('\n');
    let mut reader = BufReader::new(huge.as_bytes());
    assert_eq!(read_verdict(&mut reader).await, None, "the byte ceiling holds");

    // And a verdict preceded by ordinary noise IS found — the bound is a ceiling, not a
    // requirement that the verdict be the very first byte.
    let mut ok = String::from("some banner\n\n");
    ok.push_str(r#"{"wire":"remote-initiation.v1","ok":true,"operation":"delivery add"}"#);
    ok.push('\n');
    let mut reader = BufReader::new(ok.as_bytes());
    assert_eq!(
        read_verdict(&mut reader).await,
        Some(Verdict::Started {
            operation: "delivery add".to_string()
        })
    );
}

// ══════════════════════════════════════════════════════════════════════════════════
// THE CEILING
// ══════════════════════════════════════════════════════════════════════════════════

#[test]
fn the_ceiling_holds() {
    // MUTATION-VERIFIED. Raise MAX_STARTED_OPERATIONS or drop the claim and the second start
    // is admitted.
    assert_eq!(MAX_STARTED_OPERATIONS, 1, "the stated bound, pinned");
    assert_eq!(MAX_CATALOG_READS, 1, "the stated bound, pinned");

    let registry = RemoteInitiations::new();
    let first = registry.claim_start().expect("the first start takes the slot");
    assert!(registry.started_in_flight());
    // Nothing is told what is running until the entrypoint CONFIRMED the id is declared —
    // one caller's raw input is never echoed to a different caller.
    assert_eq!(
        registry.claim_start().err(),
        Some(StartedConflict { run_id: first.run_id().to_string(), operation: None }),
        "the second is refused"
    );

    registry.confirm_started("delivery add");
    assert_eq!(
        registry.claim_start().err(),
        Some(StartedConflict {
            run_id: first.run_id().to_string(),
            operation: Some("delivery add".to_string()),
        }),
        "and once confirmed, a competing caller is told WHAT is running"
    );

    drop(first);
    assert!(!registry.started_in_flight(), "Drop is the release");
    assert!(registry.claim_start().is_ok(), "so the next start is admitted");
}

#[test]
fn lifecycle_retains_only_the_latest_confirmed_run() {
    let registry = RemoteInitiations::new();
    let first = registry.claim_start().expect("first run");
    let first_id = first.run_id().to_string();
    assert!(registry.run(&first_id).is_none(), "raw input is not a run");

    registry.confirm_started("workspace:home:refresh");
    let running = registry.run(&first_id).expect("confirmed run is visible");
    assert_eq!(running.state, "running");
    assert_eq!(running.operation, "workspace:home:refresh");
    registry.complete(&first_id, Some(0));
    assert_eq!(registry.run(&first_id).unwrap().state, "succeeded");
    assert!(matches!(registry.request_cancel(&first_id), CancelRequest::Finished(_)));
    drop(first);

    let second = registry.claim_start().expect("second run");
    let second_id = second.run_id().to_string();
    registry.confirm_started("workspace:work:sync");
    registry.complete(&second_id, Some(7));
    let failed = registry.run(&second_id).expect("latest retained");
    assert_eq!(failed.state, "failed");
    assert_eq!(failed.exit_code, Some(7));
    assert!(registry.run(&first_id).is_none(), "history is bounded to one run");
}

#[test]
fn cancellation_targets_only_the_current_running_id() {
    let registry = RemoteInitiations::new();
    let slot = registry.claim_start().expect("start");
    let run_id = slot.run_id().to_string();
    registry.confirm_started("delivery add");

    assert!(matches!(registry.request_cancel("r-other"), CancelRequest::Unknown));
    assert!(matches!(registry.request_cancel(&run_id), CancelRequest::Requested(_)));
    registry.cancelled(&run_id);
    assert_eq!(registry.run(&run_id).unwrap().state, "cancelled");
    assert!(matches!(registry.request_cancel(&run_id), CancelRequest::Finished(_)));
    drop(slot);
}

#[test]
fn the_catalog_ceiling_holds_and_releases() {
    let registry = RemoteInitiations::new();
    let first = registry.claim_catalog().expect("the first read takes the slot");
    assert_eq!(registry.catalog_in_flight(), 1);
    assert!(registry.claim_catalog().is_none(), "the second is refused");
    drop(first);
    assert_eq!(registry.catalog_in_flight(), 0);
    assert!(registry.claim_catalog().is_some());
}

#[test]
fn the_two_ceilings_are_independent() {
    // Starting a wizard must not make the node unable to say what it can start.
    let registry = RemoteInitiations::new();
    let _started = registry.claim_start().expect("start");
    assert!(
        registry.claim_catalog().is_some(),
        "a running operation must not close the catalog — the phone still has to be able to \
         ask what this node offers"
    );
}

// ══════════════════════════════════════════════════════════════════════════════════
// NARROW SCOPES, OVER A REAL SOCKET
// ══════════════════════════════════════════════════════════════════════════════════

#[test]
fn the_routes_declare_read_and_start_separately() {
    assert_eq!(
        crate::sidecar::auth::route_requirement(&Method::GET, ROUTE_OPERATIONS),
        RouteRequirement::Scoped(Scope::ReadOperations)
    );
    assert_eq!(
        crate::sidecar::auth::route_requirement(&Method::POST, ROUTE_OPERATIONS),
        RouteRequirement::Scoped(Scope::StartOperations)
    );
    assert_eq!(
        crate::sidecar::auth::route_requirement(&Method::GET, "/operations/r-one"),
        RouteRequirement::Scoped(Scope::ReadOperations)
    );
    assert_eq!(
        crate::sidecar::auth::route_requirement(&Method::POST, "/operations/r-one/cancel"),
        RouteRequirement::Scoped(Scope::StartOperations)
    );
}

const DEVICE_TOKEN: &str = "device-token-for-initiation";
const SCOPED_TOKEN: &str = "scoped-token-for-answering";
const OPERATOR_TOKEN: &str = "scoped-token-for-operations";

/// Far enough ahead that the scoped credential is LIVE for the whole run — the refusal under
/// test must be about authority, never about a deadline that happened to pass.
const FAR_FUTURE_MS: i64 = 4_102_444_800_000; // 2100-01-01T00:00:00Z

/// A gate holding one full device credential and one `prompt:answer` scoped credential —
/// exactly the pair a node has once the operator has enrolled a phone and verified a browser.
fn gate_with_both() -> AuthGate {
    AuthGate::for_test(AuthPolicy::from_parts(
        vec![Credential {
            token_sha256: sha256_hex(DEVICE_TOKEN),
            identity: "id-phone".to_string(),
        }],
        vec![ScopedCredential {
            token_sha256: sha256_hex(SCOPED_TOKEN),
            identity: "id-browser".to_string(),
            scope: vec![Scope::AnswerPrompts],
            expires_at_ms: FAR_FUTURE_MS,
        }, ScopedCredential {
            token_sha256: sha256_hex(OPERATOR_TOKEN),
            identity: "id-browser-operator".to_string(),
            scope: vec![Scope::ReadOperations, Scope::StartOperations],
            expires_at_ms: FAR_FUTURE_MS,
        }],
    ))
}

/// The real production router on a real socket, labelled `Declared` so the gate is attached.
async fn serve_declared() -> (u16, PathBuf) {
    let tmp = std::env::temp_dir().join(format!("tractor-remote-init-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&tmp).unwrap();
    let state = SidecarState::for_test(&tmp, ":memory:").unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let router = listener_router(
        sidecar_routes(state),
        ListenRole::Declared,
        Some(gate_with_both()),
        None,
    );
    tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });
    (port, tmp)
}

async fn post_operation(port: u16, token: Option<&str>) -> reqwest::StatusCode {
    let mut request = reqwest::Client::new()
        .post(format!("http://127.0.0.1:{port}{ROUTE_OPERATIONS}"))
        .json(&serde_json::json!({ "operation": "delivery add" }));
    if let Some(token) = token {
        request = request.header("Authorization", format!("Bearer {token}"));
    }
    request.send().await.unwrap().status()
}

#[tokio::test]
async fn a_prompt_only_credential_cannot_operate() {
    let (port, _tmp) = serve_declared().await;
    assert_eq!(
        post_operation(port, Some(SCOPED_TOKEN)).await,
        401,
        "answering prompts does not imply starting operations"
    );
    assert_eq!(
        reqwest::Client::new()
            .get(format!("http://127.0.0.1:{port}{ROUTE_OPERATIONS}"))
            .header("Authorization", format!("Bearer {SCOPED_TOKEN}"))
            .send()
            .await
            .unwrap()
            .status(),
        401,
        "answering prompts does not imply reading the operation catalog"
    );
    assert_eq!(
        reqwest::Client::new()
            .get(format!(
                "http://127.0.0.1:{port}{ROUTE_OPERATIONS}/r-does-not-exist"
            ))
            .header("Authorization", format!("Bearer {SCOPED_TOKEN}"))
            .send()
            .await
            .unwrap()
            .status(),
        401,
        "prompt authority does not imply lifecycle visibility"
    );
}

#[tokio::test]
async fn an_operation_scoped_credential_reaches_both_operation_handlers() {
    let (port, _tmp) = serve_declared().await;
    assert_ne!(post_operation(port, Some(OPERATOR_TOKEN)).await, 401);
    assert_ne!(
        reqwest::Client::new()
            .get(format!("http://127.0.0.1:{port}{ROUTE_OPERATIONS}"))
            .header("Authorization", format!("Bearer {OPERATOR_TOKEN}"))
            .send().await.unwrap().status(),
        401
    );
}

#[tokio::test]
async fn no_credential_at_all_cannot_start_anything() {
    let (port, _tmp) = serve_declared().await;
    assert_eq!(post_operation(port, None).await, 401);
    assert_eq!(post_operation(port, Some("not-a-real-token")).await, 401);
}

#[tokio::test]
async fn a_device_credential_reaches_the_handler_and_is_answered_on_its_merits() {
    // The other half of the gate assertion: the device credential is NOT refused at the door.
    // What it meets past the door is this test environment's own answer — the temp cwd
    // declares no `spawnEnv.path`, so the node honestly reports it could not start anything
    // rather than pretending. Which of `503`/`409` it is depends on nothing a caller sends,
    // and `401` is the one answer it must never be.
    let (port, _tmp) = serve_declared().await;
    let status = post_operation(port, Some(DEVICE_TOKEN)).await;
    assert_ne!(status, 401, "an enrolled device is admitted by the gate");
    assert_ne!(status, 403, "and is not refused as out of scope either");
}

#[tokio::test]
async fn a_request_that_names_no_operation_is_refused_before_anything_is_spawned() {
    let (port, _tmp) = serve_declared().await;
    for body in [
        serde_json::json!({}),
        serde_json::json!({ "operation": 7 }),
        serde_json::json!({ "operation": null }),
        // A field that is not `operation` is not consulted, not merged, not defaulted.
        serde_json::json!({ "argv": ["delivery", "add"] }),
        serde_json::json!({ "command": "delivery add" }),
    ] {
        let response = reqwest::Client::new()
            .post(format!("http://127.0.0.1:{port}{ROUTE_OPERATIONS}"))
            .header("Authorization", format!("Bearer {DEVICE_TOKEN}"))
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 400, "{body} names no operation");
        let parsed: serde_json::Value = response.json().await.unwrap();
        assert_eq!(parsed["error"], "no-operation");
        assert_eq!(parsed["wire"], REMOTE_INITIATION_WIRE);
    }
}
