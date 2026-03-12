# ADR-041: Sovereign Environments & Workspace Isolation

**Status**: ✏️ PROPOSED

## Context
Refarm users (especially developers) often need to run multiple instances of the system:
- **Production**: Their real personal graph.
- **Development**: A sandbox version for testing plugins.
- **Ephemeral**: Temporary sessions for testing.

Since these often run in the same browser, they share the same origin-based storage (OPFS, IndexedDB). Without isolation, a bug in a development plugin could corrupt production data.

## Decision
1. **Vault-Based Namespacing**: Every Refarm instance must run within a named **Vault Namespace** (e.g., `vault:prod`, `vault:dev:plugin-x`).
2. **Storage Partitioning**:
   - SQLite databases are named based on the vault (e.g., `refarm-prod.sqlite`, `refarm-dev.sqlite`).
   - IndexedDB stores use prefixed keys.
   - OPFS directories are sub-divided.
3. **Bootloader Selection**: The `Homestead` bootloader must allow the user to select the environment at boot time (like a GRUB menu for Refarm).
4. **Cross-Vault Isolation**: ...
5. **No Sync Cross-Contamination**: ...

## Hierarchical Orchestration (Parent/Child Environments)
1. **The Control Plane (Primary Vault)**: The user's main "Production" vault acts as the **Control Plane**. It has the capability to "Spawn" and "Teardown" child environments.
2. **Ephemeral Workers (Child Vaults)**: Smaller, simpler vaults created for specific tasks (e.g., an AI-heavy operation, a third-party project, or a transient security audit).
3. **Capability Delegation**: The Primary Vault can delegate specific, narrow capabilities to a Child Vault (e.g., "Write access to *this* specific branch of my graph").
4. **Project Sandboxing**: Projects defined in the graph as IaG (ADR-040) can be executed within their own isolated Child Vaults, preventing side-effects on the user's primary identity.

## Consequences
- **Developer Safety**: "Local runs" won't mix with production data even on the same machine.
- **Multi-Account Support**: Naturally allows switching between different Nostr identities and their associated graphs.
- **Initial Complexity**: The bootloader needs a UI for environment selection.
