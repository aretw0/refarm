//! Resolve `expose: "tailnet"` to a concrete bind address — the answer to open question 1
//! in docs/superpowers/specs/2026-07-29-declared-surfaces-design.md ("who resolves
//! `tailnet`, and how?").
//!
//! S2 of that design says `tailnet` is INTENT, not an address: the operator declares it,
//! the runtime discovers this machine's tailnet IPv4 and binds exactly to it, fail-closed
//! — if the tailnet cannot be confirmed usable, refuse to start rather than fall back to
//! something wider or narrower. This module is that resolver.
//!
//! ## Three ways to ask, and why this one
//!
//! Measured directly, on a machine actually joined to a tailnet:
//! - `tailscale ip -4` — gives the address on success, but a non-zero exit cannot say WHY
//!   it failed (down? not logged in? not installed? all look identical from the outside).
//! - `ip -br addr show tailscale0` — no CLI dependency, but couples to a Linux-specific
//!   interface name and, like `ip -4`, cannot explain a failure either.
//! - `tailscale status --json` — THE ONLY SOURCE THAT EXPLAINS ITSELF: its `BackendState`
//!   field names exactly why the tailnet isn't usable when it isn't. This resolver trusts
//!   the JSON BODY over the process exit code — see `fetch_tailscale_status_json`'s own
//!   doc for why exit status is deliberately not part of the classification at all.
//!
//! ## The two refusals, and why they must never collapse into one
//!
//! The fail-closed promise needs the OPERATOR to be able to tell two utterly different
//! remedies apart at a glance — exactly the `down` vs `unknown` split the repo's
//! connection engine already leans on everywhere something asks the world a question and
//! must be honest about not getting an answer:
//!
//! - [`TailnetRefusal::Down`] — we asked, Tailscale answered COMPLETELY, and the answer is
//!   "this device has no usable tailnet identity right now" (`BackendState` isn't
//!   `"Running"`, `Self.Online` is `false`, or there is no IPv4 address to bind). The
//!   operator's fix is ON THE TAILSCALE SIDE: bring it up, log in, wait for it to come
//!   online, or fix the tailnet's address allocation.
//! - [`TailnetRefusal::CouldNotAsk`] — we never got a trustworthy answer at all (the
//!   binary is missing, the process wouldn't spawn, it timed out, or the output isn't the
//!   shape this resolver understands). The operator's fix is the OPPOSITE: install the
//!   CLI, check permissions, or investigate why the local invocation itself is broken —
//!   nothing here says anything about the state of the tailnet.
//!
//! Collapsing these into one message is the actual defect this module exists to prevent —
//! see the `mutation_guard_*` tests at the bottom of this file.
//!
//! ## Structure: pure classifier + thin injectable fetcher
//!
//! [`resolve_ipv4_from_status_json`] is a PURE function over an already-fetched JSON
//! string — no process, no I/O, no network — so every scenario the design calls for
//! (Running, Stopped, NeedsLogin, `Self.Online: false`, IPv6-only, malformed JSON, missing
//! fields) is exercised against real or realistic fixtures with no `tailscale` binary
//! anywhere near the test process. [`resolve_tailnet_bind_ip_with`] composes it with an
//! INJECTABLE fetcher closure, so the spawn-failure/timeout paths are ALSO tested by
//! injecting a canned `Err(TailnetRefusal::CouldNotAsk(..))` — never a real spawn. Only
//! [`resolve_tailnet_bind_ip`] (the production entry point) wires in the real fetcher,
//! and it has no test of its own — see `fetch_tailscale_status_json`'s doc.

use std::net::IpAddr;

use crate::host::{SurfaceDeclaration, SurfaceExpose};

/// A refusal to resolve `expose: "tailnet"` into a bind address — see the module doc for
/// why exactly these two, and why an operator must be able to tell them apart at a
/// glance. Each variant already carries a complete, human-readable reason;
/// `describe_refusal_for_operator` only adds which surface/declaration it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TailnetRefusal {
    /// We got a COMPLETE answer from Tailscale; the answer is "not usable right now".
    /// Fix: something about the TAILSCALE connection.
    Down(String),
    /// We never got a trustworthy answer at all. Fix: something about being ABLE to ask
    /// (install the CLI / permissions) — never a tailnet-connectivity remedy.
    CouldNotAsk(String),
}

// ── the shape this resolver reads out of `tailscale status --json` ────────────────────
//
// Every field is `Option<_>`: serde already treats an absent (or `null`) JSON field as
// `None` for an `Option<T>` member with no extra attribute needed. A payload that omits a
// field this resolver does not read (there are dozens — Peer, User, ClientVersion, ...)
// still parses fine, by construction; only a field we actually READ being absent triggers
// a "shape this resolver does not understand" refusal, and only where that absence is
// ambiguous — see `resolve_ipv4_from_status_json`'s ordering (BackendState is checked, and
// can refuse as `Down`, BEFORE `Self` is required at all: a genuinely stopped backend may
// omit `Self` entirely, and that must classify as "the tailnet is down", not "could not
// ask").

