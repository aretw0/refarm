# @refarm.dev/vtconfig

Centralized Vitest and Vite configuration helpers for the Refarm monorepo.

## Design Philosophy

This package provides shared configuration helpers for Vitest suites and browser-facing Vite apps in the monorepo.

### Dependency Cohesion

You might notice that `vitest` and `typescript` versions are explicitly listed in this package's `devDependencies` and `peerDependencies` instead of being "inherited" from the root.

#### Technical Decision:
- **npm limitation**: Standard `npm` does not provide a built-in syntax to refer to a version of an external dependency via workspace reference (e.g., `vitest: "root"` is not valid).
- **Type Safety**: Explicitly listing versions ensures that the package is built and validated against the correct toolchain, and that `tsc` can find type definitions during the package's own build process.
- **Deduplication**: As long as the versions match the root `package.json`, `npm` will automatically deduplicate these dependencies during installation.

## Usage

Extend this configuration in your package's `vitest.config.ts`:

```typescript
import { mergeConfig } from 'vitest/config'
import { baseConfig } from '@refarm.dev/vtconfig'

export default mergeConfig(baseConfig, {
  // your overrides here
})
```

For Vite apps that need browser WASM support and cross-origin isolation headers:

```typescript
import { defineConfig } from 'vite'
import { withWasmBrowserConfig } from '@refarm.dev/vtconfig'

export default withWasmBrowserConfig(defineConfig({
  // your overrides here
}))
```
