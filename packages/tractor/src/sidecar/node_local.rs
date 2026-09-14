//! The node reaches itself — a surface exposed outward ALSO listens on loopback.
//!
//! ## The invariant, and the regression that made it explicit
//!
//! Declaring `surfaces.sidecar-http` as `{"expose": "tailnet", "gate": "device-token"}`
//! bound the sidecar to the tailnet address and to NOTHING else:
//!
//! ```text
//! LISTEN  100.105.71.127:42001        ← only here
//! curl http://127.0.0.1:42001/health  → connection refused
//! ```
//!
//! Every local client — `refarm ask` first among them, which defaults to
//! `http://127.0.0.1:42001` — then reported "the runtime is not running" about a runtime
//! that was alive and healthy. Exposing a surface OUTWARD had silently REMOVED local
//! access. And a local client that chased the tailnet address instead met a `401`: the
//! node would have needed a credential to talk to itself.
//!
//! The missing invariant, stated: **the node is not a remote device.** Anyone with local
//! shell access on this machine already reads `.refarm/config.json`, the auth policy, and
//! the whole of the runtime's disk. Requiring the node to present a bearer token to itself
//! defends nothing that is not already in the reader's hands — it is ceremony, and its only
//! measurable effect was to break the operator's own CLI.
//!
//! ## The rule (general, not per-surface)
//!
//! > A surface whose RESOLVED bind host is non-loopback listens on `127.0.0.1` as well —
//! > additively. A surface whose resolved bind host is already loopback binds exactly one
//! > socket, as it always has.
//!
//! Stated over the resolved host STRING, so it holds for every surface (`sidecar-http`,
//! `daemon-ws`, and whatever is declared next) without any of them being named here.
//! `daemon-ws` declaring `"loopback"` resolves to loopback, so [`listen_plan`] returns a
//! single target for it and nothing about that surface changes.
//!
//! Additive, and therefore not a widening: a second socket on `127.0.0.1` is reachable only
//! from this machine, and the declared address keeps behaving EXACTLY as it does today —
//! same address, same gate, same refusals. Nothing that was closed becomes open to anyone
//! who was not already inside the machine.
//!
//! ## Why the gate is per LISTENER and never per REQUEST
//!
//! The tempting shape is one socket and a middleware that skips authentication when the
//! peer "looks local" — `req.peer_addr().is_loopback()`, or worse, a header. That shape is
//! rejected here, on purpose and permanently:
//!
//! - a peer address is a property of a CONNECTION, and any middleware that reads one has to
//!   be trusted to read the right one — behind a proxy, a `Connection: upgrade`, or an
//!   `X-Forwarded-For` a caller supplies, "the peer" is whatever the last hop says it is;
//! - the IPv4-mapped/unspecified edge cases that make `is_loopback_host` a carefully-tested
//!   pure function ([`super::bind_guard`]) would have to be re-derived, correctly, on the
//!   hot path of every request;
//! - and a single wrong branch in that decision is a silent authentication bypass on the
//!   OUTWARD address, which is the one thing that must never weaken.
//!
//! Instead the decision is made ONCE, at bind time, from the LISTENER's role:
//! [`ListenRole::NodeLocal`] listeners are CONSTRUCTED without the credential layer;
//! [`ListenRole::Declared`] listeners are constructed with it. Two sockets, two
//! configurations, no runtime trust decision at all. Kernel routing — not application code
//! — is what guarantees that a packet arriving on the `127.0.0.1` socket came from this
//! machine, and the kernel does not get that wrong.
//!
//! [`gate_for`] is the single place the choice is expressed, and it is GENERIC over the
//! gate type precisely so it CANNOT look at a credential, a request, a header, or an
//! address: the only thing in scope is the role. If a future change makes authentication a
//! function of anything a caller sends, that change cannot go through this function.
//!
//! ## All-or-nothing binding
//!
//! Callers bind every target in the plan BEFORE serving any of them, and treat any bind
//! failure as fatal to the whole surface — see [`ListenRole::describe_bind_failure`]. A
//! half-bound surface is the exact failure this module exists to eliminate: bound outward
//! but not locally is the regression above (the CLI breaks while the daemon logs success);
//! bound locally but not outward is a declared surface that silently is not there (the
//! operator's phone cannot reach a node whose logs say it is listening). Neither is a state
//! worth entering — a refusal that names the address is strictly more useful than a daemon
//! that is half of what it claims.
//!
//! Every function here is PURE: no socket, no I/O, no DNS. The whole plan is decided before
//! anything is bound.