#[derive(Debug, serde::Deserialize)]
struct TailscaleStatusJson {
    #[serde(rename = "BackendState")]
    backend_state: Option<String>,
    // Deliberately a raw `Value`, NOT `Option<TailscaleSelfJson>` directly: a Stopped (or
    // otherwise not-Running) backend legitimately may print SOME `"Self"` shape this
    // resolver does not expect (or none at all), and that must classify as "the tailnet
    // is down" — the BackendState answer already told us why — never as "could not ask".
    // Typing `myself` strictly here would make the WHOLE top-level parse fail on that
    // shape, before `BackendState` is ever even inspected. Parsed into `TailscaleSelfJson`
    // ONLY once `resolve_ipv4_from_status_json` has confirmed `BackendState == "Running"`
    // and therefore actually needs it.
    #[serde(rename = "Self")]
    myself: Option<serde_json::Value>,
}

#[derive(Debug, serde::Deserialize)]
struct TailscaleSelfJson {
    #[serde(rename = "Online")]
    online: Option<bool>,
    #[serde(rename = "TailscaleIPs")]
    tailscale_ips: Option<Vec<String>>,
}

/// PURE: parses ALREADY-FETCHED `raw` (the stdout of `tailscale status --json`, or a test
/// fixture standing in for it) and decides the bind address per the design's rules. Never
/// touches a process, a socket, or the filesystem — every branch is driven only by the
/// string it is handed.
pub(crate) fn resolve_ipv4_from_status_json(raw: &str) -> Result<String, TailnetRefusal> {
    let parsed: TailscaleStatusJson = serde_json::from_str(raw).map_err(|e| {
        TailnetRefusal::CouldNotAsk(format!(
            "`tailscale status --json` did not print valid JSON ({e}) — install or repair \
             the Tailscale CLI, or check that this daemon has permission to invoke it"
        ))
    })?;

    let Some(backend_state) = parsed.backend_state else {
        return Err(TailnetRefusal::CouldNotAsk(
            "`tailscale status --json` printed JSON with no \"BackendState\" field — not \
             the shape this resolver understands, so its answer cannot be trusted"
                .to_string(),
        ));
    };

    if backend_state != "Running" {
        return Err(TailnetRefusal::Down(format!(
            "\"BackendState\" is {backend_state:?}, not \"Running\" — bring Tailscale up \
             (or log in) on this machine before declaring \"expose\": \"tailnet\""
        )));
    }

    let Some(myself_value) = parsed.myself else {
        return Err(TailnetRefusal::CouldNotAsk(
            "\"BackendState\" is \"Running\" but the JSON has no \"Self\" entry — not the \
             shape this resolver understands"
                .to_string(),
        ));
    };
    let Ok(myself) = serde_json::from_value::<TailscaleSelfJson>(myself_value) else {
        return Err(TailnetRefusal::CouldNotAsk(
            "\"BackendState\" is \"Running\" but \"Self\" is not the shape this resolver \
             understands"
                .to_string(),
        ));
    };

    let Some(online) = myself.online else {
        return Err(TailnetRefusal::CouldNotAsk(
            "\"Self\" has no \"Online\" field — not the shape this resolver understands"
                .to_string(),
        ));
    };

    if !online {
        // DECISION: bucketed as `Down`, not `CouldNotAsk` — the backend answered
        // completely (it IS Running), it just says THIS device is not online right now.
        // Same remedy family as a non-Running BackendState: something on the Tailscale
        // side, not a local install/permissions problem.
        return Err(TailnetRefusal::Down(
            "\"BackendState\" is \"Running\" but \"Self.Online\" is false — this device's \
             tailnet connection is not up right now; wait for it to reconnect (or check \
             `tailscale status`) before declaring \"expose\": \"tailnet\""
                .to_string(),
        ));
    }

    let Some(ips) = myself.tailscale_ips else {
        return Err(TailnetRefusal::CouldNotAsk(
            "\"Self\" has no \"TailscaleIPs\" field — not the shape this resolver \
             understands"
                .to_string(),
        ));
    };

    if let Some(ip) = ips.iter().find_map(|s| match s.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => Some(v4.to_string()),
        _ => None,
    }) {
        return Ok(ip);
    }

    // Every address in `Self.TailscaleIPs` is IPv6 (or the list is empty) — the tailnet
    // is genuinely up and this device is genuinely online, but there is no IPv4 address
    // to bind. DECISION: refuse rather than bind an IPv6 address — this resolver has no
    // IPv6 bind support to fall back to, and silently picking whichever family happens
    // to be present is exactly the "do something the operator didn't ask for" shape S2
    // refuses. Bucketed as `Down`, not `CouldNotAsk`: Tailscale gave a complete,
    // trustworthy, HEALTHY answer — the fix is on the tailnet's address-allocation side
    // (or waiting for IPv4 to be assigned), not a local install/permissions problem.
    Err(TailnetRefusal::Down(format!(
        "this device has no IPv4 tailnet address (\"Self.TailscaleIPs\" = {ips:?}) — this \
         resolver binds IPv4 only; assign this device an IPv4 tailnet address, or declare \
         \"loopback\"/\"host:<ip>\" instead"
    )))
}

