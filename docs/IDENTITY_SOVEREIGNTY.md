# Sovereign Identity & Master Key Strategy

## Goal
Decouple Refarm from specific identity protocols (like Nostr) while providing a robust, asymmetric "Root of Sovereignty" (Master Key) that can be used for identification, signing, and security transparency.

## Proposed Strategy

### 1. The Master Key (Master Seed)
- **Protocol**: Ed25519 (Isomorphic, fast, and standard for DIDs and Nostr).
- **Generation**: Automated during `refarm init` or first boot.
- **Storage**: Managed by `@refarm.dev/silo` (stored as a secret/nutrient).
- **Usage**: 
  - Derives protocol-specific keys (Nostr, SSH-like signing).
  - Signs the Sovereign Graph state.

### 2. Security Transparency (Key Hosting)
- **Problem**: How to verify the public keys of the Refarm project or an organization?
- **Solution**: 
  - The project will host its **Public Master Key** in a well-known location (e.g., `/.refarm/identity.json` or as a `DNS TXT` record).
  - This allows security researchers and auditors to verify that the code and config they are inspecting is indeed signed by the legitimate "Refarm Sovereign".

### 3. Universal Key Generation Plugin
- Create `@refarm.dev/keychain` (or expand `Silo`).
- This plugin handles the entropy and generation without protocol lock-in.
- It can bootstrap a Nostr identity *from* the Master Key, but it doesn't *depend* on Nostr.

## Implementation Steps
1. **[Sower]**: Update onboarding UI to talk about "Sovereign Keys" instead of protocols.
2. **[Silo]**: Add support for generating and storing a "Project Root Key".
3. **[Windmill]**: Add capability to sync the Public Key to DNS or the repository as a security metadata file.

---

## Related ADRs

- **[ADR-034 — Identity Adoption Conversion](../specs/ADRs/ADR-034-identity-adoption-conversion.md)** — How users move from anonymous/guest sessions to permanent sovereign identity (Ed25519 keypair lifecycle).
- **[ADR-035 — Device Verification & Cross-Signing](../specs/ADRs/ADR-035-device-verification-cross-signing.md)** — Multi-device trust model built on top of the Master Key strategy described here.
