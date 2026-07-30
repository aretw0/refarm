//! WebSocket daemon — replaces farmhand on port 42000.
//!
//! Protocol:
//!   Binary frames: Loro CRDT sync (BrowserSyncClient-compatible, unchanged)
//!   Text frames:   JSON agent messages `{ "type": "user:prompt", "agent": "<id>", "payload": "..." }`
//!
//!   On connect:  server sends sync.get_update() (full state)
//!                client sends its own getUpdate() immediately after
//!   On recv binary: sync.apply_update(bytes) + broadcast to OTHER clients
//!   On recv text:   route to plugin runner thread via PluginChannels mpsc
//!   On local:    sync.set_broadcast_callback fires → broadcast to ALL clients
//!
//! Binary path is unchanged and BrowserSyncClient requires ZERO changes.
//!
//! ## Credential handshake (ADR-093)
//!
//! A browser cannot set an `Authorization` header on a WebSocket — `Sec-WebSocket-Protocol`
//! is the only field it controls, which is why the credential rides there instead. The
//! convention (matching `specs/ADRs/ADR-093-device-auth-gate-and-browser-websocket-
//! credential-channel.md`): the client offers TWO subprotocol tokens —
//!   - `refarm-sync-v1`   — the protocol name.
//!   - `bearer.<token>`   — the bearer credential, verbatim (the base64url alphabet
//!     `refarm auth enroll` mints is entirely valid RFC 6455 token syntax).
//!
//! `handle_connection` upgrades with `accept_hdr_async` instead of `accept_async` so the
//! callback (`ws_handshake_callback`) can inspect the offered protocols and authenticate the
//! `bearer.<token>` value against the SAME `sidecar::auth::AuthPolicy` the HTTP sidecar uses
//! — same policy file, same credentials, same sha256 matching, no second credential store.
//! On success the server echoes back ONLY `refarm-sync-v1` in its own
//! `Sec-WebSocket-Protocol` response header — the token half is NEVER echoed, logged, or
//! otherwise reflected anywhere. On failure the handshake is refused with an HTTP `401`
//! response WRITTEN to the socket before it closes (tungstenite's `ErrorResponse` path), so
//! a client can tell "refused" from "the network died" — never a silent drop.
//!
//! Opt-in, exactly like the HTTP sidecar's gate: no declared `device-token` gate and no
//! `REFARM_AUTH_POLICY` ⇒ no policy ⇒ `decide_ws_handshake` is `Passthrough` unconditionally
//! ⇒ behaviour is byte-identical to pre-ADR-093 (no header inspection, nothing echoed, any
//! client connects). A policy that is resolvable but absent/unreadable ⇒
//! `sidecar::auth::resolve_auth_policy` resolves `Some(deny_all)` ⇒ every handshake is
//! refused — "if you asked for auth, a broken policy must lock the door".
//!
//! The accept/reject DECISION (`decide_ws_handshake`) is a PURE function of the offered
//! protocol tokens and the policy — no socket, no headers, no tungstenite types — so it is
//! exhaustively unit-tested without ever binding a port. Only the thin glue around it
//! (`parse_offered_protocols`, `ws_unauthorized_response`, `ws_handshake_callback`) touches
//! the handshake request/response types, and is covered by a bounded, real-loopback-socket
//! test where genuine end-to-end coverage is worth the cost.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::handshake::server::{
    ErrorResponse as WsErrorResponse, Request as WsHandshakeRequest, Response as WsHandshakeResponse,
};
use tokio_tungstenite::tungstenite::http::{header, HeaderValue, StatusCode};
use tokio_tungstenite::{accept_hdr_async, tungstenite::Message};

use crate::sidecar::auth::AuthPolicy;
use crate::sync::NativeSync;
use crate::telemetry::TelemetryBus;
use crate::PluginChannels;

type ClientId = usize;
type ClientMap = Arc<Mutex<HashMap<ClientId, mpsc::UnboundedSender<Vec<u8>>>>>;

static NEXT_CLIENT_ID: AtomicUsize = AtomicUsize::new(0);

