// The OPERATOR's own door onto the shared connection engine — the sidecar's
// `GET /connections`, `POST /connections/:name/up`, `POST /connections/:name/down`
// routes call exactly these three methods. This is the CLI/phone-facing analogue of
// `connection_host.rs` (the plugin/WIT-facing door): same engine, same catalog
// resolution, same real adapters — reused, not duplicated, per the design's own
// instruction ("connection_host.rs already wires all three for the WIT layer — reuse
// the same helpers rather than duplicating the wiring").
//
// WHY THIS FILE, AND NOT A RE-EXPORT OF `host_effects_bridge` ITSELF: `mod
// host_effects_bridge;` (`host/mod.rs`) is private — visible only within `host` and its
// descendants. `sidecar` is a SIBLING of `host` under the crate root, so it cannot name
// `crate::host::host_effects_bridge::ConnectionRegistry` (or any of its neighbours) no
// matter how those individual items are marked. `PluginHost` is a descendant of `host`
// (this file is `include!`d into `plugin_host.rs`), so IT can reach those `pub(crate)`
// engine types directly — and `PluginHost` is already the crate's public seam
// (`pub use plugin_host::{HostEffectsHandle, PluginHost};` in `host/mod.rs`). Adding two
// narrow, JSON-friendly methods here — rather than re-exporting the whole
// `host_effects_bridge` vocabulary crate-wide for one caller — is the smallest honest way
// through: the sidecar gets exactly what it needs (`ConnectionOperatorState`,
// `ConnectionOperatorError`, both re-exported at `host/mod.rs` beside `PluginHost`) and
// nothing of the engine's internals leaks past `host`.

/// The fixed owner every OPERATOR-established connection is attributed to — CLI or
/// phone, never a plugin. `ConnectionRegistry::release_owner` (called from
/// `TractorNative::unregister` on every plugin unload, see `PluginHost::
/// release_connection_claims`) collects claims by EXACT owner-string match, and
/// `release_by_id`'s only authorization is owner-string equality over a sequential,
/// guessable claim id (see that method's own doc). If an operator-driven `ensure` used
/// a value a PLUGIN could ever hold as its own id, that plugin's unload would collect
/// the operator's claims as a side effect (the leak D5/D6 forbids: a connection must
/// live until the OPERATOR drops it, never until some unrelated plugin's lifecycle
/// ends) — or, worse, a still-loaded plugin sharing that id could `release` a claim id
/// it never minted and take the operator's connection down from inside the WIT
/// surface.
///
/// A bare `"operator"` is NOT safe for this, and asserting otherwise here was a bug:
/// `PluginHost::load` (`env_and_runtime.rs`) derives a plugin's runtime id as EITHER
/// the last `/`-segment of its manifest `id` (`manifest_runtime_plugin_id`) or, with no
/// manifest, the wasm file's stem (`path.file_stem()`) — and the manifest validator
/// reserves no names. A manifest id of `@vendor/operator`, or a file literally named
/// `operator.wasm` with no manifest at all, both yield the plugin id `"operator"`.
/// `"refarm/operator"` is safe where the bare literal was not, because NEITHER
/// derivation can ever produce a value containing a `/`: `rsplit('/').next()` is by
/// construction the text AFTER the last `/` in the source string, and a filesystem path
/// segment (`file_stem`) cannot contain a `/` either — it is a component of the path,
/// not the whole thing. Proven by
/// `a_plugin_whose_id_is_literally_operator_cannot_touch_the_operators_claims` below.
pub(crate) const CONNECTION_OWNER_OPERATOR: &str = "refarm/operator";

/// Map the engine's internal status enum to the wire-friendly string the sidecar's JSON
/// responses use. Kept as a free function (not `Display` on the engine type) because
/// `ConnectionStatus` lives in the private `host_effects_bridge` module and must stay
/// that way — this is the one seam that reads it.
fn connection_status_str(status: crate::host::host_effects_bridge::ConnectionStatus) -> &'static str {
    use crate::host::host_effects_bridge::ConnectionStatus;
    match status {
        ConnectionStatus::Down => "down",
        ConnectionStatus::Connecting => "connecting",
        ConnectionStatus::Up => "up",
        ConnectionStatus::Failed => "failed",
    }
}

