//! Fail-closed bind guard for the runtime sidecar and daemon WS — PROMOTED to enforce the
//! `surfaces` declaration (docs/superpowers/specs/2026-07-29-declared-surfaces-design.md).
//!
//! Before this design, the guard answered "is this host loopback, and is a policy present?"
//! — a question a lone `REFARM_AUTH_POLICY` file could answer FOR any surface, including the
//! WS, which has no middleware to actually check it. Now it answers the promoted question:
//! "does the `surfaces` declaration PERMIT this bind, and can this surface ENFORCE what the
//! declaration claims?" Two rules carry the weight:
//!
//! - S1 (undeclared means closed): no `surfaces.<name>` entry at all ⇒ the CEILING is
//!   loopback, full stop — a configured auth policy does not widen that. A default a flag
//!   can overwrite was exactly the shape of hole that left the WS bound to `0.0.0.0` with
//!   nothing to contradict it; the ABSENCE of a declaration must be a stronger, non-
//!   overridable signal than any default.
//! - S5 (a flag may only narrow, never widen): the declaration's `expose` is the ceiling a
//!   `--http-host`/`--ws-host` value may match or fall inside of (loopback is always inside
//!   any ceiling), never a value that points somewhere ELSE or wider.
//!
//! `refuse_unguarded_nonloopback_bind` (the HTTP sidecar's guard) additionally enforces S3:
//! a non-loopback declaration must name a gate the sidecar can enforce (`device-token`), AND
//! that gate must actually be configured right now (a real, readable `REFARM_AUTH_POLICY`) —
//! a declared-but-unconfigured gate enforces nothing and must not be mistaken for one that
//! does.
//!
//! `refuse_nonloopback_ws_bind` does not take a declaration at all: `daemon-ws` has NO
//! middleware whatsoever (ADR-093's credential handshake is not implemented), so
//! `surfaces_decl::parse_one_surface` already refuses ANY non-loopback `daemon-ws`
//! declaration AT LOAD, before this function could ever see one — the only value this
//! function could receive here is `loopback`, which changes nothing about its answer. So its
//! unconditional refusal of every non-loopback host, policy or declaration or not, already
//! answers the promoted question correctly; nothing about the function needed to change, only
//! this comment, to say so.
//!
//! Every decision below is a PURE function of its inputs — no socket, no I/O, no DNS — so it
//! is exhaustively unit-tested without ever binding a port.

use std::net::IpAddr;

use crate::host::{SurfaceDeclaration, SurfaceExpose, SurfaceGate};

