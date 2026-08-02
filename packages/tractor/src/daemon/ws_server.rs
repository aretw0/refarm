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
//! `sidecar::ResolvedAuthPolicy::resolve` yields `Some(deny_all)` ⇒ every handshake is
//! refused — "if you asked for auth, a broken policy must lock the door".
//!
//! That policy is resolved ONCE per daemon start (in `main.rs`) and threaded into BOTH this
//! server and the HTTP sidecar. This server holds the resolved value, not the source it came
//! from, so the two gates cannot read the policy file separately — nor disagree about it.
//! The value is a LIVE handle (`sidecar::auth::AuthGate`), so when the policy file changes
//! the daemon re-reads it and this handshake gate sees the new credentials on the very next
//! connection — no restart to admit an enrolled device, and none to refuse a revoked one.
//! The snapshot `decide_ws_handshake` judges is taken per handshake, from that one handle.
//!
//! The accept/reject DECISION (`decide_ws_handshake`) takes no socket, no headers and no
//! tungstenite types — so it is exhaustively unit-tested without ever binding a port. Only the
//! thin glue around it (`parse_offered_protocols`, `ws_unauthorized_response`,
//! `ws_handshake_callback`) touches the handshake request/response types, and is covered by a
//! bounded, real-loopback-socket test where genuine end-to-end coverage is worth the cost.
//!
//! ## The bound, and the trail
//!
//! This handshake is the same credential gate the HTTP sidecar runs, and for a while it had
//! half the protection: the sidecar bounded failed authentication and recorded every attempt,
//! and the handshake — the socket a browser and a phone both speak — did neither. It refused
//! bad credentials an unlimited number of times, and left no record that it had.
//!
//! It now asks `sidecar::auth::AuthGate::admit`, which is the SAME sequence the HTTP middleware
//! asks: the same limiter behind the same `Arc` (so a credential's budget is one budget across
//! both surfaces, not one per socket), keyed the same way — on the CREDENTIAL PRESENTED, which
//! the handshake holds, in the `bearer.` subprotocol token. Not on a claimed identity (which
//! hands any caller a remote lockout aimed at whoever they name) and not on a peer address
//! (which `sidecar::node_local`'s structural test forbids as a mechanism in every file that
//! serves a request — this one included). Every attempt lands in the daemon's existing
//! `scarecrow-audit.ndjson`, under the same `auth:` vocabulary, written by the same writer.
//!
//! ## What the wire learns: nothing new
//!
//! A refusal is BYTE-IDENTICAL to the refusal this handshake has always written — `401`, the
//! same two headers, the same body — whether the credential was unknown, out of scope, expired,
//! or belonged to a credential whose bound has engaged. The HTTP gate answers a `429` with
//! `Retry-After` when a bound engages; the handshake deliberately does not, because a new
//! status on a handshake is an announcement that the bound exists and that this caller reached
//! it. So the limiter's whole effect here is inward: the policy is not consulted, and the trail
//! is not written to, for an attempt made while locked out.
//!
//! The audit write happens AFTER the handshake response has gone to the socket
//! (`handle_connection` drains what the synchronous callback recorded), so the trail's I/O is
//! not on the refusal path and cannot become a timing signal either.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Mutex};
use tokio_tungstenite::tungstenite::handshake::server::{
    ErrorResponse as WsErrorResponse, Request as WsHandshakeRequest, Response as WsHandshakeResponse,
};
use tokio_tungstenite::tungstenite::http::{header, HeaderValue, StatusCode};
use tokio_tungstenite::{accept_hdr_async, tungstenite::Message};