/// Operator-facing state of one declared connection — the plain, `Serialize`-free
/// struct the sidecar's `/connections*` routes read and turn into JSON. Deliberately
/// NOT the WIT `host-connection::connection-state` bindgen type: that lives inside a
/// module tree private to `host` and is unreachable from `crate::sidecar` regardless of
/// individual field visibility (see the file doc above).
#[derive(Debug, Clone)]
pub struct ConnectionOperatorState {
    pub name: String,
    /// `"down" | "connecting" | "up" | "failed"`.
    pub status: String,
    /// When the CURRENT live instance came up — `None` unless `status == "up"`, mirroring
    /// the WIT `connection-state.since-ns` gating (a persisted cursor can describe a PRIOR
    /// process across a host restart; it is only "since" when the registry agrees the
    /// connection is up right now).
    pub since_ns: Option<u64>,
    /// How many claims are held right now.
    pub claims: usize,
    /// The operator's own claim id — `Some` only right after `ensure_connection_as_operator`
    /// mints one; `None` for a list entry or a post-stop state (both observe, neither holds).
    pub claim: Option<u64>,
}

/// Failure from an operator-facing connection call. A typed enum, not a bare `String`,
/// so the sidecar can map "undeclared name" to a clean 404 without sniffing error text —
/// exactly the distinction the design calls for ("an undeclared name is a clean
/// 404-shaped error naming the missing declaration, not a 500").
#[derive(Debug, Clone)]
pub enum ConnectionOperatorError {
    /// No such name in the operator's `connections` catalog.
    Undeclared(String),
    /// Any other failure: a malformed `.refarm/config.json`, a spawn/probe error, or the
    /// registry itself refusing the attempt. Not the caller's fault to fix by retrying
    /// with a different name.
    Failed(String),
}

impl std::fmt::Display for ConnectionOperatorError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Undeclared(message) | Self::Failed(message) => write!(f, "{message}"),
        }
    }
}

impl std::error::Error for ConnectionOperatorError {}

impl PluginHost {
    /// Build the operator-facing state for one name, reading the registry's live status
    /// plus (only when genuinely `Up` right now) the persisted stream cursor's
    /// `updated_at_ns` — the exact `since_ns` gating `connection_host.rs`'s `connection_state`
    /// uses for the WIT surface, reused here via the same `read_connection_session_cursor`.
    fn connection_operator_state(
        &self,
        sync: &NativeSync,
        name: &str,
        claim: Option<u64>,
    ) -> ConnectionOperatorState {
        let status = self.connection_registry.status(name);
        let claims = self.connection_registry.claim_count(name);
        let stream_ref = crate::host::host_effects_bridge::connection_stream_ref(name);
        let (persisted_since_ns, _last_sequence) =
            crate::host::host_effects_bridge::read_connection_session_cursor(sync, &stream_ref);
        let since_ns = if matches!(status, crate::host::host_effects_bridge::ConnectionStatus::Up) {
            persisted_since_ns
        } else {
            None
        };
        ConnectionOperatorState {
            name: name.to_string(),
            status: connection_status_str(status).to_string(),
            since_ns,
            claims,
            claim,
        }
    }

    /// `GET /connections` — every DECLARED connection with its current registry state. A
    /// name that is declared but never established is reported `Down` (its status simply
    /// defaults there — the registry has no live entry for it), never omitted: the
    /// catalog, not the registry's live map, is what is iterated.
    pub fn list_declared_connections(
        &self,
        sync: &NativeSync,
    ) -> Result<Vec<ConnectionOperatorState>, ConnectionOperatorError> {
        let decls = crate::host::host_effects_bridge::connections_catalog()
            .map_err(ConnectionOperatorError::Failed)?;
        let mut names: Vec<&String> = decls.keys().collect();
        names.sort();
        Ok(names
            .into_iter()
            .map(|name| self.connection_operator_state(sync, name, None))
            .collect())
    }

