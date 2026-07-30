// Declared surfaces — ONE place to say how THIS node is reachable
// (docs/superpowers/specs/2026-07-29-declared-surfaces-design.md).
//
// The listener inventory that motivated this file found six surfaces, each deciding its
// own reachability, with no shared declaration — the daemon WS was never DECIDED open, it
// was written open, and nothing existed to contradict it. `surfaces` is the fourth thing
// `.refarm/config.json` declares (after `connections`, `commands`, and
// `capabilities.requiresConnections`), in the SAME doctrine: the operator states intent as
// DATA, the runtime interprets it, anything undeclared is refused.
//
// S1 — undeclared means closed: a surface with no entry here binds loopback, full stop.
// This is the ABSENCE of a value, not a default a flag can overwrite — `sidecar::bind_guard`
// treats a missing entry as a loopback CEILING no `--http-host`/`--ws-host` may exceed.
//
// S3 — a surface may not declare a gate it cannot enforce, checked HERE, AT LOAD (not
// deferred to bind time): `sidecar-http` has real per-request bearer middleware
// (`sidecar::auth::auth_middleware`) and may declare `"gate": "device-token"`. `daemon-ws`
// gained its own enforcement when ADR-093's `Sec-WebSocket-Protocol` credential handshake
// shipped (`daemon::ws_server`'s `accept_hdr_async` callback, gated by the SAME
// `sidecar::auth::AuthPolicy`) — so it too may now declare `"gate": "device-token"` on a
// non-loopback `expose`, exactly like `sidecar-http`. Both surfaces still refuse a
// non-loopback `expose` with no gate at all, or a gate the surface cannot enforce (checked
// against `surface_enforceable_gate` below), naming the reason here, at load, rather than
// silently accepted and only caught later at bind time.
//
// `expose: "tailnet"` parses into `SurfaceExpose::Tailnet` — intent only (S2: "expose is
// intent, not an address"), never an address at parse time. `sidecar::tailnet_resolve`
// resolves it at BIND TIME by asking Tailscale (`tailscale status --json`, the only one of
// the three ways to ask that explains a failure instead of just a non-zero exit) and
// distinguishes "the tailnet is down" (a complete, trustworthy answer that isn't usable —
// not Running, not Online, or no IPv4 address) from "could not ask" (the CLI is missing,
// the process wouldn't spawn, it timed out, or the shape is unexpected) — open question 1
// of the design doc, answered. `sidecar::bind_guard`'s pure guard functions never see an
// unresolved `Tailnet`: by the time they run, `sidecar::tailnet_resolve::
// resolve_declared_expose_for_bind` has already rewritten it to `Host(<resolved ip>)`, or
// refused with a distinguishable message before the guard is ever reached.
//
// Read from the FILESYSTEM ONLY, never the replicated config node: exposure decides how
// THIS machine is reachable, so a declaration replicated from another device over CRDT
// must never decide it (same doctrine as `connections` — see `resolve_connections`).
//
// O1/O2/O4 (docs/superpowers/specs/2026-07-30-open-by-declaration-surfaces-design.md) —
// ONE vocabulary, TWO enforcers. Question 2 of the 07-29 design ("what does `gate:
// "device-token"` mean on a Node surface that verifies nothing?") is ANSWERED: it means
// nothing, so it may not be declared there at all — and since S3 forbids the lie, the
// vocabulary has to offer the truth instead. Three consequences, all implemented below:
//
// O1 — `"gate": "none"` (`SurfaceGate::Open`) is an explicit value meaning DELIBERATELY
// open. Refusing to lie leaves a surface with nothing to say: a Node file server that
// verifies no bearer cannot honestly declare `device-token`, and its only other option
// used to be declaring nothing — indistinguishable from an oversight. The distinction is
// the entire point: an auditor reading `.refarm/config.json` can tell a CHOICE from a
// FORGETTING, and can ask "why is this open?" instead of never noticing that it is.
//
// O2 — openness is admissible ONLY with an admitted-device transport: `expose: "tailnet"`,
// where arriving over the transport is itself the first factor. Never a literal
// `host:<ip>` (see `parse_one_surface` for why the 100.64.0.0/10 shape is NOT accepted as
// evidence of admission), never `host:0.0.0.0`. `loopback` + `none` parses and means
// nothing special — loopback was already the floor. Everything else is REFUSED AT PARSE
// TIME, never warned about: silence means closed, and a refused declaration means the
// operator learns immediately instead of discovering it from a log line.
//
// O4 — `KNOWN_SURFACES` includes the TypeScript-owned surfaces so that ONE
// `.refarm/config.json` parses in BOTH runtimes. Rust validates the SHAPE and O2's
// combination rules for every declared surface and ENFORCES only the two it binds
// (`sidecar-http`, `daemon-ws`); a TS surface's entry must parse and must satisfy O2, but
// no Rust binding logic ever reads it — `main.rs` looks surfaces up BY KEY, so a
// TS entry is inert here by construction (it never reaches `bind_guard`, and never causes
// `tailnet_resolve` to ask Tailscale anything). What must not happen is two vocabularies:
// before this slice a `dist-http`/`web` entry did not merely go unread, it made the Rust
// daemon REFUSE TO BOOT — one runtime treating the other's config as corruption.

