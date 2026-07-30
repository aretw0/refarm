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
// Out of scope this slice: the TypeScript surfaces (`capabilities`, `web` in the design
// doc's example) — the Rust parser below refuses their names as "unknown", exactly as it
// refuses any other undeclared surface, until question 2 of the design (what `gate:
// "device-token"` means on a Node surface that verifies nothing) is answered and that
// slice widens `KNOWN_SURFACES`.

// `SurfaceGate`/`SurfaceExpose`/`SurfaceDeclaration`/the two surface-name constants and
// `surfaces_from_config` are `pub` (not `pub(crate)`): the `tractor` BINARY (`src/main.rs`)
// is a separate crate from the `tractor` LIBRARY these live in, and main.rs is where the
// declaration is resolved once at boot and threaded into `sidecar::start` — so the type has
// to cross that crate boundary. Fields stay `pub(crate)`: only `sidecar::bind_guard` (same
// crate) reads them; main.rs only ever holds the value opaquely.
pub const SURFACE_SIDECAR_HTTP: &str = "sidecar-http";
pub const SURFACE_DAEMON_WS: &str = "daemon-ws";
const KNOWN_SURFACES: &[&str] = &[SURFACE_SIDECAR_HTTP, SURFACE_DAEMON_WS];
const MAX_SURFACES: usize = 8;

/// A gate a surface may declare. `DeviceToken` is the only member today — the bearer
/// credential `sidecar::auth::auth_middleware` checks (and ADR-093's planned WS handshake
/// will check the same way). `pub(crate)`: only ever appears behind `SurfaceDeclaration`'s
/// `pub(crate)` field, never in a signature main.rs (a separate crate) has to name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SurfaceGate {
    DeviceToken,
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
        other => Err(format!(
            "surfaces['{surface}'].gate {other:?} is not a known gate — the only gate a \
             surface may declare today is \"device-token\""
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
            "surfaces['{name}'] is not a surface this daemon reads — the Rust runtime \
             declares exposure for \"{SURFACE_SIDECAR_HTTP}\" and \"{SURFACE_DAEMON_WS}\" \
             only (the TypeScript surfaces are a later slice)"
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

    if !matches!(expose, SurfaceExpose::Loopback) {
        // S3, enforced AT LOAD: a non-loopback `expose` must name a gate this surface can
        // actually enforce — never a gate it lacks the machinery for, and never NO gate at
        // all (that would recreate exactly the hole this design closes: a wide bind whose
        // only witness is a comment saying "trust me").
        match surface_enforceable_gate(name) {
            None => {
                // Currently unreachable for either known surface (both `sidecar-http` and
                // `daemon-ws`, since ADR-093, enforce `device-token`) — kept as the
                // fail-shut default for any future surface `KNOWN_SURFACES` grows to
                // include before `surface_enforceable_gate` is taught its enforcement.
                return Err(format!(
                    "surfaces['{name}'].expose = {expose_raw:?}: '{name}' has no credential \
                     gate implemented at all — it may declare only \"loopback\""
                ));
            }
            Some(capable) => match gate {
                Some(g) if g == capable => {}
                Some(_) => {
                    return Err(format!(
                        "surfaces['{name}'].gate does not name a gate '{name}' can enforce"
                    ));
                }
                None => {
                    return Err(format!(
                        "surfaces['{name}'].expose = {expose_raw:?} needs a gate — declare \
                         \"gate\": \"device-token\" to bind '{name}' beyond loopback"
                    ));
                }
            },
        }
    }

    Ok(SurfaceDeclaration { expose, gate })
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
