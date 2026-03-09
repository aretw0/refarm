# ADR-035: Device-to-Device Verification & Cross-Signing

## Status
Proposed

## Context
As Refarm moves towards multi-device synchronization (via ADR-003 and ADR-031), we need a robust way for a user to:

1. **Authorize a new device** to access their Sovereign Graph.
2. **Verify the identity of other users** to ensure End-to-End Encryption (E2EE) and data integrity.
3. **Recover access** to their graph if they lose a device.

Following the Matrix model, we need to move beyond single-key signing to a hierarchy of trust.

## Decision
We will implement a **Cross-Signing & Device Verification** protocol managed by **Heartwood**.

### 1. Key Hierarchy (Heartwood Managed)

- **Identity Root (MSK)**: The permanent identity (e.g., Nostr pubkey). Stays offline or in high-security storage.
- **Session Key (Device Key)**: An ephemeral-but-persistent ed25519 keypair generated on each device.
- **Device Verification Node**: A signed graph node where `Identity Root` (MSK) signs the `Session Key` (Device Key), authorizing it to act on behalf of the user.

### 2. Device-to-Device Verification (Self-Verification)
When a user logs in on a new Device B:

1. Device B generates a Session Key and displays a **SAS (Short Authentication String)** (7 Emojis).
2. The user goes to a verified Device A and enters the verification flow.
3. **ECDH Exchange**: Devices A and B perform an ephemeral key exchange via the Sync Relay.
4. **SAS Comparison**: User confirms that Emojis on A match B.
5. **Signature Issuance**: Device A (holding the MSK or a delegate SSK) signs a `DeviceVerification` node for Device B.

### 3. Cross-User Verification

- Users can verify each other using the same SAS (Emoji) mechanism.
- Successful verification results in a `UserTrust` node signed by the verifier's `User-Signing Key`.

### 4. Implementation in CommandHost

- The `CommandHost` will expose intents for:
  - `system:security:verify-device`
  - `system:security:display-sas`
  - `system:security:confirm-sas`

### 5. Verification State in the Graph

- The `IdentityConversion` node (ADR-034) is the first step. Subsequent device additions are recorded as `DeviceTrust` nodes.
- Sync engines will only replicate sensitive/encrypted partitions to devices with a verified `DeviceTrust` path.

## Consequences

- **Positive**: High security against "impersonation" attacks when adding devices.
- **Positive**: User-friendly verification via Emojis.
- **Positive**: Prevents unauthorized devices from decrypting the Sovereign Graph even if they gain access to the sync relay.
- **Negative**: Adds UI complexity for onboarding a second device.