// `SurfaceGate`/`SurfaceExpose`/`SurfaceDeclaration`/the two surface-name constants and
// `surfaces_from_config` are `pub` (not `pub(crate)`): the `tractor` BINARY (`src/main.rs`)
// is a separate crate from the `tractor` LIBRARY these live in, and main.rs is where the
// declaration is resolved once at boot and threaded into `sidecar::start` — so the type has
// to cross that crate boundary. Fields stay `pub(crate)`: only `sidecar::bind_guard` (same
// crate) reads them; main.rs only ever holds the value opaquely.
pub const SURFACE_SIDECAR_HTTP: &str = "sidecar-http";
pub const SURFACE_DAEMON_WS: &str = "daemon-ws";

// The TypeScript-owned surfaces (O4). NOT `pub`: main.rs never names them, because the
// Rust runtime never binds them — they exist here so ONE config file parses in both
// runtimes, and so that O2's combination rules are checked once, in the fail-shut parser,
// rather than twice with a chance to drift.
//
// `capabilities` is `serveCapabilities`, the SDK primitive from the 07-29 design's example
// block. `web` is the `refarm web serve` LISTENER.
//
// On the name: the 07-30 design's prose calls the bootstrap surface `dist-http`, after
// what it serves (`.refarm/dist`, published by `refarm dist publish`). That is the SAME
// listener as `web` — and its own O6 is the reason only ONE of the two names may exist
// here. O6 establishes that `refarm web serve` is one listener carrying several routes
// (the dist artifacts AND proxies to `127.0.0.1:42000`/`42001`), and that declaring it
// open opens all of them — "this cannot be waved off as 'a different surface'". A name
// taken from the payload invites exactly that excuse, and admitting BOTH names would let
// an operator declare two different `expose`/`gate` values for one listener with no answer
// as to which wins — the two-vocabulary failure O4 exists to prevent. So the surface is
// named for the listener, like `sidecar-http` and `daemon-ws` before it: `web`.
const SURFACE_CAPABILITIES: &str = "capabilities";
const SURFACE_WEB: &str = "web";

const KNOWN_SURFACES: &[&str] =
    &[SURFACE_SIDECAR_HTTP, SURFACE_DAEMON_WS, SURFACE_CAPABILITIES, SURFACE_WEB];
const MAX_SURFACES: usize = 8;

