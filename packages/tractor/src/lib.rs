//! tractor-native — Sovereign WASM plugin host
//!
//! Native Rust implementation of the Refarm Tractor. Designed for:
//!   - Edge / RPi agents (~10 MB binary, no Node.js/V8)
//!   - Electron desktop applications (embedded library)
//!   - Server-side plugin orchestration
//!
//! Provides full behavioral parity with `@refarm.dev/tractor` (TypeScript).
//! Uses the same SQLite schema and Loro CRDT binary format, enabling data
//! portability between browser (JS) and native (Rust) runtimes.
//!
//! # Architecture
//!
//! ```text
//! TractorNative
//!   ├── host::PluginHost       — wasmtime Component loader + WIT bridge
//!   ├── storage::NativeStorage — rusqlite, same schema as storage-sqlite TS
//!   ├── sync::NativeSync       — loro::LoroDoc CQRS + Projector
//!   ├── trust::TrustManager    — PluginTrustGrant + ExecutionProfile
//!   └── telemetry::TelemetryBus — tokio broadcast fan-out + RingBuffer
//! ```
//!
//! # Session Continuity
//! See `README.md` for phase checklist and instructions to resume from another session.

pub mod capabilities;
pub mod daemon;
pub mod host;
pub mod observer;
pub mod sidecar;
pub mod storage;
pub(crate) mod streaming;
pub mod sync;
pub mod telemetry;
pub mod trust;

use anyhow::Result;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, RwLock};

use tokio::sync::mpsc;

pub use storage::NativeStorage;
pub use sync::NativeSync;
pub use telemetry::TelemetryBus;
pub use trust::{ExecutionProfile, SecurityMode, TrustManager};

/// A message routed from the WebSocket daemon to a loaded agent plugin.
#[derive(Debug)]
pub struct AgentMessage {
    pub event: String,
    pub payload: Option<String>,
}

const SHUTDOWN_EVENT: &str = "__tractor:shutdown";

/// The event a plugin declaring `agent:respond` is implicitly subscribed to (the
/// agent's prompt channel). `agent:respond` is sugar that expands to this
/// subscription plus election as the default `user:prompt` target.
const USER_PROMPT_EVENT: &str = "user:prompt";

/// Keyed by plugin_id — each sender reaches the plugin's dedicated runner thread.
pub type AgentChannels = Arc<RwLock<HashMap<String, mpsc::UnboundedSender<AgentMessage>>>>;

/// The neutral event router: maps an event name to the set of plugin_ids
/// subscribed to it, layered OVER the plugin-id lifecycle registry
/// (`agent_channels`) rather than replacing it — the registry still owns the
/// senders and shutdown drain. This is what makes any loaded plugin able to
/// receive its OWN declared event, not just the elected agent's `user:prompt`.
///
/// A plugin declares its events via `capabilities.subscribes` in its manifest;
/// the legacy `agent:respond` and `observe-agent-tools` capability strings are
/// treated as sugar that expand into subscriptions (see `register_for_events`),
/// so no existing manifest has to change.
#[derive(Clone, Default)]
pub struct EventRouter {
    /// event name -> set of subscribed plugin_ids.
    index: Arc<RwLock<HashMap<String, std::collections::BTreeSet<String>>>>,
}

impl EventRouter {
    /// Subscribe a plugin to an event name (idempotent).
    pub fn subscribe(&self, event: &str, plugin_id: &str) {
        self.index
            .write()
            .expect("event router poisoned")
            .entry(event.to_string())
            .or_default()
            .insert(plugin_id.to_string());
    }

    /// Remove a plugin from every event's subscriber set (on teardown/unload).
    pub fn unsubscribe_all(&self, plugin_id: &str) {
        let mut index = self.index.write().expect("event router poisoned");
        for subscribers in index.values_mut() {
            subscribers.remove(plugin_id);
        }
        index.retain(|_, subscribers| !subscribers.is_empty());
    }