/// The address a node reaches itself on. IPv4 loopback specifically — it is what
/// `apps/refarm/src/utils/runtime-config.ts`'s `DEFAULT_RUNTIME_SIDECAR_URL`
/// (`http://127.0.0.1:42001`) points at, and what every local client in this repo assumes.
pub(crate) const NODE_LOCAL_HOST: &str = "127.0.0.1";

/// WHY a listener exists — and therefore whether it carries the credential layer. The gate
/// decision is a function of this value and nothing else (see [`gate_for`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ListenRole {
    /// The address the `surfaces` declaration resolved to — the outward surface. Carries
    /// whatever gate the declaration named; nothing about it weakens.
    Declared,
    /// The additive `127.0.0.1` companion. Reachable only from this machine, so it carries
    /// no credential layer: the node does not authenticate to itself.
    NodeLocal,
}

impl ListenRole {
    /// Operator-facing name of this listener, for logs and bind-failure messages.
    pub(crate) fn label(self) -> &'static str {
        match self {
            ListenRole::Declared => "declared",
            ListenRole::NodeLocal => "node-local",
        }
    }

    /// The message for a bind that failed, naming WHICH listener and WHY the whole surface
    /// refuses rather than coming up half-bound. PURE.
    pub(crate) fn describe_bind_failure(self, surface_label: &str, addr: &str, cause: &str) -> String {
        match self {
            ListenRole::Declared => format!(
                "{surface_label}: could not bind the declared address {addr} ({cause}). \
                 Refusing to start half-bound: the node-local 127.0.0.1 listener alone would \
                 make this surface look healthy from this machine while it is not reachable \
                 at the address it declares."
            ),
            ListenRole::NodeLocal => format!(
                "{surface_label}: could not bind the node-local address {addr} ({cause}). \
                 Refusing to start half-bound: a surface bound only outward makes every local \
                 client on this machine — `refarm ask` included — report the runtime as down \
                 while it is running. Free that port, or narrow the surface to loopback."
            ),
        }
    }
}

/// One socket to open: a host, and the role that decides its configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ListenTarget {
    pub(crate) host: String,
    pub(crate) role: ListenRole,
}

/// The complete, ordered set of sockets a surface opens, given the host its declaration
/// RESOLVED to (post-`tailnet_resolve`, post-`bind_guard` — the exact string that would
/// have been bound before this rule existed). PURE.
///
/// - resolved host is loopback ⇒ exactly ONE target, the resolved host itself, `Declared`.
///   A loopback-declared surface is unchanged in every respect, including a narrowed
///   `127.0.0.5` or `[::1]`: the operator asked for that address, and adding a second
///   socket they did not ask for would be this module inventing policy rather than
///   restoring reach.
/// - resolved host is non-loopback ⇒ TWO targets: the declared host first (it is what the
///   declaration is about, and the one whose bind failure is most urgent to report), then
///   the additive `127.0.0.1` companion.
pub(crate) fn listen_plan(resolved_host: &str) -> Vec<ListenTarget> {
    let declared =
        ListenTarget { host: resolved_host.to_string(), role: ListenRole::Declared };
    if super::bind_guard::is_loopback_host(resolved_host) {
        return vec![declared];
    }
    vec![
        declared,
        ListenTarget { host: NODE_LOCAL_HOST.to_string(), role: ListenRole::NodeLocal },
    ]
}

/// THE authentication decision, and the only one: which credential layer a listener is
/// CONSTRUCTED with. A function of the listener's role — never of a request, a peer
/// address, a header, or the credential itself.
///
/// GENERIC over `G` deliberately, and that genericity is the structural guarantee: with the
/// gate type opaque, this function cannot inspect a policy, cannot compare a token, and
/// cannot consult anything a caller sends. The only value it can branch on is the role,
/// which is fixed at bind time and is not attacker-influenced. Any future attempt to make
/// authentication depend on request data would have to abandon this function to do it —
/// which is exactly the review signal that would be wanted.
///
/// PURE.
pub(crate) fn gate_for<G>(role: ListenRole, gate: Option<G>) -> Option<G> {
    match role {
        ListenRole::Declared => gate,
        ListenRole::NodeLocal => None,
    }
}

