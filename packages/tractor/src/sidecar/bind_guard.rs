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
//! `refuse_unguarded_nonloopback_bind` (the HTTP sidecar's guard) and
//! `refuse_unguarded_nonloopback_ws_bind` (the WS guard, below) BOTH enforce S3: a
//! non-loopback declaration must name a gate the surface can enforce (`device-token`), AND
//! that gate must actually be RESOLVABLE right now (`auth_policy_resolvable`) — a gate with
//! no policy behind it at all enforces nothing and must not be mistaken for one that does.
//!
//! "Resolvable" — not "a `REFARM_AUTH_POLICY` env var is set", which is what this used to
//! mean. `sidecar::auth::resolve_policy_path` derives the policy path from the DECLARATION
//! (`<refarm-dir>/auth-policy.json`) when no env override is given, so declaring the gate is
//! itself enough to resolve one; and a resolvable-but-absent policy is `deny_all`, i.e. the
//! strictest possible enforcement of the declared gate, not an ungated bind. Note this
//! combination — bound, and denying everything — is not new: an env var pointing at a
//! nonexistent file has always produced exactly it (`Some(deny_all)` + a "present" peek).
//! What changed is that the operator no longer has to name the path by hand to get there.
//!
//! Until ADR-093 shipped, `refuse_nonloopback_ws_bind` (this function's former name and
//! shape) took no declaration at all and refused every non-loopback host unconditionally:
//! `daemon-ws` had NO middleware whatsoever, so a configured policy could never gate what it
//! bound, and `surfaces_decl::parse_one_surface` refused any non-loopback `daemon-ws`
//! declaration AT LOAD for the same reason. Now that `daemon::ws_server`'s
//! `Sec-WebSocket-Protocol` handshake (ADR-093) actually authenticates every connection
//! against the SAME `sidecar::auth::AuthPolicy` the sidecar uses, `daemon-ws` can enforce
//! `device-token` exactly like `sidecar-http` — so its guard is now the SAME declaration-
//! aware shape, not a bespoke unconditional refusal.
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
///   binds loopback only; a resolvable `auth_policy_resolvable` does NOT change this anymore.
/// - non-loopback + a declaration whose `expose` is `"loopback"` ⇒ `Err` (S5) — the flag is
///   trying to widen past the declared ceiling.
/// - non-loopback + a declaration whose `expose` is `host:<ip>` that does NOT match `host`
///   ⇒ `Err` (S5) — the flag points somewhere else (or wider) than what was declared; the
///   declaration is authoritative for WHICH address, not just whether non-loopback is legal.
/// - non-loopback + a matching `host:<ip>` declaration ⇒ `Ok` only if the declared `gate` is
///   `device-token` AND `auth_policy_resolvable` (S3) — a declared gate with no policy behind
///   it enforces nothing and must not be mistaken for one that does. In practice declaring
///   the gate is what MAKES a policy resolvable (`sidecar::auth::resolve_policy_path`), so
///   this arm is now defence in depth rather than a state the operator can be stuck in.
pub(crate) fn refuse_unguarded_nonloopback_bind(
    host: &str,
    auth_policy_resolvable: bool,
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
             }}\nthen mint a per-device credential with `refarm auth enroll`. The declared \
             gate derives the policy path from the daemon's refarm dir, so no \
             REFARM_AUTH_POLICY export is needed — that env only OVERRIDES the path."
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
        Some(SurfaceGate::DeviceToken) if auth_policy_resolvable => Ok(()),
        Some(SurfaceGate::DeviceToken) => Err(format!(
            "refusing to bind the sidecar to {host:?}: surfaces.sidecar-http declares \
             \"gate\": \"device-token\" but no auth policy is resolvable, so nothing would \
             actually enforce it. Mint a per-device credential with `refarm auth enroll` — \
             the daemon derives the policy path from the refarm dir it was given; \
             REFARM_AUTH_POLICY only overrides that path."
        )),
        None => Err(format!(
            "refusing to bind the sidecar to {host:?}: surfaces.sidecar-http declares a \
             non-loopback expose with no gate. Declare \"gate\": \"device-token\" to bind \
             beyond loopback."
        )),
    }
}

