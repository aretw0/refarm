# ADR-040: Sovereign Infrastructure-as-Graph (IaG)

**Status**: ✏️ DRAFT (Experimental)

## Context
Refarm aims to be more than a productivity tool; it is a Personal Operating System. Traditional OSs use configuration files (dotfiles, `/etc`). Modern cloud architecture uses Infrastructure-as-Code (Terraform, Nix).

Refarm introduces **Infrastructure-as-Graph (IaG)**.

The user's vision is that the Sovereign Graph should not only configure Refarm itself but also act as a source of truth for external application deployments. A user should be able to store a project definition in their graph, and Refarm handles the "provisioning" (triggering GitHub Actions, deploying to S3/IPFS) using secrets and variables stored in runtime nodes.

## Decision
1. **Duality of Config**: System state can originate from two sources:
   - **Static DSL (.jsonld files)**: Versioned in Git, strictly immutable at runtime.
   - **Dynamic Graph (Nodes)**: Mutable at runtime, stored in SQLite/OPFS/CRDT.
2. **Precedence Rules**: Static DSL defines the "Base Layer". Dynamic Graph nodes can "Overlay" or "Override" configurations if permitted by a capability policy.
3. **Pluggable Identity (DID-centric)**: Infrastructure blocks (DPLs) must use Decentralized Identifiers (DIDs). While Refarm defaults to `did:nostr`, the kernel acts as a **DID Resolver**. Any key implementation (Apple Passkey, GPG, Ethereum) can be used if a plugin implements the `IdentityBridge` WIT contract.
4. **Terraform-like Convergence**: Refarm acts as an orchestrator that reconciles the "Live State" of external services with the "Desired State" in the graph.

## Consequences
- **Resilience**: Even if the Git repo is lost, the runtime graph holds the "Last Known Good" state for deployments.
- **Portability**: Your "Infrastructure" travels with your Nostr keys.
- **Granularity**: Users can choose to lock down core system config in Git while leaving UI/Plugin preferences to the runtime graph.
