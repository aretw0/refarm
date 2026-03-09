# ADR-033: Command Governance & Unified Intent Registry

## Status
Proposed

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
