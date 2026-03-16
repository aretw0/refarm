# WASM & JCO Architecture in Refarm

This document explains the technical rationale, architectural decisions, and operational details of Refarm's WebAssembly integration via the Component Model and `jco`.

## Why JCO & The Component Model?

Refarm aims for **Digital Sovereignty**. This requires a plugin system that is:
1. **Isomorphic**: Runs in Node.js, Browsers, and Edge.
2. **Capability-Gated**: Plugins should not have direct access to the host's system (I/O, Network) unless explicitly granted.
3. **Language Agnostic**: Developers should write plugins in Rust, Go, Zig, or C and have them work seamlessly.

The **Wasm Component Model** (via WIT - WebAssembly Interface Types) provides the boundary. [JCO](https://github.com/bytecodealliance/jco) is the toolset that transpiles these standardized WASM components into executable JavaScript modules.

## The Transpilation Flow

When a plugin is loaded in Tractor:
1. **Fetch**: The WASM binary is retrieved.
2. **Transpile**: `jco` converts the binary into a set of JS files and core WASM modules.
3. **Cache**: These files are stored in `.jco-cache` (mapped by component ID) to avoid redundant transpilation.
4. **Import**: The glue code is dynamically imported using ESM `import()`.
5. **Instantiate**: The host provides WASI stubs to satisfy the component's environment requirements.

## WASI Stubs & Versioning

Different versions of compilers (like `cargo-component`) and tools target different "snapshots" of WASI (e.g., Preview 2). This lead to "property drift" where a component might expect `wasi:cli/environment@0.2.0` while another expects just `wasi:cli/environment`.

Refarm solves this by providing **Version-Agnostic stubs**:
- We inject imports for both unversioned and versioned keys (`@0.2.0`, `@0.2.3`).
- We provide stub classes (like `Descriptor` or `InputStream`) that JCO can "monkey-patch" during instantiation, which is a common pattern in JCO's generated glue code.

## CI/CD Alignment

To ensure high-fidelity verification without bloating CI runners:
- **Fixtures**: Stable components (like Heartwood) are pre-transpiled into `__fixtures__` within tests. This bypasses the need for full Rust toolchains during every CI run for package-level tests.
- **WASM Tracking**: Specific test fixtures are explicitly allowed in git via `.gitignore` exceptions.

---

> "We treat WASM as the soil, JCO as the plow, and WIT as the fence that keeps the farm secure."
