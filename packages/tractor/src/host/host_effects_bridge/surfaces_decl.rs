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
// (`sidecar::auth::auth_middleware`) and may declare `"gate": "device-token"`; `daemon-ws`
// has NO middleware at all (ADR-093's credential handshake is not implemented), so it may
// declare only `"loopback"` — anything else is refused here, naming ADR-093, rather than
// silently accepted and only caught later at bind time.
//
// `expose: "tailnet"` is deliberately IN the vocabulary and REJECTED: who resolves this
// machine's tailnet address, and how that resolver tells "the tailnet is down" from "I
// could not ask" (so the fail-closed promise holds), is an open question (design doc, open
// question 1) — declaring it loudly refuses rather than silently doing the wrong thing,
// same pattern the repo already uses for `probe.shell` and a non-zero `linger.idleMs`
// (connection_decl.rs).
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

/// `expose` intent, resolved from the operator's string (S2). `Tailnet` is deliberately
/// NOT a variant here: `parse_expose` refuses the string outright, so no downstream code
/// (parser or `sidecar::bind_guard`) can ever hold a value meaning "bind the tailnet" —
/// there is nothing yet that could honor it correctly.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SurfaceExpose {
    Loopback,
    /// A SHAPE-validated (parseable IP literal) — never trusted or resolved — address,
    /// stored exactly as declared (brackets stripped). `sidecar::bind_guard` compares the
    /// actual requested bind host against this value; it does not trust the label alone.
    Host(String),
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
        SURFACE_DAEMON_WS => None,
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
        "tailnet" => Err(format!(
            "surfaces['{surface}'].expose = \"tailnet\" is not implemented yet: who resolves \
             this machine's tailnet address, and how that resolver tells \"the tailnet is \
             down\" from \"I could not ask\" (so the fail-closed promise holds), is an open \
             question (docs/superpowers/specs/2026-07-29-declared-surfaces-design.md, open \
             question 1) — declare \"loopback\" or a literal \"host:<ip>\" instead"
        )),
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
                return Err(format!(
                    "surfaces['{name}'].expose = {expose_raw:?}: '{name}' has no credential \
                     gate implemented at all (ADR-093's credential handshake is not \
                     implemented yet) — it may declare only \"loopback\""
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