/// Refuse to start the sidecar when `host` is NOT loopback and the `surfaces.sidecar-http`
/// declaration does not permit it. PURE: never binds a socket, never resolves DNS.
///
/// - loopback (`127.0.0.0/8`, `::1`, the literal `localhost`) ⇒ always `Ok` — this is the
///   sidecar's default (`127.0.0.1`) and is inside every declaration's ceiling, declared or
///   not.
/// - non-loopback + no declaration (`declared: None`) ⇒ `Err` (S1) — an undeclared surface
///   binds loopback only; a configured `auth_policy_present` does NOT change this anymore.
/// - non-loopback + a declaration whose `expose` is `"loopback"` ⇒ `Err` (S5) — the flag is
///   trying to widen past the declared ceiling.
/// - non-loopback + a declaration whose `expose` is `host:<ip>` that does NOT match `host`
///   ⇒ `Err` (S5) — the flag points somewhere else (or wider) than what was declared; the
///   declaration is authoritative for WHICH address, not just whether non-loopback is legal.
/// - non-loopback + a matching `host:<ip>` declaration ⇒ `Ok` only if the declared `gate` is
///   `device-token` AND `auth_policy_present` (S3) — a declared gate that is not actually
///   configured enforces nothing and must not be mistaken for one that does.
pub(crate) fn refuse_unguarded_nonloopback_bind(
    host: &str,
    auth_policy_present: bool,
    declared: Option<&SurfaceDeclaration>,
) -> Result<(), String> {
    if is_loopback_host(host) {
        return Ok(());
    }

    let Some(decl) = declared else {
        return Err(format!(
            "refusing to bind the sidecar to non-loopback host {host:?}: no \
             `surfaces.sidecar-http` declaration is present in .refarm/config.json, and an \
             undeclared surface binds loopback only. Declare it first:\n  \"surfaces\": {{ \
             \"sidecar-http\": {{ \"expose\": \"host:{host}\", \"gate\": \"device-token\" }} \
             }}\nthen mint a per-device credential with `refarm auth enroll` and set \
             REFARM_AUTH_POLICY to the resulting policy file before binding beyond loopback."
        ));
    };

    let SurfaceExpose::Host(declared_ip) = &decl.expose else {
        return Err(format!(
            "refusing to bind the sidecar to non-loopback host {host:?}: \
             surfaces.sidecar-http declares \"expose\": \"loopback\" — a flag may narrow that \
             declaration, never widen it. Widen the declaration in .refarm/config.json first."
        ));
    };

    if !hosts_match(host, declared_ip) {
        return Err(format!(
            "refusing to bind the sidecar to {host:?}: surfaces.sidecar-http declares \
             \"expose\": \"host:{declared_ip}\" — a flag may only match that declaration or \
             narrow it to loopback, never point somewhere else or wider."
        ));
    }

    match decl.gate {
        Some(SurfaceGate::DeviceToken) if auth_policy_present => Ok(()),
        Some(SurfaceGate::DeviceToken) => Err(format!(
            "refusing to bind the sidecar to {host:?}: surfaces.sidecar-http declares \
             \"gate\": \"device-token\" but no REFARM_AUTH_POLICY is configured, so nothing \
             would actually enforce it. Mint a per-device credential with `refarm auth \
             enroll`, then set REFARM_AUTH_POLICY to the resulting policy file before binding \
             beyond loopback."
        )),
        None => Err(format!(
            "refusing to bind the sidecar to {host:?}: surfaces.sidecar-http declares a \
             non-loopback expose with no gate. Declare \"gate\": \"device-token\" to bind \
             beyond loopback."
        )),
    }
}

/// Refuse a non-loopback bind for the CRDT/agent WebSocket, UNCONDITIONALLY. PURE: never
/// binds a socket, never resolves DNS, never reads `surfaces` (see the module doc for why a
/// declaration cannot change this answer — `daemon-ws` may only ever declare `"loopback"`,
/// enforced at load by `surfaces_decl::parse_one_surface`).
///
/// The WS listener has NO credential middleware. `handle_connection` accepts `user:prompt`
/// frames from any peer that completes the handshake — there is no credential channel on
/// this socket at all (ADR-093's `Sec-WebSocket-Protocol` handshake is planned, not
/// implemented). A policy file — or a `surfaces` declaration claiming otherwise — would
/// unlock a bind while gating nothing, and the guard's `Ok` would read as "this is gated"
/// when nothing gates it. A guard that approves what it does not gate is worse than no
/// guard, because it is mistaken for permission.
///
/// Until the WS credential handshake ships, the only honest answer for a non-loopback WS
/// bind is `Err`. When ADR-093 lands, this becomes the same declaration-aware call the
/// sidecar makes — and not a moment before.
pub(crate) fn refuse_nonloopback_ws_bind(host: &str) -> Result<(), String> {
    if is_loopback_host(host) {
        return Ok(());
    }
    Err(format!(
        "refusing to bind the agent/CRDT WebSocket to non-loopback host {host:?}: this \
         socket has NO credential gate at all — any peer that can reach it may dispatch \
         `user:prompt` to a plugin. Unlike the HTTP sidecar, a configured \
         REFARM_AUTH_POLICY does NOT gate this listener (no middleware reads it), so it \
         cannot authorize a wider bind either — and neither can any `surfaces.daemon-ws` \
         declaration (that block accepts only `\"expose\": \"loopback\"` for this surface; \
         anything else is refused when `.refarm/config.json` loads, before this ever runs). \
         The WS credential handshake over `Sec-WebSocket-Protocol` (ADR-093) is not \
         implemented yet; until it ships, reach this port from another device through an \
         authenticated front (e.g. `refarm web serve` on a loopback-proxied origin) or a \
         network-layer tunnel, not by widening this bind."
    ))
}