    /// The plugin_ids subscribed to `event`, in stable order.
    pub fn subscribers(&self, event: &str) -> Vec<String> {
        self.index
            .read()
            .expect("event router poisoned")
            .get(event)
            .map(|s| s.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// True when at least one plugin is subscribed to `event`.
    pub fn has_subscribers(&self, event: &str) -> bool {
        self.index
            .read()
            .expect("event router poisoned")
            .get(event)
            .is_some_and(|s| !s.is_empty())
    }
}

/// Deliver an event to plugin runner channels via the router, emitting the
/// `router:deliver` observability event. The one shared implementation both
/// `TractorNative::deliver` and the sidecar effort dispatcher call, so routing +
/// its telemetry live in ONE place. `Some(target)` delivers to exactly that
/// plugin; `None` broadcasts to every subscriber of `event`. Returns the count
/// actually sent.
pub fn deliver_via_router(
    router: &EventRouter,
    channels: &AgentChannels,
    telemetry: &TelemetryBus,
    event: &str,
    target: Option<&str>,
    payload: Option<String>,
) -> usize {
    let started = std::time::Instant::now();
    let recipients: Vec<String> = match target {
        Some(plugin_id) => vec![plugin_id.to_string()],
        None => router.subscribers(event),
    };
    let wanted = recipients.len();
    let mut sent = 0;
    if wanted > 0 {
        let guard = channels.read().expect("agent_channels poisoned");
        for plugin_id in &recipients {
            if let Some(tx) = guard.get(plugin_id) {
                if tx
                    .send(AgentMessage {
                        event: event.to_string(),
                        payload: payload.clone(),
                    })
                    .is_ok()
                {
                    sent += 1;
                }
            }
        }
    }

    let latency_us = started.elapsed().as_micros() as u64;
    // `undeliverable` is the degradation signal: events with no subscriber, or
    // subscribers whose sender was gone. Watch this in telemetry.
    let undeliverable = wanted.saturating_sub(sent);
    telemetry.emit_named(
        "router:deliver",
        None,
        Some(serde_json::json!({
            "event": event,
            "target": target,
            "wanted": wanted,
            "sent": sent,
            "undeliverable": undeliverable,
            "latency_us": latency_us,
        })),
    );
    if undeliverable > 0 {
        tracing::warn!(
            event = %event,
            wanted,
            sent,
            undeliverable,
            "router: some recipients were undeliverable"
        );
    }
    sent
}

/// Top-level configuration for booting a TractorNative instance.
#[derive(Debug, Clone)]
pub struct TractorNativeConfig {
    /// Storage namespace — maps to `~/.local/share/refarm/{namespace}.db`
    /// Use `:memory:` for ephemeral / test sessions.
    pub namespace: String,
    /// WebSocket daemon port (default: 42000, same as farmhand)
    pub port: u16,
    /// Security mode for node signing and verification
    pub security_mode: SecurityMode,
    /// Telemetry ring buffer capacity (default: 1000)
    pub telemetry_capacity: usize,
}

impl Default for TractorNativeConfig {
    fn default() -> Self {
        Self {
            namespace: "default".to_string(),
            port: 42000,
            security_mode: SecurityMode::Strict,
            telemetry_capacity: 1000,
        }
    }
}

/// A sovereign WASM plugin host — native Rust.
///
/// Mirrors `Tractor` class from `@refarm.dev/tractor` (TypeScript).
pub struct TractorNative {
    pub storage: NativeStorage,
    pub sync: NativeSync,
    pub plugins: host::PluginHost,
    pub trust: TrustManager,
    pub telemetry: TelemetryBus,
    /// mpsc senders to plugin runner threads, keyed by plugin_id.
    /// Populated by `register_for_events`; read by WsServer for prompt routing.
    pub agent_channels: AgentChannels,
    /// Subset of `agent_channels` containing only plugins that declared
    /// the `"observe-agent-tools"` capability in their manifest.
    /// Read by the Scarecrow audit subscriber to route agent-tool events.
    pub observer_channels: AgentChannels,
    /// ID of the first loaded plugin that declared `"agent:respond"` capability.
    /// The sidecar exposes this as `activeAgent` in the /plugins response so the
    /// CLI can select the active agent without hardcoding any plugin name.
    pub active_agent_id: Arc<RwLock<Option<String>>>,
    /// The neutral event router: event name -> subscribed plugin_ids. Layered over
    /// `agent_channels`; lets any loaded plugin receive its own declared event, not
    /// just the elected agent's `user:prompt`. Populated by `register_for_events`.
    pub event_router: EventRouter,
    /// Join handles for plugin runner threads, keyed by plugin_id.
    plugin_runner_handles: Arc<RwLock<HashMap<String, std::thread::JoinHandle<()>>>>,
    #[allow(dead_code)]
    config: TractorNativeConfig,
}

impl TractorNative {
    /// Boot a TractorNative instance.
    ///
    /// Opens (or creates) the SQLite database, initialises the Loro CRDT doc,
    /// and prepares the wasmtime plugin host.
    ///
    /// Mirrors: `Tractor.boot(config)` in TypeScript.
    pub async fn boot(config: TractorNativeConfig) -> Result<Self> {
        tracing::info!(namespace = %config.namespace, "TractorNative booting");

        let telemetry = TelemetryBus::new(config.telemetry_capacity);
        let storage = NativeStorage::open(&config.namespace)?;
        let sync = NativeSync::new(storage.clone(), &config.namespace)?;
        let trust = TrustManager::new();
        let plugins = host::PluginHost::new(trust.clone(), telemetry.clone())?;

        Ok(Self {
            storage,
            sync,
            plugins,
            trust,
            telemetry,
            agent_channels: Arc::new(RwLock::new(HashMap::new())),
            observer_channels: Arc::new(RwLock::new(HashMap::new())),
            active_agent_id: Arc::new(RwLock::new(None)),
            event_router: EventRouter::default(),
            plugin_runner_handles: Arc::new(RwLock::new(HashMap::new())),
            config,
        })
    }

    /// Load and instantiate a WASM plugin from a file path.
    pub async fn load_plugin(&self, path: &Path) -> Result<host::PluginInstanceHandle> {
        self.plugins.load(path, &self.sync).await
    }

    /// Move a loaded plugin handle into a dedicated runner thread and register
    /// its mpsc sender in `agent_channels` for WebSocket prompt routing.
    ///
    /// `PluginInstanceHandle` is `!Send` (wasmtime Store). Each plugin gets its
    /// own thread + single-threaded tokio runtime so the `!Send` constraint is
    /// satisfied without unsafe code.
    pub fn register_for_events(&self, handle: host::PluginInstanceHandle) {
        let plugin_id = handle.id.clone();
        let provides = handle.provides.clone();
        let subscribes = handle.subscribes.clone();
        let (tx, mut rx) = mpsc::unbounded_channel::<AgentMessage>();

        let id_for_thread = plugin_id.clone();
        let join = std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("plugin runner rt");
            let local = tokio::task::LocalSet::new();
            local.block_on(&rt, async move {
                let mut h = handle;
                let mut teardown_done = false;
                while let Some(msg) = rx.recv().await {
                    if msg.event == SHUTDOWN_EVENT {
                        h.call_teardown().await;
                        teardown_done = true;
                        break;
                    }

                    if let Err(e) = h.call_on_event(&msg.event, msg.payload.as_deref()).await {
                        tracing::warn!(plugin_id = %id_for_thread, "on_event error: {e}");
                    }
                }

                if !teardown_done {
                    h.call_teardown().await;
                }
                h.terminate();
                tracing::debug!(plugin_id = %id_for_thread, "plugin runner exiting");
            });
        });

        self.agent_channels
            .write()
            .expect("agent_channels poisoned")
            .insert(plugin_id.clone(), tx.clone());

        // Populate the neutral event router. A plugin's explicitly declared
        // `capabilities.subscribes` events are subscribed directly...
        for event in &subscribes {
            self.event_router.subscribe(event, &plugin_id);
        }

        // ...and the legacy capability strings are treated as SUGAR that expand
        // into subscriptions, so no existing manifest has to change:
        //   agent:respond        -> subscribes to user:prompt (+ election below)
        //   observe-agent-tools  -> subscribes to the agent-tool event family
        if provides.contains(&crate::capabilities::CAP_AGENT_RESPOND.to_string()) {
            self.event_router.subscribe(USER_PROMPT_EVENT, &plugin_id);
            // Election survives as a POLICY over the general router: the first
            // respond-capable plugin becomes the default `user:prompt` target.
            let mut guard = self
                .active_agent_id
                .write()
                .expect("active_agent_id poisoned");
            if guard.is_none() {
                *guard = Some(plugin_id.clone());
                tracing::info!(plugin_id = %plugin_id, "registered as active agent");
            }
        }

        if provides.contains(&crate::observer::CAP_OBSERVE_AGENT_TOOLS.to_string()) {
            self.observer_channels
                .write()
                .expect("observer_channels poisoned")
                .insert(plugin_id.clone(), tx);
            tracing::info!(plugin_id = %plugin_id, "registered as agent-tool observer");
        }

        self.plugin_runner_handles
            .write()
            .expect("plugin_runner_handles poisoned")
            .insert(plugin_id, join);
    }