/// Compose the pure classifier with an INJECTABLE fetcher — see the module doc. Tests use
/// this to prove the "could not ask" composition without ever spawning a process: they
/// inject a closure returning `Err(TailnetRefusal::CouldNotAsk(..))` directly, standing in
/// for a spawn failure or a timeout.
pub(crate) fn resolve_tailnet_bind_ip_with(
    fetch: impl FnOnce() -> Result<String, TailnetRefusal>,
) -> Result<String, TailnetRefusal> {
    let raw = fetch()?;
    resolve_ipv4_from_status_json(&raw)
}

/// Production entry point: resolve this machine's tailnet bind address by actually asking
/// Tailscale. The only caller of `fetch_tailscale_status_json` — see that function's own
/// doc for why it is a direct `std::process::Command`, not a gated host effect, and why it
/// has no unit test of its own.
pub(crate) fn resolve_tailnet_bind_ip() -> Result<String, TailnetRefusal> {
    resolve_tailnet_bind_ip_with(fetch_tailscale_status_json)
}

/// How long to wait for `tailscale status --json` before treating the ask itself as
/// failed. This runs once, synchronously, at daemon boot, before anything is serving — a
/// couple of seconds is a real cost the operator pays once at startup, not a steady-state
/// latency, so it is sized generously rather than tightly.
const TAILSCALE_STATUS_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(2);

/// Ask the LOCAL Tailscale daemon for this machine's own state. A direct
/// `std::process::Command` — deliberately NOT routed through `host_effects_bridge`'s
/// `spawn_process` (the plugin allowlist + env-scrubbing gate): that machinery exists to
/// constrain PLUGINS, untrusted WASM guests spawning processes on the operator's behalf.
/// This call is the REFARM DAEMON itself asking a question about its OWN network identity
/// in order to choose its OWN bind address — host business, at boot, before anything is
/// serving, never plugin-reachable and never plugin-influenced (no argv, no env, no cwd
/// here comes from a plugin) — so the plugin-effect gate does not apply, and routing this
/// through it would be a category error, not extra safety.
///
/// A manual poll-based timeout: `std::process::Command` (deliberately, per the above) has
/// no built-in one, so this spawns, drains stdout on a background thread (so a full OS
/// pipe buffer can never make the child block on a write nobody is reading), and polls
/// `try_wait()` on a short interval until `TAILSCALE_STATUS_TIMEOUT` elapses — killing and
/// reaping the child if it is still running, treated as [`TailnetRefusal::CouldNotAsk`],
/// exactly like every other failure to get a trustworthy answer.
///
/// Exit code is deliberately NOT part of the classification: `tailscale status --json`'s
/// whole value over `tailscale ip -4` is that its JSON BODY explains a failure
/// (`BackendState`) where a bare exit code cannot (see the module doc) — so stdout is
/// parsed regardless of exit status; a process that exits non-zero but still printed a
/// complete JSON body is trusted the same as one that exited zero. Only a process that
/// could not be spawned, would not exit before the timeout, or printed non-UTF-8 output
/// ever yields `CouldNotAsk` from THIS function — an exited process's stdout that parses
/// to unexpected JSON shape is `resolve_ipv4_from_status_json`'s call, not this one's.
///
/// No unit test spawns this function, real `tailscale` or otherwise — see the module doc
/// ("no test ever spawns tailscale or touches the network"). It is thin, deliberately
/// untested glue around `std::process::Command`, exactly the role
/// `ws_handshake_callback`'s own doc comment (`daemon/ws_server.rs`) describes for the
/// thin glue around ITS real I/O: the decision logic it feeds is what is exhaustively
/// tested, via [`resolve_tailnet_bind_ip_with`]'s injectable fetcher.
fn fetch_tailscale_status_json() -> Result<String, TailnetRefusal> {
    use std::io::Read;
    use std::process::{Command, Stdio};

    let mut child = Command::new("tailscale")
        .args(["status", "--json"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| {
            TailnetRefusal::CouldNotAsk(format!(
                "could not run `tailscale status --json` ({e}) — install the Tailscale \
                 CLI, or check that this daemon has permission to execute it"
            ))
        })?;

    let mut stdout = child.stdout.take().expect("stdout was piped above");
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout.read_to_end(&mut buf);
        buf
    });

    let deadline = std::time::Instant::now() + TAILSCALE_STATUS_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => break,
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(TailnetRefusal::CouldNotAsk(format!(
                        "`tailscale status --json` did not answer within {:.1}s — timed \
                         out, treated the same as being unable to ask",
                        TAILSCALE_STATUS_TIMEOUT.as_secs_f32()
                    )));
                }
                std::thread::sleep(std::time::Duration::from_millis(25));
            }
            Err(e) => {
                return Err(TailnetRefusal::CouldNotAsk(format!(
                    "failed to wait on `tailscale status --json` ({e}) — could not ask"
                )));
            }
        }
    }

    let stdout_bytes = reader.join().unwrap_or_default();
    String::from_utf8(stdout_bytes).map_err(|e| {
        TailnetRefusal::CouldNotAsk(format!(
            "`tailscale status --json` printed non-UTF-8 output ({e}) — could not ask"
        ))
    })
}

