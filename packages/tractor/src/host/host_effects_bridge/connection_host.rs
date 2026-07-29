// Host implementation of the `host-connection` WIT interface — the plugin-facing
// surface over the connection engine (`connection_engine.rs`/`connection_decl.rs`/
// `connection_frames.rs`). This file wires those ALREADY-BUILT, ALREADY-TESTED
// pieces to the WASM boundary; it does not reimplement any of them.
//
// THE decision this file exists to honour: a connection is a resource SHARED
// ACROSS PLUGINS. The `ConnectionRegistry` these methods call is the ONE shared
// instance `PluginHost` owns (see `wasi_bridge/core.rs`'s `connection_registry`
// field doc) — never constructed here. Two plugins asking for the same declared
// name must observe ONE live connection and ONE login.

// NOTE: this file is `include!`d into the flattened `host_effects_bridge` module,
// alongside `connection_engine.rs`/`connection_decl.rs`/`connection_frames.rs`, so
// `TractorNativeBindings`, `Permission`, `NativeSync`, `HashMap`, `ConnectionRegistry`,
// `ConnectionStatus`, `ConnectionDeclaration`, `resolve_connections`,
// `spawn_establish_process`, `run_probe`, and `connection_stream_ref` are ALL already
// in scope — a second `use` for any of them would collide (E0252). Only the
// WIT-generated `host-connection` types are genuinely new here.
use crate::host::plugin_host::plugin::host::host_connection::{
    ConnectionState, ConnectionStatus as WitConnectionStatus, Host as HostConnectionHost,
};

fn now_ns() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

fn map_connection_status(status: ConnectionStatus) -> WitConnectionStatus {
    match status {
        ConnectionStatus::Down => WitConnectionStatus::Down,
        ConnectionStatus::Connecting => WitConnectionStatus::Connecting,
        ConnectionStatus::Up => WitConnectionStatus::Up,
        ConnectionStatus::Failed => WitConnectionStatus::Failed,
    }
}

/// Read back the resume cursor (`last_sequence`) and the timestamp of the most
/// recent frame (`updated_at_ns`) from the SAME `StreamSession` node
/// `ConnectionFramePublisher` maintains (`connection_frames.rs`). Nothing writes
/// to that node again once a connection reaches `Ready` and is merely shared (no
/// further establish attempt), so `updated_at_ns` at that point IS the moment the
/// current live instance came up — the WIT record's `since-ns`. Best-effort: an
/// absent or unreadable node (never established, or a fresh host) yields
/// `(None, 0)`, matching `ConnectionFramePublisher::new`'s own "start fresh"
/// fallback — this never fails the call over a missing cursor.
fn read_connection_session_cursor(sync: &NativeSync, stream_ref: &str) -> (Option<u64>, u32) {
    let node = sync
        .get_node(&stream_session_observation_id(stream_ref))
        .ok()
        .flatten()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok());
    let last_sequence = node
        .as_ref()
        .and_then(|n| n.get("last_sequence"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as u32;
    let since_ns = node
        .as_ref()
        .and_then(|n| n.get("updated_at_ns"))
        .and_then(|v| v.as_u64());
    (since_ns, last_sequence)
}

/// Build the WIT `connection-state` record from the registry's live status plus the
/// persisted stream cursor. `claim` is `Some` only right after `ensure` mints one —
/// `status` (observe without acquiring interest) always passes `None`.
fn connection_state(
    registry: &ConnectionRegistry,
    sync: &NativeSync,
    name: &str,
    claim: Option<u64>,
) -> ConnectionState {
    let status = registry.status(name);
    let stream_ref = connection_stream_ref(name);
    let (since_ns, last_sequence) = read_connection_session_cursor(sync, &stream_ref);
    ConnectionState {
        name: name.to_string(),
        status: map_connection_status(status),
        stream_ref,
        claim,
        since_ns,
        last_sequence,
    }
}

/// Resolve the operator's connection catalog fresh from `.refarm/config.json`,
/// under the process cwd — the SAME base `resolve_trusted_plugins` reads at load
/// (`env_and_runtime.rs`'s `grant_base`). Read fresh on every call (not cached at
/// plugin-load like `trusted_plugins`): an operator adding/editing a `connections`
/// declaration should not require bouncing every already-loaded plugin, and D12
/// ("the operator is shown reality") wants `ensure`/`status` to reflect the current
/// file. Filesystem-only per the design — a connection names a command that runs
/// on THIS machine, so a name replicated from another device over CRDT must never
/// be honoured here.
fn connections_catalog() -> Result<HashMap<String, ConnectionDeclaration>, String> {
    resolve_connections(&std::env::current_dir().unwrap_or_default())
}

fn undeclared_connection_error(name: &str) -> String {
    format!("no connection named '{name}' is declared in .refarm/config.json")
}

#[wasmtime::component::__internal::async_trait]
impl HostConnectionHost for TractorNativeBindings {
    async fn ensure(&mut self, name: String) -> Result<ConnectionState, String> {
        self.enforce_permission(Permission::ConnectionUse)?;

        let decls = connections_catalog()?;
        let decl = decls
            .get(&name)
            .cloned()
            .ok_or_else(|| undeclared_connection_error(&name))?;

        // The probe is a closure the registry calls with NO arguments (it may be
        // invoked many times over one establish attempt), so the resolved
        // declaration + policy are captured by value and cloned per call —
        // `run_probe` itself is the real adapter (connection_engine.rs), spawning
        // the declared `probe.run` argv through the SAME guards every spawn passes.
        let probe_policy = self.effect_policy.clone();
        let probe_decl = decl.clone();
        let mut probe = move || {
            let decl = probe_decl.clone();
            let policy = probe_policy.clone();
            async move { run_probe(&decl, &policy).await }
        };

        // `spawn` is called AT MOST once per establish attempt (single-flight,
        // enforced by the registry's per-name gate) — wired straight to the real
        // adapter, which itself re-applies the shell/env/cwd guards.
        let spawn_policy = self.effect_policy.clone();
        let spawn = move |decl: &ConnectionDeclaration| spawn_establish_process(decl, &spawn_policy);

        // The plugin's OWN id is the OWNER — this is what lets `release_owner`
        // (called on unload/revoke, see `PluginHost::release_connection_claims`)
        // collect exactly this plugin's claims and no one else's.
        let claim = self
            .connection_registry
            .ensure(&name, &self.plugin_id, &decls, spawn, &mut probe, &self.sync, &now_ns)
            .await?;

        Ok(connection_state(&self.connection_registry, &self.sync, &name, Some(claim.id)))
    }

    async fn release(&mut self, claim: u64) -> Result<(), String> {
        self.enforce_permission(Permission::ConnectionUse)?;
        self.connection_registry.release_by_id(claim);
        Ok(())
    }

    async fn status(&mut self, name: String) -> Result<ConnectionState, String> {
        self.enforce_permission(Permission::ConnectionUse)?;
        let decls = connections_catalog()?;
        if !decls.contains_key(&name) {
            return Err(undeclared_connection_error(&name));
        }
        Ok(connection_state(&self.connection_registry, &self.sync, &name, None))
    }
}
