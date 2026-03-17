# ADR-027: Compositional Plugin Architecture & Headless DSL

**Date**: 2026-03-07
**Status**: Proposed
**Context**:
We want to take the "Everything is a Plugin" philosophy to its logical conclusion. Currently, the Refarm host (Homestead) has hardcoded features like the terminal, editor, and graph view. To achieve true sovereignty and radical modularity, the host should be a "blank canvas" (a shell) that orchestrates plugins. Furthermore, these plugins must be able to communicate with each other, defining clear APIs for composition.

**Decision**:
We will implement **Compositional Plugin Architecture** and a **Headless DSL**.

### 1. Compositional Plugin Manifest
The `PluginManifest` will be expanded to include:
- `providesApi`: A list of capabilities or interfaces that the plugin exposes to the system or other plugins.
- `requiresApi`: A list of capabilities or interfaces that the plugin needs from other plugins to function.

This allows for dependency graph resolution at the Tractor level. For example, an `EditorPlugin` might require a `FileSystemProviderApi`.

### 2. Headless DSL (Design System Language)
To ensure a consistent but flexible UI across plugins, we will define a headless DSL:
- **Design Tokens**: A set of CSS variables (`--refarm-bg-primary`, `--refarm-accent`, etc.) that the host provides.
- **Headless Components**: Plugins will use these tokens and follow a standardized DOM structure, allowing the host or the user to apply global/local styles (glassmorphism, dark mode, etc.) without breaking functionality.

### 3. "Everything is a Plugin" (Homestead Shell)
Homestead will be refactored into a pure orchestrator:
- **Core Shell**: Only responsible for loading the Tractor and the initial "Bootstrapping Plugin".
- **Functional Plugins**: Terminal, Editor, Graph, and Discovery UI will be implemented as plugins.
- **Composition**: The `TerminalPlugin` might provide an `OutputApi` that other plugins use to log messages.

### 4. Cross-Plugin Communication
We will extend the `tractor-bridge` (WIT) to allow plugins to query for other plugins' exported functions, facilitating a secure, capability-gated RPC mechanism.

**Consequences**:
- **Positivas**: 
  - **Total Modularity**: Users can swap the "Terminal" or "Editor" for any alternative.
  - **Consistency**: The headless DSL ensures a premium, cohesive look while keeping plugins lightweight.
  - **Ecosystem Growth**: Developers can build "Helper Plugins" that provide APIs for others.
- **Negativas**: 
  - **Complexity**: Managing the dependency graph and cross-plugin security becomes more challenging.
  - **Performance**: RPC calls between WASM components might have overhead (mitigated by WASI Preview 2 performance).

**Implementation Roadmap**:
1. Update `packages/plugin-manifest` and `wit/refarm-sdk.wit`.
2. Define `packages/dsl-headless` (CSS and base primitives).
3. Implement `TerminalPlugin` as the first "Internal-turned-External" component.
4. Refactor Homestead's `index.astro` to be a dynamic loader.