// ── the seam `sidecar::start` / `daemon::preflight_ws_bind_host` actually call ─────────

/// Resolve `declared`'s `expose` into a declaration `sidecar::bind_guard`'s PURE guard
/// functions can consume directly — rewriting `"tailnet"` into a concrete `host:<ip>` by
/// actually asking Tailscale (see the module doc). This is the ONLY place `expose:
/// "tailnet"` is ever resolved: by the time `bind_guard::resolve_sidecar_bind_host` /
/// `resolve_ws_bind_host` run, any `Tailnet` in the declaration they see has ALREADY been
/// rewritten to `Host(<resolved ip>)` — those functions stay exactly as pure as they
/// always were, never touching a socket, a process, or the network themselves.
///
/// `surface_key`/`surface_label` name WHICH surface/declaration a refusal message should
/// point at (`"sidecar-http"`/`"the sidecar"` or `"daemon-ws"`/`"the agent/CRDT
/// WebSocket"`), matching the wording `bind_guard`'s own refusal messages already use.
///
/// Skips resolution ENTIRELY — no `tailscale` spawn, no timeout budget spent — whenever
/// the answer could not possibly matter:
/// - `declared` is `None`, or its `expose` is not `Tailnet` at all (nothing to resolve).
/// - `flag` is present AND already loopback-shaped: narrowing to loopback is legal
///   regardless of what the declared ceiling actually resolves to (S5), so resolving
///   tailnet here would only add ~2s of latency and a spurious failure mode (Tailscale
///   not installed in, say, a container that is deliberately narrowing to loopback) for
///   an answer that was never going to be used. Mutation-tested below.
pub(crate) fn resolve_declared_expose_for_bind(
    surface_key: &str,
    surface_label: &str,
    flag: Option<&str>,
    declared: Option<&SurfaceDeclaration>,
) -> Result<Option<SurfaceDeclaration>, String> {
    resolve_declared_expose_for_bind_with(
        surface_key,
        surface_label,
        flag,
        declared,
        resolve_tailnet_bind_ip,
    )
}

/// `resolve_declared_expose_for_bind`, parameterized on the resolver — the injection seam
/// tests use to prove the skip conditions and the refusal formatting WITHOUT ever calling
/// the real fetcher (`resolve_tailnet_bind_ip`, which shells out for real).
///
/// `pub(crate)` for that seam alone: `sidecar::node_local`'s tests drive the WHOLE chain a
/// `tailnet` declaration travels (resolve → bind guard → listen plan) and must do it without
/// a `tailscale` binary anywhere near the test process. Production code has exactly one entry
/// point, `resolve_declared_expose_for_bind` above, which wires in the real fetcher.
pub(crate) fn resolve_declared_expose_for_bind_with(
    surface_key: &str,
    surface_label: &str,
    flag: Option<&str>,
    declared: Option<&SurfaceDeclaration>,
    resolve: impl FnOnce() -> Result<String, TailnetRefusal>,
) -> Result<Option<SurfaceDeclaration>, String> {
    let Some(decl) = declared else { return Ok(None) };
    if !matches!(decl.expose, SurfaceExpose::Tailnet) {
        return Ok(Some(decl.clone()));
    }
    if let Some(v) = flag {
        if super::bind_guard::is_loopback_host(v) {
            return Ok(Some(decl.clone()));
        }
    }
    match resolve() {
        Ok(ip) => Ok(Some(SurfaceDeclaration { expose: SurfaceExpose::Host(ip), gate: decl.gate })),
        Err(refusal) => Err(describe_refusal_for_operator(surface_key, surface_label, &refusal)),
    }
}