/// A gate a surface may declare. `pub(crate)`: only ever appears behind
/// `SurfaceDeclaration`'s `pub(crate)` field, never in a signature main.rs (a separate
/// crate) has to name.
///
/// The `Option<SurfaceGate>` this sits inside carries the distinction O1 is about, and the
/// two levels must not be confused with each other:
/// - `None` — the operator wrote no `gate` key. SILENCE. Indistinguishable from an
///   oversight, and therefore never permission for anything.
/// - `Some(Open)` — the operator wrote `"gate": "none"`. A DECLARATION, reviewable as one.
/// - `Some(DeviceToken)` — the operator declared the bearer credential
///   `sidecar::auth::auth_middleware` and ADR-093's WS handshake actually check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SurfaceGate {
    DeviceToken,
    /// Declared `"gate": "none"` — deliberately open (O1). Spelled `Open` rather than
    /// `None` so that `Some(SurfaceGate::Open)` can never be misread as `Option::None`
    /// at a match site where the whole point is telling those two apart.
    ///
    /// This is NOT a gate. It satisfies nothing that wants one: `bind_guard`'s
    /// `Some(SurfaceGate::DeviceToken) if auth_policy_resolvable` arm never matches it,
    /// and `any_surface_declares_device_token_gate` is false for it, so declaring it can
    /// never derive an auth-policy path nor widen a Rust surface's bind. Its ONLY effect
    /// is to let a surface that verifies nothing say so honestly, under O2's constraints.
    Open,
}

/// `expose` intent, resolved from the operator's string (S2). PURE at PARSE time — even
/// `Tailnet` carries no address here, only intent; `sidecar::tailnet_resolve` is the one
/// place that turns it into a concrete `Host(<ip>)`, at bind time, by actually asking
/// Tailscale.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SurfaceExpose {
    Loopback,
    /// A SHAPE-validated (parseable IP literal) — never trusted or resolved — address,
    /// stored exactly as declared (brackets stripped). `sidecar::bind_guard` compares the
    /// actual requested bind host against this value; it does not trust the label alone.
    Host(String),
    /// Bind to whatever this machine's tailnet resolves to RIGHT NOW — resolved lazily,
    /// at bind time, by `sidecar::tailnet_resolve::resolve_declared_expose_for_bind`
    /// (never here, never at parse time: S2). `sidecar::bind_guard`'s pure guard
    /// functions never receive this variant in practice — the resolver always rewrites
    /// it to `Host(<resolved ip>)` first, or refuses before the guard is ever called.
    Tailnet,
}

/// One surface's parsed, validated declaration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SurfaceDeclaration {
    pub(crate) expose: SurfaceExpose,
    pub(crate) gate: Option<SurfaceGate>,
}

/// What `surface` can ACTUALLY enforce today, independent of anything declared for it.
/// This is the S3 capability table both the parser (structural, AT LOAD, below) and
/// `sidecar::bind_guard` (runtime, AT BIND) consult — one source of truth, so the two can
/// never drift apart. `None` means no enforcement mechanism exists at all: no gate value,
/// named or not, can ever make a non-loopback `expose` legal for that surface.
pub(crate) fn surface_enforceable_gate(surface: &str) -> Option<SurfaceGate> {
    match surface {
        SURFACE_SIDECAR_HTTP => Some(SurfaceGate::DeviceToken),
        // ADR-093's `Sec-WebSocket-Protocol` credential handshake gives `daemon-ws` the
        // same enforcement `sidecar-http` has — see the module doc's S3 section.
        SURFACE_DAEMON_WS => Some(SurfaceGate::DeviceToken),
        _ => None,
    }
}

fn parse_gate(raw: &str, surface: &str) -> Result<SurfaceGate, String> {
    match raw {
        "device-token" => Ok(SurfaceGate::DeviceToken),
        // O1: deliberate openness is a VALUE, not an omission. Whether it is ADMISSIBLE
        // here is a question about the COMBINATION it appears in, answered by
        // `validate_declared_combination` — this function only reads the vocabulary.
        "none" => Ok(SurfaceGate::Open),
        other => Err(format!(
            "surfaces['{surface}'].gate {other:?} is not a known gate — a surface may \
             declare \"device-token\" (a bearer credential is verified on every request) \
             or \"none\" (deliberately open, admissible only with \"expose\": \"tailnet\")"
        )),
    }
}