/// Resolve the ACTUAL sidecar bind host from the operator's `--http-host` flag (if any)
/// and the `surfaces.sidecar-http` declaration, then validate the result — one call
/// instead of two, so the value that gets bound is exactly the value that was checked.
///
/// `flag: None` means `--http-host` was not passed. Under S5 (a flag may only narrow,
/// never widen) a CLI DEFAULT is not neutral — a default value is indistinguishable from
/// an explicit operator choice, so main.rs's `http_host` no longer HAS one. Absence is a
/// real third state: it means "the declaration decides", so the resolved host becomes
/// whatever `host:<ip>` the declaration names (loopback if it declares `"loopback"` or is
/// absent entirely — S1). This is the fix for the bug that made the whole `surfaces`
/// slice inert for this surface: previously the flag ALWAYS carried a value (its old
/// `default_value = "127.0.0.1"`), so it ALWAYS narrowed, so a `host:<ip>` declaration
/// could never take effect.
///
/// `flag: Some(v)` means the operator IS narrowing (or asserting) — `v` is validated
/// against the declared ceiling exactly as `refuse_unguarded_nonloopback_bind` always
/// has: it may match the declaration, narrow it to loopback, but never widen or point
/// elsewhere.
///
/// PURE: no socket, no I/O, no DNS.
pub(crate) fn resolve_sidecar_bind_host(
    flag: Option<&str>,
    auth_policy_present: bool,
    declared: Option<&SurfaceDeclaration>,
) -> Result<String, String> {
    let requested = match flag {
        Some(v) => v.to_string(),
        None => match declared.map(|decl| &decl.expose) {
            Some(SurfaceExpose::Host(ip)) => ip.clone(),
            Some(SurfaceExpose::Loopback) | None => "127.0.0.1".to_string(),
        },
    };
    refuse_unguarded_nonloopback_bind(&requested, auth_policy_present, declared)?;
    Ok(requested)
}

/// Resolve the ACTUAL WS bind host from the operator's `--ws-host` flag (if any), then
/// validate it. `flag: None` (the flag was not passed) resolves to loopback — the ONLY
/// value `surfaces.daemon-ws` may ever legally declare (enforced at config load, see the
/// module doc), so there is nothing for a declaration to add here: an absent flag means
/// the same thing a present-and-loopback flag would. `flag: Some(v)` is validated
/// unconditionally, exactly as `refuse_nonloopback_ws_bind` always has — no declaration,
/// no policy, changes that answer. PURE: no socket, no I/O, no DNS.
pub(crate) fn resolve_ws_bind_host(flag: Option<&str>) -> Result<String, String> {
    let requested = flag.unwrap_or("127.0.0.1").to_string();
    refuse_nonloopback_ws_bind(&requested)?;
    Ok(requested)
}

/// Strip a surrounding `[...]` (RFC 3986 bracketed host syntax) before parsing. SYNTAX
/// ONLY — removes bracket characters, never touches the address's bits or family. Shared by
/// `is_loopback_host` and `hosts_match` so both use the identical parse.
fn parse_bind_ip(host: &str) -> Option<IpAddr> {
    let unbracketed = host
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
        .unwrap_or(host);
    unbracketed.parse::<IpAddr>().ok()
}

/// `true` for `127.0.0.0/8`, `::1`, and the literal `localhost`. Everything else —
/// including the unspecified addresses `0.0.0.0` / `[::]`, and any host that fails to
/// parse as an `IpAddr` — is treated as NOT loopback. PURE.
fn is_loopback_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    // The bind address is built as `format!("{host}:{port}")`. A bare `::1` in that
    // template yields `::1:8080` — not a parseable socket address, so it never binds
    // — meaning `[::1]` (bracketed, RFC 3986 host syntax) is the ONLY IPv6-loopback
    // spelling that ever binds successfully. `parse_bind_ip` strips a surrounding
    // `[...]` before parsing so that form is recognized as loopback.
    //
    // Do NOT extend `parse_bind_ip` into address *canonicalization* (e.g. folding an
    // IPv4-mapped IPv6 address down to its embedded IPv4 form) to "simplify" the checks
    // below: `Ipv6Addr::is_unspecified()` is `false` for the IPv4-mapped `::ffff:0.0.0.0`,
    // so canonicalizing mapped addresses before the unspecified check would make that
    // address parse as plain `0.0.0.0` and get caught by accident rather than by policy —
    // and the mirror mistake, folding `::ffff:127.0.0.1` down to `127.0.0.1`, would make
    // `ip.is_loopback()` return `true` and silently ALLOW an unauthenticated
    // all-interfaces-reachable bind through the mapped-address family. `::ffff:0.0.0.0`
    // and `::ffff:127.0.0.1` (and the rest of `::ffff:0.0.0.0/96`) must both stay refused
    // exactly as they are today: not loopback, no special-casing.
    let Some(ip) = parse_bind_ip(host) else {
        // Doesn't parse and isn't `localhost` ⇒ unknown shape ⇒ fail closed, not loopback.
        return false;
    };
    if ip.is_unspecified() {
        // 0.0.0.0 / [::] — explicitly NOT loopback. This is every interface, the single
        // most dangerous host to get wrong here; `IpAddr::is_loopback` already returns
        // `false` for it, but the case is spelled out so the exclusion cannot regress
        // silently if that behavior ever changes upstream.
        return false;
    }
    ip.is_loopback()
}

