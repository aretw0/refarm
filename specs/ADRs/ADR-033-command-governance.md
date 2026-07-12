# ADR-033: Command Governance & Unified Intent Registry

## Status
Accepted

**Progress**: Implemented in `packages/tractor-ts/src/lib/command-host.ts` (15 tests).
§1 Command Registry (register/get/unregister/execute/getCommands, `CommandMetadata`).
§2 Extensibility — `decorate(id, wrapper)` composes a new handler over the existing one
(a plugin refines an intent, e.g. Vim over `editor:save`), decorations stack.
§3 Governance — `execute()` now enforces `capability` via an injectable `CapabilityGate`:
a gated command is denied (`CommandDeniedError` + `system:command_denied`) before the
handler runs; `canExecute(id)` exposes the same decision for the UI; the sensitive
`system:security:*` commands declare `capability: system:security:manage-trust`. The gate
is optional (omit → permissive, back-compat); wiring a concrete gate to a caller-capability
source is the remaining activation step. §4 Accessibility — `getCommands()` returns an
`ariaLabel` (from category/title/description) + a `runnable` flag per command.
Web-standard-shortcut delegation (part of §2) and a shell that consumes `shortcut`/`ariaLabel`
are surface work, not registry work. NOTE: commands are a SURFACE concept (TS/browser); the
authoritative Rust `tractor` governs plugin ADMISSION separately (trust + capability grants),
so "Rust parity" is not applicable to this intent layer.

**Date**: 2026-03-09

## Context
Refarm aims to provide a high-productivity environment where power users can quickly navigate and execute actions using keyboard-first interfaces (Command Palette, Quick Open) while maintaining accessibility and web standards.

Currently, commands are scattered between the core and various plugins. There is no unified way to:

1. Discover all available actions.
2. Override or extend existing actions (e.g., Vim mode).
3. Ensure security (governance) over which commands can be called by whom.
4. Support screen readers and other assistive technologies consistently.

## Decision
We will implement a centralized **Command Registry** (via `CommandHost` in Tractor) that serves as the "Sovereign Intent Layer."

### 1. Command Definition
A Command must include:

- `id`: Namespace-prefixed unique ID (e.g., `system:identity:sign`).
- `title`/`category`: For UI discovery (Command Palette).
- `handler`: The execution logic (async function).
- `capability`: (Optional) The required permission to run.
- `shortcut`: (Optional) Default keybinding.

### 2. Extensibility & Overrides

- **Cascading Registry**: The registry allows plugins to "Register" or "Decorate" existing commands.
- **Intent Refinement**: A plugin can register a handler for an existing ID to modify its behavior (e.g., a "Vim" plugin modifying the `editor:save` intent).
- **Web Standard Triggers**: Standard web shortcuts (e.g., `ctrl+f`, `ctrl+p`) should be mapped as intents in the registry. This allows the Shell to delegate keyboard events to the `CommandHost`.

### 3. Governance

- Tractor enforces that only plugins with the appropriate capabilities can add to the registry.
- Commands from untrusted plugins can be flagged or isolated in the UI.

### 4. Accessibility

- All commands in the registry must be listable by the Shell to populate a search-ready Palette.
- Every command must have an associated ARIA label derived from its title/description, ensuring screen readers can announce available actions.

## Consequences

- **Positive**: Consistent UX across all plugins. Power users get a unified "Command Center."
- **Positive**: Accessibility is "baked in" to every intent.
- **Neutral**: Plugins must explicitly register intents rather than just binding to `window.onkeydown`, promoting cleaner separation of concerns.