use crate::sidecar::auth::{AuditRecord, AuthGate, GateOutcome, RouteRequirement};
use crate::sidecar::node_local::ListenRole;
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
/// a resolution: the authoritative read (and its enable/deny-all log line) happens exactly
/// ONCE per daemon start, in `main.rs`, via `sidecar::ResolvedAuthPolicy::resolve`, and the
/// RESULT is threaded into both gates. This preflight deliberately runs BEFORE that read,
/// because its whole purpose is to refuse a bad `--ws-host` as the daemon's first act —
/// without touching the filesystem and without saying anything about the gate. The peek and
/// the resolution cannot disagree: both are exactly "`resolve_policy_path` is `Some`".
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
    // The auth policy ALREADY RESOLVED — once, at daemon start, by main.rs — and threaded
    // in for the same reason `declared_surface` is: `start` reads no global state to learn
    // what the operator declared. NOT an `AuthPolicySource`: holding the source is what let
    // this server resolve the policy a SECOND time (the HTTP sidecar resolved the first),
    // doubling the derived-but-ABSENT warning on every boot and making two independent reads
    // of one file possible. See `sidecar::auth::ResolvedAuthPolicy`.
    auth_policy: crate::sidecar::ResolvedAuthPolicy,
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
        auth_policy: crate::sidecar::ResolvedAuthPolicy,
    ) -> Self {
        Self {
            sync,
            host,
            port,
            telemetry,
            plugin_channels,
            event_router,
            declared_surface,
            auth_policy,
        }
    }

    /// Every address `start()` binds, in order. PURE — no socket, no I/O — and derived
    /// from the very same `node_local::listen_plan` `start` uses, so it cannot drift from
    /// what is actually bound. Split out so the resolved host can be asserted without ever
    /// opening a port (see the `daemon` mutation-guard tests below).
    #[cfg(test)]
    fn bind_addrs(&self) -> Vec<String> {
        crate::sidecar::node_local::listen_plan(&self.host)
            .iter()
            .map(|t| format!("{}:{}", t.host, self.port))
            .collect()
    }

    /// Start the WebSocket server and block until Ctrl-C.
    pub async fn start(&self) -> Result<()> {
        // NO resolution here — `self.auth_policy` IS the resolution, performed once at
        // daemon start and handed to this server and to the HTTP sidecar alike. Consulted
        // twice below (the bind guard, then the per-connection handshake gate), but READ
        // once from disk, so the enable/deny-all log line is emitted exactly once per boot
        // and both gates provably enforce the same credentials.
        //
        // Fail-closed bind guard — same doctrine and (since ADR-093) the SAME shape as
        // the HTTP sidecar's: a declared `device-token` gate is the operator's opt-in
        // ONLY because something now actually enforces it — `handle_connection`'s
        // `accept_hdr_async` callback authenticates every `Sec-WebSocket-Protocol`
        // handshake against this exact policy before any frame is read. A policy
        // resolvable with no declaration, or a declaration naming no gate, still refuses
        // (S1/S3) — see `sidecar::bind_guard::refuse_unguarded_nonloopback_ws_bind`.
        crate::sidecar::bind_guard::refuse_unguarded_nonloopback_ws_bind(
            &self.host,
            self.auth_policy.is_gated(),
            self.declared_surface.as_ref(),
        )
        .map_err(|reason| anyhow::anyhow!(reason))?;

        // The node reaches itself — the SAME general rule the HTTP sidecar follows, stated
        // once in `sidecar::node_local` over the resolved host string and applied here
        // without this surface being named there. `daemon-ws` is declared `"loopback"` in
        // practice, so the plan is a single target and nothing about this socket changes;
        // were it ever declared outward, it would additionally answer on `127.0.0.1` — and
        // that companion listener would be CONSTRUCTED without the handshake gate, exactly
        // as the sidecar's is.
        let plan = crate::sidecar::node_local::listen_plan(&self.host);

        // Bind every target before serving any: half-bound is refused for the WS exactly as
        // it is for the sidecar (see `node_local`'s module doc). The `?` drops whatever was
        // already bound, so a refusal leaves nothing listening.
        let mut bound = Vec::with_capacity(plan.len());
        for target in &plan {
            let addr = format!("{}:{}", target.host, self.port);
            let listener = TcpListener::bind(&addr).await.map_err(|e| {
                anyhow::anyhow!(target.role.describe_bind_failure(
                    "the agent/CRDT WebSocket",
                    &addr,
                    &e.to_string()
                ))
            })?;
            bound.push((listener, target.role));
        }

        self.run_all(bound, self.auth_policy.gate()).await
    }

    /// Run the server with a pre-bound listener and the WS credential gate OFF
    /// (`REFARM_AUTH_POLICY` behaves as unset) — used directly by tests outside this
    /// crate (the `tractor` binary's own test suite) to avoid TOCTOU. A thin `pub`
    /// wrapper around `run_gated` that never names `AuthGate` in its own signature:
    /// `AuthGate` is `pub(crate)` (see `sidecar::mod.rs`'s `auth` module doc for why
    /// that stays scoped), so a `pub fn` cannot take it as a parameter without widening
    /// that visibility. Production code never calls this — `start` calls `run_gated`
    /// directly with the real resolved policy.
    pub async fn run(&self, listener: TcpListener) -> Result<()> {
        self.run_gated(listener, None).await
    }

    /// Same as `run`, but with an explicit (possibly `None`) auth policy — the ADR-093
    /// handshake gate. `pub(crate)`: callable from anywhere in THIS crate, including
    /// `start` (the real production path, which passes the policy resolved once at
    /// daemon start) and this module's own `#[cfg(test)]` suite, which injects a policy
    /// directly — hermetically, with no env var mutation (`std::env::set_var` is
    /// process-global and races across parallel `cargo test` threads).
    pub(crate) async fn run_gated(
        &self,
        listener: TcpListener,
        auth_policy: Option<AuthGate>,
    ) -> Result<()> {
        self.run_all(vec![(listener, ListenRole::Declared)], auth_policy).await
    }

    /// Serve one or more ALREADY-BOUND listeners, each carrying its own credential
    /// configuration, over ONE shared client map and ONE broadcast subscription.
    ///
    /// The sharing is the reason this takes a list instead of being called twice:
    /// `set_broadcast_callback` REPLACES any previous subscription and each call would build
    /// its own `ClientMap`, so two independent `run_gated` calls would leave clients on the
    /// first listener permanently deaf to local changes and invisible to peers on the second.
    /// One call, one map, one callback — the listeners differ only in their gate.
    ///
    /// Which gate each listener gets is decided by `node_local::gate_for` from the LISTENER's
    /// role, at this point, before a single connection is accepted. The gate is then moved
    /// into that listener's accept loop, so a connection is judged by the configuration of the
    /// socket it arrived on and by nothing it sends.
    pub(crate) async fn run_all(
        &self,
        bound: Vec<(TcpListener, ListenRole)>,
        auth_policy: Option<AuthGate>,
    ) -> Result<()> {
        // Log every ACTUAL bound address, not just the configured host: a line that says only
        // "listening on 42000" cannot be read as evidence of WHERE it listens, and this whole
        // class of defect (a listener open to the network while the operator believes it is
        // loopback — or absent from loopback while the operator believes it is there) is
        // exactly what a partial log hides.
        let addresses = bound
            .iter()
            .map(|(listener, role)| {
                let addr = listener
                    .local_addr()
                    .map(|a| a.to_string())
                    .unwrap_or_else(|_| format!("{}:{}", self.host, self.port));
                format!("{addr} ({})", role.label())
            })
            .collect::<Vec<_>>()
            .join(", ");
        tracing::info!(host = %self.host, port = self.port, %addresses, "WebSocket daemon listening");

        self.telemetry.emit_named(
            "daemon:start",
            None,
            Some(serde_json::json!({
                "host": self.host,
                "port": self.port,
                "addresses": addresses,
            })),
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

        // One accept loop per listener, each holding the gate its ROLE was given. They share
        // `clients`, so a peer on either socket sees every other peer's updates.
        let accept_loops = futures_util::future::join_all(bound.into_iter().map(
            |(listener, role)| {
                self.accept_loop(
                    listener,
                    crate::sidecar::node_local::gate_for(role, auth_policy.clone()),
                    clients.clone(),
                )
            },
        ));

        tokio::select! {
            _ = accept_loops => {},
            _ = tokio::signal::ctrl_c() => {
                tracing::info!("Shutdown signal received");
            }
        }
        Ok(())
    }

    /// Accept forever on ONE listener, handing every connection the gate THIS listener was
    /// constructed with. `gate` is captured once, here, and cloned per connection — the
    /// handshake never asks where a connection came from, only what credential it offers.
    /// The peer address is logged and never compared to anything.
    async fn accept_loop(&self, listener: TcpListener, gate: Option<AuthGate>, clients: ClientMap) {
        loop {
            match listener.accept().await {
                Ok((tcp_stream, addr)) => {
                    tracing::debug!(%addr, "new connection");
                    let sync = self.sync.clone();
                    let clients = clients.clone();
                    let plugin_channels = self.plugin_channels.clone();
                    let event_router = self.event_router.clone();
                    let telemetry = self.telemetry.clone();
                    let auth_policy = gate.clone();
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
    }
}

async fn handle_connection(
    tcp_stream: tokio::net::TcpStream,
    sync: Arc<NativeSync>,
    clients: ClientMap,
    plugin_channels: PluginChannels,
    event_router: crate::EventRouter,
    telemetry: TelemetryBus,
    auth_policy: Option<AuthGate>,
) -> Result<()> {
    // `accept_hdr_async` (not `accept_async`) so `ws_handshake_callback` can inspect the
    // offered `Sec-WebSocket-Protocol` tokens and gate the upgrade itself (ADR-093) — see
    // the module doc. `auth_policy: None` makes the callback a no-op passthrough,
    // byte-identical to the old `accept_async(tcp_stream)` call: no gate, so no credential, no
    // budget to spend, and nothing to record. That is the node-local listener's shape exactly
    // (`node_local::gate_for` hands it `None`), so this whole layer is unreachable there rather
    // than merely unused.
    let recorded = HandshakeRecord::default();
    let accepted =
        accept_hdr_async(tcp_stream, ws_handshake_callback(auth_policy.clone(), recorded.clone()))
            .await;

    // BEFORE the `?`, deliberately: a REFUSED handshake is exactly the event the trail exists to
    // carry, and an early return would drop it. Awaited here rather than inside the callback
    // because the callback is synchronous — and because writing after the response has already
    // gone to the socket keeps the trail's I/O off the refusal path, where it could otherwise
    // become the timing signal the byte-identical response is there to deny.
    if let (Some(gate), Some(record)) = (&auth_policy, recorded.take()) {
        gate.record(&record, WS_HANDSHAKE_REQUIREMENT, WS_HANDSHAKE_METHOD).await;
    }

    let ws = accepted?;
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

/// The HTTP method the audit records for a handshake. The WebSocket opening handshake IS an
/// HTTP `GET` (RFC 6455 §4.1), so the trail's existing `method` field keeps its exact meaning
/// and the shared wire fixture keeps its exact shape. A handshake-only field, or a
/// handshake-only event name, would break the vocabulary that fixture exists to hold in
/// lockstep across two runtimes — and this surface has no fact the vocabulary cannot already
/// name.
const WS_HANDSHAKE_METHOD: &str = "GET";
/// What the handshake requires of a credential: nothing beyond being a device credential.
///
/// The handshake declares no scope, and by `sidecar::auth`'s own rule for silence a route that
/// declares nothing admits device credentials ONLY — which is exactly what this handshake
/// admitted before it asked the gate, when it called `AuthPolicy::authenticate` directly. Same
/// admitted set, now with the REASON for a refusal kept, which is what lets the right budget be
/// spent and the right event be written.
const WS_HANDSHAKE_REQUIREMENT: RouteRequirement = RouteRequirement::DeviceOnly;

/// The accept/reject decision for one handshake attempt, given the tokens the client offered in
/// `Sec-WebSocket-Protocol`. No I/O, no tungstenite types, no logging: the caller decides what
/// to log and how to shape the HTTP response from the result. This is what the test suite
/// drives directly, so the handshake gate is exhaustively covered without ever opening a socket.
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
    ///
    /// There are exactly TWO reasons, and there will not be a third. "The bound has engaged" is
    /// deliberately NOT one of them: it is answered with `"invalid credential"`, the same bytes
    /// a wrong token has always been answered with, because a handshake that named the bound
    /// would be telling whoever tripped it that they had.
    Reject { reason: &'static str },
}

/// What one handshake decided: what to do with the socket, and what to write down.
///
/// The two are separated because they happen at different times. The decision must be returned
/// synchronously — tungstenite's `Callback` is a plain `FnOnce` — while the write is `async`.
/// So the record travels out of the callback and `handle_connection` awaits it, which also
/// keeps the trail's I/O off the refusal path entirely.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WsHandshakeOutcome {
    pub(crate) decision: WsHandshakeDecision,
    /// `None` when there is nothing to record, which is exactly three cases and the same three
    /// the HTTP gate keeps silent about: no gate at all (nothing is being enforced), no
    /// credential offered (nothing was attempted, and counting it would let ordinary noise spend
    /// the budget that exists to detect guessing), and an attempt made while ALREADY locked out
    /// (the lockout was recorded on the attempt that tripped it; a line per attempt is a
    /// disk-filling amplifier handed to whoever is hammering).
    pub(crate) record: Option<AuditRecord>,
}

/// THE handshake decision. `offered` is the list of subprotocol tokens the client sent (already
/// split/trimmed from the raw header value — see `parse_offered_protocols`).
///
/// No longer pure over an `&AuthPolicy`, and that is the point of this change rather than a
/// regression in it: a bound on failed authentication is STATE, and the state must be the one
/// the HTTP gate already keeps. Judging a borrowed policy value is precisely what let this
/// handshake refuse the same wrong credential forever. `now` is the limiter's monotonic clock,
/// passed in so the whole sequence is drivable across a window boundary without waiting.
fn decide_ws_handshake(
    offered: &[&str],
    gate: Option<&AuthGate>,
    now: Instant,
) -> WsHandshakeOutcome {
    let Some(gate) = gate else {
        return WsHandshakeOutcome { decision: WsHandshakeDecision::Passthrough, record: None };
    };
    let token = offered
        .iter()
        .find_map(|p| p.strip_prefix(WS_TOKEN_PROTOCOL_PREFIX))
        .filter(|t| !t.is_empty());
    let Some(token) = token else {
        // Nothing presented ⇒ nothing guessed. Refused, not counted, not recorded — the same
        // rule `auth_middleware` applies to a request with no `Authorization` header.
        return WsHandshakeOutcome {
            decision: WsHandshakeDecision::Reject { reason: "missing credential" },
            record: None,
        };
    };
    match gate.admit(token, WS_HANDSHAKE_REQUIREMENT, now) {
        GateOutcome::Admitted { verified, record } => WsHandshakeOutcome {
            decision: WsHandshakeDecision::Accept { identity: verified.identity },
            record: Some(record),
        },
        // The refusal is DISCARDED here, on purpose, and the discard IS the no-oracle rule as
        // control flow: a bound engaging and a token nothing recognises leave this function
        // indistinguishable, so nothing downstream — no status, no header, no body — can differ
        // between them. The bound's effect is entirely inward: the policy went unread and the
        // trail went unwritten.
        GateOutcome::Refused { refusal: _, record } => WsHandshakeOutcome {
            decision: WsHandshakeDecision::Reject { reason: "invalid credential" },
            record,
        },
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

/// Where a synchronous handshake leaves the fact it learned, for the async caller to write.
///
/// A `std::sync::Mutex` and not the `tokio::sync::Mutex` this module imports for the server
/// itself: the callback is not async and cannot await anything, and the critical section is one
/// `Option` move. The slot is filled at most once per connection, by construction — the
/// callback is an `FnOnce`.
#[derive(Clone, Default)]
struct HandshakeRecord(Arc<std::sync::Mutex<Option<AuditRecord>>>);

impl HandshakeRecord {
    fn put(&self, record: Option<AuditRecord>) {
        if let Some(record) = record {
            *self.0.lock().expect("handshake record lock poisoned") = Some(record);
        }
    }

    /// Take what the handshake recorded, leaving nothing behind — so a caller cannot write the
    /// same fact twice.
    fn take(&self) -> Option<AuditRecord> {
        self.0.lock().expect("handshake record lock poisoned").take()
    }
}

/// Build the `accept_hdr_async` callback (`tungstenite::handshake::server::Callback`) for
/// one connection. `gate` is the LIVE handle `WsServer::run_gated` holds — cloned per
/// connection, which is an `Arc` bump, so a connection arriving after a revocation is judged by
/// the post-revocation policy and one arriving after an enrolment by the post-enrolment policy,
/// and every listener sharing the gate shares ONE set of budgets. Thin glue: parses the request,
/// calls `decide_ws_handshake`, deposits whatever is to be recorded, then either echoes
/// `WS_SYNC_PROTOCOL` (accept) or writes a `401` (reject) — all logging happens here, at the
/// boundary, never inside the decision.
// The tungstenite Callback trait fixes this exact `Result<Response, ErrorResponse>` shape;
// boxing its error would stop the closure from implementing that upstream trait.
#[allow(clippy::result_large_err)]
fn ws_handshake_callback(
    gate: Option<AuthGate>,
    recorded: HandshakeRecord,
) -> impl FnOnce(&WsHandshakeRequest, WsHandshakeResponse) -> Result<WsHandshakeResponse, WsErrorResponse> {
    move |request, response| {
        let offered = parse_offered_protocols(request);
        let offered_refs: Vec<&str> = offered.iter().map(String::as_str).collect();
        let outcome = decide_ws_handshake(&offered_refs, gate.as_ref(), Instant::now());
        recorded.put(outcome.record);
        match outcome.decision {
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

    use crate::security_events::{Budget, SecurityEvent, SECURITY_EVENT_NAMES};
    use crate::sidecar::auth::{
        credential_tag, sha256_hex, AuthGate, AuthPolicy, Credential, AUTH_POLICY_ENV,
        FAILURE_THRESHOLD, FAILURE_WINDOW,
    };
    use crate::{EventEnvelope, NativeStorage, NativeSync, TelemetryBus};

    fn make_sync() -> Arc<NativeSync> {
        let storage = NativeStorage::open(":memory:").unwrap();
        Arc::new(NativeSync::new(storage, ":memory:").unwrap())
    }

    /// An `AuthPolicySource` that resolves to nothing: a refarm dir that does not exist and
    /// NO declared `device-token` gate. The derivation itself is covered beside it, in
    /// `sidecar::auth`.
    fn no_auth_source() -> crate::sidecar::AuthPolicySource {
        crate::sidecar::AuthPolicySource::new(
            std::path::PathBuf::from("/nonexistent-refarm-dir"),
            false,
        )
    }

    /// The "no gate anywhere" resolved policy these tests hand to `WsServer::new`. They drive
    /// the gate through `run_gated`'s explicit policy argument instead, so what the server
    /// was constructed with must never be what decides.
    fn no_auth_policy() -> crate::sidecar::ResolvedAuthPolicy {
        crate::sidecar::ResolvedAuthPolicy::from_policy(None)
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
        spawn_server_full(channels, crate::EventRouter::default(), Some(AuthGate::for_test(policy)))
            .await
    }

    /// Same, but over a LIVE gate resolved from a real policy file — for the reload test,
    /// which changes the file under a server that keeps running.
    async fn spawn_server_with_gate(channels: PluginChannels, gate: AuthGate) -> String {
        spawn_server_full(channels, crate::EventRouter::default(), Some(gate)).await
    }

    async fn spawn_server_full(
        channels: PluginChannels,
        event_router: crate::EventRouter,
        auth_policy: Option<AuthGate>,
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
            no_auth_policy(),
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

    /// A server on `host`, with no gate — the shape both bind-address guards below need.
    fn server_on(host: &str) -> WsServer {
        WsServer::new(
            make_sync(),
            host.to_string(),
            42000,
            TelemetryBus::new(10),
            Arc::new(RwLock::new(HashMap::new())),
            crate::EventRouter::default(),
            None,
            no_auth_policy(),
        )
    }

    #[test]
    fn bind_addr_uses_configured_host_not_all_interfaces() {
        // Mutation guard: `start()` used to hardcode `format!("0.0.0.0:{port}")` —
        // every interface, unconditionally, no auth. This asserts the address that
        // flows into the bind call, PURE — no socket opened — so a regression back to
        // a hardcoded 0.0.0.0 default is caught without ever touching the network.
        assert_eq!(server_on("127.0.0.1").bind_addrs(), vec!["127.0.0.1:42000".to_string()]);
        assert!(!server_on("127.0.0.1").bind_addrs().contains(&"0.0.0.0:42000".to_string()));
    }

    #[test]
    fn a_loopback_declared_ws_binds_exactly_one_socket_as_it_always_has() {
        // `daemon-ws` is declared `"loopback"`; the node-reaches-itself rule must leave it
        // byte-identical — one socket, at the declared address.
        assert_eq!(server_on("127.0.0.1").bind_addrs().len(), 1);
    }

    #[test]
    fn an_outward_declared_ws_also_answers_on_loopback() {
        // The general rule reaches this surface too — stated once in `node_local`, applied
        // here without that module naming `daemon-ws`. Were the WS ever declared outward,
        // the node would still reach it at 127.0.0.1, ungated (`gate_for` gives the
        // node-local listener no handshake gate).
        assert_eq!(
            server_on("100.105.71.127").bind_addrs(),
            vec!["100.105.71.127:42000".to_string(), "127.0.0.1:42000".to_string()],
        );
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

    /// A gate over a one-credential device policy — what these tests judge against now that
    /// the decision needs the LIMITER's state and not only a policy value.
    fn gate_with(token: &str, identity: &str) -> AuthGate {
        AuthGate::for_test(policy_with(token, identity))
    }

    /// One handshake decision, at "now". The `.decision` projection keeps every assertion below
    /// written about the same thing it was written about before the trail existed.
    fn decide(offered: &[&str], gate: Option<&AuthGate>) -> WsHandshakeDecision {
        decide_ws_handshake(offered, gate, Instant::now()).decision
    }

    #[test]
    fn decide_no_policy_is_passthrough_regardless_of_what_is_offered() {
        assert_eq!(decide(&[], None), WsHandshakeDecision::Passthrough);
        assert_eq!(
            decide(&[WS_SYNC_PROTOCOL, "bearer.anything"], None),
            WsHandshakeDecision::Passthrough
        );
    }

    #[test]
    fn decide_policy_with_valid_token_accepts_and_resolves_identity() {
        let gate = gate_with("good-token", "id-arthur");
        let offered = [WS_SYNC_PROTOCOL, "bearer.good-token"];
        assert_eq!(
            decide(&offered, Some(&gate)),
            WsHandshakeDecision::Accept { identity: "id-arthur".to_string() }
        );
    }

    #[test]
    fn decide_policy_with_wrong_token_is_rejected() {
        let gate = gate_with("good-token", "id-arthur");
        let offered = [WS_SYNC_PROTOCOL, "bearer.wrong-token"];
        assert_eq!(
            decide(&offered, Some(&gate)),
            WsHandshakeDecision::Reject { reason: "invalid credential" }
        );
    }

    #[test]
    fn decide_policy_with_no_subprotocol_at_all_is_rejected() {
        let gate = gate_with("good-token", "id-arthur");
        assert_eq!(
            decide(&[], Some(&gate)),
            WsHandshakeDecision::Reject { reason: "missing credential" }
        );
    }

    #[test]
    fn decide_policy_with_protocol_name_but_no_token_entry_is_rejected() {
        // The protocol name alone, with no `bearer.` entry at all, must be treated the
        // same as offering nothing — not silently accepted because SOMETHING was sent.
        let gate = gate_with("good-token", "id-arthur");
        let offered = [WS_SYNC_PROTOCOL];
        assert_eq!(
            decide(&offered, Some(&gate)),
            WsHandshakeDecision::Reject { reason: "missing credential" }
        );
    }

    #[test]
    fn decide_policy_with_empty_token_value_is_rejected() {
        let gate = gate_with("good-token", "id-arthur");
        let offered = [WS_SYNC_PROTOCOL, "bearer."];
        assert_eq!(
            decide(&offered, Some(&gate)),
            WsHandshakeDecision::Reject { reason: "missing credential" }
        );
    }

    #[test]
    fn decide_accept_decision_never_carries_the_raw_token() {
        // Mutation guard for "never echo the token": even in DEBUG form (the shape a
        // careless `tracing::info!("{decision:?}")` might log), the accept decision must
        // never contain the raw token — only the resolved identity, which the policy
        // controls independently of the token's own bytes. Asserted over the WHOLE outcome,
        // record included: the record now travels out of the callback, so it is a second thing
        // that could carry a secret and must not.
        let token = "super-secret-token-value-zzz";
        let gate = gate_with(token, "id-arthur");
        let offered = [WS_SYNC_PROTOCOL, &format!("{WS_TOKEN_PROTOCOL_PREFIX}{token}")];
        let outcome = decide_ws_handshake(&offered, Some(&gate), Instant::now());
        let debug = format!("{outcome:?}");
        assert!(!debug.contains(token), "the accept outcome must never carry the raw token: {debug}");
        assert!(
            !debug.contains(&sha256_hex(token)),
            "nor the token's digest: {debug}"
        );
        assert_eq!(
            outcome.decision,
            WsHandshakeDecision::Accept { identity: "id-arthur".to_string() }
        );
    }

    #[test]
    fn deny_all_policy_from_unreadable_config_rejects_every_credential() {
        // Exercises the REAL resolution (`ResolvedAuthPolicy::resolve`), not a hand-built
        // policy: "policy resolvable but unreadable ⇒ deny all" is `sidecar::auth`'s own
        // doctrine — the WS gate enforces the SAME resolved value the sidecar does, so a
        // broken policy must lock the WS door too, not leave it open.
        let _env = crate::test_support::env_lock();
        std::env::set_var(AUTH_POLICY_ENV, "/nonexistent/policy-for-ws-handshake-test.json");
        let resolved = crate::sidecar::ResolvedAuthPolicy::resolve(&no_auth_source());
        std::env::remove_var(AUTH_POLICY_ENV);

        let gate = resolved.gate().expect("unreadable policy must still resolve to Some(deny_all)");
        let offered = [WS_SYNC_PROTOCOL, "bearer.any-token-at-all"];
        assert_eq!(
            decide(&offered, Some(&gate)),
            WsHandshakeDecision::Reject { reason: "invalid credential" }
        );
    }

    // ── the bound on failed handshakes, and the trail ─────────────────────────────

    /// The gate the bound-and-trail tests judge against, over the SAME one-credential device
    /// policy the handshake tests have always used.
    fn gated(token: &str, identity: &str) -> AuthGate {
        gate_with(token, identity)
    }

    fn offered_bearer(token: &str) -> [String; 2] {
        [WS_SYNC_PROTOCOL.to_string(), format!("{WS_TOKEN_PROTOCOL_PREFIX}{token}")]
    }

    fn attempt(gate: &AuthGate, token: &str, now: Instant) -> WsHandshakeOutcome {
        let offered = offered_bearer(token);
        let refs: Vec<&str> = offered.iter().map(String::as_str).collect();
        decide_ws_handshake(&refs, Some(gate), now)
    }

    #[test]
    fn a_failed_handshake_spends_the_guessing_budget_and_the_bound_engages() {
        // The gap this closes, stated as a test: before it, a peer could offer a wrong
        // `bearer.` subprotocol as fast as it could open sockets, for ever, and nothing counted.
        let gate = gated("the-real-token", "id-arthur");
        let now = Instant::now();

        for n in 1..FAILURE_THRESHOLD {
            let outcome = attempt(&gate, "a-guess", now);
            assert_eq!(
                outcome.decision,
                WsHandshakeDecision::Reject { reason: "invalid credential" },
                "attempt {n} must be refused"
            );
            assert_eq!(
                outcome.record.map(|r| r.event),
                Some(SecurityEvent::AuthenticationFailed),
                "attempt {n} is a guess and must be recorded as one"
            );
        }
        assert_eq!(
            gate.tracked_failures(),
            1,
            "one credential presented ⇒ one bucket, whatever the number of attempts"
        );

        // The attempt that TRIPS the bound is its own, distinguishable event, written once.
        let tripped = attempt(&gate, "a-guess", now);
        assert_eq!(
            tripped.record.map(|r| r.event),
            Some(SecurityEvent::RateLimitEngaged(Budget::Authentication)),
            "the {FAILURE_THRESHOLD}th failure must name the bound it engaged"
        );

        // …and every attempt after it is refused WITHOUT the policy being consulted and
        // WITHOUT a further line. The silence is the bound doing its second job: a line per
        // attempt while locked out is a disk-filling amplifier handed to whoever is hammering.
        for _ in 0..3 {
            let after = attempt(&gate, "a-guess", now);
            assert_eq!(
                after.decision,
                WsHandshakeDecision::Reject { reason: "invalid credential" },
                "a locked-out handshake is refused exactly as any other is"
            );
            assert_eq!(
                after.record, None,
                "an attempt made while already locked out must write nothing"
            );
        }
    }

    #[test]
    fn the_bound_releases_itself_after_the_window_with_nothing_scheduled() {
        let gate = gated("the-real-token", "id-arthur");
        let origin = Instant::now();
        for _ in 0..FAILURE_THRESHOLD {
            attempt(&gate, "a-guess", origin);
        }
        assert_eq!(attempt(&gate, "a-guess", origin).record, None, "locked out");
        // One window later, the bucket is forgotten on read — no sweeper, nothing to fail.
        let later = origin + FAILURE_WINDOW;
        assert_eq!(
            attempt(&gate, "a-guess", later).record.map(|r| r.event),
            Some(SecurityEvent::AuthenticationFailed),
            "the lockout must end on its own, and counting must start over"
        );
    }

    #[test]
    fn the_bound_never_refuses_a_credential_that_authenticates() {
        // The anti-lockout property, on the handshake: grinding one credential past its bound
        // must not cost the enrolled device its own socket, because a budget belongs to the
        // secret that spends it.
        let gate = gated("the-real-token", "id-arthur");
        let now = Instant::now();
        for _ in 0..(FAILURE_THRESHOLD + 3) {
            attempt(&gate, "a-guess", now);
        }
        let accepted = attempt(&gate, "the-real-token", now);
        assert_eq!(
            accepted.decision,
            WsHandshakeDecision::Accept { identity: "id-arthur".to_string() },
            "a flood against another credential must never shut the enrolled device out"
        );
        assert_eq!(
            accepted.record.map(|r| r.event),
            Some(SecurityEvent::Accepted),
            "and the acceptance is attributed in the trail"
        );
    }

    #[test]
    fn a_successful_handshake_clears_that_credentials_guessing_count() {
        // What the HTTP side decided, and it must hold here or enrolment gets worse rather than
        // better: a phone that reconnects four times BEFORE the operator enrols it has spent
        // four of its five, and the enrolment must not leave it one reconnection from a
        // lockout. A success is proof the caller was not guessing, so the count goes.
        //
        // Driven over a REAL policy file, because "the same credential fails and then succeeds"
        // is only reachable through an enrolment — which is exactly the operational moment.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(crate::sidecar::auth::AUTH_POLICY_FILE_NAME);
        let write = |tokens: &[(&str, &str)]| {
            let credentials: Vec<_> = tokens
                .iter()
                .map(|(t, id)| serde_json::json!({ "identity": id, "tokenSha256": sha256_hex(t) }))
                .collect();
            std::fs::write(
                &path,
                serde_json::to_vec(&serde_json::json!({ "credentials": credentials })).unwrap(),
            )
            .unwrap();
        };
        write(&[("laptop-token", "id-laptop")]);
        let gate = crate::sidecar::ResolvedAuthPolicy::resolve(
            &crate::sidecar::AuthPolicySource::new(dir.path().to_path_buf(), true),
        )
        .gate()
        .expect("declared ⇒ gated");

        let now = Instant::now();
        for _ in 0..(FAILURE_THRESHOLD - 1) {
            attempt(&gate, "phone-token", now);
        }
        assert_eq!(gate.tracked_failures(), 1, "the phone has spent four of its five");

        write(&[("laptop-token", "id-laptop"), ("phone-token", "id-phone")]);
        assert!(gate.reload_if_changed(), "the enrolment is a change");

        let accepted = attempt(&gate, "phone-token", now);
        assert_eq!(
            accepted.decision,
            WsHandshakeDecision::Accept { identity: "id-phone".to_string() }
        );
        assert_eq!(
            gate.tracked_failures(),
            0,
            "the enrolled phone must not carry its pre-enrolment failures into the next minute"
        );
    }

    #[test]
    fn a_recognised_credential_refused_here_spends_the_refusal_budget_not_the_guessing_one() {
        // The separation the HTTP gate gained, carried to the handshake for free by asking the
        // same question: a browser holding a real `prompt:answer` credential that points itself
        // at the CRDT socket is a caller with a bug, not a stranger guessing — and it must not
        // spend the budget that exists to detect guessing.
        let policy = AuthPolicy::from_parts(
            vec![],
            vec![crate::sidecar::auth::ScopedCredential {
                token_sha256: sha256_hex("browser-token"),
                identity: "id-browser".to_string(),
                scope: vec![crate::sidecar::auth::Scope::AnswerPrompts],
                expires_at_ms: i64::MAX,
            }],
        );
        let gate = AuthGate::for_test(policy);
        let outcome = attempt(&gate, "browser-token", Instant::now());
        assert_eq!(
            outcome.decision,
            WsHandshakeDecision::Reject { reason: "invalid credential" },
            "the handshake declares no scope, so only a device credential satisfies it — \
             unchanged, and the caller is told exactly what it was told before"
        );
        assert_eq!(
            outcome.record.map(|r| r.event),
            Some(SecurityEvent::AuthorizationRefused),
            "inwardly, this is a caller this node KNOWS asking for authority it has not got"
        );
        assert_eq!(
            gate.tracked_failures_in(Budget::Authentication),
            0,
            "a recognised credential is not evidence of guessing"
        );
        assert_eq!(gate.tracked_failures_in(Budget::Authorization), 1);
    }

    #[test]
    fn a_handshake_offering_no_credential_is_refused_and_never_counted() {
        // Nothing presented ⇒ nothing guessed. Counting an unaware client, a probe or a
        // browser that wandered in would let ordinary noise spend the budget that exists to
        // detect guessing — a way for a third party to blunt the signal for free.
        let gate = gated("the-real-token", "id-arthur");
        for offered in [vec![], vec![WS_SYNC_PROTOCOL], vec![WS_SYNC_PROTOCOL, "bearer."]] {
            let outcome = decide_ws_handshake(&offered, Some(&gate), Instant::now());
            assert_eq!(
                outcome.decision,
                WsHandshakeDecision::Reject { reason: "missing credential" }
            );
            assert_eq!(outcome.record, None, "nothing was attempted, so nothing is recorded");
        }
        assert_eq!(gate.tracked_failures(), 0, "and no budget was spent");
    }

    /// The refusal this handshake writes, rendered as the bytes it IS: status line, every
    /// header (sorted, so the comparison cannot pass on iteration order), and the body.
    fn render_refusal(response: &WsErrorResponse) -> String {
        let mut headers: Vec<String> = response
            .headers()
            .iter()
            .map(|(name, value)| format!("{}: {}", name.as_str(), value.to_str().unwrap_or("<!>")))
            .collect();
        headers.sort();
        format!(
            "{} {}\n{}\n\n{}",
            response.status().as_u16(),
            response.status().canonical_reason().unwrap_or(""),
            headers.join("\n"),
            response.body().as_deref().unwrap_or_default()
        )
    }

    fn refuse_through_the_callback(gate: &AuthGate, token: &str) -> WsErrorResponse {
        let request = tokio_tungstenite::tungstenite::http::Request::builder()
            .header(
                header::SEC_WEBSOCKET_PROTOCOL,
                format!("{WS_SYNC_PROTOCOL}, {WS_TOKEN_PROTOCOL_PREFIX}{token}"),
            )
            .body(())
            .unwrap();
        ws_handshake_callback(Some(gate.clone()), HandshakeRecord::default())(
            &request,
            WsHandshakeResponse::new(()),
        )
        .expect_err("a wrong credential must be refused")
    }

    #[test]
    fn the_refusal_is_byte_identical_whether_or_not_the_bound_has_engaged() {
        // THE no-oracle rule for this surface, and it is not negotiable. The HTTP gate answers
        // a `429` with `Retry-After` when a bound engages; the handshake deliberately does not,
        // because a new status on a handshake announces both that the bound exists and that
        // this caller reached it. Every refusal here — before the bound, on the attempt that
        // trips it, and long after — must be the same bytes.
        let gate = gated("the-real-token", "id-arthur");
        let rendered: Vec<String> = (0..(FAILURE_THRESHOLD + 3))
            .map(|_| render_refusal(&refuse_through_the_callback(&gate, "a-guess")))
            .collect();
        for (n, line) in rendered.iter().enumerate() {
            assert_eq!(
                line, &rendered[0],
                "refusal {} differs from the first — the bound must be invisible on the wire",
                n + 1
            );
        }

        // Identical to the refusal a wrong credential got before any bound existed — the same
        // function, on a gate that has never seen a failure.
        let untouched = gated("the-real-token", "id-arthur");
        assert_eq!(
            rendered[0],
            render_refusal(&refuse_through_the_callback(&untouched, "a-guess"))
        );

        // And pinned LITERALLY, so "identical" cannot be satisfied by all of them being wrong.
        assert_eq!(
            rendered[0],
            "401 Unauthorized\n\
             content-type: application/json\n\
             www-authenticate: Bearer\n\
             \n\
             {\"error\":\"unauthorized\",\"reason\":\"invalid credential\"}"
        );
    }

    #[test]
    fn the_handshake_names_no_security_event_of_its_own() {
        // The vocabulary is a contract with a second runtime, held in lockstep by
        // `packages/event-contract-v1/security-events.fixture.ndjson`. A handshake-only event
        // name would be a fact one side could emit and the other could not parse — so this file
        // must not spell one, not even in a test.
        let src = include_str!("ws_server.rs");
        for name in crate::security_events::SECURITY_EVENT_NAMES {
            assert!(
                !src.contains(name),
                "{name} is spelled in ws_server.rs — the handshake must name facts through \
                 crate::security_events, never in its own words"
            );
        }
        assert!(
            src.contains("gate.admit(token, WS_HANDSHAKE_REQUIREMENT, now)"),
            "the handshake must reach the bound through the gate's ONE decision, never a \
             limiter of its own"
        );
        assert!(
            src.contains("gate.record(&record, WS_HANDSHAKE_REQUIREMENT, WS_HANDSHAKE_METHOD)"),
            "and the trail through the gate's ONE writer, never a second audit file"
        );
    }

    // ── the ungated listener, and the operator's declared shape ────────────────────

    #[test]
    fn the_node_local_listener_gets_no_gate_and_therefore_no_bound_and_no_trail() {
        // `node-local` is untouched, structurally: it is CONSTRUCTED without a gate, so it has
        // no credential to key on, no budget to spend and nothing to record — the limiter is
        // unreachable there rather than merely unused. It is also the operator's recovery path.
        let gate = gated("the-real-token", "id-arthur");
        assert!(
            crate::sidecar::node_local::gate_for(ListenRole::NodeLocal, Some(gate.clone()))
                .is_none(),
            "the node-local listener must never carry the credential layer"
        );
        let ungated = decide_ws_handshake(
            &[WS_SYNC_PROTOCOL, "bearer.anything-at-all"],
            None,
            Instant::now(),
        );
        assert_eq!(
            ungated,
            WsHandshakeOutcome { decision: WsHandshakeDecision::Passthrough, record: None },
            "no gate ⇒ passthrough and silence, byte-identical to pre-ADR-093"
        );
        assert_eq!(gate.tracked_failures(), 0);
    }

    #[test]
    fn a_loopback_declared_daemon_ws_opens_one_socket_and_it_is_the_gated_one() {
        // The operator's own declaration: `surfaces.daemon-ws` is `"loopback"`. The plan is a
        // single `Declared` target — there is no additive node-local companion to reason about
        // — and that one socket carries whatever gate was resolved, exactly as it did before
        // this change. Nothing about WHERE this surface listens moves.
        let plan = crate::sidecar::node_local::listen_plan("127.0.0.1");
        assert_eq!(plan.len(), 1, "a loopback-declared surface opens exactly one socket");
        assert_eq!(plan[0].role, ListenRole::Declared);
        assert_eq!(plan[0].host, "127.0.0.1");
        let gate = gated("the-real-token", "id-arthur");
        assert!(
            crate::sidecar::node_local::gate_for(plan[0].role, Some(gate)).is_some(),
            "and the declared socket is the one the gate is attached to"
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
            let accept_result = ws_handshake_callback(
                Some(AuthGate::for_test(policy.clone())),
                HandshakeRecord::default(),
            )(&accept_req, WsHandshakeResponse::new(()));
            assert!(accept_result.is_ok(), "valid token must be accepted");

            let reject_req = tokio_tungstenite::tungstenite::http::Request::builder()
                .header(
                    header::SEC_WEBSOCKET_PROTOCOL,
                    format!("{WS_SYNC_PROTOCOL}, {WS_TOKEN_PROTOCOL_PREFIX}wrong-{token}"),
                )
                .body(())
                .unwrap();
            let reject_result = ws_handshake_callback(
                Some(AuthGate::for_test(policy.clone())),
                HandshakeRecord::default(),
            )(&reject_req, WsHandshakeResponse::new(()));
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

    #[tokio::test]
    async fn e2e_a_running_server_admits_an_enrolment_and_refuses_a_revocation() {
        // The whole point, over a real socket, on ONE server that is never restarted:
        // enrolling a device makes the SAME running daemon accept it, and revoking it makes
        // the same running daemon refuse it. Before the reload, both required a restart —
        // which for the revocation direction means a credential the operator had already
        // deleted kept opening the door until they happened to bounce the runtime.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(crate::sidecar::auth::AUTH_POLICY_FILE_NAME);

        let write = |tokens: &[(&str, &str)]| {
            let credentials: Vec<_> = tokens
                .iter()
                .map(|(t, id)| serde_json::json!({ "identity": id, "tokenSha256": sha256_hex(t) }))
                .collect();
            std::fs::write(
                &path,
                serde_json::to_vec(&serde_json::json!({ "credentials": credentials })).unwrap(),
            )
            .unwrap();
        };
        write(&[("laptop-token", "id-laptop")]);

        let resolved = crate::sidecar::ResolvedAuthPolicy::resolve(
            &crate::sidecar::AuthPolicySource::new(dir.path().to_path_buf(), true),
        );
        let gate = resolved.gate().expect("declared ⇒ gated");
        let addr =
            spawn_server_with_gate(Arc::new(RwLock::new(HashMap::new())), gate.clone()).await;

        let connect = |token: &str| {
            let request =
                client_request_with_protocols(&addr, &[WS_SYNC_PROTOCOL, &format!("bearer.{token}")]);
            async move { timeout(Duration::from_secs(2), connect_async(request)).await }
        };

        assert!(
            connect("phone-token").await.expect("no hang").is_err(),
            "a device that has not been enrolled must be refused"
        );

        write(&[("laptop-token", "id-laptop"), ("phone-token", "id-phone")]);
        assert!(gate.reload_if_changed(), "the enrolment is a change");
        assert!(
            connect("phone-token").await.expect("no hang").is_ok(),
            "the SAME running server must admit the newly enrolled device — no restart"
        );

        write(&[("laptop-token", "id-laptop")]);
        assert!(gate.reload_if_changed(), "the revocation is a change");
        assert!(
            connect("phone-token").await.expect("no hang").is_err(),
            "and must refuse it again the moment it is revoked — no restart"
        );
        assert!(
            connect("laptop-token").await.expect("no hang").is_ok(),
            "while the device that was never revoked keeps working throughout"
        );
    }

    // ── the trail, end to end over a real socket ───────────────────────────────────

    /// Every `event` name the trail carries, in file order. Reads the SAME file the rest of the
    /// runtime writes (`observer::AUDIT_FILE` under the refarm dir) — there is one trail, and
    /// this test would fail if the handshake had opened a second.
    fn audit_events(dir: &std::path::Path) -> Vec<String> {
        audit_lines(dir)
            .iter()
            .map(|line| {
                serde_json::from_str::<serde_json::Value>(line).expect("an audit line is JSON")
                    ["event"]
                    .as_str()
                    .expect("every line names its event")
                    .to_string()
            })
            .collect()
    }

    fn audit_lines(dir: &std::path::Path) -> Vec<String> {
        std::fs::read_to_string(dir.join(crate::observer::AUDIT_FILE))
            .unwrap_or_default()
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(str::to_string)
            .collect()
    }

    /// The audit write happens in the connection's own task, after the handshake response has
    /// already gone to the socket — so a test that connected must WAIT for the line rather than
    /// assume it. Bounded; a missing line fails the assertion that follows, not this helper.
    async fn wait_for_audit_lines(dir: &std::path::Path, expected: usize) {
        for _ in 0..200 {
            if audit_lines(dir).len() >= expected {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }

    #[tokio::test]
    async fn e2e_the_handshake_records_every_attempt_in_the_one_trail_and_never_a_credential() {
        let token = "ws-trail-secret-token-zzz";
        let dir = tempfile::tempdir().unwrap();
        let gate = AuthGate::for_test_with_audit(policy_with(token, "id-ws"), dir.path());
        let addr = spawn_server_with_gate(Arc::new(RwLock::new(HashMap::new())), gate.clone()).await;

        let connect = |offer: String| {
            let request = client_request_with_protocols(&addr, &[WS_SYNC_PROTOCOL, &offer]);
            async move { timeout(Duration::from_secs(2), connect_async(request)).await }
        };

        // 1. An accepted handshake is attributed.
        let accepted = connect(format!("bearer.{token}")).await.expect("no hang");
        assert!(accepted.is_ok(), "the enrolled credential must still connect");
        wait_for_audit_lines(dir.path(), 1).await;

        // 2. FAILURE_THRESHOLD guesses: the last one engages the bound.
        for n in 0..FAILURE_THRESHOLD {
            assert!(
                connect("bearer.a-guess".to_string()).await.expect("no hang").is_err(),
                "guess {n} must be refused"
            );
            wait_for_audit_lines(dir.path(), 2 + n as usize).await;
        }

        // 3. And an attempt made while locked out writes NOTHING — the amplifier bound.
        assert!(connect("bearer.a-guess".to_string()).await.expect("no hang").is_err());
        // Give the connection task the same chance to write that every step above had.
        tokio::time::sleep(Duration::from_millis(100)).await;

        let mut expected = vec![crate::security_events::ACCEPTED.to_string()];
        for _ in 0..(FAILURE_THRESHOLD - 1) {
            expected.push(crate::security_events::AUTHENTICATION_FAILED.to_string());
        }
        expected.push(crate::security_events::RATE_LIMIT_ENGAGED.to_string());
        assert_eq!(
            audit_events(dir.path()),
            expected,
            "every handshake attempt lands in the one trail, under the shared vocabulary — \
             and an attempt made while locked out lands nowhere"
        );
        for name in audit_events(dir.path()) {
            assert!(
                SECURITY_EVENT_NAMES.contains(&name.as_str()),
                "{name} is not in the vocabulary the fixture pins for both runtimes"
            );
        }

        // THE rule: no credential material, in any form, anywhere in the trail.
        let digest = sha256_hex(token);
        let tag = credential_tag(token).to_string();
        for line in audit_lines(dir.path()) {
            assert!(!line.contains(token), "the raw token appears in the trail: {line}");
            assert!(!line.contains(&digest), "the token's sha256 appears: {line}");
            assert!(!line.contains(&digest[..8]), "a truncated digest is still material: {line}");
            assert!(!line.contains(&tag), "the limiter's tag appears: {line}");
            assert!(
                !line.contains("a-guess"),
                "a GUESSED credential is credential material too: {line}"
            );
            assert!(
                !contains_hex_run(&line, 16),
                "a long hex run is what a hash looks like: {line}"
            );
        }
    }

    /// Does `text` contain an unbroken run of at least `len` hex digits? The shape of a hash,
    /// caught regardless of what anyone decides to call the field it lands in.
    fn contains_hex_run(text: &str, len: usize) -> bool {
        let mut run = 0usize;
        for ch in text.chars() {
            if ch.is_ascii_hexdigit() {
                run += 1;
                if run >= len {
                    return true;
                }
            } else {
                run = 0;
            }
        }
        false
    }

    #[tokio::test]
    async fn e2e_an_ungated_listener_writes_no_trail_while_a_gated_one_does() {
        // `node-local` and the "nothing declared" case share one shape: no gate ⇒ passthrough,
        // no budget, no line. Asserted over real sockets, and against a trail that is PROVEN
        // live in the same test — a silent file is only evidence when something else would have
        // written to it.
        let token = "two-listeners-token";
        let dir = tempfile::tempdir().unwrap();
        let gate = AuthGate::for_test_with_audit(policy_with(token, "id-gated"), dir.path());

        let ungated = spawn_server(Arc::new(RwLock::new(HashMap::new()))).await;
        let (_ws, response) = timeout(Duration::from_secs(2), connect_async(&ungated))
            .await
            .expect("no hang")
            .expect("an ungated listener admits any client, unchanged");
        assert!(
            response.headers().get(header::SEC_WEBSOCKET_PROTOCOL).is_none(),
            "and echoes nothing, exactly as before"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(
            audit_lines(dir.path()).is_empty(),
            "an ungated listener has no gate to record, and must not invent one"
        );

        let gated_addr =
            spawn_server_with_gate(Arc::new(RwLock::new(HashMap::new())), gate).await;
        let request =
            client_request_with_protocols(&gated_addr, &[WS_SYNC_PROTOCOL, &format!("bearer.{token}")]);
        assert!(
            timeout(Duration::from_secs(2), connect_async(request))
                .await
                .expect("no hang")
                .is_ok(),
            "the gated listener admits the enrolled credential"
        );
        wait_for_audit_lines(dir.path(), 1).await;
        assert_eq!(
            audit_events(dir.path()),
            vec![crate::security_events::ACCEPTED.to_string()],
            "…and writes to the very file the ungated one left alone"
        );
    }

    // ── one resolution, two gates (the single-resolution fix, end to end) ─────────

    /// An OS-assigned free port, released immediately — for the two servers below, which
    /// bind the address themselves (`start`) rather than accepting a pre-bound listener.
    async fn free_port() -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        port
    }

    async fn wait_until_listening(port: u16) {
        for _ in 0..100 {
            if tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("server on port {port} never started listening");
    }

    #[tokio::test]
    async fn one_resolution_is_the_policy_both_gates_really_enforce() {
        // The point of resolving once is not tidiness — it is that the HTTP sidecar and the
        // WS server must enforce THE SAME credentials. When each resolved for itself they
        // read the same file twice, and two reads are two answers that can drift apart: one
        // gate honouring a credential the other has never heard of, with nothing in the logs
        // to explain it.
        //
        // So: resolve ONCE from a policy file that exists, hand the value to both REAL
        // servers over REAL loopback sockets, and require both to accept exactly the enrolled
        // token and reject exactly everything else.
        let _env = crate::test_support::env_lock();
        std::env::remove_var(AUTH_POLICY_ENV);
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join(crate::sidecar::auth::AUTH_POLICY_FILE_NAME),
            serde_json::to_vec(&serde_json::json!({
                "credentials": [
                    { "identity": "id-both", "tokenSha256": sha256_hex("both-gates-token") }
                ]
            }))
            .unwrap(),
        )
        .unwrap();

        // ONE resolution — what main.rs performs at daemon start.
        let resolved = crate::sidecar::ResolvedAuthPolicy::resolve(
            &crate::sidecar::AuthPolicySource::new(dir.path().to_path_buf(), true),
        );

        // ── gate 1: the WS handshake, via the real `WsServer::start` ──────────────
        let ws_port = free_port().await;
        let ws_server = WsServer::new(
            make_sync(),
            "127.0.0.1".to_string(),
            ws_port,
            TelemetryBus::new(10),
            Arc::new(RwLock::new(HashMap::new())),
            crate::EventRouter::default(),
            None,
            resolved.clone(),
        );
        tokio::spawn(async move {
            let _ = ws_server.start().await;
        });
        wait_until_listening(ws_port).await;
        let ws_addr = format!("ws://127.0.0.1:{ws_port}");

        let accepted = timeout(
            Duration::from_secs(2),
            connect_async(client_request_with_protocols(
                &ws_addr,
                &[WS_SYNC_PROTOCOL, "bearer.both-gates-token"],
            )),
        )
        .await
        .expect("connect must not hang");
        assert!(accepted.is_ok(), "the WS gate must accept the ONE resolved credential");

        let ws_refused = timeout(
            Duration::from_secs(2),
            connect_async(client_request_with_protocols(
                &ws_addr,
                &[WS_SYNC_PROTOCOL, "bearer.not-the-token"],
            )),
        )
        .await
        .expect("connect must not hang")
        .expect_err("the WS gate must reject anything else");
        match ws_refused {
            tokio_tungstenite::tungstenite::Error::Http(response) => {
                assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
            }
            other => panic!("expected an HTTP 401 handshake refusal, got: {other:?}"),
        }

        // ── gate 2: the HTTP sidecar middleware, via the real `sidecar::start` ────
        let http_port = free_port().await;
        let state = crate::sidecar::SidecarState::for_test(dir.path(), ":memory:").unwrap();
        let http_policy = resolved.clone();
        tokio::spawn(async move {
            let _ = crate::sidecar::start(
                state,
                Some("127.0.0.1".to_string()),
                http_port,
                None,
                http_policy,
            )
            .await;
        });
        wait_until_listening(http_port).await;
        let efforts = format!("http://127.0.0.1:{http_port}/efforts");

        let client = reqwest::Client::new();
        assert_eq!(
            client.get(&efforts).send().await.unwrap().status(),
            reqwest::StatusCode::UNAUTHORIZED,
            "no credential ⇒ the HTTP gate must 401, from the same resolved policy"
        );
        assert_eq!(
            client
                .get(&efforts)
                .bearer_auth("not-the-token")
                .send()
                .await
                .unwrap()
                .status(),
            reqwest::StatusCode::UNAUTHORIZED,
            "a credential the WS gate rejects must be rejected here too"
        );
        assert_eq!(
            client
                .get(&efforts)
                .bearer_auth("both-gates-token")
                .send()
                .await
                .unwrap()
                .status(),
            reqwest::StatusCode::OK,
            "the credential the WS gate accepted must be accepted here too — ONE policy"
        );
    }
}