/// Resolve AND decide whether the WS bind is acceptable BEFORE anything boots. PURE — no
/// socket, no file I/O. `host: None` means `--ws-host` was not passed — under S1/S5 an
/// absent flag is not a value at all, so the `surfaces.daemon-ws` DECLARATION decides the
/// resolved host (loopback if it declares `"loopback"` or is absent — S1). `host: Some(v)`
/// is the operator narrowing/asserting, validated against the declared ceiling exactly as
/// `sidecar::bind_guard::refuse_unguarded_nonloopback_ws_bind` always has. Returns the
/// RESOLVED host string so the caller binds the exact value that was validated, rather
/// than re-deriving it.
///
/// `auth_policy_resolvable` comes from `sidecar::auth::auth_policy_configured(auth_source)` —
/// a cheap, non-authoritative peek at the declaration + env (no file read, no log line), NOT
/// the full `resolve_auth_policy()` resolution: that authoritative read (and its
/// enable/deny-all log line) happens exactly ONCE, later, inside `WsServer::start` — see that
/// function's doc for why re-reading it here would double the log line and cost a needless
/// file read before the runtime has even started booting.
///
/// `WsServer::start` applies the same guard again at the moment it binds (that check is
/// the load-bearing one — it cannot be bypassed by a caller who forgets this). This exists
/// so the binary can refuse a bad `--ws-host` as its FIRST act: the WS server is started at
/// the very END of daemon boot, so without a preflight the operator pays a full runtime
/// boot — storage opened, plugins instantiated, supervisor and audit subscriber spawned —
/// only to be told the host was never acceptable. Refusing up front means nothing was
/// started, so there is also nothing to tear down.
///
/// ALSO resolves `expose: "tailnet"` (`crate::sidecar::tailnet_resolve` — open question 1
/// of the declared-surfaces design), returning the EFFECTIVE declaration alongside the
/// resolved host so the caller (`main.rs`) threads that same already-resolved value into
/// `WsServer::new` — `Tailnet` is asked about (a `tailscale` spawn, up to ~2s) AT MOST
/// ONCE per daemon start, here, not a second time when `WsServer::start` re-validates.
pub fn preflight_ws_bind_host(
    host: Option<&str>,
    declared: Option<&crate::host::SurfaceDeclaration>,
    auth_source: &crate::sidecar::AuthPolicySource,
) -> Result<(String, Option<crate::host::SurfaceDeclaration>)> {
    let effective = crate::sidecar::tailnet_resolve::resolve_declared_expose_for_bind(
        crate::host::SURFACE_DAEMON_WS,
        "the agent/CRDT WebSocket",
        host,
        declared,
    )
    .map_err(|reason| anyhow::anyhow!(reason))?;
    let auth_policy_resolvable = crate::sidecar::auth::auth_policy_configured(auth_source);
    let resolved_host = crate::sidecar::bind_guard::resolve_ws_bind_host(
        host,
        auth_policy_resolvable,
        effective.as_ref(),
    )
    .map_err(|reason| anyhow::anyhow!(reason))?;
    Ok((resolved_host, effective))
}

/// WebSocket server — the farmhand replacement.
pub struct WsServer {
    sync: Arc<NativeSync>,
    host: String,
    port: u16,
    telemetry: TelemetryBus,
    plugin_channels: PluginChannels,
    event_router: crate::EventRouter,
    // The resolved `surfaces.daemon-ws` declaration (S1/S3/S5), read ONCE at daemon boot
    // (`crate::host::surfaces_from_config`) and threaded in by the caller — mirrors how
    // `sidecar::start` receives `declared_surface` rather than reading
    // `.refarm/config.json` itself. `None` means undeclared, NOT "permits anything" (S1).
    declared_surface: Option<crate::host::SurfaceDeclaration>,
    // WHERE the auth policy comes from (the daemon's `--refarm-dir` + whether the
    // declaration names a `device-token` gate) — threaded in by the caller for the same
    // reason `declared_surface` is: `start` reads no global state to learn what the
    // operator declared. See `sidecar::auth::AuthPolicySource`.
    auth_source: crate::sidecar::AuthPolicySource,
}

