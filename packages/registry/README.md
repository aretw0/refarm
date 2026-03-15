# @refarm.dev/registry

**Sovereign Registry** is the central component for plugin discovery, validation, and lifecycle management in the Refarm ecosystem. It ensures that only trusted and validated plugins are activated within the sovereign micro-kernel.

## Features

- **Decentralized Discovery**: Supports resolving plugin manifests from remote URLs (HTTP/JSON).
- **Hardened Validation**: Integrates with [Heartwood](file:///workspaces/refarm/packages/heartwood) for Ed25519 signature verification.
- **Lifecycle Management**: Track plugin states (`registered`, `validated`, `active`, `error`).
- **State Persistence**: Export and import registry state to sync with the [Sovereign Graph](file:///workspaces/refarm/docs/ARCHITECTURE.md#sovereign-graph).
- **Radical Portability**: Decouples plugin metadata from its location via `sourceUrl` tracking.

## Usage

```typescript
import { SovereignRegistry } from "@refarm.dev/registry";

const registry = new SovereignRegistry();

// Resolve from remote
await registry.resolveRemote("my-plugin", "https://cdn.example.com/plugin.json");

// Validate (requires signature from Heartwood)
await registry.validatePlugin("my-plugin", signature, publicKey);

// Activate
await registry.activatePlugin("my-plugin");
```

## Architecture

The Registry acts as a gateway between the discovery layer (Sovereign Graph) and the execution layer (Tractor). It maintains authorative truth about which plugins are allowed to run.

---
> "Source is truth. Location is ephemeral."