    /// `POST /connections/:name/up` — ensure the declared connection under the fixed
    /// `CONNECTION_OWNER_OPERATOR` owner (see its own doc for why that string must
    /// contain a `/`, which no plugin id can ever contain). Idempotent, sharing with
    /// any plugin already holding it: the SAME
    /// `ConnectionRegistry` and the SAME real adapters (`run_probe`/`spawn_establish_process`)
    /// `connection_host.rs` wires for the WIT `ensure` are reused verbatim here — a second
    /// call while the connection is up performs NO second login, matching D5.
    pub async fn ensure_connection_as_operator(
        &self,
        sync: &NativeSync,
        name: &str,
    ) -> Result<ConnectionOperatorState, ConnectionOperatorError> {
        let decls = crate::host::host_effects_bridge::connections_catalog()
            .map_err(ConnectionOperatorError::Failed)?;
        let decl = decls.get(name).cloned().ok_or_else(|| {
            ConnectionOperatorError::Undeclared(
                crate::host::host_effects_bridge::undeclared_connection_error(name),
            )
        })?;

        // Same wiring shape as `connection_host.rs`'s `HostConnectionHost::ensure`: the
        // probe/spawn closures capture the resolved policy + declaration by value so the
        // registry can invoke them without borrowing `self` across the `.await` below.
        let probe_policy = self.effect_policy.clone();
        let probe_decl = decl.clone();
        let mut probe = move || {
            let decl = probe_decl.clone();
            let policy = probe_policy.clone();
            async move { crate::host::host_effects_bridge::run_probe(&decl, &policy).await }
        };

        let spawn_policy = self.effect_policy.clone();
        let spawn = move |decl: &crate::host::host_effects_bridge::ConnectionDeclaration| {
            crate::host::host_effects_bridge::spawn_establish_process(decl, &spawn_policy)
        };

        let claim = self
            .connection_registry
            .ensure(
                name,
                CONNECTION_OWNER_OPERATOR,
                &decls,
                spawn,
                &mut probe,
                sync,
                &crate::host::host_effects_bridge::now_ns,
            )
            .await
            .map_err(ConnectionOperatorError::Failed)?;

        Ok(self.connection_operator_state(sync, name, Some(claim.id)))
    }

    /// `POST /connections/:name/down` — the explicit OPERATOR stop
    /// (`ConnectionRegistry::stop`). Sovereign: it takes the connection down even with
    /// claims outstanding. Returns the post-stop state (always `Down`, no claim) alongside
    /// how many claims were active at the moment of the stop — D12 ("the operator is shown
    /// reality") means that count is reported, never swallowed.
    pub fn stop_connection_as_operator(
        &self,
        name: &str,
    ) -> Result<(ConnectionOperatorState, usize), ConnectionOperatorError> {
        let decls = crate::host::host_effects_bridge::connections_catalog()
            .map_err(ConnectionOperatorError::Failed)?;
        if !decls.contains_key(name) {
            return Err(ConnectionOperatorError::Undeclared(
                crate::host::host_effects_bridge::undeclared_connection_error(name),
            ));
        }

        let claims_active = self.connection_registry.stop(name);
        let state = ConnectionOperatorState {
            name: name.to_string(),
            status: connection_status_str(self.connection_registry.status(name)).to_string(),
            since_ns: None,
            claims: self.connection_registry.claim_count(name),
            claim: None,
        };
        Ok((state, claims_active))
    }

    /// How many times `name` was ACTUALLY spawned — test-only. Lets a sidecar HTTP test
    /// mutation-verify the sharing guarantee (`up` called twice performs ONE establish)
    /// without reaching into the private `connection_registry` field from outside this
    /// module tree.
    #[cfg(test)]
    pub(crate) fn connection_spawn_count(&self, name: &str) -> u32 {
        self.connection_registry.spawn_count(name)
    }

    /// Attempt to release a claim AS `caller` — test-only. Lets a test simulate exactly
    /// what `connection_host.rs`'s WIT `release: func(claim: u64)` binding does
    /// (`self.connection_registry.release_by_id(claim, &self.plugin_id)`) for an
    /// arbitrary `caller` id, without standing up a real WASM plugin, so CRITICAL-2's
    /// regression (a plugin whose runtime id happens to be `"operator"` releasing the
    /// operator's own claim) is provable at this layer too — not just the `release_owner`
    /// (unload-collects-claims) half `connection_spawn_count`'s sibling test already covers.
    #[cfg(test)]
    pub(crate) fn connection_release_claim_as(&self, claim_id: u64, caller: &str) {
        self.connection_registry.release_by_id(claim_id, caller);
    }
}