impl WsServer {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        sync: Arc<NativeSync>,
        host: String,
        port: u16,
        telemetry: TelemetryBus,
        plugin_channels: PluginChannels,
        event_router: crate::EventRouter,
        declared_surface: Option<crate::host::SurfaceDeclaration>,
        auth_source: crate::sidecar::AuthPolicySource,
    ) -> Self {
        Self {
            sync,
            host,
            port,
            telemetry,
            plugin_channels,
            event_router,
            declared_surface,
            auth_source,
        }
    }

    /// The address `start()` binds. PURE — no socket, no I/O — split out so the
    /// default host can be asserted without ever opening a port (see the `daemon`
    /// mutation-guard test below).
    fn bind_addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }

    /// Start the WebSocket server and block until Ctrl-C.
    pub async fn start(&self) -> Result<()> {
        // Resolved ONCE here: reused for the fail-closed bind guard immediately below AND
        // threaded into `run` for the per-connection handshake gate, so a resolvable
        // policy is read from disk (and its enable/deny-all log line emitted) exactly
        // once per WS start — same discipline as `sidecar::start`.
        let auth_policy = crate::sidecar::auth::resolve_auth_policy(&self.auth_source);

        // Fail-closed bind guard — same doctrine and (since ADR-093) the SAME shape as
        // the HTTP sidecar's: a declared `device-token` gate is the operator's opt-in
        // ONLY because something now actually enforces it — `handle_connection`'s
        // `accept_hdr_async` callback authenticates every `Sec-WebSocket-Protocol`
        // handshake against this exact `auth_policy` before any frame is read. A policy
        // resolvable with no declaration, or a declaration naming no gate, still refuses
        // (S1/S3) — see `sidecar::bind_guard::refuse_unguarded_nonloopback_ws_bind`.
        crate::sidecar::bind_guard::refuse_unguarded_nonloopback_ws_bind(
            &self.host,
            auth_policy.is_some(),
            self.declared_surface.as_ref(),
        )
        .map_err(|reason| anyhow::anyhow!(reason))?;

        let addr = self.bind_addr();
        let listener = TcpListener::bind(&addr).await?;
        self.run_gated(listener, auth_policy).await
    }

    /// Run the server with a pre-bound listener and the WS credential gate OFF
    /// (`REFARM_AUTH_POLICY` behaves as unset) — used directly by tests outside this
    /// crate (the `tractor` binary's own test suite) to avoid TOCTOU. A thin `pub`
    /// wrapper around `run_gated` that never names `AuthPolicy` in its own signature:
    /// `AuthPolicy` is `pub(crate)` (see `sidecar::mod.rs`'s `auth` module doc for why
    /// that stays scoped), so a `pub fn` cannot take it as a parameter without widening
    /// that visibility. Production code never calls this — `start` calls `run_gated`
    /// directly with the real resolved policy.
    pub async fn run(&self, listener: TcpListener) -> Result<()> {
        self.run_gated(listener, None).await
    }

    /// Same as `run`, but with an explicit (possibly `None`) auth policy — the ADR-093
    /// handshake gate. `pub(crate)`: callable from anywhere in THIS crate, including
    /// `start` (the real production path, which resolves the policy from env exactly
    /// once) and this module's own `#[cfg(test)]` suite, which injects a policy
    /// directly — hermetically, with no env var mutation (`std::env::set_var` is
    /// process-global and races across parallel `cargo test` threads).
    pub(crate) async fn run_gated(
        &self,
        listener: TcpListener,
        auth_policy: Option<AuthPolicy>,
    ) -> Result<()> {
        // Log the HOST too, not just the port: a line that says only "listening on 42000"
        // cannot be read as evidence of WHERE it listens, and this whole class of defect
        // (a listener open to the network while the operator believes it is loopback) is
        // exactly what a port-only log hides.
        tracing::info!(host = %self.host, port = self.port, "WebSocket daemon listening");

        self.telemetry.emit_named(
            "daemon:start",
            None,
            Some(serde_json::json!({ "host": self.host, "port": self.port })),
        );

        let clients: ClientMap = Arc::new(Mutex::new(HashMap::new()));

        // Wire sync.set_broadcast_callback → broadcast to ALL connected clients
        // (fires only for local changes, e.g. from plugins calling store_node)
        // Using set_broadcast_callback replaces any previous subscription, preventing
        // duplicate broadcasts if run() is called more than once on the same NativeSync.
        let clients_for_on_update = clients.clone();
        self.sync.set_broadcast_callback(move |bytes| {
            let clients = clients_for_on_update.clone();
            let bytes = bytes.clone();
            // on_update fires synchronously on doc.commit(); spawn to avoid blocking
            tokio::spawn(async move {
                let guard = clients.lock().await;
                for tx in guard.values() {
                    let _ = tx.send(bytes.clone());
                }
            });
        });

        let accept_loop = async {
            loop {
                match listener.accept().await {
                    Ok((tcp_stream, addr)) => {
                        tracing::debug!(%addr, "new connection");
                        let sync = self.sync.clone();
                        let clients = clients.clone();
                        let plugin_channels = self.plugin_channels.clone();
                        let event_router = self.event_router.clone();
                        let telemetry = self.telemetry.clone();
                        let auth_policy = auth_policy.clone();
                        tokio::spawn(async move {
                            if let Err(e) = handle_connection(
                                tcp_stream,
                                sync,
                                clients,
                                plugin_channels,
                                event_router,
                                telemetry,
                                auth_policy,
                            )
                            .await
                            {
                                tracing::warn!("connection error: {e}");
                            }
                        });
                    }
                    Err(e) => tracing::error!("accept error: {e}"),
                }
            }
        };

        tokio::select! {
            _ = accept_loop => {},
            _ = tokio::signal::ctrl_c() => {
                tracing::info!("Shutdown signal received");
            }
        }
        Ok(())
    }
}

async fn handle_connection(
    tcp_stream: tokio::net::TcpStream,
    sync: Arc<NativeSync>,
    clients: ClientMap,
    plugin_channels: PluginChannels,
    event_router: crate::EventRouter,
    telemetry: TelemetryBus,
    auth_policy: Option<AuthPolicy>,
) -> Result<()> {
    // `accept_hdr_async` (not `accept_async`) so `ws_handshake_callback` can inspect the
    // offered `Sec-WebSocket-Protocol` tokens and gate the upgrade itself (ADR-093) — see
    // the module doc. `auth_policy: None` makes the callback a no-op passthrough,
    // byte-identical to the old `accept_async(tcp_stream)` call.
    let ws = accept_hdr_async(tcp_stream, ws_handshake_callback(auth_policy)).await?;
    let (mut sink, mut stream) = ws.split();

    // Send current server state immediately on connect
    let initial = sync.get_update()?;
    sink.send(Message::Binary(initial)).await?;

    // Register client in map for broadcasts
    let client_id = NEXT_CLIENT_ID.fetch_add(1, Ordering::SeqCst);
    let (tx, mut rx) = mpsc::unbounded_channel::<Vec<u8>>();
    clients.lock().await.insert(client_id, tx);

    // Spawn send task: reads from channel, forwards to websocket sink
    let send_task = tokio::spawn(async move {
        while let Some(bytes) = rx.recv().await {
            if sink.send(Message::Binary(bytes)).await.is_err() {
                break;
            }
        }
    });

    // Recv loop: apply incoming frames + relay to other clients
    while let Some(msg) = stream.next().await {
        match msg {
            Ok(Message::Binary(bytes)) => {
                let bytes = bytes.to_vec();
                // Apply to local CRDT (no on_update fires for imports).
                // Only relay to other clients if the frame was valid — a corrupted
                // frame must not cascade to other peers.
                match sync.apply_update(&bytes) {
                    Ok(()) => {
                        let guard = clients.lock().await;
                        for (&id, tx) in guard.iter() {
                            if id != client_id {
                                let _ = tx.send(bytes.clone());
                            }
                        }
                    }
                    Err(e) => {
                        tracing::warn!("apply_update failed (frame discarded, not relayed): {e}")
                    }
                }
            }
            Ok(Message::Text(json)) => {
                if let Ok(msg) = serde_json::from_str::<serde_json::Value>(&json) {
                    if msg.get("type").and_then(|v| v.as_str()) == Some("user:prompt") {
                        let agent = msg
                            .get("agent")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_owned();
                        let payload = msg
                            .get("payload")
                            .and_then(|v| v.as_str())
                            .map(str::to_owned);
                        // Route through the neutral, observable router. `user:prompt`
                        // is a single-target delivery to the named agent — the same
                        // path every other event now takes, so ws_server is no longer
                        // an agent-shaped producer bypassing the router.
                        let sent = crate::deliver_via_router(
                            &event_router,
                            &plugin_channels,
                            &telemetry,
                            "user:prompt",
                            Some(&agent),
                            payload,
                        );
                        if sent == 0 {
                            tracing::warn!(agent, "user:prompt: no plugin registered for agent");
                        }
                    }
                }
            }
            Ok(Message::Close(_)) | Err(_) => break,
            _ => {} // ignore ping/pong
        }
    }

    // Cleanup: close channel (drop tx) so send task drains, then await it
    let removed_tx = clients.lock().await.remove(&client_id);
    drop(removed_tx); // closes the mpsc channel
    let _ = send_task.await; // wait for send task to exit cleanly
    Ok(())
}

