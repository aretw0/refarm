# Refarm: The Personal OS Boot Process

## The Kernel Philosophy
Refarm as an Operating System only needs to be "ready to boot". The GUI (Homestead) is the bootloader. Everything else — drivers, apps, settings — comes from the Graph.

## Boot Sequence
1. **L0: Shell Load**: Homestead (Astro/SPA) is served from a static host.
2. **L1: Tractor Ignition**: The Tractor microkernel initializes WASM runtimes and capabilities.
3. **L2: Identity & Vault Decryption**: User provides Nostr keys/Vault credentials.
4. **L3: Graph Hydration**: Tractor reads the Sovereign Graph from SQLite/OPFS.
5. **L4: Plugin Mounting**: Capabilities are granted to plugins based on graph definitions.
6. **L5: System Live**: The UI renders based on the "Canonical UI" definitions found in the graph.

## The Onboarding Seed
To prevent the "Empty Graph" problem, Refarm includes a **Seed Process**:
- When a new user boots for the first time, a default DSL (Domain Specific Language) file is ingested.
- This seed populates the graph with basic nodes: "Getting Started" guide, default settings, and recommended plugins.
- Once seeded, the user is in full control. The seed is just the starting point of their sovereign autonomy.
- The seed is not "hardcoded" in the binary. It is a file that is served by the static host, and the Tractor kernel is configured to ingest it if no other graph is found.