/// Format a `TailnetRefusal` into the full operator-facing message — the two shapes the
/// operator must be able to tell apart at a glance. THE mutation-verify target: if these
/// two arms ever produced text that could be confused for one another (e.g. both starting
/// "refusing to bind ... to the tailnet:" with no further distinguishing phrase), the
/// fail-closed promise this design exists for would still hold structurally (both DO
/// refuse) but would be useless operationally — the operator would not know which of two
/// opposite remedies to try. See `mutation_guard_down_and_could_not_ask_read_differently`.
fn describe_refusal_for_operator(surface_key: &str, surface_label: &str, refusal: &TailnetRefusal) -> String {
    match refusal {
        TailnetRefusal::Down(reason) => format!(
            "refusing to bind {surface_label} to the tailnet: the tailnet is down — \
             {reason} (surfaces['{surface_key}'] declares \"expose\": \"tailnet\"; declare \
             \"loopback\" or a literal \"host:<ip>\" instead if you do not want to wait \
             for it.)"
        ),
        TailnetRefusal::CouldNotAsk(reason) => format!(
            "refusing to bind {surface_label} to the tailnet: could not ask Tailscale for \
             this machine's status — {reason} (surfaces['{surface_key}'] declares \
             \"expose\": \"tailnet\".)"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::SurfaceGate;

    // ── resolve_ipv4_from_status_json — the pure classifier, real/realistic fixtures ──

    /// Captured verbatim (the fields this resolver reads) from `tailscale status --json`
    /// on a machine actually joined to a tailnet — not invented. Other, unrelated fields
    /// (Peer, User, ClientVersion, ...) are omitted deliberately: they carry OTHER
    /// tailnet members' identities, not this resolver's concern, and the classifier's own
    /// "extra/absent fields it does not read never matter" behaviour is covered
    /// separately by `extra_unknown_fields_do_not_break_parsing` below.
    const RUNNING_FIXTURE: &str = r#"{
        "Version": "1.98.9-t4fb758c39-g200941d74",
        "TUN": true,
        "BackendState": "Running",
        "HaveNodeKey": true,
        "TailscaleIPs": ["100.105.71.127", "fd7a:115c:a1e0::9d3a:4780"],
        "Self": {
            "Online": true,
            "TailscaleIPs": ["100.105.71.127", "fd7a:115c:a1e0::9d3a:4780"]
        }
    }"#;

    #[test]
    fn running_online_ipv4_resolves_the_ipv4_address() {
        assert_eq!(resolve_ipv4_from_status_json(RUNNING_FIXTURE).unwrap(), "100.105.71.127");
    }

    #[test]
    fn extra_unknown_fields_do_not_break_parsing() {
        // The real fixture above already carries fields this resolver never reads
        // (Version, TUN, HaveNodeKey, top-level TailscaleIPs) — this asserts explicitly
        // that a MORE exotic unknown field (a nested object, an array) is equally inert,
        // since a real `tailscale status --json` payload also carries Peer/User/Health/
        // ClientVersion/CurrentTailnet/CertDomains, none of which this resolver reads.
        let raw = r#"{
            "BackendState": "Running",
            "Health": ["a warning string"],
            "CurrentTailnet": {"Name": "example.ts.net"},
            "Self": {"Online": true, "TailscaleIPs": ["100.64.0.5"], "Capabilities": ["x"]}
        }"#;
        assert_eq!(resolve_ipv4_from_status_json(raw).unwrap(), "100.64.0.5");
    }

    #[test]
    fn stopped_is_refused_as_down_naming_the_state() {
        let raw = r#"{"BackendState": "Stopped"}"#;
        let err = resolve_ipv4_from_status_json(raw).expect_err("Stopped must refuse");
        let TailnetRefusal::Down(reason) = &err else {
            panic!("Stopped must classify as Down, got: {err:?}");
        };
        assert!(reason.contains("\"Stopped\""), "must name the state: {reason}");
    }

    #[test]
    fn needs_login_is_refused_as_down_naming_the_state() {
        let raw = r#"{"BackendState": "NeedsLogin"}"#;
        let err = resolve_ipv4_from_status_json(raw).expect_err("NeedsLogin must refuse");
        let TailnetRefusal::Down(reason) = &err else {
            panic!("NeedsLogin must classify as Down, got: {err:?}");
        };
        assert!(reason.contains("\"NeedsLogin\""), "must name the state: {reason}");
    }

    #[test]
    fn stopped_and_needs_login_produce_different_reasons() {
        // Both are Down, but the OPERATOR still benefits from which state it actually
        // is (NeedsLogin's fix is "log in"; Stopped's is "bring it up") — this guards
        // against a lazy implementation that collapses every non-Running state into one
        // generic "not running" sentence, discarding the one thing that varies.
        let stopped = resolve_ipv4_from_status_json(r#"{"BackendState": "Stopped"}"#).unwrap_err();
        let needs_login =
            resolve_ipv4_from_status_json(r#"{"BackendState": "NeedsLogin"}"#).unwrap_err();
        assert_ne!(stopped, needs_login);
    }

    #[test]
    fn no_state_and_starting_are_also_refused_as_down() {
        for state in ["NoState", "Starting"] {
            let raw = format!(r#"{{"BackendState": "{state}"}}"#);
            let err = resolve_ipv4_from_status_json(&raw).expect_err("must refuse");
            assert!(matches!(err, TailnetRefusal::Down(_)), "{state}: must be Down: {err:?}");
        }
    }

    #[test]
    fn self_online_false_while_running_is_refused_as_down() {
        // DECISION (documented in resolve_ipv4_from_status_json): a complete, healthy
        // BackendState with this device simply not online yet is still a Down-shaped
        // refusal, not CouldNotAsk — Tailscale answered fully, the answer just isn't
        // "bind me".
        let raw = r#"{"BackendState": "Running", "Self": {"Online": false, "TailscaleIPs": ["100.64.0.5"]}}"#;
        let err = resolve_ipv4_from_status_json(raw).expect_err("Online: false must refuse");
        let TailnetRefusal::Down(reason) = &err else {
            panic!("Online: false must classify as Down, got: {err:?}");
        };
        assert!(reason.contains("Online"), "must name what's false: {reason}");
    }

    #[test]
    fn ipv6_only_is_refused_as_down_and_says_so() {
        // DECISION (documented in resolve_ipv4_from_status_json): IPv6-only binds are
        // refused, not silently attempted — bucketed as Down (a complete, healthy answer
        // that just has no IPv4 to offer), distinct from CouldNotAsk.
        let raw = r#"{"BackendState": "Running", "Self": {"Online": true, "TailscaleIPs": ["fd7a:115c:a1e0::9d3a:4780"]}}"#;
        let err = resolve_ipv4_from_status_json(raw).expect_err("IPv6-only must refuse");
        let TailnetRefusal::Down(reason) = &err else {
            panic!("IPv6-only must classify as Down, got: {err:?}");
        };
        assert!(reason.contains("IPv4"), "must say why: {reason}");
    }

    #[test]
    fn empty_tailscale_ips_while_online_is_refused_as_down() {
        let raw = r#"{"BackendState": "Running", "Self": {"Online": true, "TailscaleIPs": []}}"#;
        let err = resolve_ipv4_from_status_json(raw).expect_err("no addresses must refuse");
        assert!(matches!(err, TailnetRefusal::Down(_)));
    }

    #[test]
    fn unparseable_json_is_refused_as_could_not_ask() {
        let err = resolve_ipv4_from_status_json("not json at all").expect_err("must refuse");
        assert!(matches!(err, TailnetRefusal::CouldNotAsk(_)), "got: {err:?}");
    }

    #[test]
    fn json_that_is_not_an_object_is_refused_as_could_not_ask() {
        let err = resolve_ipv4_from_status_json("[1, 2, 3]").expect_err("must refuse");
        assert!(matches!(err, TailnetRefusal::CouldNotAsk(_)), "got: {err:?}");
    }

    #[test]
    fn missing_backend_state_is_refused_as_could_not_ask() {
        let err = resolve_ipv4_from_status_json(r#"{"Self": {"Online": true}}"#).expect_err("must refuse");
        assert!(matches!(err, TailnetRefusal::CouldNotAsk(_)), "got: {err:?}");
    }

    #[test]
    fn running_with_no_self_entry_is_refused_as_could_not_ask() {
        // A genuinely `Stopped` backend may legitimately omit `Self` — that must NOT be
        // confused with THIS case: `BackendState: "Running"` promising a live identity
        // that the JSON then fails to actually provide is a shape violation, not a down
        // tailnet.
        let err = resolve_ipv4_from_status_json(r#"{"BackendState": "Running"}"#).expect_err("must refuse");
        assert!(matches!(err, TailnetRefusal::CouldNotAsk(_)), "got: {err:?}");
    }

    #[test]
    fn running_with_no_online_field_is_refused_as_could_not_ask() {
        let raw = r#"{"BackendState": "Running", "Self": {"TailscaleIPs": ["100.64.0.5"]}}"#;
        let err = resolve_ipv4_from_status_json(raw).expect_err("must refuse");
        assert!(matches!(err, TailnetRefusal::CouldNotAsk(_)), "got: {err:?}");
    }

    #[test]
    fn running_online_with_no_tailscale_ips_field_is_refused_as_could_not_ask() {
        let raw = r#"{"BackendState": "Running", "Self": {"Online": true}}"#;
        let err = resolve_ipv4_from_status_json(raw).expect_err("must refuse");
        assert!(matches!(err, TailnetRefusal::CouldNotAsk(_)), "got: {err:?}");
    }

    #[test]
    fn stopped_with_a_malformed_self_shape_is_still_down_not_could_not_ask() {
        // Ordering guard: BackendState is checked, and can already refuse as Down,
        // BEFORE `Self` is inspected at all — a Stopped backend with a garbage or absent
        // `Self` must still read as "the tailnet is down", not "could not ask".
        let raw = r#"{"BackendState": "Stopped", "Self": "not even an object"}"#;
        let err = resolve_ipv4_from_status_json(raw).expect_err("must refuse");
        assert!(matches!(err, TailnetRefusal::Down(_)), "got: {err:?}");
    }

    // ── mutation-verify: the two refusal kinds cannot collapse into one message ────────

    #[test]
    fn mutation_guard_down_and_could_not_ask_read_differently() {
        let down = resolve_ipv4_from_status_json(r#"{"BackendState": "Stopped"}"#).unwrap_err();
        let could_not_ask = resolve_ipv4_from_status_json("not json").unwrap_err();

        let down_msg = describe_refusal_for_operator("daemon-ws", "the agent/CRDT WebSocket", &down);
        let could_not_ask_msg =
            describe_refusal_for_operator("daemon-ws", "the agent/CRDT WebSocket", &could_not_ask);

        assert_ne!(down_msg, could_not_ask_msg);
        // Not just "any difference" (e.g. differing only in the trailing detail) — the
        // OPENING clause, the part an operator reads first, must itself differ: that is
        // what makes the two remedies distinguishable at a glance, not just on close
        // reading.
        assert!(down_msg.contains("the tailnet is down"), "{down_msg}");
        assert!(!could_not_ask_msg.contains("the tailnet is down"), "{could_not_ask_msg}");
        assert!(could_not_ask_msg.contains("could not ask Tailscale"), "{could_not_ask_msg}");
        assert!(!down_msg.contains("could not ask Tailscale"), "{down_msg}");
    }

    #[test]
    fn mutation_guard_a_typed_match_cannot_confuse_the_two_kinds() {
        // The type-level guard behind the message-level one above: `TailnetRefusal` is a
        // two-variant enum, not a single `String` with a prefix convention a future edit
        // could accidentally drop — callers are FORCED to handle Down and CouldNotAsk as
        // distinct cases (see `describe_refusal_for_operator`'s own `match`, which the
        // compiler would reject as non-exhaustive if a third variant appeared unhandled).
        let down = TailnetRefusal::Down("x".to_string());
        let could_not_ask = TailnetRefusal::CouldNotAsk("x".to_string());
        assert_ne!(down, could_not_ask);
    }

    // ── resolve_tailnet_bind_ip_with — the injectable-fetcher seam, no real spawn ──────

    #[test]
    fn fetcher_success_flows_through_the_classifier() {
        let resolved =
            resolve_tailnet_bind_ip_with(|| Ok(RUNNING_FIXTURE.to_string())).unwrap();
        assert_eq!(resolved, "100.105.71.127");
    }

    #[test]
    fn fetcher_spawn_error_is_could_not_ask() {
        let err = resolve_tailnet_bind_ip_with(|| {
            Err(TailnetRefusal::CouldNotAsk("could not run `tailscale status --json` (No such file or directory) — install the Tailscale CLI".to_string()))
        })
        .expect_err("a fetcher error must propagate, not be silently swallowed");
        assert!(matches!(err, TailnetRefusal::CouldNotAsk(_)));
    }

    #[test]
    fn fetcher_timeout_is_could_not_ask() {
        let err = resolve_tailnet_bind_ip_with(|| {
            Err(TailnetRefusal::CouldNotAsk(
                "`tailscale status --json` did not answer within 2.0s — timed out, \
                 treated the same as being unable to ask"
                    .to_string(),
            ))
        })
        .expect_err("a timeout must propagate as CouldNotAsk");
        let TailnetRefusal::CouldNotAsk(reason) = err else {
            panic!("timeout must classify as CouldNotAsk");
        };
        assert!(reason.contains("timed out"));
    }

    #[test]
    fn fetcher_success_but_unparseable_output_is_still_could_not_ask() {
        // The fetcher itself succeeded (got SOME bytes back); the classifier is what
        // refuses, for a different underlying reason than a spawn/timeout failure — both
        // land in the SAME bucket (CouldNotAsk), which is the point: from the operator's
        // side, "the ask machinery worked but the answer was garbage" and "the ask
        // machinery itself failed" call for the identical remedy (fix the local
        // invocation), so they are deliberately not distinguished further than this.
        let err = resolve_tailnet_bind_ip_with(|| Ok("this is not json".to_string()))
            .expect_err("must refuse");
        assert!(matches!(err, TailnetRefusal::CouldNotAsk(_)));
    }

    // ── resolve_declared_expose_for_bind_with — the orchestration seam ─────────────────

    fn declare_tailnet(gate: Option<SurfaceGate>) -> SurfaceDeclaration {
        SurfaceDeclaration { expose: SurfaceExpose::Tailnet, gate }
    }

    fn declare_host(ip: &str, gate: Option<SurfaceGate>) -> SurfaceDeclaration {
        SurfaceDeclaration { expose: SurfaceExpose::Host(ip.to_string()), gate }
    }

    fn declare_loopback() -> SurfaceDeclaration {
        SurfaceDeclaration { expose: SurfaceExpose::Loopback, gate: None }
    }

    #[test]
    fn no_declaration_never_calls_the_resolver() {
        let mut called = false;
        let out = resolve_declared_expose_for_bind_with("daemon-ws", "the WS", None, None, || {
            called = true;
            Ok("100.64.0.1".to_string())
        })
        .unwrap();
        assert!(out.is_none());
        assert!(!called, "must not resolve when nothing is declared");
    }

    #[test]
    fn a_host_declaration_never_calls_the_resolver() {
        let mut called = false;
        let decl = declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken));
        let out = resolve_declared_expose_for_bind_with(
            "daemon-ws",
            "the WS",
            None,
            Some(&decl),
            || {
                called = true;
                Ok("100.64.0.9".to_string())
            },
        )
        .unwrap();
        assert!(!called, "a Host declaration needs no tailnet resolution");
        assert_eq!(out.unwrap().expose, SurfaceExpose::Host("100.64.0.1".to_string()));
    }

    #[test]
    fn a_loopback_declaration_never_calls_the_resolver() {
        let mut called = false;
        let out = resolve_declared_expose_for_bind_with(
            "daemon-ws",
            "the WS",
            None,
            Some(&declare_loopback()),
            || {
                called = true;
                Ok("100.64.0.9".to_string())
            },
        )
        .unwrap();
        assert!(!called);
        assert_eq!(out.unwrap().expose, SurfaceExpose::Loopback);
    }

    #[test]
    fn mutation_guard_loopback_flag_narrowing_a_tailnet_declaration_skips_resolution() {
        // THE mutation guard for the narrowing skip: without this short-circuit, an
        // operator narrowing a `tailnet` declaration down to `--ws-host 127.0.0.1` (e.g.
        // in a container with no Tailscale installed at all) would be BLOCKED by a
        // tailnet resolution failure for an answer that was never going to be used —
        // exactly the S5 guarantee (a flag may always narrow to loopback) silently
        // broken for this one `expose` value.
        let mut called = false;
        let decl = declare_tailnet(Some(SurfaceGate::DeviceToken));
        let out = resolve_declared_expose_for_bind_with(
            "daemon-ws",
            "the WS",
            Some("127.0.0.1"),
            Some(&decl),
            || {
                called = true;
                Err(TailnetRefusal::CouldNotAsk("tailscale not installed".to_string()))
            },
        )
        .expect("narrowing to loopback must succeed even when tailnet cannot be resolved");
        assert!(!called, "loopback-narrowing must skip resolution entirely");
        assert_eq!(out.unwrap().expose, SurfaceExpose::Tailnet, "declaration itself is untouched");
    }

    #[test]
    fn an_absent_flag_with_a_tailnet_declaration_resolves() {
        let decl = declare_tailnet(Some(SurfaceGate::DeviceToken));
        let out = resolve_declared_expose_for_bind_with(
            "daemon-ws",
            "the WS",
            None,
            Some(&decl),
            || Ok("100.105.71.127".to_string()),
        )
        .unwrap()
        .unwrap();
        assert_eq!(out.expose, SurfaceExpose::Host("100.105.71.127".to_string()));
        assert_eq!(out.gate, Some(SurfaceGate::DeviceToken), "gate must carry through untouched");
    }

    #[test]
    fn a_nonloopback_flag_with_a_tailnet_declaration_still_resolves() {
        // Needed so the guard can later validate the flag against the ACTUAL resolved
        // ceiling, not a raw `Tailnet` sentinel it cannot compare against.
        let mut called = false;
        let decl = declare_tailnet(Some(SurfaceGate::DeviceToken));
        let out = resolve_declared_expose_for_bind_with(
            "daemon-ws",
            "the WS",
            Some("100.105.71.127"),
            Some(&decl),
            || {
                called = true;
                Ok("100.105.71.127".to_string())
            },
        )
        .unwrap()
        .unwrap();
        assert!(called, "a non-loopback flag must still resolve, to validate against the real ceiling");
        assert_eq!(out.expose, SurfaceExpose::Host("100.105.71.127".to_string()));
    }

    #[test]
    fn resolution_failure_refuses_with_the_formatted_message() {
        let decl = declare_tailnet(Some(SurfaceGate::DeviceToken));
        let err = resolve_declared_expose_for_bind_with(
            "sidecar-http",
            "the sidecar",
            None,
            Some(&decl),
            || Err(TailnetRefusal::Down("\"BackendState\" is \"Stopped\", not \"Running\"".to_string())),
        )
        .expect_err("a Down refusal must propagate as an Err");
        assert!(err.contains("the tailnet is down"), "{err}");
        assert!(err.contains("sidecar-http"), "must name the surface: {err}");
    }
}