// ── ADR-093 credential handshake ────────────────────────────────────────────────────
//
// The convention (see the module doc): the client offers `[PROTOCOL_NAME,
// "bearer.<token>"]` in `Sec-WebSocket-Protocol`; the server echoes back ONLY
// `PROTOCOL_NAME`, never the token half.

/// The subprotocol name echoed back on a successful handshake — and ONLY this. It is the
/// one piece of the offered `Sec-WebSocket-Protocol` value that is ever safe to reflect: it
/// carries no secret. Matches `specs/ADRs/ADR-093-...md`'s `refarm-sync-v1`.
const WS_SYNC_PROTOCOL: &str = "refarm-sync-v1";

/// Prefix of the second offered subprotocol token that carries the bearer credential
/// itself, e.g. `bearer.abc123...`. Matches the ADR's `bearer.<token>`.
const WS_TOKEN_PROTOCOL_PREFIX: &str = "bearer.";

/// The pure accept/reject decision for one handshake attempt, given the tokens the client
/// offered in `Sec-WebSocket-Protocol` and the resolved policy. PURE — no I/O, no
/// tungstenite types, no logging: the caller decides what to log and how to shape the HTTP
/// response from the result. This is what the test suite drives directly, so the handshake
/// gate is exhaustively covered without ever opening a socket.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum WsHandshakeDecision {
    /// No policy configured (`REFARM_AUTH_POLICY` unset) — accept without touching the
    /// response at all, regardless of what the client offered. Byte-identical to
    /// pre-ADR-093 behaviour.
    Passthrough,
    /// Policy configured and the offered credential authenticated. `identity` is the
    /// resolved device identity — safe to log, NEVER a header value (only
    /// `WS_SYNC_PROTOCOL` is ever echoed).
    Accept { identity: String },
    /// Policy configured and the handshake must be refused with `401`. `reason` is a
    /// static, tokenless string — safe to log AND safe to return to the client.
    Reject { reason: &'static str },
}

/// PURE decision function. `offered` is the list of subprotocol tokens the client sent
/// (already split/trimmed from the raw header value — see `parse_offered_protocols`).
fn decide_ws_handshake(offered: &[&str], policy: Option<&AuthPolicy>) -> WsHandshakeDecision {
    let Some(policy) = policy else {
        return WsHandshakeDecision::Passthrough;
    };
    let token = offered
        .iter()
        .find_map(|p| p.strip_prefix(WS_TOKEN_PROTOCOL_PREFIX))
        .filter(|t| !t.is_empty());
    let Some(token) = token else {
        return WsHandshakeDecision::Reject { reason: "missing credential" };
    };
    match policy.authenticate(token) {
        Some(identity) => WsHandshakeDecision::Accept { identity: identity.to_string() },
        None => WsHandshakeDecision::Reject { reason: "invalid credential" },
    }
}

/// Every offered `Sec-WebSocket-Protocol` token, comma-split (RFC 6455 allows either
/// multiple header lines or one comma-separated value; browsers send the latter) and
/// trimmed. Empty entries are dropped. Thin glue around tungstenite's request type — no
/// decision logic lives here, only extraction.
fn parse_offered_protocols(request: &WsHandshakeRequest) -> Vec<String> {
    request
        .headers()
        .get_all(header::SEC_WEBSOCKET_PROTOCOL)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect()
}

/// Build the `401` handshake-rejection response. `reason` is one of `decide_ws_handshake`'s
/// static strings — never the token, never anything else caller-supplied. tungstenite
/// WRITES this response to the socket before closing it (see `ServerHandshake::stage_finished`
/// in `tungstenite::handshake::server`), so the client can distinguish a refusal from a
/// dropped connection — never a silent close.
fn ws_unauthorized_response(reason: &str) -> WsErrorResponse {
    let body = serde_json::json!({ "error": "unauthorized", "reason": reason }).to_string();
    WsHandshakeResponse::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::WWW_AUTHENTICATE, "Bearer")
        .body(Some(body))
        .unwrap_or_else(|_| WsErrorResponse::new(None))
}