/// S5's "matches the declaration" test: `requested` (what a flag asked to bind) and
/// `declared` (the `host:<ip>` a `SurfaceExpose::Host` carries) name the SAME address.
/// Compares parsed `IpAddr`s (not raw strings) so `[2001:db8::1]` and `2001:db8::1` are
/// recognized as the same declaration. A `requested` host that does not even parse as an IP
/// can never match a (pre-validated, always-parseable) declared one — fails closed, exactly
/// like `is_loopback_host` does for an unparseable host. PURE.
fn hosts_match(requested: &str, declared: &str) -> bool {
    match (parse_bind_ip(requested), parse_bind_ip(declared)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn declare_loopback() -> SurfaceDeclaration {
        SurfaceDeclaration { expose: SurfaceExpose::Loopback, gate: None }
    }

    fn declare_host(ip: &str, gate: Option<SurfaceGate>) -> SurfaceDeclaration {
        SurfaceDeclaration { expose: SurfaceExpose::Host(ip.to_string()), gate }
    }

    // ── loopback is always fine — declared, undeclared, policy or not ───────────────

    #[test]
    fn loopback_v4_starts_regardless_of_policy_or_declaration() {
        assert!(refuse_unguarded_nonloopback_bind("127.0.0.1", false, None).is_ok());
        assert!(refuse_unguarded_nonloopback_bind("127.0.0.1", true, None).is_ok());
        assert!(
            refuse_unguarded_nonloopback_bind("127.0.0.1", false, Some(&declare_loopback()))
                .is_ok()
        );
    }

    #[test]
    fn loopback_v4_range_starts_without_policy() {
        // The whole 127.0.0.0/8 range is loopback, not just 127.0.0.1.
        assert!(refuse_unguarded_nonloopback_bind("127.5.5.5", false, None).is_ok());
    }

    #[test]
    fn loopback_v6_starts_without_policy() {
        assert!(refuse_unguarded_nonloopback_bind("::1", false, None).is_ok());
    }

    #[test]
    fn bracketed_loopback_v6_starts_without_policy() {
        // `[::1]` is the ONLY IPv6-loopback spelling that ever binds successfully
        // through `format!("{host}:{port}")` (bare `::1` yields the unparseable
        // `::1:8080`), so this is the shape operators/config actually use. It must be
        // recognized as loopback, same as `::1` and `127.0.0.1`.
        assert!(refuse_unguarded_nonloopback_bind("[::1]", false, None).is_ok());
    }

    #[test]
    fn bracketed_unspecified_v6_with_no_declaration_is_refused() {
        // `[::]` — the bracketed, actually-bindable spelling of "every IPv6 interface"
        // — must stay refused exactly like `::` and `0.0.0.0`. Bracket-stripping is
        // syntax only; it must not accidentally launder the unspecified address through.
        assert!(refuse_unguarded_nonloopback_bind("[::]", false, None).is_err());
    }

    #[test]
    fn ipv4_mapped_loopback_v6_stays_refused() {
        // `::ffff:127.0.0.1` is the IPv4-mapped spelling of loopback, but
        // `Ipv6Addr::is_loopback()` only matches the literal `::1` — it does not
        // special-case the mapped family. This guard must never canonicalize a mapped
        // address down to its embedded IPv4 form before checking, or this would flip to
        // `Ok` and silently allow an all-interfaces-reachable bind through the back door.
        assert!(refuse_unguarded_nonloopback_bind("::ffff:127.0.0.1", false, None).is_err());
    }

    #[test]
    fn ipv4_mapped_unspecified_v6_stays_refused() {
        // `::ffff:0.0.0.0` is the IPv4-mapped "every interface" address.
        // `Ipv6Addr::is_unspecified()` is `false` for it (unlike bare `0.0.0.0`), so if
        // this guard ever canonicalized mapped addresses before the unspecified check,
        // this one would slip past that check too. It doesn't need the check: mapped
        // addresses are never loopback here, so it stays refused regardless.
        assert!(refuse_unguarded_nonloopback_bind("::ffff:0.0.0.0", false, None).is_err());
    }

    #[test]
    fn localhost_literal_starts_without_policy() {
        assert!(refuse_unguarded_nonloopback_bind("localhost", false, None).is_ok());
        assert!(refuse_unguarded_nonloopback_bind("LOCALHOST", false, None).is_ok());
    }

    // ── S1 mutation-verify: undeclared means closed, a policy does NOT widen it ─────

    #[test]
    fn undeclared_nonloopback_with_no_policy_is_refused_and_names_the_declaration() {
        let err = refuse_unguarded_nonloopback_bind("0.0.0.0", false, None)
            .expect_err("0.0.0.0 with no declaration must be refused");
        assert!(err.contains("surfaces"), "must name the declaration: {err}");
        assert!(err.contains("sidecar-http"), "must name the surface: {err}");
    }

    #[test]
    fn undeclared_nonloopback_with_a_policy_present_is_still_refused() {
        // THE S1 mutation guard. Before this design, a configured policy alone was
        // enough to widen the sidecar's bind — `refuse_unguarded_nonloopback_bind`
        // used to take only `(host, auth_policy_present)` and this exact case (a
        // tailnet-shaped address, policy present, no declaration in sight) returned
        // `Ok`. Under S1, undeclared means closed regardless of policy: silence must
        // outrank a flag/env var, or the very hole this design closes (the WS was
        // never DECIDED open, just never contradicted) reopens for the sidecar too.
        assert!(refuse_unguarded_nonloopback_bind("100.64.0.1", true, None).is_err());
        assert!(refuse_unguarded_nonloopback_bind("0.0.0.0", true, None).is_err());
    }

    #[test]
    fn undeclared_unparseable_host_is_refused_even_with_a_policy_present() {
        // Same S1 guard for a host shape that isn't even a parseable IP: a policy is
        // no longer a blanket "any non-loopback host is fine" permission — the
        // declaration decides, and there isn't one.
        assert!(refuse_unguarded_nonloopback_bind("some.hostname", true, None).is_err());
    }

    // ── declared "loopback": a flag may narrow (trivially true), never widen ────────

    #[test]
    fn declared_loopback_permits_a_loopback_bind() {
        assert!(
            refuse_unguarded_nonloopback_bind("127.0.0.1", false, Some(&declare_loopback()))
                .is_ok()
        );
    }

    #[test]
    fn declared_loopback_refuses_any_wider_flag() {
        let decl = declare_loopback();
        let err = refuse_unguarded_nonloopback_bind("0.0.0.0", true, Some(&decl))
            .expect_err("a loopback declaration must not be widened by a flag");
        assert!(err.contains("loopback"), "must name the declared ceiling: {err}");
    }

    // ── declared "host:<ip>" — the declaration is authoritative for WHICH address ───

    #[test]
    fn declared_host_with_gate_and_policy_present_is_allowed() {
        let decl = declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken));
        assert!(refuse_unguarded_nonloopback_bind("100.64.0.1", true, Some(&decl)).is_ok());
    }

    #[test]
    fn declared_host_with_gate_but_no_policy_present_is_refused() {
        // The declaration NAMES a gate it can enforce, but nothing is actually
        // configured to enforce it right now — S3's runtime half.
        let decl = declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken));
        let err = refuse_unguarded_nonloopback_bind("100.64.0.1", false, Some(&decl))
            .expect_err("a declared gate with no configured policy must be refused");
        assert!(err.contains("REFARM_AUTH_POLICY"), "must name the fix: {err}");
    }

    #[test]
    fn declared_host_with_no_gate_is_refused_even_with_policy_present() {
        // A non-loopback declaration with NO gate at all is refused independent of
        // whether a policy happens to be configured — the declaration itself never
        // claimed anything would enforce this bind.
        let decl = declare_host("100.64.0.1", None);
        assert!(refuse_unguarded_nonloopback_bind("100.64.0.1", true, Some(&decl)).is_err());
    }

    // ── S5 mutation-verify: narrowing is honoured, widening is refused ──────────────

    #[test]
    fn flag_narrowing_a_host_declaration_to_loopback_is_honoured() {
        let decl = declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken));
        assert!(
            refuse_unguarded_nonloopback_bind("127.0.0.1", false, Some(&decl)).is_ok(),
            "loopback is inside every declared ceiling, even without a policy"
        );
    }

    #[test]
    fn flag_matching_the_declared_host_exactly_is_honoured() {
        let decl = declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken));
        assert!(refuse_unguarded_nonloopback_bind("100.64.0.1", true, Some(&decl)).is_ok());
    }

    #[test]
    fn flag_pointing_at_a_different_host_than_declared_is_refused() {
        // THE S5 mutation guard: a flag may match the declaration or narrow it, never
        // point somewhere ELSE — even another single, specific, non-loopback address.
        let decl = declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken));
        let err = refuse_unguarded_nonloopback_bind("192.168.1.5", true, Some(&decl))
            .expect_err("a flag pointing at an undeclared address must be refused");
        assert!(err.contains("100.64.0.1"), "must name the declared ceiling: {err}");
    }

    #[test]
    fn flag_widening_a_specific_host_declaration_to_every_interface_is_refused() {
        // THE S5 mutation guard, the sharper form: `0.0.0.0` is not "one more specific
        // address" — it is EVERY interface, strictly wider than any declared `host:<ip>`.
        let decl = declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken));
        assert!(refuse_unguarded_nonloopback_bind("0.0.0.0", true, Some(&decl)).is_err());
    }

    #[test]
    fn declared_host_bracketed_ipv6_matches_unbracketed_flag_value() {
        let decl = declare_host("2001:db8::1", Some(SurfaceGate::DeviceToken));
        assert!(refuse_unguarded_nonloopback_bind("[2001:db8::1]", true, Some(&decl)).is_ok());
    }

    // ── resolve_sidecar_bind_host: Problem 1 — the declaration decides when the flag is
    // absent, an operator-present flag narrows ─────────────────────────────────────

    #[test]
    fn resolve_sidecar_absent_flag_with_a_declared_host_binds_the_declared_host() {
        // THE mutation guard for Problem 1. Before this fix, main.rs's `--http-host`
        // had `default_value = "127.0.0.1"`, so the flag ALWAYS carried a value, and a
        // present value ALWAYS narrows (S5) — so a `surfaces.sidecar-http` declaring
        // `host:<ip>` could NEVER take effect: the resolved host would always come out
        // "127.0.0.1", never "100.64.0.1", no matter what was declared. If this
        // function regresses to that shape (e.g. `flag.unwrap_or("127.0.0.1")` with no
        // declaration fallback), this assertion fails: it demands the declared host,
        // not loopback.
        let decl = declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken));
        let resolved = resolve_sidecar_bind_host(None, true, Some(&decl))
            .expect("an absent flag + a matching declared+gated host must resolve, not refuse");
        assert_eq!(resolved, "100.64.0.1");
    }

    #[test]
    fn resolve_sidecar_absent_flag_with_no_declaration_defaults_to_loopback() {
        let resolved = resolve_sidecar_bind_host(None, false, None)
            .expect("undeclared + absent flag must default, not refuse");
        assert_eq!(resolved, "127.0.0.1");
    }

    #[test]
    fn resolve_sidecar_absent_flag_with_a_loopback_declaration_defaults_to_loopback() {
        let resolved = resolve_sidecar_bind_host(None, false, Some(&declare_loopback()))
            .expect("a loopback declaration + absent flag must default, not refuse");
        assert_eq!(resolved, "127.0.0.1");
    }

    #[test]
    fn resolve_sidecar_present_loopback_flag_narrows_a_host_declaration_and_is_allowed() {
        let decl = declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken));
        let resolved = resolve_sidecar_bind_host(Some("127.0.0.1"), false, Some(&decl))
            .expect("loopback narrows any declared ceiling, even without a policy");
        assert_eq!(resolved, "127.0.0.1");
    }

    #[test]
    fn resolve_sidecar_present_flag_wider_than_the_declaration_is_refused() {
        let decl = declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken));
        let err = resolve_sidecar_bind_host(Some("0.0.0.0"), true, Some(&decl))
            .expect_err("a flag wider than the declared ceiling must be refused");
        assert!(err.contains("100.64.0.1"), "must name the declared ceiling: {err}");
    }

    #[test]
    fn resolve_sidecar_present_flag_matching_the_declared_host_is_allowed() {
        let decl = declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken));
        let resolved = resolve_sidecar_bind_host(Some("100.64.0.1"), true, Some(&decl))
            .expect("a flag exactly matching the declaration must resolve, not refuse");
        assert_eq!(resolved, "100.64.0.1");
    }

    // ── WS guard: unconditional, no declaration or policy value flips it ────────────

    #[test]
    fn ws_loopback_hosts_are_allowed() {
        for host in ["127.0.0.1", "127.5.5.5", "::1", "[::1]", "localhost", "LOCALHOST"] {
            assert!(
                refuse_nonloopback_ws_bind(host).is_ok(),
                "{host} must be recognized as loopback for the WS bind"
            );
        }
    }

    #[test]
    fn ws_nonloopback_is_refused_even_with_a_policy_configured() {
        // THE point of this guard. `refuse_unguarded_nonloopback_bind` says Ok to a
        // MATCHING declared tailnet IP — correct for HTTP, where a policy installs auth
        // middleware. The WS has no middleware, so nothing unlocks the bind.
        assert!(refuse_nonloopback_ws_bind("100.64.0.1").is_err());
    }

    #[test]
    fn ws_unspecified_and_mapped_families_are_refused() {
        for host in ["0.0.0.0", "::", "[::]", "::ffff:0.0.0.0", "::ffff:127.0.0.1"] {
            assert!(
                refuse_nonloopback_ws_bind(host).is_err(),
                "{host} must be refused for the WS bind"
            );
        }
    }

    #[test]
    fn ws_unparseable_host_fails_closed() {
        assert!(refuse_nonloopback_ws_bind("not-an-ip-or-localhost").is_err());
        assert!(refuse_nonloopback_ws_bind("some.hostname").is_err());
    }

    #[test]
    fn ws_refusal_says_the_gate_is_not_implemented_rather_than_naming_a_policy_fix() {
        let err = refuse_nonloopback_ws_bind("0.0.0.0")
            .expect_err("0.0.0.0 must be refused for the WS bind");
        assert!(err.contains("not implemented"), "must say the gate is missing: {err}");
        assert!(err.contains("ADR-093"), "must point at the tracking ADR: {err}");
        // Must NOT tell the operator to set a policy — that would be a lie here: a
        // policy does not gate this socket and will not lift this refusal.
        assert!(
            !err.contains("refarm auth enroll"),
            "must not offer a fix that does not work for the WS: {err}"
        );
    }

    // ── resolve_ws_bind_host: absent flag ⇒ loopback; present ⇒ unconditional refusal ──

    #[test]
    fn resolve_ws_absent_flag_defaults_to_loopback() {
        assert_eq!(resolve_ws_bind_host(None).unwrap(), "127.0.0.1");
    }

    #[test]
    fn resolve_ws_present_loopback_flag_is_allowed() {
        assert_eq!(resolve_ws_bind_host(Some("127.0.0.1")).unwrap(), "127.0.0.1");
    }

    #[test]
    fn resolve_ws_present_nonloopback_flag_is_refused_regardless_of_declaration_or_policy() {
        // `resolve_ws_bind_host` takes no `declared`/policy argument at all — WS's
        // `surfaces.daemon-ws` can only ever legally declare `"loopback"` (enforced at
        // config load, see the module doc), so a non-loopback WS bind stays refused
        // unconditionally, same as `refuse_nonloopback_ws_bind` always has.
        assert!(resolve_ws_bind_host(Some("100.64.0.1")).is_err());
        assert!(resolve_ws_bind_host(Some("0.0.0.0")).is_err());
    }
}