/// Refuse to start the WS daemon when `host` is NOT loopback and the `surfaces.daemon-ws`
/// declaration does not permit it. PURE: never binds a socket, never resolves DNS. The WS
/// mirror of `refuse_unguarded_nonloopback_bind` — see that function's doc for the shared
/// shape (S1/S5); this one differs only in which surface/messages it names, and in what
/// `auth_policy_resolvable` actually gates: `daemon::ws_server`'s `accept_hdr_async` callback
/// (ADR-093), authenticating the `Sec-WebSocket-Protocol` handshake against the SAME
/// `sidecar::auth::AuthPolicy` the sidecar's HTTP middleware uses — not the sidecar's HTTP
/// requests. A resolvable policy here means the WS gate is ACTUALLY live, not merely that some
/// unrelated surface happens to have one configured.
///
/// - loopback ⇒ always `Ok`.
/// - non-loopback + no declaration ⇒ `Err` (S1) — an undeclared surface binds loopback
///   only; a resolvable policy does not widen this.
/// - non-loopback + a `"loopback"` declaration ⇒ `Err` (S5) — the flag would widen past
///   the declared ceiling.
/// - non-loopback + a `host:<ip>` declaration that does not match `host` ⇒ `Err` (S5).
/// - non-loopback + a matching `host:<ip>` declaration ⇒ `Ok` only if the declared `gate`
///   is `device-token` AND `auth_policy_resolvable` (S3) — a declared gate the handshake has
///   no policy to check against enforces nothing.
pub(crate) fn refuse_unguarded_nonloopback_ws_bind(
    host: &str,
    auth_policy_resolvable: bool,
    declared: Option<&SurfaceDeclaration>,
) -> Result<(), String> {
    if is_loopback_host(host) {
        return Ok(());
    }

    let Some(decl) = declared else {
        return Err(format!(
            "refusing to bind the agent/CRDT WebSocket to non-loopback host {host:?}: no \
             `surfaces.daemon-ws` declaration is present in .refarm/config.json, and an \
             undeclared surface binds loopback only. Declare it first:\n  \"surfaces\": {{ \
             \"daemon-ws\": {{ \"expose\": \"host:{host}\", \"gate\": \"device-token\" }} \
             }}\nthen mint a per-device credential with `refarm auth enroll`. The declared \
             gate derives the policy path from the daemon's refarm dir, so no \
             REFARM_AUTH_POLICY export is needed — that env only OVERRIDES the path."
        ));
    };

    let SurfaceExpose::Host(declared_ip) = &decl.expose else {
        return Err(format!(
            "refusing to bind the agent/CRDT WebSocket to non-loopback host {host:?}: \
             surfaces.daemon-ws declares \"expose\": \"loopback\" — a flag may narrow that \
             declaration, never widen it. Widen the declaration in .refarm/config.json first."
        ));
    };

    if !hosts_match(host, declared_ip) {
        return Err(format!(
            "refusing to bind the agent/CRDT WebSocket to {host:?}: surfaces.daemon-ws \
             declares \"expose\": \"host:{declared_ip}\" — a flag may only match that \
             declaration or narrow it to loopback, never point somewhere else or wider."
        ));
    }

    match decl.gate {
        Some(SurfaceGate::DeviceToken) if auth_policy_resolvable => Ok(()),
        Some(SurfaceGate::DeviceToken) => Err(format!(
            "refusing to bind the agent/CRDT WebSocket to {host:?}: surfaces.daemon-ws \
             declares \"gate\": \"device-token\" but no auth policy is resolvable, so the \
             Sec-WebSocket-Protocol handshake (ADR-093) has nothing to authenticate \
             against. Mint a per-device credential with `refarm auth enroll` — the daemon \
             derives the policy path from the refarm dir it was given; REFARM_AUTH_POLICY \
             only overrides that path."
        )),
        None => Err(format!(
            "refusing to bind the agent/CRDT WebSocket to {host:?}: surfaces.daemon-ws \
             declares a non-loopback expose with no gate. Declare \"gate\": \"device-token\" \
             to bind beyond loopback."
        )),
    }
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
    auth_policy_resolvable: bool,
    declared: Option<&SurfaceDeclaration>,
) -> Result<String, String> {
    let requested = resolve_declared_bind_host(flag, declared);
    refuse_unguarded_nonloopback_bind(&requested, auth_policy_resolvable, declared)?;
    Ok(requested)
}