/// Parse `expose`'s STRING form into intent (S2). PURE — no I/O, no DNS: `host:<ip>` is
/// only SHAPE-validated here (a parseable IP literal), never resolved or trusted.
fn parse_expose(raw: &str, surface: &str) -> Result<SurfaceExpose, String> {
    match raw {
        "loopback" => Ok(SurfaceExpose::Loopback),
        "tailnet" => Ok(SurfaceExpose::Tailnet),
        other => {
            let Some(ip_raw) = other.strip_prefix("host:") else {
                return Err(format!(
                    "surfaces['{surface}'].expose {other:?} is not a known value — expected \
                     \"loopback\", \"host:<ip>\", or \"tailnet\""
                ));
            };
            let unbracketed = ip_raw
                .strip_prefix('[')
                .and_then(|rest| rest.strip_suffix(']'))
                .unwrap_or(ip_raw);
            if unbracketed.parse::<std::net::IpAddr>().is_err() {
                return Err(format!(
                    "surfaces['{surface}'].expose \"host:{ip_raw}\" is not a valid, fully-\
                     specified IP address literal — \"host:<ip>\" takes a concrete address, \
                     never a hostname (nothing here resolves DNS)"
                ));
            }
            Ok(SurfaceExpose::Host(ip_raw.to_string()))
        }
    }
}

fn parse_one_surface(name: &str, value: &serde_json::Value) -> Result<SurfaceDeclaration, String> {
    if !KNOWN_SURFACES.contains(&name) {
        return Err(format!(
            "surfaces['{name}'] is not a surface any refarm runtime declares — the \
             vocabulary is \"{SURFACE_SIDECAR_HTTP}\" and \"{SURFACE_DAEMON_WS}\" (this \
             daemon binds and enforces these), plus \"{SURFACE_CAPABILITIES}\" and \
             \"{SURFACE_WEB}\" (the TypeScript runtime binds these; this daemon validates \
             their shape and never binds them)"
        ));
    }
    let Some(obj) = value.as_object() else {
        return Err(format!(
            "surfaces['{name}'] must be an object, e.g. {{ \"expose\": \"loopback\" }}"
        ));
    };

    let expose_raw = match obj.get("expose") {
        Some(serde_json::Value::String(s)) => s.as_str(),
        _ => return Err(format!("surfaces['{name}'].expose is required and must be a string")),
    };
    let expose = parse_expose(expose_raw, name)?;

    let gate = match obj.get("gate") {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(s)) => Some(parse_gate(s, name)?),
        Some(_) => return Err(format!("surfaces['{name}'].gate must be a string")),
    };

    validate_declared_combination(name, &expose, expose_raw, gate)?;

    Ok(SurfaceDeclaration { expose, gate })
}

/// `true` when a declared `host:<ip>` names EVERY interface (`0.0.0.0`, `[::]`). SHAPE
/// only — `parse_expose` already proved the literal parses, so this is a re-read of a
/// validated value, never a resolution. Used ONLY to sharpen a refusal's wording; the
/// refusal itself does not depend on it, so the IPv4-mapped `::ffff:0.0.0.0` (for which
/// `is_unspecified()` is deliberately `false` — see `bind_guard::is_loopback_host`'s doc
/// for why that must never be canonicalized away) is refused by the same rule regardless.
fn declared_host_is_unspecified(raw: &str) -> bool {
    let unbracketed = raw.strip_prefix('[').and_then(|rest| rest.strip_suffix(']')).unwrap_or(raw);
    unbracketed.parse::<std::net::IpAddr>().map(|ip| ip.is_unspecified()).unwrap_or(false)
}

