//! Fail-closed bind guard for the runtime sidecar.
//!
//! `sidecar::start` binds an HTTP listener to an operator-chosen `(host, port)`. The
//! default — `127.0.0.1` — is loopback, so no other device on the network can reach it,
//! policy or not. The moment the operator points the bind at anything else (a tailnet
//! IP, `0.0.0.0`, a hostname), the listener becomes reachable from OUTSIDE this machine,
//! and routes like `POST /connections/:name/up` establish real processes. Without the
//! opt-in auth gate (`auth::auth_config_from_env`), that is an unauthenticated listener
//! that can run things — on this machine, potentially on a corporate network.
//!
//! `auth.rs` already carries this instinct one level down: "policy present but
//! unreadable ⇒ deny-all — if you asked for auth, a broken policy must lock the door,
//! not leave it open." This module extends the same doctrine one layer OUT, to the bind
//! itself: no policy at all + a bind that reaches beyond loopback must also lock the
//! door, rather than trust operator discipline to always remember `127.0.0.1`.
//!
//! The decision is a PURE function of `(host, policy_present)` — no socket, no I/O, no
//! DNS — so it is exhaustively unit-tested without ever binding a port.

use std::net::IpAddr;

/// Refuse to start the sidecar when `host` is NOT loopback and no auth policy is
/// configured. PURE: never binds a socket, never resolves DNS.
///
/// - loopback (`127.0.0.0/8`, `::1`, the literal `localhost`) ⇒ always `Ok`, policy or
///   not. This is the sidecar's default (`127.0.0.1`) and its behavior is UNCHANGED by
///   this guard.
/// - non-loopback + a policy configured ⇒ `Ok` — the operator opted into the identity
///   gate before opening the bind beyond loopback.
/// - non-loopback + no policy ⇒ `Err` naming the fix, not just the refusal.
pub(crate) fn refuse_unguarded_nonloopback_bind(
    host: &str,
    auth_policy_present: bool,
) -> Result<(), String> {
    if auth_policy_present || is_loopback_host(host) {
        return Ok(());
    }
    Err(format!(
        "refusing to bind the sidecar to non-loopback host {host:?} with no auth policy \
         configured — an unauthenticated listener here can establish real processes \
         (e.g. POST /connections/:name/up). Mint a per-device credential with \
         `refarm auth enroll`, then set REFARM_AUTH_POLICY to the resulting policy file \
         before binding beyond loopback."
    ))
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
    // spelling that ever binds successfully. Strip a surrounding `[...]` before parsing
    // so that form is recognized as loopback.
    //
    // This stripping is SYNTAX ONLY — it removes bracket characters, never touches the
    // address's bits or family — and it happens unconditionally before the parse, for
    // every host, loopback or not. Do NOT extend this into address *canonicalization*
    // (e.g. folding an IPv4-mapped IPv6 address down to its embedded IPv4 form) to
    // "simplify" the checks below: `Ipv6Addr::is_unspecified()` is `false` for the
    // IPv4-mapped `::ffff:0.0.0.0`, so canonicalizing mapped addresses before the
    // unspecified check would make that address parse as plain `0.0.0.0` and get
    // caught by accident rather than by policy — and the mirror mistake, folding
    // `::ffff:127.0.0.1` down to `127.0.0.1`, would make `ip.is_loopback()` return
    // `true` and silently ALLOW an unauthenticated all-interfaces-reachable bind
    // through the mapped-address family. `::ffff:0.0.0.0` and `::ffff:127.0.0.1` (and
    // the rest of `::ffff:0.0.0.0/96`) must both stay refused exactly as they are
    // today: not loopback, no special-casing.
    let unbracketed = host
        .strip_prefix('[')
        .and_then(|rest| rest.strip_suffix(']'))
        .unwrap_or(host);
    let Ok(ip) = unbracketed.parse::<IpAddr>() else {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_v4_starts_regardless_of_policy() {
        assert!(refuse_unguarded_nonloopback_bind("127.0.0.1", false).is_ok());
        assert!(refuse_unguarded_nonloopback_bind("127.0.0.1", true).is_ok());
    }

    #[test]
    fn loopback_v4_range_starts_without_policy() {
        // The whole 127.0.0.0/8 range is loopback, not just 127.0.0.1.
        assert!(refuse_unguarded_nonloopback_bind("127.5.5.5", false).is_ok());
    }

    #[test]
    fn loopback_v6_starts_without_policy() {
        assert!(refuse_unguarded_nonloopback_bind("::1", false).is_ok());
    }

    #[test]
    fn bracketed_loopback_v6_starts_without_policy() {
        // `[::1]` is the ONLY IPv6-loopback spelling that ever binds successfully
        // through `format!("{host}:{port}")` (bare `::1` yields the unparseable
        // `::1:8080`), so this is the shape operators/config actually use. It must be
        // recognized as loopback, same as `::1` and `127.0.0.1`.
        assert!(refuse_unguarded_nonloopback_bind("[::1]", false).is_ok());
    }

    #[test]
    fn bracketed_unspecified_v6_with_no_policy_is_refused() {
        // `[::]` — the bracketed, actually-bindable spelling of "every IPv6 interface"
        // — must stay refused exactly like `::` and `0.0.0.0`. Bracket-stripping is
        // syntax only; it must not accidentally launder the unspecified address through.
        assert!(refuse_unguarded_nonloopback_bind("[::]", false).is_err());
    }

    #[test]
    fn ipv4_mapped_loopback_v6_stays_refused() {
        // `::ffff:127.0.0.1` is the IPv4-mapped spelling of loopback, but
        // `Ipv6Addr::is_loopback()` only matches the literal `::1` — it does not
        // special-case the mapped family. This guard must never canonicalize a mapped
        // address down to its embedded IPv4 form before checking (see the comment on
        // `is_loopback_host`), or this would flip to `Ok` and silently allow an
        // all-interfaces-reachable bind through the back door.
        assert!(refuse_unguarded_nonloopback_bind("::ffff:127.0.0.1", false).is_err());
    }

    #[test]
    fn ipv4_mapped_unspecified_v6_stays_refused() {
        // `::ffff:0.0.0.0` is the IPv4-mapped "every interface" address.
        // `Ipv6Addr::is_unspecified()` is `false` for it (unlike bare `0.0.0.0`), so if
        // this guard ever canonicalized mapped addresses before the unspecified check,
        // this one would slip past that check too. It doesn't need the check: mapped
        // addresses are never loopback here, so it stays refused regardless.
        assert!(refuse_unguarded_nonloopback_bind("::ffff:0.0.0.0", false).is_err());
    }

    #[test]
    fn localhost_literal_starts_without_policy() {
        assert!(refuse_unguarded_nonloopback_bind("localhost", false).is_ok());
        assert!(refuse_unguarded_nonloopback_bind("LOCALHOST", false).is_ok());
    }

    #[test]
    fn unspecified_v4_with_no_policy_is_refused_and_names_the_fix() {
        let err = refuse_unguarded_nonloopback_bind("0.0.0.0", false)
            .expect_err("0.0.0.0 with no policy must be refused");
        assert!(err.contains("refarm auth enroll"), "must name the enroll command: {err}");
        assert!(err.contains("REFARM_AUTH_POLICY"), "must name the env var: {err}");
    }

    #[test]
    fn unspecified_v6_with_no_policy_is_refused() {
        assert!(refuse_unguarded_nonloopback_bind("::", false).is_err());
    }

    #[test]
    fn tailnet_shaped_address_with_no_policy_is_refused() {
        assert!(refuse_unguarded_nonloopback_bind("100.64.0.1", false).is_err());
    }

    #[test]
    fn tailnet_shaped_address_with_a_policy_present_is_allowed() {
        assert!(refuse_unguarded_nonloopback_bind("100.64.0.1", true).is_ok());
    }

    #[test]
    fn unparseable_host_with_no_policy_is_refused() {
        assert!(refuse_unguarded_nonloopback_bind("not-an-ip-or-localhost", false).is_err());
    }

    #[test]
    fn unparseable_host_with_a_policy_present_is_allowed() {
        // A policy is a blanket permission for non-loopback binds regardless of host
        // shape — this guard's job is to refuse the UNGUARDED case, not validate hosts.
        assert!(refuse_unguarded_nonloopback_bind("some.hostname", true).is_ok());
    }
}
