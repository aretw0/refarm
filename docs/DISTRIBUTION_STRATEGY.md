# Refarm: Distribution & Build Strategy

This document explains the "How and Why" of package entry points (`src` vs `dist`) to ensure the project is planted with a sober and scalable architecture.

## The Rule of Dist (Correctness)
All packages within the Refarm ecosystem MUST point their `main`, `module`, and `types` fields to the `dist/` directory.

### Why?
1. **Universal Consumption**: Consumers (NPM users, WASM hosts, CLI) should not be required to have a TypeScript compiler or specific monorepo paths configured to run Refarm code.
2. **Deterministic Releases**: What you test in `dist` is exactly what you ship.
3. **Isomorphism**: Bundlers and runtimes handle compiled JS much more predictably across different environments (Browser, Node, WASI).

## The Development Exception (Velocity)
During active development within the monorepo, we sometimes point to `src` or use `tsconfig` paths to avoid a "Build-Rebuild-Wait" loop.

### How to develop "Live":
1. **Turbo Watch**: Run `npm run dev` (which triggers `turbo dev`). This keeps `dist` in sync with `src` in real-time.
2. **Symlinks**: The `node_modules/@refarm.dev/*` links point to the package folder, which in turn points to `dist`.

## Summary of Entry Points

| Package Type | Entry Point | Rationale |
|--------------|-------------|-----------|
| **CLI / Binary** | `./dist/index.js` | Must be compiled to be executable via `bin`. |
| **Contract / Lib**| `./dist/index.js` | Ensures pure JS/Types consumption for 3rd parties. |
| **Plugin** | `./dist/index.js` | Prepared for runtime loading (Tractor). |

### Current Corrective Actions
- [ ] Align `@refarm.dev/sower` to point to `dist/index.js`.
- [ ] Ensure all new `packages/*` implement a `build` script.
- [ ] Update `task.md` to track distribution hardening.