/// The whole S3 + O2 rule set over an already-shape-valid `(expose, gate)` pair, checked
/// AT LOAD (never deferred to bind time). PURE — no I/O, no DNS, no Tailscale.
///
/// Four rules, in the order a reader should think about them:
///
/// 1. **O1/S3 — a surface may not declare a gate it cannot enforce**, at ANY `expose`,
///    including `loopback`. Claiming an enforcement that does not exist is a lie wherever
///    it binds, and `"gate": "none"` now exists precisely so the honest thing is sayable.
///    (A gate a surface CAN enforce, declared alongside `loopback`, stays legal and inert —
///    it never widens anything, and it is what derives the node's auth-policy path.)
/// 2. **O2 — `"gate": "none"` is admissible only over an admitted-device transport.**
/// 3. **O2 — a surface that HAS a real gate may not declare itself open beyond loopback**:
///    `sidecar-http` and `daemon-ws` accept mutations (agent dispatch, CRDT writes), and
///    O2 admits openness only for read-only surfaces that grant nothing.
/// 4. **S3 — a non-loopback `expose` needs a gate**, the pre-existing rule, unchanged.
fn validate_declared_combination(
    name: &str,
    expose: &SurfaceExpose,
    expose_raw: &str,
    gate: Option<SurfaceGate>,
) -> Result<(), String> {
    let enforceable = surface_enforceable_gate(name);

    // (1) O1/S3 — the declared gate must be one THIS surface actually verifies.
    if gate == Some(SurfaceGate::DeviceToken) && enforceable != Some(SurfaceGate::DeviceToken) {
        return Err(format!(
            "surfaces['{name}'].gate \"device-token\": '{name}' verifies no bearer \
             credential at all, so declaring that gate would claim an enforcement that \
             does not exist. If '{name}' is deliberately open, say so — declare \"gate\": \
             \"none\", which is admissible with \"expose\": \"tailnet\" or \"loopback\""
        ));
    }

    // (2)/(3) O2 — the combination rules that make deliberate openness safe rather than
    // merely documented.
    if gate == Some(SurfaceGate::Open) {
        return match expose {
            // Loopback + "none" is admissible and means NOTHING special: loopback was
            // already the floor S1 gives every surface. It is still worth declaring —
            // it says the openness is a choice — but it grants nothing.
            SurfaceExpose::Loopback => Ok(()),
            SurfaceExpose::Tailnet => {
                if enforceable.is_some() {
                    // (3) The surface HAS a gate and accepts mutations. O2 admits
                    // openness only for a read-only surface that grants nothing; these
                    // two dispatch agents and write CRDT state.
                    return Err(format!(
                        "surfaces['{name}'] declares \"gate\": \"none\" with \"expose\": \
                         \"tailnet\", but '{name}' accepts mutations and HAS a credential \
                         gate — deliberate openness is admissible only for a read-only \
                         surface that grants nothing. Declare \"gate\": \"device-token\" \
                         to expose '{name}' on the tailnet"
                    ));
                }
                Ok(())
            }
            SurfaceExpose::Host(ip) if declared_host_is_unspecified(ip) => Err(format!(
                "surfaces['{name}'] declares \"gate\": \"none\" with \"expose\": \
                 \"host:{ip}\" — that is EVERY interface on this machine, the one exposure \
                 deliberate openness may never combine with. Declare \"expose\": \
                 \"tailnet\" instead: an open surface is admissible only because arriving \
                 over an admitted-device transport is itself the first factor, and \
                 {ip} admits nobody in particular"
            )),
            SurfaceExpose::Host(ip) => Err(format!(
                "surfaces['{name}'] declares \"gate\": \"none\" with \"expose\": \
                 \"host:{ip}\" — deliberate openness is admissible only over a transport \
                 whose peers the operator already admitted, and a literal address is not \
                 evidence of one: nothing here resolves or trusts it (S2), including an \
                 address that merely LOOKS like a tailnet's 100.64.0.0/10 (that range is \
                 RFC 6598 carrier-grade NAT, which Tailscale borrows and ISPs and \
                 containers also use). Declare \"expose\": \"tailnet\" to open '{name}' to \
                 admitted devices, or narrow it to \"loopback\""
            )),
        };
    }

    // (4) S3, unchanged: a non-loopback `expose` must name a gate this surface can
    // actually enforce — never a gate it lacks the machinery for, and never NO gate at
    // all (that would recreate exactly the hole this design closes: a wide bind whose
    // only witness is a comment saying "trust me").
    if matches!(expose, SurfaceExpose::Loopback) {
        return Ok(());
    }
    match enforceable {
        None => Err(format!(
            "surfaces['{name}'].expose = {expose_raw:?}: '{name}' has no credential gate \
             implemented at all — it may declare \"loopback\", or \"tailnet\" together \
             with \"gate\": \"none\" if it is deliberately open (read-only, admitted \
             devices only)"
        )),
        Some(capable) => match gate {
            Some(g) if g == capable => Ok(()),
            // Unreachable today: the only other gate VALUE is `Open`, handled above, and
            // rule (1) already rejected a gate this surface cannot enforce. Kept as the
            // fail-shut default for whatever the vocabulary grows next.
            Some(_) => {
                Err(format!("surfaces['{name}'].gate does not name a gate '{name}' can enforce"))
            }
            None => Err(format!(
                "surfaces['{name}'].expose = {expose_raw:?} needs a gate — declare \
                 \"gate\": \"device-token\" to bind '{name}' beyond loopback"
            )),
        },
    }
}