/// The addresses a plan opens, for the ONE log line the surface emits when it comes up.
/// A line naming a single address is now a lie whenever the plan has two entries — and this
/// whole class of defect (an operator believing a surface listens somewhere it does not, or
/// does not listen somewhere it does) is precisely what a partial log hides. Each address is
/// annotated with its role so the line also says which one is gated. PURE.
pub(crate) fn describe_listen_plan(plan: &[ListenTarget], port: u16) -> String {
    plan.iter()
        .map(|t| format!("{}:{} ({})", t.host, port, t.role.label()))
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── the rule: non-loopback ⇒ two sockets, loopback ⇒ one ──────────────────────────

    #[test]
    fn a_tailnet_resolved_host_listens_on_the_declared_address_and_on_loopback() {
        let plan = listen_plan("100.105.71.127");
        assert_eq!(
            plan,
            vec![
                ListenTarget {
                    host: "100.105.71.127".to_string(),
                    role: ListenRole::Declared
                },
                ListenTarget { host: "127.0.0.1".to_string(), role: ListenRole::NodeLocal },
            ],
            "a surface exposed outward must ALSO be reachable at 127.0.0.1"
        );
    }

    #[test]
    fn a_loopback_declared_surface_binds_exactly_one_socket() {
        // `daemon-ws` is declared `"loopback"` in the operator's config; this is the
        // assertion that the general rule leaves it byte-identical.
        let plan = listen_plan("127.0.0.1");
        assert_eq!(plan.len(), 1, "one socket, as today");
        assert_eq!(plan[0].host, "127.0.0.1");
        assert_eq!(plan[0].role, ListenRole::Declared);
    }

    #[test]
    fn a_narrowed_loopback_address_is_not_given_a_second_socket() {
        // An operator who narrowed to a specific loopback address asked for THAT address.
        // Adding 127.0.0.1 alongside it would be this module inventing a bind they did not
        // declare — additive reach is for surfaces that went OUTWARD, nothing else.
        for host in ["127.0.0.5", "[::1]", "localhost", "LOCALHOST"] {
            let plan = listen_plan(host);
            assert_eq!(plan.len(), 1, "{host} is loopback ⇒ one socket");
            assert_eq!(plan[0].host, host);
        }
    }

    #[test]
    fn every_non_loopback_host_gets_the_node_local_companion() {
        // Including the unspecified addresses: `0.0.0.0` never reaches a plan in production
        // (the bind guard refuses it long before), but if it ever did, "already covers
        // loopback" is an inference this module must NOT make — `is_loopback_host` says
        // `0.0.0.0` is not loopback, and one source of truth for that question is the whole
        // point of reusing it.
        for host in ["100.105.71.127", "192.168.1.5", "0.0.0.0", "[::]", "some.hostname"] {
            let plan = listen_plan(host);
            assert_eq!(plan.len(), 2, "{host} is non-loopback ⇒ declared + node-local");
            assert_eq!(plan[0].role, ListenRole::Declared);
            assert_eq!(plan[1].role, ListenRole::NodeLocal);
            assert_eq!(plan[1].host, NODE_LOCAL_HOST);
        }
    }

    #[test]
    fn a_surface_declared_tailnet_binds_the_resolved_address_and_loopback() {
        // THE regression, end to end, minus the `tailscale` spawn — the real chain a
        // `tailnet` declaration travels at daemon boot: the declaration is resolved to a
        // concrete address (`tailnet_resolve`), the bind guard turns the flag + declaration
        // into the ONE host that would have been bound before this rule existed
        // (`bind_guard`), and THAT string is what the listen plan reads.
        //
        // Before: that chain ended at a single socket on 100.105.71.127, and
        // `http://127.0.0.1:42001` was connection-refused. Now it ends at two.
        let declared = crate::host::SurfaceDeclaration {
            expose: crate::host::SurfaceExpose::Tailnet,
            gate: Some(crate::host::SurfaceGate::DeviceToken),
        };
        let effective = super::super::tailnet_resolve::resolve_declared_expose_for_bind_with(
            crate::host::SURFACE_SIDECAR_HTTP,
            "the sidecar",
            None, // no `--http-host` flag: the declaration decides
            Some(&declared),
            || Ok("100.105.71.127".to_string()),
        )
        .expect("a resolvable tailnet declaration must resolve");

        let host = super::super::bind_guard::resolve_sidecar_bind_host(
            None,
            true, // the declared device-token gate is resolvable
            effective.as_ref(),
        )
        .expect("a gated, resolved tailnet declaration must be permitted to bind");
        assert_eq!(host, "100.105.71.127", "the declared address is still what resolves");

        let plan = listen_plan(&host);
        assert_eq!(plan.len(), 2, "declared + node-local");
        assert_eq!(plan[0].host, "100.105.71.127");
        assert_eq!(plan[0].role, ListenRole::Declared);
        assert_eq!(plan[1].host, "127.0.0.1");
        assert_eq!(plan[1].role, ListenRole::NodeLocal);

        // …and the gate follows the ROLE, not the address: outward keeps the credential
        // layer, node-local never gets one.
        assert_eq!(gate_for(plan[0].role, Some("the-declared-gate")), Some("the-declared-gate"));
        assert_eq!(gate_for(plan[1].role, Some("the-declared-gate")), None);
    }

    #[test]
    fn the_declared_address_is_never_replaced_only_accompanied() {
        // The regression was a REPLACEMENT (declared address instead of loopback). Pin that
        // the declared host is always present, first, and unmodified.
        for host in ["100.105.71.127", "127.0.0.1", "192.168.1.5"] {
            assert_eq!(listen_plan(host)[0].host, host, "the declared address must survive");
        }
    }

    // ── the gate is a function of the ROLE, and of nothing else ───────────────────────

    #[test]
    fn the_node_local_listener_is_constructed_without_a_credential_layer() {
        assert_eq!(gate_for(ListenRole::NodeLocal, Some("a-gate")), None);
    }

    #[test]
    fn the_declared_listener_keeps_whatever_gate_was_resolved() {
        assert_eq!(gate_for(ListenRole::Declared, Some("a-gate")), Some("a-gate"));
        assert_eq!(gate_for(ListenRole::Declared, None::<&str>), None);
    }

    #[test]
    fn an_ungated_surface_stays_ungated_on_both_listeners() {
        // No declared gate ⇒ no layer anywhere ⇒ behaviour byte-identical to before this
        // module existed. The node-local listener does not INTRODUCE a gate, it only
        // declines to inherit one.
        for role in [ListenRole::Declared, ListenRole::NodeLocal] {
            assert_eq!(gate_for(role, None::<&str>), None);
        }
    }

    // ── structural: no authentication decision reads a request property ───────────────

    /// Every source file that participates in serving a request on a gated surface, read at
    /// COMPILE TIME. Assertions below are over the actual bytes that build the binary — not
    /// over a description of them. This module itself is deliberately absent: it names the
    /// forbidden constructs in prose and in the assertion below, and it is the one file that
    /// provably cannot USE them ([`gate_for`] is generic over the gate type and takes no
    /// request at all).
    const REQUEST_PATH_SOURCES: &[(&str, &str)] = &[
        ("sidecar/mod.rs", include_str!("mod.rs")),
        ("sidecar/auth.rs", include_str!("auth.rs")),
        ("sidecar/cors.rs", include_str!("cors.rs")),
        // The pending-prompt routes ATTRIBUTE an action to a device, which makes them the
        // first place a "…but trust the caller when it looks local" shortcut would be
        // tempting. They are held to the same rule as every other request-path file: the
        // identity comes from the credential layer this listener was CONSTRUCTED with, or
        // from nothing at all.
        ("sidecar/pending_prompt.rs", include_str!("pending_prompt.rs")),
        ("daemon/ws_server.rs", include_str!("../daemon/ws_server.rs")),
    ];

    #[test]
    fn no_code_path_can_decide_authentication_from_a_request_property() {
        // STRUCTURAL, and the reason this listener shape was chosen over a "skip auth when
        // the peer looks local" middleware: every MECHANISM by which a request could
        // influence the authentication decision is absent from the request path outright.
        //
        // Axum cannot hand a handler a peer address without `ConnectInfo` and
        // `into_make_service_with_connect_info`; tokio cannot report one without
        // `peer_addr`/`remote_addr`; and a proxy's claim about the client can only ride in
        // `X-Forwarded-For` / `Forwarded`. None of these names exists in any file that sees a
        // request. Absent the mechanism, the branch cannot be written — which is a stronger
        // statement than "we checked and there is no such branch today".
        //
        // If any of these ever appears here, this test fails and forces the reviewer to ask
        // the only question that matters: is authentication now a function of something the
        // caller controls?
        const FORBIDDEN: &[&str] = &[
            "connectinfo",
            "into_make_service_with_connect_info",
            "peer_addr",
            "remote_addr",
            "forwarded",
        ];
        for (name, src) in REQUEST_PATH_SOURCES {
            let lowered = src.to_lowercase();
            for needle in FORBIDDEN {
                assert!(
                    !lowered.contains(needle),
                    "{name} names {needle:?} — authentication must never be decided from a \
                     request property. Keep the decision per-LISTENER: construct the \
                     node-local listener without the credential layer (see node_local)."
                );
            }
        }
    }

    #[test]
    fn the_only_authentication_input_is_the_bearer_credential_itself() {
        // The positive half of the assertion above: what the HTTP gate DOES read is one
        // header, `Authorization`, and it reads it to authenticate — never to decide whether
        // to authenticate. Pinned so a future "…unless header X says otherwise" cannot be
        // added without this test being confronted.
        let auth = include_str!("auth.rs");
        assert!(
            auth.contains("header::AUTHORIZATION"),
            "the bearer credential is the gate's one input"
        );
        assert!(
            auth.contains("bearer_token(&request)"),
            "auth_middleware must branch on the CREDENTIAL alone — missing, invalid, or valid"
        );
        // The failure limiter is keyed on the credential too, and that is the only thing it
        // may be keyed on. `credential_tag` takes the token and nothing else; if a second
        // argument ever appears here, the reviewer is being asked whether a REFUSAL is now a
        // function of something the caller controls — the same question the assertion above
        // asks about an admission.
        assert!(
            auth.contains("fn credential_tag(token: &str) -> u64"),
            "the limiter's key must be derived from the presented credential alone"
        );
    }

    #[test]
    fn gate_for_is_the_only_place_a_credential_layer_is_chosen() {
        // The layer must never be attached from a conditional written inline at a bind site:
        // one such branch, and the per-listener guarantee is only as good as that branch.
        // Both surfaces must route the choice through `gate_for`.
        let sidecar = include_str!("mod.rs");
        let ws = include_str!("../daemon/ws_server.rs");
        assert!(
            sidecar.contains("node_local::gate_for"),
            "the HTTP sidecar must choose its credential layer through gate_for"
        );
        assert!(
            ws.contains("node_local::gate_for"),
            "the WS daemon must choose its credential layer through gate_for"
        );
    }

    // ── the log line names every address, not just one ────────────────────────────────

    #[test]
    fn the_listening_line_names_both_addresses_with_their_roles() {
        let plan = listen_plan("100.105.71.127");
        assert_eq!(
            describe_listen_plan(&plan, 42001),
            "100.105.71.127:42001 (declared), 127.0.0.1:42001 (node-local)"
        );
    }

    #[test]
    fn the_listening_line_of_a_loopback_surface_names_exactly_one_address() {
        assert_eq!(describe_listen_plan(&listen_plan("127.0.0.1"), 42000), "127.0.0.1:42000 (declared)");
    }

    // ── half-bound is refused, and the refusal says which half ────────────────────────

    #[test]
    fn each_bind_failure_names_its_own_listener_and_its_own_consequence() {
        let declared = ListenRole::Declared.describe_bind_failure(
            "the sidecar",
            "100.105.71.127:42001",
            "Address already in use (os error 98)",
        );
        let node_local = ListenRole::NodeLocal.describe_bind_failure(
            "the sidecar",
            "127.0.0.1:42001",
            "Address already in use (os error 98)",
        );

        for msg in [&declared, &node_local] {
            assert!(msg.contains("Address already in use"), "the OS cause must survive: {msg}");
            assert!(msg.contains("half-bound"), "must say why it refuses rather than continues");
        }
        assert!(declared.contains("100.105.71.127:42001"));
        assert!(node_local.contains("127.0.0.1:42001"));
        assert_ne!(
            declared, node_local,
            "the two halves fail for opposite operational reasons and must read differently"
        );
        assert!(
            node_local.contains("refarm ask"),
            "the node-local failure is the one that breaks the operator's own CLI — say so"
        );
    }
}