/// Shared by `resolve_sidecar_bind_host` and `resolve_ws_bind_host`: an absent flag
/// resolves to whatever `host:<ip>` the declaration names (loopback if it declares
/// `"loopback"` or is absent entirely — S1); a present flag is the operator's own value,
/// validated by the caller's guard immediately after. PURE: no socket, no I/O, no DNS.
fn resolve_declared_bind_host(flag: Option<&str>, declared: Option<&SurfaceDeclaration>) -> String {
    match flag {
        Some(v) => v.to_string(),
        None => match declared.map(|decl| &decl.expose) {
            Some(SurfaceExpose::Host(ip)) => ip.clone(),
            // `Tailnet` reaching a PURE function is a defensive fallback, not an expected
            // path: `sidecar::tailnet_resolve::resolve_declared_expose_for_bind` ALWAYS
            // rewrites a `Tailnet` declaration to `Host(<resolved ip>)` (or refuses,
            // before this function is ever called) whenever the flag is absent — the
            // exact condition this `None =>` arm is under. Folded into the SAME fallback
            // as `Loopback`/no-declaration rather than given its own branch: if this
            // invariant is ever violated by a future caller, failing toward loopback is
            // the fail-CLOSED direction (S1), never a silent widen.
            Some(SurfaceExpose::Loopback) | Some(SurfaceExpose::Tailnet) | None => {
                "127.0.0.1".to_string()
            }
        },
    }
}