    /// Deliver an event to plugins via the neutral router. When `target` is
    /// `Some(plugin_id)` the event is delivered to exactly that plugin (the
    /// single-target case, e.g. `user:prompt` to the elected or named agent);
    /// when `None` it is broadcast to every plugin subscribed to `event`.
    /// Returns the number of plugins the event was sent to.
    ///
    /// This is the one path every event producer routes through, so a loaded
    /// plugin receives its own declared event by subscription rather than by the
    /// agent-shaped `agent_channels.get(active_agent)` lookup.
    ///
    /// Every delivery emits a `router:deliver` telemetry event carrying the event
    /// name, how many plugins were wanted vs actually sent, and the microsecond
    /// latency — so the router is never a blind spot: a dropped event (zero
    /// subscribers, or a dead sender) shows up as `sent < wanted`, and a slow
    /// delivery shows up in `latency_us`, without needing the scarecrow.
    pub fn deliver(&self, event: &str, target: Option<&str>, payload: Option<String>) -> usize {
        deliver_via_router(
            &self.event_router,
            &self.agent_channels,
            &self.telemetry,
            event,
            target,
            payload,
        )
    }

    /// Shut down all plugins and close storage.
    pub async fn shutdown(&self) -> Result<()> {
        tracing::info!("TractorNative shutting down");

        let senders = {
            let mut guard = self
                .agent_channels
                .write()
                .expect("agent_channels poisoned");
            guard.drain().map(|(_, tx)| tx).collect::<Vec<_>>()
        };

        for tx in &senders {
            let _ = tx.send(AgentMessage {
                event: SHUTDOWN_EVENT.to_string(),
                payload: None,
            });
        }
        drop(senders);

        let joins = {
            let mut guard = self
                .plugin_runner_handles
                .write()
                .expect("plugin_runner_handles poisoned");
            guard.drain().map(|(_, join)| join).collect::<Vec<_>>()
        };

        for join in joins {
            if let Err(panic_payload) = join.join() {
                tracing::warn!(
                    "plugin runner thread panic during shutdown: {:?}",
                    panic_payload
                );
            }
        }

        self.storage.close()?;
        Ok(())
    }
}

