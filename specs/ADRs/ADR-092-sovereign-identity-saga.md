# ADR-092: Sovereign Identity Continuity (Saga Index)

**Status**: Proposed  
**Progress**: Index only — 032/034/035 remain the specs; all three are Proposed and unimplemented  
**Date**: 2026-07-12  
**Deciders**: Arthur Silva, Claude  
**Related**: [ADR-032](ADR-032-proton-security-mandatory-signing.md), [ADR-034](ADR-034-identity-adoption-conversion.md), [ADR-035](ADR-035-device-verification-cross-signing.md), [ADR-051](ADR-051-external-signed-revocation-offline-policy.md), [ADR-063](ADR-063-cli-oauth-strategy.md)

---

## Context

Three ADRs written in the same 2026-03-09 session (all Proposed, none implemented)
form one continuous protocol for sovereign identity. Read apart they are hard to
place; this is an INDEX that names the arc. (The children are close enough — same
theme, same session, no distinct dates — that a future *merge* is defensible; until
someone implements them, this index is the lighter step.)

## The arc (each step owned by its child ADR)

1. **[ADR-032] Proton-Level Security & Mandatory Identity Continuity** — identity is
   mandatory (no orphaned unsigned work); security-critical logic (signature
   verification, secret derivation) moves into a hardened context (WASM security
   kernel) rather than the UI JS context.
2. **[ADR-034] Identity Adoption & Conversion Protocol** — how a guest's unsigned
   work is adopted into a permanent signed identity (guest → permanent, chain of
   custody).
3. **[ADR-035] Device-to-Device Verification & Cross-Signing** — multi-device trust:
   verifying and cross-signing across a user's devices.

Related and *already accepted* (not part of this triad, but adjacent identity work):
**[ADR-051]** (external-signed offline revocation) and **[ADR-063]** (CLI OAuth
device grant).

## How to read it

Identity continuity = **032 (mandatory + hardened kernel) → 034 (guest→permanent
adoption) → 035 (multi-device cross-signing)** — all Heartwood/Ed25519-based, all
Proposed. This index adds no new decision; each child keeps its own `Related:
ADR-092` back-pointer.
