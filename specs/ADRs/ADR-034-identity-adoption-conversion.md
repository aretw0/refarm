# ADR-034: Identity Adoption & Conversion Protocol

## Status
Proposed

## Context
Refarm users often start as **Visitors** (read-only) or **Guests** (ephemeral keys). To encourage a "gradual sovereignty" journey, we need a way to help them transition to a **Permanent** identity (e.g., Nostr) without losing ownership of the data they signed as Guests.

## Decision
We will implement a **Claim-based Identity Adoption** protocol to link ephemeral keys to permanent ones.

### 1. The Conversion Claim
When a user upgrades from Guest to Permanent:

1. The `Tractor` generates an **Identity Conversion Node** (`@type: IdentityConversion`).
2. This node contains:
   - `guestPubkey`: The ephemeral hex-encoded public key.
   - `permanentPubkey`: The new permanent hex-encoded public key.
   - `timestamp`: The ISO8601 timestamp of the conversion.
3. This node is **Double-Signed**:
   - Signature 1: By the **Guest Key** (proving voluntary transfer of data sovereignty).
   - Signature 2: By the **Permanent Key** (proving the new identity accepts the legacy data).

### 2. Data Ownership Resolution

- **Sovereign Graph Inference**: Storage adapters and Sync engines must treat the `IdentityConversion` node as a verifiable link in the chain of trust.
- **Ownership Check**: Any node signed by the `guestPubkey` is cryptographically considered owned by the `permanentPubkey` if a valid `IdentityConversion` node exists and can be verified.

### 3. Migration (Optional)

- **Deep Migration**: Users may opt for a "Full Rewrite" where Tractor iterates through all nodes signed by the Guest key, re-signs them with the Permanent key, and updates the storage. This improves privacy by untethering the permanent identity from the ephemeral trace, but incurs higher compute/IO cost.
- **Lazy Adoption**: By default, nodes are kept with the Guest signature, and the link is resolved on-the-fly during query time.

### 4. Security

- A `permanentPubkey` cannot "claim" a Guest key without a signature from the Guest key itself. This prevents "phantom adoptions."

## Consequences

- **Positive**: Zero data loss during account creation or onboarding.
- **Positive**: Gradual onboarding path that respects previous contributions.
- **Negative**: Adds overhead to the "Effective Owner" resolution logic in database queries and sync filters.
