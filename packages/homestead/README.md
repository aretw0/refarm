# @refarm.dev/homestead

Homestead is Refarm's browser-based SDK and operating environment. It provides the `StudioShell` and core plugins for identity, notifications, and plugin management.

## Role

Homestead acts as the "Face" of the sovereign citizen, providing a portal to their digital estate that runs entirely in the browser using WASM and local storage (OPFS).

## Key Components

- **`StudioShell`**: The extensible UI container for all Refarm distros.
- **`setupStudioShell(...)`**: Shared shell setup helper that instantiates `StudioShell`, runs `setup()`, and returns the shell without hiding host-specific plugin registration.
- **`bootStudioRuntime(...)`**: Shared browser runtime boot helper for OPFS SQLite, Loro CRDT storage, optional browser sync, identity stubs, and Tractor boot.
- **`createStudioPluginHandle(...)`**: Shared local plugin-handle factory for first-party hosts and Studio experiments.
- **`createHomesteadSurfacePluginHandle(...)`**: Shared helper for local plugins that declare Homestead surfaces without repeating manifest boilerplate.
- **`renderHomesteadSurface` plugin hook**: Optional plugin method Homestead calls for trusted manifest-declared surfaces, passing `{ pluginId, slotId, mountSource, surface, locale }`; return `{ html }` for explicit trusted HTML or a string/`{ text }` for text content. Homestead records `data-refarm-surface-render-mode` and emits render/failure telemetry for Studio diagnostics.
- **`HeraldPlugin`**: Identity and presence management.
- **`FireflyPlugin`**: System-wide notification system.

`apps/dev`, `apps/me`, and future surfaces such as `social` should share the Homestead runtime helper for repeated Tractor/OPFS/Loro orchestration, while keeping app-specific plugins, fixtures, and visual diagnostics in the app layer.

See [ROADMAP.md](./ROADMAP.md) for the vision of a graph-driven UI.