/// Parse the `surfaces` block. An absent block is an empty catalog — S1's silence, every
/// surface binds loopback; a present-but-malformed block fails shut, exactly like
/// `connections` (`parse_connections`).
pub(crate) fn parse_surfaces(
    cfg: &serde_json::Value,
) -> Result<HashMap<String, SurfaceDeclaration>, String> {
    let Some(block) = cfg.get("surfaces") else {
        return Ok(HashMap::new());
    };
    let Some(obj) = block.as_object() else {
        return Err("surfaces must be an object".to_string());
    };
    if obj.len() > MAX_SURFACES {
        return Err(format!("too many surfaces declared (max {MAX_SURFACES})"));
    }
    let mut out = HashMap::with_capacity(obj.len());
    for (name, value) in obj {
        out.insert(name.clone(), parse_one_surface(name, value)?);
    }
    Ok(out)
}

/// Resolve the `surfaces` catalog from `.refarm/config.json` under `base`. Absent file ⇒
/// empty catalog (S1). Malformed file, or a declaration refused at load (S3) ⇒ error,
/// matching the hardened reader's (`read_refarm_config_value_at`) fail-shut posture.
pub(crate) fn resolve_surfaces(base: &Path) -> Result<HashMap<String, SurfaceDeclaration>, String> {
    match read_refarm_config_value_at(base)? {
        Some(cfg) => parse_surfaces(&cfg),
        None => Ok(HashMap::new()),
    }
}

/// Boot-time entry point — resolves against the process cwd, the SAME base
/// `resolve_connections`'s production wiring uses (`connection_host.rs`), so `surfaces` and
/// `connections` always agree on which `.refarm/config.json` they are reading.
pub fn surfaces_from_config() -> Result<HashMap<String, SurfaceDeclaration>, String> {
    resolve_surfaces(&std::env::current_dir().unwrap_or_default())
}

/// `true` when ANY declared surface names `"gate": "device-token"` — the node-wide fact
/// `sidecar::auth::AuthPolicySource` derives the conventional policy path from, so declaring
/// the gate is ENOUGH (the operator never plumbs `REFARM_AUTH_POLICY` by hand to be believed).
///
/// Node-WIDE, not per-surface, because the policy is node-wide: ONE `auth-policy.json`, one
/// credential set, read by every surface's enforcement (`sidecar::auth_middleware` and
/// ADR-093's WS handshake resolve the SAME file). Answering per-surface would mean two
/// resolutions, two reads and two log lines for one file.
///
/// This does NOT widen any surface: `sidecar::bind_guard` still requires THIS surface to
/// declare the gate itself before permitting its own non-loopback bind, so a gate declared on
/// `sidecar-http` never unlocks an undeclared or ungated `daemon-ws` (S1/S3). All this
/// answers is "is a credential policy part of what this node declared".
///
/// `"gate": "none"` (`SurfaceGate::Open`) answers NO here, deliberately (O1). Declaring
/// deliberate openness is the opposite of declaring a credential gate, so it must never
/// derive a policy path: doing so would make an OPEN surface manufacture the very
/// `auth_policy_resolvable` signal `bind_guard` reads as "a gate is live", and a node whose
/// only declaration is `"none"` would report a credential policy it never asked for.
/// The equality against `Some(SurfaceGate::DeviceToken)` — not `decl.gate.is_some()` — is
/// what makes that hold; `open_gate_does_not_derive_an_auth_policy_path` is its guard.
pub fn any_surface_declares_device_token_gate(
    surfaces: &HashMap<String, SurfaceDeclaration>,
) -> bool {
    surfaces.values().any(|decl| decl.gate == Some(SurfaceGate::DeviceToken))
}
