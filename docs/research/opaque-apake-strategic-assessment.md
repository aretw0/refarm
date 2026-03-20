# OPAQUE aPAKE — Strategic Assessment for the Refarm Ecosystem

**Date**: 2026-03-20
**Status**: Research — Informing v0.2.0+ Identity Architecture
**Authors**: Refarm Team

---

## What Is OPAQUE?

OPAQUE (Oblivious Pseudo-Random Function-based Augmented Password-Authenticated Key
Exchange) is an **aPAKE** protocol that solves the most critical weakness in
password-based authentication: **the server never sees the password — not even during
registration.**

This is categorically different from state-of-the-art password hashing (bcrypt,
Argon2id, scrypt). Those schemes still require the server to receive the plaintext
password during login to verify it against the stored hash. If the database leaks,
an offline dictionary attack becomes possible. OPAQUE eliminates that entire class of
attack.

### Protocol Summary

**Registration flow:**

```
Client (browser/CLI)                    Server (refarm.social / recovery relay)
  │
  ├─ [r = H(pwd) × random_blind] ──────────────────────────────────────────▶ │
  │                                                                            │
  │                                        OPRF(r, server_key) ─────────────▶ │
  │ ◀───────────────────────────────────── [OPRF_response] ──────────────────┤
  │
  ├─ rwd  = H(pwd, OPRF_response)
  ├─ generate ephemeral keypair (pkU, skU)
  ├─ envelope = Encrypt(rwd, skU)
  ├─ send (pkU, envelope) ──────────────────────────────────────────────────▶ │
  │                                                                            │
  │                                  store(pkU, envelope, pkS) ─────────────▶ │
```

**Authentication flow:**

```
Client                                  Server
  │
  ├─ [blinded_pwd] ────────────────────────────────────────────────────────▶ │
  │ ◀────────────────────────────────── [OPRF_response, envelope] ──────────┤
  │
  ├─ rwd  = H(pwd, OPRF_response)
  ├─ skU  = Decrypt(rwd, envelope)
  ├─ AKE  (SIGMA / 3DH)  ─────────────────────────────────────────────────▶ │
  │ ◀───────────────────────────────── [AKE response] ──────────────────────┤
  │
  └─ session_key (shared) ──────────────────────────────────────────────────╗
                                                                             ║
                                        session_key (shared) ────────────────╝
```

**What the server never learns:**
- The password (no plaintext, no hash)
- `rwd` — the "ransomed working key" derived from password + OPRF
- `skU` — the user's private key (encrypted inside the envelope)

**What a database breach reveals to an attacker:**
- `(pkU, envelope, pkS)` — completely useless without knowing `pwd`
- No offline dictionary attack is possible (unlike bcrypt/Argon2id breaches)

### Protocol Status (as of 2026-03)

| Component       | Standard             | Status                              |
|-----------------|----------------------|-------------------------------------|
| OPRF primitive  | RFC 9497             | ✅ Published                        |
| OPAQUE protocol | draft-irtf-cfrg-opaque | 🔄 In final RFC candidature       |
| Rust crate      | `opaque-ke`          | ✅ Well-maintained, formal audit    |
| JS/WASM         | `opaque-wasm`        | ⚠️ Exists but less mature          |

---

## Ecosystem Mapping: Where OPAQUE Fits in Refarm

### 1. Recovery Service (ADR-032) — High Relevance ⭐⭐⭐

**The problem:** ADR-032 defines pluggable recovery (`recovery-plugin-codes`,
`recovery-plugin-social`, `recovery-plugin-hw`). Any strategy involving a remote
relay to escrow or verify recovery material needs an authentication protocol for
that relay endpoint.

**Why OPAQUE is the right fit:** The recovery scenario is exactly the threat model
OPAQUE was designed for. A user who lost their device is in a high-stress state,
using a memorised password, connecting to a server that must authenticate them —
while that server must *never* be in a position to steal or replay that password.
Phishing attacks are most effective in this "lost device" moment.

**Integration path:** If `recovery-plugin-*` introduces any "vault of keys" endpoint
(even a Cloudflare Worker relay), OPAQUE is the natural authentication primitive.
The Rust `opaque-ke` crate integrates directly with the Tractor native binary.

**When:** v0.3.0+ — after ADR-032 moves from Proposed to Accepted.

---

### 2. refarm.social — High Relevance ⭐⭐⭐

**The problem:** refarm.social is a real server hosting federated communities. Some
users — especially non-technical ones — will need a password-based identity fallback
alongside Nostr keypair identity.

**Why OPAQUE is the right fit:** Most federated social platforms still use
bcrypt/scrypt. Being the first federated social platform with OPAQUE-native
authentication is a *concrete* security differentiation, not just marketing copy.
Refarm's sovereignty narrative already exists; OPAQUE is the cryptographic proof at
the authentication layer.

