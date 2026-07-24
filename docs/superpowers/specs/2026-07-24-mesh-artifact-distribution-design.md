# Mesh artifact distribution — the PC as a temporary binary/build server

> Status: design (2026-07-24). Operator direction (Arthur): for users who run and develop
> **only inside their own Tailscale mesh** (no GitHub Releases), the dev PC should act as a
> **temporary server of binaries and builds** — it leaves something built, and refarm solves
> **transfer via download between devices on the same mesh + subsequent updates**. Distinct
> from *reachability* (already solved via Tailscale; Pears is the sovereign upgrade): this is
> about **getting the software**, not reaching the running farm.

## Scope of this slice

First payload: **the `@refarm.dev/farm-client` kit** (arch-agnostic — runs anywhere Node
runs: Termux, Pi, PC; it is the device surface already). It unblocks "download without git"
for the phone today. The x86 tractor binary is a later payload (the operator is bringing a
second x86 node onto the tailnet) — the manifest is designed to admit it without change.

## Fit with what already exists (leverage effort, no parallel rails)

- **Transport = `refarm web serve <dir>`** (unchanged). Already a hardened read-only mesh
  file server: GET/HEAD, path-contained, serves `.mjs`/`.json`/`.wasm`. No new server.
- **Integrity format = `sha256-<base64>`** (SRI style), the convention refarm already uses
  for plugin integrity (`packages/tractor-ts/src/lib/install-plugin.ts`). Not raw hex.
- **The device client stays zero-dep** (the no-deps rope: required only for `farm-client`,
  the git-pull surface). `farm-update` computes integrity with `node:crypto`; the publish
  side (apps/refarm, has deps) may share the same format.

## The two halves (each an isolated block)

### 1. Publish (PC side) — `refarm dist publish`
Assembles the kit into an ephemeral, gitignored dir and writes a manifest:
- Reads `packages/farm-client` (version from its `package.json`; files = its `src/**` +
  `bin/**` + README).
- Copies them to `<out>/farm-client/` (default `<out>` = `.refarm/dist`), preserving the
  `src/`+`bin/` layout so `bin/*.mjs` still `import "../src/..."` on the device.
- Writes `<out>/farm-client/manifest.json`:
  ```json
  { "name": "farm-client", "version": "0.1.0", "platform": null,
    "createdAt": "<iso>",
    "files": [ { "path": "bin/farm-ask.mjs", "integrity": "sha256-…", "bytes": 456 }, … ] }
  ```
- Prints the next step: `refarm web serve .refarm/dist/farm-client --host 0.0.0.0 --port 4321`.
- Source Sovereignty (§1): source in `packages/`, artifact in `.refarm/dist` (gitignored).

### 2. Consume (device side) — `packages/farm-client/bin/farm-update.mjs` (zero-dep)
- Resolve the farm host (tailnet peers first, like `farm-ask`) + `FARM_DIST_PORT` (4321).
- `GET /manifest.json`.
- Read the locally installed manifest from `FARM_KIT_DIR` (default `~/.refarm/kit/farm-client`).
- `planUpdate(remote, local)` → the files whose integrity differs or are missing.
- Download each, **verify `sha256-<base64>`**, write to a temp path, atomic `rename` into place.
- Write the new manifest last (so a crash mid-update never advertises a version it lacks).
- Report footer-style: `↻ farm-client 0.1.0 → 0.2.0 · 3 files · 12.4 KB`.

### Pure core (testable in isolation) — `packages/farm-client/src/manifest.mjs`
`integrityOf(bytes)`, `parseManifest(json)`, `planUpdate(remote, local)`. No I/O; the bin is
the thin I/O shell around them. The decoupled-guard invariant covers the new files.

## Trust & integrity
The mesh is already an authenticated WireGuard tunnel — trust the transport for v1. The
`sha256-<base64>` per-file integrity guarantees byte-integrity end to end. No signature chain
in v1 (a later slice, alongside the x86 binary payload, can add operator signing).

## YAGNI boundaries (v1)
- No auto-update polling — `farm-update` is invoked manually.
- No multi-arch registry — one payload; the `name`/`platform` fields admit more later.
- No delta/patch downloads — whole-file, integrity-gated.
- No rollback UI — the previous manifest stays until the swap completes; re-run to re-pull.

## The wire contract
`manifest.json` is neutral (wire, not app): the same shape distributes the farm-client kit to
the phone today and the compiled tractor binary to an x86 tailnet peer later (that payload
carries a `platform` and its own files). One pattern, extensible by payload.