#[cfg(test)]
mod event_router_tests {
    use super::EventRouter;

    #[test]
    fn subscribe_then_query_returns_the_plugin() {
        let router = EventRouter::default();
        router.subscribe("vault:dispatch", "@demo/vault");
        assert_eq!(router.subscribers("vault:dispatch"), vec!["@demo/vault"]);
        assert!(router.has_subscribers("vault:dispatch"));
    }

    #[test]
    fn an_unsubscribed_event_has_no_subscribers() {
        let router = EventRouter::default();
        router.subscribe("vault:dispatch", "@demo/vault");
        assert!(router.subscribers("quality:check").is_empty());
        assert!(!router.has_subscribers("quality:check"));
    }

    #[test]
    fn many_plugins_subscribe_to_the_same_event_deduped_and_ordered() {
        let router = EventRouter::default();
        router.subscribe("shared:event", "@b/plugin");
        router.subscribe("shared:event", "@a/plugin");
        router.subscribe("shared:event", "@b/plugin"); // idempotent
        // BTreeSet keeps them sorted and deduped.
        assert_eq!(
            router.subscribers("shared:event"),
            vec!["@a/plugin", "@b/plugin"]
        );
    }

    #[test]
    fn one_plugin_subscribes_to_many_events() {
        let router = EventRouter::default();
        router.subscribe("vault:dispatch", "@demo/vault");
        router.subscribe("vault:reindex", "@demo/vault");
        assert_eq!(router.subscribers("vault:dispatch"), vec!["@demo/vault"]);
        assert_eq!(router.subscribers("vault:reindex"), vec!["@demo/vault"]);
    }