**Integration path:** OPAQUE as an `identity-opaque-v1` adapter alongside the
existing `identity-nostr` adapter. Users who arrive with keypairs continue to use
them directly. Users who arrive via password use OPAQUE to derive and protect their
keypair — they gain the same Ed25519 identity, via a different authentication path.

```
Nostr-native users:  keypair  ─────────────────────────────────────▶ identity-nostr
Password users:      password ─── OPAQUE ─── session_key ─── derive ─▶ identity-opaque-v1
                                                                          │
                                                                          ▼
                                                                   same Ed25519 key
```

**When:** v0.2.0+ — when refarm.social endpoints begin to exist.

---

### 3. Master Key Protection (Silo + Sentinel) — Medium Relevance ⭐⭐

**The problem:** When a user protects their Ed25519 master key with a password
(e.g. in the CLI `silo`), the current approach likely uses Argon2id for key
stretching. If `~/.refarm/identity.json` is stolen, an offline dictionary attack
on the derived key encryption is possible.

**Why OPAQUE applies (with nuance):** OPAQUE's OPRF can be used as a superior
key-stretching function because the OPRF blinding prevents precomputation — even
when the "server" is the local Farmhand daemon on port 42000.

```
User (shell) ────── [OPRF request] ──────────────────▶ Farmhand daemon
             ◀───── [OPRF response] ──────────────────
User derives rwd, decrypts master key
```

**The critical limitation:** If both `identity.json` and the Farmhand process live
on the same machine and the attacker has root access, `server_key` is accessible.
The benefit is real **only** when Farmhand runs in a separate security context.

**The unlock:** ADR-032's Sentinel WASM is the prerequisite. The Sentinel running as
an isolated WASM component (or in a TPM/HSM virtual context) is the environment
where the OPRF server key can be kept meaningfully separate from the encrypted
identity file. Until the Sentinel exists, Argon2id remains the correct choice.

**When:** v0.3.0+ — after the Sentinel WASM from ADR-032 is implemented.

---

### 4. Cloudflare Workers Relay (ADR-037) — Medium Relevance ⭐⭐

**The problem:** ADR-037's async mailbox/KV relay on Cloudflare Workers will need
to authenticate users who push and pull encrypted data. The current design plans
token-based authentication (JWT or Ed25519 challenge-response).

**Why OPAQUE may apply:** If the relay adds password-based emergency access (e.g.
"access without device"), OPAQUE is the correct protocol. Cloudflare Workers support
WASM — `opaque-ke` compiled to WASM would run on the Worker side.

**The counterpoint:** Ed25519 signature challenge-response (already planned) is
already stronger than any password scheme. OPAQUE is only relevant if the relay
*explicitly* decides to support password-based access as a fallback.

**When:** Depends on ADR-037 design decisions — not a priority until relay design
is finalized.

---

### 5. Plugin Registry Author Authentication — Low Relevance ⭐

**The problem:** Authenticating plugin authors who publish WASM plugins to
`@refarm.dev/registry`.

**Why OPAQUE doesn't fit well:** Plugin authors authenticate via OAuth (GitHub) or
Ed25519 signing — organizational identity patterns, not memorised-password patterns.
OPAQUE is optimised for individual end-users with memorised secrets.

**Recommendation:** NIP-07 browser extension signing or Ed25519 challenge-response.
OPAQUE would be over-engineering for this use case.

---

### 6. Farmhand ↔ Homestead Local Auth — Low Relevance ⭐

**The problem:** Homestead (browser IDE) connects to Farmhand (WebSocket on port
42000). Currently local-only with no authentication beyond same-machine trust.

**Why OPAQUE doesn't fit:** OPAQUE targets channels with an untrusted server. A
local connection to a daemon on the same machine is not that channel. A capability
token or self-signed certificate is sufficient.

**When it becomes relevant:** If Farmhand exposes endpoints over a network for
multi-user or enterprise deployments, then OPAQUE or mTLS would become viable.

---

## Mapping Summary

| Area                          | Relevance | Timeline    | Prerequisite                      |
|-------------------------------|-----------|-------------|-----------------------------------|
| Recovery Service (ADR-032)    | ⭐⭐⭐    | v0.3.0+     | Recovery plugin implemented       |
| refarm.social auth            | ⭐⭐⭐    | v0.2.0+     | Social layer with endpoints       |
| Master Key (Silo + Sentinel)  | ⭐⭐      | v0.3.0+     | Sentinel WASM (ADR-032)           |
| Cloudflare Workers Relay      | ⭐⭐      | ADR-037 TBD | Relay design decision             |
| Plugin Registry Auth          | ⭐        | Not priority | —                                |
| Farmhand local auth           | ⭐        | Not priority | Multi-user deployment             |

