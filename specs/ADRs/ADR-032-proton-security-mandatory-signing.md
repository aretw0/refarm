# ADR-032: Proton-Level Security & Mandatory Identity Continuity

## Status
Proposed (v0.1)

## Context
Refarm aims for maximum user sovereignty and "Proton-level" security (end-to-end encrypted, zero-knowledge, and cryptographically verifiable).

Currently, Guest Mode allows users to experiment without an identity. However, this creates a data gap where initial work is unsigned and unauthenticated, making later ownership transitions technically complex (orphaned nodes) and reducing the system's "Security at Ease" (default secure state).

Furthermore, as specialized security-critical logic (signature verification, secret derivation) grows, keeping it in the same JavaScript execution context as potentially buggy UI or external plugins increases the attack surface.

## Decision
We will enforce **Mandatory Identity Continuity** and a **WASM-Native Security Kernel**.

### 1. Mandatory Ephemeral Identity (On-Demand)

- **Visitor Mode (Keys: None)**: Passive state. User can browse and query existing data. No cryptographic identity is generated.
- **Guest Mode (Keys: Ephemeral)**: Triggered by user interaction (e.g., creating a node, saving a copy). Tractor generates an ephemeral ED25519 keypair in memory.
- **Mandatory Signing**: Once in Guest Mode, every Graph Node created MUST be signed by this ephemeral key.
- **Identity Upgrade**: When a user transitions from "Guest" to "Permanent" (e.g., generating a mnemonic), the new permanent keypair is used to **cosign** or **rotate** the ephemeral history, ensuring an unbroken cryptographic chain of custody.
- **Ejection Right**: Users can export their signed data at any point. If the session is lost without a permanent identity or export, the data is lost.

### 2. The Sentinel (WASM Security Kernel)

- **Isolation**: Move signature verification, hashing, and secret derivation into a sandboxed WASM component ("The Sentinel").
- **Capability Gating**: The JS host (Tractor) only handles coordination. The Sentinel handles the "Truth" (cryptographic verification) and produces the "Secrets" (derived keys).
- **Auditability**: The Sentinel bytecode is immutable and easily auditable by security researchers.

### 3. Plugin-Driven Recovery

- **Pluggable Recovery**: We will define a `refarm:identity/recovery` WIT interface.
- **Implementation**: Instead of hardcoding recovery codes, Refarm will offer recovery via plugins:
  - `recovery-plugin-codes`: Standard "Recovery Code" list generation.
  - `recovery-plugin-social`: Social recovery/Guardian-based.
  - `recovery-plugin-hw`: Hardware key backup.
- **No Backdoors**: If no recovery plugin is configured and the key is lost, the data is lost.

## Consequences

### Positive

- **Instant Security**: No "unauthenticated" window. Every node is signed from day one.
- **Audit Readiness**: Public keys are always available for signing and receiving security reports.
- **Reduced JS Attack Surface**: Critical cryptography is moved out of the general JS heap.

### Negative

- **Onboarding Friction**: Users must be warned that "Guest" sessions are volatile and keys must be "locked in" via permanent identity to ensure long-term recovery.
- **Implementation Complexity**: Coordinating the transition from ephemeral to permanent keys (cryptographic ownership transfer) requires a robust migration strategy.