/// Build the `accept_hdr_async` callback (`tungstenite::handshake::server::Callback`) for
/// one connection. `policy` is cloned once per connection from the value `WsServer::run`
/// resolved ONCE at start (see its doc) — cheap, since `AuthPolicy` is a small `Vec` of
/// hashes. Thin glue: parses the request, calls the PURE `decide_ws_handshake`, then either
/// echoes `WS_SYNC_PROTOCOL` (accept) or writes a `401` (reject) — all logging happens
/// here, at the boundary, never inside the pure decision.
fn ws_handshake_callback(
    policy: Option<AuthPolicy>,
) -> impl FnOnce(&WsHandshakeRequest, WsHandshakeResponse) -> Result<WsHandshakeResponse, WsErrorResponse> {
    move |request, response| {
        let offered = parse_offered_protocols(request);
        let offered_refs: Vec<&str> = offered.iter().map(String::as_str).collect();
        match decide_ws_handshake(&offered_refs, policy.as_ref()) {
            WsHandshakeDecision::Passthrough => Ok(response),
            WsHandshakeDecision::Accept { identity } => {
                tracing::info!(identity = %identity, "daemon-ws handshake accepted");
                let mut response = response;
                response
                    .headers_mut()
                    .insert(header::SEC_WEBSOCKET_PROTOCOL, HeaderValue::from_static(WS_SYNC_PROTOCOL));
                Ok(response)
            }
            WsHandshakeDecision::Reject { reason } => {
                tracing::warn!(reason, "daemon-ws handshake refused");
                Err(ws_unauthorized_response(reason))
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{Arc, RwLock};
    use std::time::Duration;

    use futures_util::{SinkExt, StreamExt};
    use tokio::net::TcpListener;
    use tokio::sync::mpsc;
    use tokio::time::timeout;
    use tokio_tungstenite::{connect_async, tungstenite::Message};

    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    use crate::sidecar::auth::{sha256_hex, AuthPolicy, Credential, AUTH_POLICY_ENV};
    use crate::{EventEnvelope, NativeStorage, NativeSync, TelemetryBus};

    fn make_sync() -> Arc<NativeSync> {
        let storage = NativeStorage::open(":memory:").unwrap();
        Arc::new(NativeSync::new(storage, ":memory:").unwrap())
    }

    /// An `AuthPolicySource` that resolves to nothing: a refarm dir that does not exist and
    /// NO declared `device-token` gate. These tests drive the gate through `run_gated`'s
    /// explicit policy argument, so the source must never be what decides — the derivation
    /// itself is covered beside it, in `sidecar::auth`.
    fn no_auth_source() -> crate::sidecar::AuthPolicySource {
        crate::sidecar::AuthPolicySource::new(
            std::path::PathBuf::from("/nonexistent-refarm-dir"),
            false,
        )
    }

    /// Bind on an ephemeral port, start the server in a background task, no auth policy
    /// (today's behaviour, unchanged). Returns the `ws://` address so tests can connect
    /// immediately.
    async fn spawn_server(channels: PluginChannels) -> String {
        spawn_server_with_router(channels, crate::EventRouter::default()).await
    }

    async fn spawn_server_with_router(
        channels: PluginChannels,
        event_router: crate::EventRouter,
    ) -> String {
        spawn_server_full(channels, event_router, None).await
    }

    /// Same as `spawn_server`, but with an `AuthPolicy` gating the handshake — for the
    /// ADR-093 accept/reject end-to-end tests. Never touches `REFARM_AUTH_POLICY` (the
    /// policy is injected directly into `run`), so these tests stay hermetic: no env var
    /// mutation, no race with other tests in the same `cargo test` process.
    async fn spawn_server_with_auth_policy(channels: PluginChannels, policy: AuthPolicy) -> String {
        spawn_server_full(channels, crate::EventRouter::default(), Some(policy)).await
    }

    async fn spawn_server_full(
        channels: PluginChannels,
        event_router: crate::EventRouter,
        auth_policy: Option<AuthPolicy>,
    ) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = WsServer::new(
            make_sync(),
            "127.0.0.1".to_string(),
            0,
            TelemetryBus::new(10),
            channels,
            event_router,
            None,
            no_auth_source(),
        );
        tokio::spawn(async move {
            let _ = server.run_gated(listener, auth_policy).await;
        });
        format!("ws://{addr}")
    }

    /// A client handshake request offering the given `Sec-WebSocket-Protocol` tokens
    /// (comma-joined, matching how a browser sends its `protocols` array). Empty slice ⇒
    /// no header at all — the "no subprotocol offered" case.
    fn client_request_with_protocols(
        addr: &str,
        protocols: &[&str],
    ) -> tokio_tungstenite::tungstenite::http::Request<()> {
        let mut request = addr.into_client_request().unwrap();
        if !protocols.is_empty() {
            request.headers_mut().insert(
                header::SEC_WEBSOCKET_PROTOCOL,
                HeaderValue::from_str(&protocols.join(", ")).unwrap(),
            );
        }
        request
    }

    // ── happy path ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn json_prompt_routes_to_registered_agent() {
        let channels: PluginChannels = Arc::new(RwLock::new(HashMap::new()));
        let (tx, mut rx) = mpsc::unbounded_channel::<EventEnvelope>();
        channels.write().unwrap().insert("agent".to_string(), tx);

        let addr = spawn_server(channels).await;
        let (ws, _) = connect_async(&addr).await.unwrap();
        let (mut sink, mut stream) = ws.split();
        stream.next().await; // drain initial state

        sink.send(Message::Text(
            r#"{"type":"user:prompt","agent":"agent","payload":"olá pi"}"#.to_string(),
        ))
        .await
        .unwrap();

        let msg = timeout(Duration::from_millis(500), rx.recv())
            .await
            .expect("timed out waiting for agent message")
            .expect("channel closed");

        assert_eq!(msg.event, "user:prompt");
        assert_eq!(msg.payload.as_deref(), Some("olá pi"));
    }

    #[tokio::test]
    async fn initial_state_frame_is_binary() {
        let addr = spawn_server(Arc::new(RwLock::new(HashMap::new()))).await;
        let (ws, _) = connect_async(&addr).await.unwrap();
        let (_sink, mut stream) = ws.split();
        let first = stream.next().await.unwrap().unwrap();
        assert!(
            matches!(first, Message::Binary(_)),
            "expected Binary CRDT frame on connect"
        );
    }

    // ── bind host ────────────────────────────────────────────────────────────

    #[test]
    fn bind_addr_uses_configured_host_not_all_interfaces() {
        // Mutation guard: `start()` used to hardcode `format!("0.0.0.0:{port}")` —
        // every interface, unconditionally, no auth. This asserts the address that
        // flows into the bind call, PURE — no socket opened — so a regression back to
        // a hardcoded 0.0.0.0 default is caught without ever touching the network.
        let server = WsServer::new(
            make_sync(),
            "127.0.0.1".to_string(),
            42000,
            TelemetryBus::new(10),
            Arc::new(RwLock::new(HashMap::new())),
            crate::EventRouter::default(),
            None,
            no_auth_source(),
        );
        assert_eq!(server.bind_addr(), "127.0.0.1:42000");
        assert_ne!(server.bind_addr(), "0.0.0.0:42000");
    }

    // ── resilience ───────────────────────────────────────────────────────────

    #[tokio::test]
    async fn json_prompt_unknown_agent_ignored_no_crash() {
        let addr = spawn_server(Arc::new(RwLock::new(HashMap::new()))).await;
        let (ws, _) = connect_async(&addr).await.unwrap();
        let (mut sink, mut stream) = ws.split();
        stream.next().await; // drain initial state

        // Unknown agent — server must warn and continue, not crash.
        sink.send(Message::Text(
            r#"{"type":"user:prompt","agent":"nobody","payload":"x"}"#.to_string(),
        ))
        .await
        .unwrap();

        // Second message proves the connection and server are still alive.
        sink.send(Message::Text(
            r#"{"type":"user:prompt","agent":"nobody","payload":"y"}"#.to_string(),
        ))
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn malformed_json_silently_ignored() {
        let addr = spawn_server(Arc::new(RwLock::new(HashMap::new()))).await;
        let (ws, _) = connect_async(&addr).await.unwrap();
        let (mut sink, mut stream) = ws.split();
        stream.next().await; // drain initial state

        sink.send(Message::Text("not json !!!".to_string()))
            .await
            .unwrap();
        sink.send(Message::Text("{}".to_string())).await.unwrap();
        // no panic, no error — test passes by reaching this line
    }

    #[tokio::test]
    async fn wrong_type_field_not_routed() {
        let channels: PluginChannels = Arc::new(RwLock::new(HashMap::new()));
        let (tx, mut rx) = mpsc::unbounded_channel::<EventEnvelope>();
        channels.write().unwrap().insert("agent".to_string(), tx);

        let addr = spawn_server(channels).await;
        let (ws, _) = connect_async(&addr).await.unwrap();
        let (mut sink, mut stream) = ws.split();
        stream.next().await; // drain initial state

        // Different "type" value — must NOT route to the agent.
        sink.send(Message::Text(
            r#"{"type":"some:other","agent":"agent","payload":"ignored"}"#.to_string(),
        ))
        .await
        .unwrap();

        let result = timeout(Duration::from_millis(100), rx.recv()).await;
        assert!(
            result.is_err(),
            "non-prompt type must not route to agent channel"
        );
    }

    // ── ADR-093 handshake: decide_ws_handshake — PURE, no sockets ───────────────────

    fn policy_with(token: &str, identity: &str) -> AuthPolicy {
        AuthPolicy::from_credentials(vec![Credential {
            token_sha256: sha256_hex(token),
            identity: identity.to_string(),
        }])
    }

    #[test]
    fn decide_no_policy_is_passthrough_regardless_of_what_is_offered() {
        assert_eq!(decide_ws_handshake(&[], None), WsHandshakeDecision::Passthrough);
        assert_eq!(
            decide_ws_handshake(&[WS_SYNC_PROTOCOL, "bearer.anything"], None),
            WsHandshakeDecision::Passthrough
        );
    }

    #[test]
    fn decide_policy_with_valid_token_accepts_and_resolves_identity() {
        let policy = policy_with("good-token", "id-arthur");
        let offered = [WS_SYNC_PROTOCOL, "bearer.good-token"];
        assert_eq!(
            decide_ws_handshake(&offered, Some(&policy)),
            WsHandshakeDecision::Accept { identity: "id-arthur".to_string() }
        );
    }

    #[test]
    fn decide_policy_with_wrong_token_is_rejected() {
        let policy = policy_with("good-token", "id-arthur");
        let offered = [WS_SYNC_PROTOCOL, "bearer.wrong-token"];
        assert_eq!(
            decide_ws_handshake(&offered, Some(&policy)),
            WsHandshakeDecision::Reject { reason: "invalid credential" }
        );
    }

    #[test]
    fn decide_policy_with_no_subprotocol_at_all_is_rejected() {
        let policy = policy_with("good-token", "id-arthur");
        assert_eq!(
            decide_ws_handshake(&[], Some(&policy)),
            WsHandshakeDecision::Reject { reason: "missing credential" }
        );
    }

    #[test]
    fn decide_policy_with_protocol_name_but_no_token_entry_is_rejected() {
        // The protocol name alone, with no `bearer.` entry at all, must be treated the
        // same as offering nothing — not silently accepted because SOMETHING was sent.
        let policy = policy_with("good-token", "id-arthur");
        let offered = [WS_SYNC_PROTOCOL];
        assert_eq!(
            decide_ws_handshake(&offered, Some(&policy)),
            WsHandshakeDecision::Reject { reason: "missing credential" }
        );
    }

    #[test]
    fn decide_policy_with_empty_token_value_is_rejected() {
        let policy = policy_with("good-token", "id-arthur");
        let offered = [WS_SYNC_PROTOCOL, "bearer."];
        assert_eq!(
            decide_ws_handshake(&offered, Some(&policy)),
            WsHandshakeDecision::Reject { reason: "missing credential" }
        );
    }

    #[test]
    fn decide_accept_decision_never_carries_the_raw_token() {
        // Mutation guard for "never echo the token": even in DEBUG form (the shape a
        // careless `tracing::info!("{decision:?}")` might log), the accept decision must
        // never contain the raw token — only the resolved identity, which the policy
        // controls independently of the token's own bytes.
        let token = "super-secret-token-value-zzz";
        let policy = policy_with(token, "id-arthur");
        let offered = [WS_SYNC_PROTOCOL, &format!("{WS_TOKEN_PROTOCOL_PREFIX}{token}")];
        let decision = decide_ws_handshake(&offered, Some(&policy));
        let debug = format!("{decision:?}");
        assert!(!debug.contains(token), "the accept decision must never carry the raw token: {debug}");
        assert_eq!(decision, WsHandshakeDecision::Accept { identity: "id-arthur".to_string() });
    }

    #[test]
    fn deny_all_policy_from_unreadable_config_rejects_every_credential() {
        // Exercises the REAL resolution (`resolve_auth_policy`), not a hand-built policy:
        // "policy resolvable but unreadable ⇒ deny all" is `sidecar::auth`'s own doctrine —
        // the WS gate reuses the SAME resolution, so a broken policy must lock the WS door
        // too, not leave it open.
        let _env = crate::test_support::env_lock();
        std::env::set_var(AUTH_POLICY_ENV, "/nonexistent/policy-for-ws-handshake-test.json");
        let resolved = crate::sidecar::auth::resolve_auth_policy(&no_auth_source());
        std::env::remove_var(AUTH_POLICY_ENV);

        let policy = resolved.expect("unreadable policy must still resolve to Some(deny_all)");
        let offered = [WS_SYNC_PROTOCOL, "bearer.any-token-at-all"];
        assert_eq!(
            decide_ws_handshake(&offered, Some(&policy)),
            WsHandshakeDecision::Reject { reason: "invalid credential" }
        );
    }

    // ── ADR-093 handshake: glue around the decision (parsing, response building) ───

    #[test]
    fn parse_offered_protocols_splits_a_single_comma_separated_header() {
        let request = tokio_tungstenite::tungstenite::http::Request::builder()
            .header(header::SEC_WEBSOCKET_PROTOCOL, "refarm-sync-v1, bearer.abc123")
            .body(())
            .unwrap();
        assert_eq!(
            parse_offered_protocols(&request),
            vec!["refarm-sync-v1".to_string(), "bearer.abc123".to_string()]
        );
    }

    #[test]
    fn parse_offered_protocols_handles_multiple_header_lines() {
        let request = tokio_tungstenite::tungstenite::http::Request::builder()
            .header(header::SEC_WEBSOCKET_PROTOCOL, "refarm-sync-v1")
            .header(header::SEC_WEBSOCKET_PROTOCOL, "bearer.abc123")
            .body(())
            .unwrap();
        assert_eq!(
            parse_offered_protocols(&request),
            vec!["refarm-sync-v1".to_string(), "bearer.abc123".to_string()]
        );
    }

    #[test]
    fn parse_offered_protocols_absent_header_is_empty() {
        let request = tokio_tungstenite::tungstenite::http::Request::builder().body(()).unwrap();
        assert!(parse_offered_protocols(&request).is_empty());
    }

    #[test]
    fn ws_unauthorized_response_is_401_with_reason_and_no_token() {
        let response = ws_unauthorized_response("invalid credential");
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            response.headers().get(header::WWW_AUTHENTICATE).and_then(|v| v.to_str().ok()),
            Some("Bearer")
        );
        let body = response.body().as_deref().unwrap_or_default();
        assert!(body.contains("invalid credential"));
    }

    #[test]
    fn handshake_callback_never_logs_the_raw_token_on_either_path() {
        // Captures real `tracing` output around both the accept and reject paths — the
        // strongest form of "never log the token" available without a real socket.
        let token = "logged-nowhere-secret-zzz";
        let policy = policy_with(token, "id-arthur");

        let captured = CapturedLogs::default();
        let subscriber =
            tracing_subscriber::fmt().with_writer(captured.clone()).with_ansi(false).finish();

        tracing::subscriber::with_default(subscriber, || {
            let accept_req = tokio_tungstenite::tungstenite::http::Request::builder()
                .header(
                    header::SEC_WEBSOCKET_PROTOCOL,
                    format!("{WS_SYNC_PROTOCOL}, {WS_TOKEN_PROTOCOL_PREFIX}{token}"),
                )
                .body(())
                .unwrap();
            let accept_result =
                ws_handshake_callback(Some(policy.clone()))(&accept_req, WsHandshakeResponse::new(()));
            assert!(accept_result.is_ok(), "valid token must be accepted");

            let reject_req = tokio_tungstenite::tungstenite::http::Request::builder()
                .header(
                    header::SEC_WEBSOCKET_PROTOCOL,
                    format!("{WS_SYNC_PROTOCOL}, {WS_TOKEN_PROTOCOL_PREFIX}wrong-{token}"),
                )
                .body(())
                .unwrap();
            let reject_result =
                ws_handshake_callback(Some(policy.clone()))(&reject_req, WsHandshakeResponse::new(()));
            assert!(reject_result.is_err(), "wrong token must be refused");
        });

        let log_text = String::from_utf8(captured.contents()).expect("log output must be UTF-8");
        assert!(
            !log_text.contains(token),
            "log output must never contain the raw token: {log_text}"
        );
        assert!(log_text.contains("id-arthur"), "success path must log the resolved identity");
    }

    // `std::sync::Mutex`, NOT the `tokio::sync::Mutex` this module's `use` brings into
    // scope for the server itself (`Mutex::lock()` there is async) — this is a plain
    // sync writer used from `tracing`'s (synchronous) `Write` trait.
    #[derive(Clone, Default)]
    struct CapturedLogs(Arc<std::sync::Mutex<Vec<u8>>>);

    impl CapturedLogs {
        fn contents(&self) -> Vec<u8> {
            self.0.lock().unwrap().clone()
        }
    }

    impl std::io::Write for CapturedLogs {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for CapturedLogs {
        type Writer = CapturedLogs;
        fn make_writer(&'a self) -> Self::Writer {
            self.clone()
        }
    }

    // ── ADR-093 handshake: end-to-end over a real (bounded) loopback socket ─────────

    #[tokio::test]
    async fn e2e_no_policy_no_subprotocol_connects_unchanged() {
        // Today's behaviour, unchanged: no policy ⇒ no header inspection at all.
        let addr = spawn_server(Arc::new(RwLock::new(HashMap::new()))).await;
        let (_ws, response) = timeout(Duration::from_secs(2), connect_async(&addr))
            .await
            .expect("connect must not hang")
            .expect("connection must succeed when no policy is configured");
        assert!(
            response.headers().get(header::SEC_WEBSOCKET_PROTOCOL).is_none(),
            "must not echo a protocol when the gate is off"
        );
    }

    #[tokio::test]
    async fn e2e_policy_valid_token_is_accepted_and_echoes_the_protocol_name_not_the_token() {
        let token = "e2e-valid-token";
        let policy = policy_with(token, "id-e2e");
        let addr =
            spawn_server_with_auth_policy(Arc::new(RwLock::new(HashMap::new())), policy).await;
        let request =
            client_request_with_protocols(&addr, &[WS_SYNC_PROTOCOL, &format!("bearer.{token}")]);

        let (_ws, response) = timeout(Duration::from_secs(2), connect_async(request))
            .await
            .expect("connect must not hang")
            .expect("a valid token must be accepted");

        let echoed = response
            .headers()
            .get(header::SEC_WEBSOCKET_PROTOCOL)
            .and_then(|v| v.to_str().ok())
            .expect("must echo a protocol on accept");
        assert_eq!(echoed, WS_SYNC_PROTOCOL);
        assert!(!echoed.contains(token), "the echoed header must never contain the token");
    }

    #[tokio::test]
    async fn e2e_policy_wrong_token_is_refused_with_401_socket_not_established() {
        let policy = policy_with("the-real-token", "id-e2e");
        let addr =
            spawn_server_with_auth_policy(Arc::new(RwLock::new(HashMap::new())), policy).await;
        let request =
            client_request_with_protocols(&addr, &[WS_SYNC_PROTOCOL, "bearer.wrong-token"]);

        let err = timeout(Duration::from_secs(2), connect_async(request))
            .await
            .expect("connect must not hang")
            .expect_err("a wrong token must be refused, not accepted");
        match err {
            tokio_tungstenite::tungstenite::Error::Http(response) => {
                assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
            }
            other => panic!("expected an HTTP 401 handshake refusal, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn e2e_policy_no_subprotocol_offered_is_refused_with_401() {
        let policy = policy_with("the-real-token", "id-e2e");
        let addr =
            spawn_server_with_auth_policy(Arc::new(RwLock::new(HashMap::new())), policy).await;

        // No protocols offered at all — connect with the bare address, same as a client
        // unaware of ADR-093 would.
        let err = timeout(Duration::from_secs(2), connect_async(&addr))
            .await
            .expect("connect must not hang")
            .expect_err("no subprotocol at all must be refused when a policy is configured");
        match err {
            tokio_tungstenite::tungstenite::Error::Http(response) => {
                assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
            }
            other => panic!("expected an HTTP 401 handshake refusal, got: {other:?}"),
        }
    }
}