/// Resolve the ACTUAL WS bind host from the operator's `--ws-host` flag (if any) and the
/// `surfaces.daemon-ws` declaration, then validate the result. Since ADR-093, this is
/// exactly `resolve_sidecar_bind_host`'s shape applied to the WS guard — an absent flag
/// lets a `host:<ip>` declaration decide (S1 default: loopback), a present flag narrows or
/// asserts, validated against the declared ceiling and `auth_policy_resolvable` (S3/S5) by
/// `refuse_unguarded_nonloopback_ws_bind`. PURE: no socket, no I/O, no DNS.
pub(crate) fn resolve_ws_bind_host(
    flag: Option<&str>,
    auth_policy_resolvable: bool,
    declared: Option<&SurfaceDeclaration>,
) -> Result<String, String> {
    let requested = resolve_declared_bind_host(flag, declared);
    refuse_unguarded_nonloopback_ws_bind(&requested, auth_policy_resolvable, declared)?;
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
///
/// `pub(crate)`, not private: `sidecar::tailnet_resolve::resolve_declared_expose_for_bind`
/// reuses this EXACT check (rather than re-deriving its own) to decide whether a
/// `--http-host`/`--ws-host` flag is already loopback-shaped and can therefore skip
/// resolving `tailnet` entirely — one source of truth for the IPv4-mapped/unspecified
/// edge cases this function's own doc already warns are easy to get subtly wrong twice.
pub(crate) fn is_loopback_host(host: &str) -> bool {
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
        // whether a policy happens to be resolvable — the declaration itself never
        // claimed anything would enforce this bind. Since a DECLARED gate is now what
        // derives the policy path, this is the case that actually reaches an operator:
        // they exposed a host and forgot the gate, and the refusal must name the fix.
        let decl = declare_host("100.64.0.1", None);
        for resolvable in [false, true] {
            let err = refuse_unguarded_nonloopback_bind("100.64.0.1", resolvable, Some(&decl))
                .expect_err("a non-loopback declaration with no gate must be refused");
            assert!(err.contains("no gate"), "must say what is missing: {err}");
            assert!(
                err.contains("\"gate\": \"device-token\""),
                "must name the fix verbatim: {err}"
            );
        }
    }

    #[test]
    fn every_loopback_bind_is_unchanged_across_every_combination() {
        // Loopback is inside every ceiling, always — declared or not, gated or not,
        // policy resolvable or not. Pinned as an exhaustive matrix because the
        // declaration-derived policy changed WHEN `auth_policy_resolvable` is true, and
        // the one thing that must not move with it is the loopback default every local
        // tool (`127.0.0.1:42001`) depends on.
        let declarations = [
            None,
            Some(declare_loopback()),
            Some(declare_host("100.64.0.1", None)),
            Some(declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken))),
        ];
        for decl in &declarations {
            for resolvable in [false, true] {
                for host in ["127.0.0.1", "127.5.5.5", "::1", "[::1]", "localhost", "LOCALHOST"] {
                    assert!(
                        refuse_unguarded_nonloopback_bind(host, resolvable, decl.as_ref()).is_ok(),
                        "sidecar {host} must stay permitted (resolvable={resolvable}, decl={decl:?})"
                    );
                    assert!(
                        refuse_unguarded_nonloopback_ws_bind(host, resolvable, decl.as_ref())
                            .is_ok(),
                        "ws {host} must stay permitted (resolvable={resolvable}, decl={decl:?})"
                    );
                }
            }
        }
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

    // ── WS guard: since ADR-093, declaration-aware exactly like the sidecar's ──────────

    #[test]
    fn ws_loopback_hosts_are_allowed_regardless_of_policy_or_declaration() {
        for host in ["127.0.0.1", "127.5.5.5", "::1", "[::1]", "localhost", "LOCALHOST"] {
            assert!(
                refuse_unguarded_nonloopback_ws_bind(host, false, None).is_ok(),
                "{host} must be recognized as loopback for the WS bind"
            );
        }
    }

    #[test]
    fn ws_unspecified_and_mapped_families_are_refused() {
        for host in ["0.0.0.0", "::", "[::]", "::ffff:0.0.0.0", "::ffff:127.0.0.1"] {
            assert!(
                refuse_unguarded_nonloopback_ws_bind(host, true, None).is_err(),
                "{host} must be refused for the WS bind"
            );
        }
    }

    #[test]
    fn ws_unparseable_host_fails_closed() {
        assert!(refuse_unguarded_nonloopback_ws_bind("not-an-ip-or-localhost", true, None).is_err());
        assert!(refuse_unguarded_nonloopback_ws_bind("some.hostname", true, None).is_err());
    }

    // ── S1 mutation-verify: undeclared means closed, a policy does NOT widen it ─────

    #[test]
    fn ws_undeclared_nonloopback_with_no_policy_is_refused_and_names_the_declaration() {
        let err = refuse_unguarded_nonloopback_ws_bind("0.0.0.0", false, None)
            .expect_err("0.0.0.0 with no declaration must be refused");
        assert!(err.contains("surfaces"), "must name the declaration: {err}");
        assert!(err.contains("daemon-ws"), "must name the surface: {err}");
    }

    #[test]
    fn ws_undeclared_nonloopback_with_a_policy_present_is_still_refused() {
        // THE S1 mutation guard for the WS guard specifically: a configured policy alone
        // must not widen an UNDECLARED daemon-ws bind — silence outranks a policy/flag.
        assert!(refuse_unguarded_nonloopback_ws_bind("100.64.0.1", true, None).is_err());
    }

    // ── declared "loopback": a flag may narrow (trivially true), never widen ────────

    #[test]
    fn ws_declared_loopback_permits_a_loopback_bind() {
        assert!(
            refuse_unguarded_nonloopback_ws_bind("127.0.0.1", false, Some(&declare_loopback()))
                .is_ok()
        );
    }

    #[test]
    fn ws_declared_loopback_refuses_any_wider_flag() {
        let decl = declare_loopback();
        let err = refuse_unguarded_nonloopback_ws_bind("0.0.0.0", true, Some(&decl))
            .expect_err("a loopback declaration must not be widened by a flag");
        assert!(err.contains("loopback"), "must name the declared ceiling: {err}");
    }

    // ── declared "host:<ip>" — the declaration is authoritative for WHICH address ───

    #[test]
    fn ws_declared_host_with_gate_and_policy_present_is_allowed() {
        // THE ADR-093 mutation guard: before the handshake shipped, this exact input
        // (a matching declared host, gated, policy present) was refused UNCONDITIONALLY
        // — the WS had nothing to enforce the gate with. Now it must be allowed, same as
        // the sidecar's `declared_host_with_gate_and_policy_present_is_allowed`.
        let decl = declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken));
        assert!(refuse_unguarded_nonloopback_ws_bind("100.64.0.1", true, Some(&decl)).is_ok());
    }

    #[test]
    fn ws_declared_host_with_gate_but_no_policy_present_is_refused() {
        let decl = declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken));
        let err = refuse_unguarded_nonloopback_ws_bind("100.64.0.1", false, Some(&decl))
            .expect_err("a declared gate with no configured policy must be refused");
        assert!(err.contains("REFARM_AUTH_POLICY"), "must name the fix: {err}");
    }

    #[test]
    fn ws_declared_host_with_no_gate_is_refused_even_with_policy_present() {
        let decl = declare_host("100.64.0.1", None);
        for resolvable in [false, true] {
            let err = refuse_unguarded_nonloopback_ws_bind("100.64.0.1", resolvable, Some(&decl))
                .expect_err("a non-loopback declaration with no gate must be refused");
            assert!(
                err.contains("\"gate\": \"device-token\""),
                "must name the fix verbatim: {err}"
            );
        }
    }

    // ── S5 mutation-verify: narrowing is honoured, widening is refused ──────────────

    #[test]
    fn ws_flag_narrowing_a_host_declaration_to_loopback_is_honoured() {
        let decl = declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken));
        assert!(
            refuse_unguarded_nonloopback_ws_bind("127.0.0.1", false, Some(&decl)).is_ok(),
            "loopback is inside every declared ceiling, even without a policy"
        );
    }

    #[test]
    fn ws_flag_pointing_at_a_different_host_than_declared_is_refused() {
        let decl = declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken));
        let err = refuse_unguarded_nonloopback_ws_bind("192.168.1.5", true, Some(&decl))
            .expect_err("a flag pointing at an undeclared address must be refused");
        assert!(err.contains("100.64.0.1"), "must name the declared ceiling: {err}");
    }

    #[test]
    fn ws_flag_widening_a_specific_host_declaration_to_every_interface_is_refused() {
        let decl = declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken));
        assert!(refuse_unguarded_nonloopback_ws_bind("0.0.0.0", true, Some(&decl)).is_err());
    }

    // ── resolve_ws_bind_host: absent flag ⇒ the declaration decides (S1 default:
    // loopback); present flag narrows/asserts, validated exactly as the guard above ──

    #[test]
    fn resolve_ws_absent_flag_with_no_declaration_defaults_to_loopback() {
        let resolved = resolve_ws_bind_host(None, false, None)
            .expect("undeclared + absent flag must default, not refuse");
        assert_eq!(resolved, "127.0.0.1");
    }

    #[test]
    fn resolve_ws_absent_flag_with_a_declared_host_binds_the_declared_host() {
        // THE ADR-093 mutation guard for `resolve_ws_bind_host`: before the handshake
        // shipped this function ignored `declared` entirely (`flag.unwrap_or(loopback)`),
        // so a `surfaces.daemon-ws` declaring `host:<ip>` could never take effect — same
        // Problem-1 shape `resolve_sidecar_bind_host` was fixed for.
        let decl = declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken));
        let resolved = resolve_ws_bind_host(None, true, Some(&decl))
            .expect("an absent flag + a matching declared+gated host must resolve, not refuse");
        assert_eq!(resolved, "100.64.0.1");
    }

    #[test]
    fn resolve_ws_present_loopback_flag_is_allowed() {
        assert_eq!(resolve_ws_bind_host(Some("127.0.0.1"), false, None).unwrap(), "127.0.0.1");
    }

    #[test]
    fn resolve_ws_present_nonloopback_flag_with_no_declaration_is_refused() {
        assert!(resolve_ws_bind_host(Some("100.64.0.1"), true, None).is_err());
        assert!(resolve_ws_bind_host(Some("0.0.0.0"), true, None).is_err());
    }

    #[test]
    fn resolve_ws_present_flag_matching_a_declared_gated_host_with_policy_is_allowed() {
        let decl = declare_host("100.64.0.1", Some(SurfaceGate::DeviceToken));
        let resolved = resolve_ws_bind_host(Some("100.64.0.1"), true, Some(&decl))
            .expect("a flag exactly matching a declared+gated+policy-present host resolves");
        assert_eq!(resolved, "100.64.0.1");
    }
}