    #[test]
    fn unsubscribe_all_removes_the_plugin_from_every_event() {
        let router = EventRouter::default();
        router.subscribe("vault:dispatch", "@demo/vault");
        router.subscribe("quality:check", "@demo/vault");
        router.subscribe("quality:check", "@demo/quality");
        router.unsubscribe_all("@demo/vault");
        assert!(router.subscribers("vault:dispatch").is_empty());
        // The other plugin's subscription survives.
        assert_eq!(router.subscribers("quality:check"), vec!["@demo/quality"]);
    }
}

#[cfg(test)]
mod deliver_observability_tests {
    use super::{TractorNative, TractorNativeConfig};
    use crate::SecurityMode;

    fn memory_config() -> TractorNativeConfig {
        TractorNativeConfig {
            namespace: ":memory:".to_string(),
            port: 0,
            security_mode: SecurityMode::None,
            ..TractorNativeConfig::default()
        }
    }

    /// deliver() must NEVER be a blind spot: an event with no reachable recipient
    /// emits a `router:deliver` telemetry event whose `undeliverable` is the
    /// degradation signal. This is the observability that keeps us from flying
    /// blind when we stretch the rope (accept new events) without the scarecrow.
    #[tokio::test]
    async fn deliver_emits_telemetry_with_the_undeliverable_signal() {
        let tractor = TractorNative::boot(memory_config())
            .await
            .expect("boot must succeed");
        let mut telemetry = tractor.telemetry.subscribe();

        // Target a plugin that is not registered: nothing to send to, so the
        // event is undeliverable — exactly the case we must be able to SEE.
        let sent = tractor.deliver("vault:dispatch", Some("@ghost/plugin"), None);
        assert_eq!(sent, 0, "an unregistered target receives nothing");

        // The telemetry event fired and carries the degradation signal.
        let event = telemetry
            .try_recv()
            .expect("a router:deliver telemetry event must be emitted");
        assert_eq!(event.event, "router:deliver");
        let payload = event.payload.expect("payload present");
        assert_eq!(payload["event"], "vault:dispatch");
        assert_eq!(payload["wanted"], 1);
        assert_eq!(payload["sent"], 0);
        assert_eq!(payload["undeliverable"], 1);
        assert!(
            payload["latency_us"].as_u64().is_some(),
            "latency_us must be recorded so a slow delivery is visible"
        );

        tractor.shutdown().await.expect("shutdown must succeed");
    }

    /// A broadcast with zero subscribers is also visible (wanted 0, sent 0) — a
    /// silently-dropped event can never masquerade as success.
    #[tokio::test]
    async fn deliver_with_no_subscribers_is_still_observable() {
        let tractor = TractorNative::boot(memory_config())
            .await
            .expect("boot must succeed");
        let mut telemetry = tractor.telemetry.subscribe();

        let sent = tractor.deliver("nobody:listens", None, None);
        assert_eq!(sent, 0);

        let event = telemetry.try_recv().expect("telemetry emitted");
        let payload = event.payload.expect("payload present");
        assert_eq!(payload["wanted"], 0);
        assert_eq!(payload["sent"], 0);

        tractor.shutdown().await.expect("shutdown must succeed");
    }
}