---

## What to Do Now (Pre-Implementation Groundwork)

### ✅ `world refarm-identity-plugin` Added in v0.1.0

Because `refarm:plugin@0.1.0` had not yet been published when this assessment was
written, there was no reason to defer the identity contract to a v0.2.0 bump. The
`interface identity-provider` and `world refarm-identity-plugin` were added to
`wit/refarm-sdk.wit` before the initial release (2026-03-20).

The contract is protocol-agnostic: `derive-from-session` receives session bytes and
returns an opaque handle — valid for OPAQUE, WebAuthn, or any future scheme.
The private key never leaves the WASM sandbox.

The v0.1.0 WIT now ships with:
- `world refarm-plugin` — base world for integration plugins (unchanged)
- `world refarm-identity-plugin` — extends `refarm-plugin` with `export identity-provider`

**Adapter implementations** (`identity-nostr`, `identity-opaque-v1`) remain v0.2.0+
work — they depend on refarm.social endpoints and the OPAQUE RFC finalising.

### Monitor the RFC

`draft-irtf-cfrg-opaque` is approaching final publication. Once it exits the IRTF
CFRG draft process and becomes an RFC:
- The API of `opaque-ke` (Rust) will stabilise around the RFC test vectors
- The timing for writing the adoption ADR becomes clear
- The `opaque-wasm` / JS side will likely mature significantly

Track: https://datatracker.ietf.org/doc/draft-irtf-cfrg-opaque/

### Low-Cost Spike (Before ADR-032 Work Starts)

When ADR-032 recovery work begins, run a 1-day spike in the `packages/tractor`
workspace to validate the integration path:

```bash
# In packages/tractor/
cargo add opaque-ke chacha20poly1305

# Implement OPAQUE server and client registration + authentication
# Target: a Rust test that registers a "user" with the Tractor native binary
# and authenticates back, extracting an OPAQUE session key

cargo test -- opaque_spike
```

This validates that `opaque-ke` integrates cleanly before any design is committed
to production interfaces.

---

## Why This Matters for Refarm's Identity Narrative

Refarm already carries the narrative of **data sovereignty**. OPAQUE would be the
cryptographic proof at the authentication layer — especially on refarm.social, where
users would see:

> "Not even we know your password. Mathematically guaranteed."

This is a concrete differentiator in a market where even well-intentioned platforms
use bcrypt/scrypt (still vulnerable to offline dictionary attacks after a database
breach). The sovereignty claim extends from the data layer down to the identity
layer.

The highest risk of **not** investigating OPAQUE now is painful retrofit: retrofitting
an authentication protocol after real users exist on refarm.social is a migration
project with downtime, compatibility shims, and trust implications. Designing the
interfaces with OPAQUE in mind now costs one review cycle; changing the protocol
later costs an engineering quarter.

---

## Verdict

**Yes, Refarm benefits from OPAQUE — at the right moment.**

| Phase   | Action                                                                              |
|---------|-------------------------------------------------------------------------------------|
| ✅ v0.1.0 | `world refarm-identity-plugin` + `interface identity-provider` shipped in `refarm-sdk.wit` before initial publish |
| v0.2.0  | Implement `identity-nostr` and `identity-opaque-v1` adapters; wire into tractor plugin host |
| v0.3.0  | Implement recovery plugin with OPAQUE as the authentication mechanism; integrate with ADR-032 Sentinel |
| Social  | OPAQUE as the first-class password-based auth path from day one on refarm.social   |

---

## References

- [RFC 9497 — OPRF](https://www.rfc-editor.org/rfc/rfc9497)
- [draft-irtf-cfrg-opaque](https://datatracker.ietf.org/doc/draft-irtf-cfrg-opaque/)
- [`opaque-ke` Rust crate](https://crates.io/crates/opaque-ke) — formal security audit by NCC Group
- [ADR-032: Proton Security & Mandatory Signing](../../specs/ADRs/ADR-032-proton-security-mandatory-signing.md) — Sentinel WASM, recovery plugins
- [ADR-034: Identity Adoption & Conversion](../../specs/ADRs/ADR-034-identity-adoption-conversion.md) — guest → permanent keypair flow
- [ADR-035: Device Verification & Cross-Signing](../../specs/ADRs/ADR-035-device-verification-cross-signing.md)
- [ADR-037: Infrastructure Escalation Strategy](../../specs/ADRs/ADR-037-infrastructure-escalation-strategy.md) — Cloudflare Workers relay
- [docs/IDENTITY_SOVEREIGNTY.md](../IDENTITY_SOVEREIGNTY.md) — Master Key & Silo strategy
- [wit/refarm-sdk.wit](../../wit/refarm-sdk.wit) — current WIT identity surface
