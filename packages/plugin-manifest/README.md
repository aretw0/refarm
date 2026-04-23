# @refarm.dev/plugin-manifest

Plugin manifest schema and validation for Refarm plugin ecosystem.

## Installation

```bash
npm install @refarm.dev/plugin-manifest
```

## Usage

### Define Your Plugin Manifest

Create `plugin-manifest.json` in your plugin root:

```json
{
  "id": "@mycompany/my-plugin",
  "name": "My Awesome Plugin",
  "version": "1.0.0",
  "entry": "./dist/index.js",
  "capabilities": {
    "provides": ["storage:v1"],
    "requires": ["kernel:events"]
  },
  "permissions": ["storage:read", "storage:write"],
  "observability": {
    "hooks": ["onLoad", "onInit", "onRequest", "onError", "onTeardown"]
  }
}
```

### Validate Manifest

```typescript
import { validatePluginManifest, assertValidPluginManifest } from "@refarm.dev/plugin-manifest";
import manifestJson from "./plugin-manifest.json";

// Option 1: Get validation result
const result = validatePluginManifest(manifestJson);
if (!result.valid) {
  console.error("Manifest errors:", result.errors);
}

// Option 2: Assert (throws on invalid)
try {
  assertValidPluginManifest(manifestJson);
  console.log("Manifest is valid!");
} catch (error) {
  console.error("Invalid manifest:", error.message);
}
```

### In Your Plugin Tests

```typescript
import { validatePluginManifest } from "@refarm.dev/plugin-manifest";
import manifest from "../plugin-manifest.json";

describe("Plugin manifest", () => {
  it("is valid", () => {
    const result = validatePluginManifest(manifest);
    expect(result.valid).toBe(true);
  });
});
```

## Manifest Schema

### Required Fields

- **`id`**: Scoped package name (e.g., `@vendor/plugin-name`)
- **`name`**: Human-readable name (min 3 chars)
- **`version`**: Semantic version (e.g., `1.2.3`)
- **`entry`**: Relative path to entry point (e.g., `./dist/index.js`)
- **`capabilities.provides`**: Array of capabilities this plugin implements
- **`capabilities.requires`**: Array of capabilities needed from kernel/other plugins
- **`permissions`**: Array of permission strings
- **`observability.hooks`**: Array of telemetry hooks

### Observability Hooks (Required)

All plugins MUST implement these hooks:

- `onLoad`: Called when plugin is loaded
- `onInit`: Called when plugin initializes
- `onRequest`: Called on each capability request
- `onError`: Called when errors occur
- `onTeardown`: Called when plugin unloads

## API

### `validatePluginManifest(manifest: PluginManifest): ManifestValidationResult`

Returns validation result with errors list.

### `assertValidPluginManifest(manifest: PluginManifest): void`

Throws error if manifest is invalid.

### Types

```typescript
interface PluginManifest {
  id: string;
  name: string;
  version: string;
  entry: string;
  capabilities: PluginCapabilities;
  permissions: string[];
  observability: {
    hooks: TelemetryHook[];
  };
}

interface PluginCapabilities {
  provides: string[];
  requires: string[];
}

type TelemetryHook = "onLoad" | "onInit" | "onRequest" | "onError" | "onTeardown";
```

## Validation Rules

1. `id` must be scoped (@vendor/name)
2. `name` must be at least 3 characters
3. `version` must be valid semver
4. `entry` must be relative `.js`/`.mjs`/`.cjs` or `.wasm` path (absolute paths are rejected)
5. `.wasm` entries must declare `integrity` as `sha256-<base64|64hex>`
6. `capabilities.provides` must have at least one capability
7. No duplicates in provides/requires/permissions/APIs
8. `targets` must be a non-empty array using only `browser`, `server`, `remote`
9. All required telemetry hooks must be declared

## FAQ — "Plugin precisa ser WASM?"

Não. O contrato de manifesto aceita `entry` em `.js`/`.mjs`/`.cjs` **ou** `.wasm`.

- `.wasm`: caminho recomendado para sandbox e hardening (integridade `sha256-*` obrigatória).
- `.js/.mjs/.cjs`: caminho válido para adoção gradual, especialmente para times que ainda não migraram para WASM.
  No `tractor-ts`, entradas JS já podem ser carregadas via módulo JS em runtime (com diferenças por ambiente).

Em resumo: WASM é o trilho de segurança mais forte, mas não é bloqueio absoluto para começar.

Para a política de produto/arquitetura em detalhes, veja `docs/PLUGIN_AUTHORING_TRACKS.md` no monorepo.

## Shared install/cache contract

Besides schema validation, this package now exposes a shared binary-install contract:

- `parseSha256Integrity()`
- `verifyBufferIntegrity()`
- `installWasmArtifact(request, { cache, fetchFn })`
- `detectWasmBinaryKind(bytes)`

`installWasmArtifact` is used by both Barn and Tractor install paths, so hash verification,
cache-hit validation, eviction-on-mismatch, fetch+persist semantics, and `artifactKind`
classification (`module`/`component`/`unknown`) stay consistent.

Advanced hosts can pass `metadataExtensions` in the install request to persist
runtime-specific install metadata (e.g. browser runtime module sidecars) without forking
core integrity/cache behavior.

## Runtime entry compatibility helpers

To keep runtime behavior aligned across hosts, this package also exports:

- `detectEntryFormat(entry)`
- `evaluateEntryRuntimeCompatibility(entry, runtime, options?)`
- `assertEntryRuntimeCompatibility(entry, runtime, options?)`
  - `options.allowBrowserWasmFromCache` habilita compatibilidade `.wasm` no browser para hosts que adotam execução cache-backed.

Current runtime policy:

- **node**: `.js`, `.mjs`, `.cjs`, `.wasm`
- **browser**: `.js`, `.mjs` by default; `.wasm` is available only when the host opts into cache-backed execution (`allowBrowserWasmFromCache`) and `.cjs` stays blocked
  - cache-backed `.wasm` hosts can use `artifactKind` metadata to reject incompatible binaries (e.g. component artifacts pending dedicated runtime toolchain)

## Conformance scope (manifest:v1)

`@refarm.dev/plugin-manifest` is a **schema/validation contract**, not a runtime capability contract.
Therefore, its conformance gate is the validator suite (`src/validate.test.js`) exposed via:

```bash
npm --prefix packages/plugin-manifest run test:conformance
```

A dedicated `runManifestV1Conformance()` harness is deferred until a separate runtime contract is introduced.

## Runtime alignment notes (tractor)

`@refarm.dev/tractor` now enforces a minimum manifest↔runtime alignment during plugin load when a
manifest is found next to the `.wasm` artifact (`plugin-manifest.json` or `manifest.json`).

Checks include:

- plugin id alignment (`manifest.id` suffix must match runtime `plugin_id` derived from wasm filename)
- required observability hooks (`onLoad`, `onInit`, `onRequest`, `onError`, `onTeardown`)
- minimal metadata compatibility (`metadata.version === manifest.version`)

Critical mismatches fail `load()` with an explicit alignment error before plugin activation.

---

## Role in the Sovereign Farm

This package defines the formal "Contract" for plugin citizenship within Refarm. It ensures every plugin is well-behaved, traceable, and secure.

See [ROADMAP.md](./ROADMAP.md) for its evolution.

## License

MIT
