# @refarm.dev/terminal

Refarm Terminal is a core system plugin that provides a standardized `OutputApi` for text-based logging and interaction within the Refarm ecosystem.

## Quick Start

In a "Pure Shell" environment like Homestead, the Terminal plugin is discovered and mounted automatically if it's in the plugin directory.

## Installation

```bash
# In your plugin dev environment
npm install @refarm.dev/terminal
```

## Usage

As a "Core Provider", this plugin exports the `OutputApi` which can be consumed by other plugins via the Tractor:

```typescript
const terminal = await tractor.getPluginApi("OutputApi");
await terminal.call("log", { message: "Hello from another plugin!" });
```

## Certification
- **License**: MIT
- **A11y**: Level 3 (Screen Reader & Keyboard optimized)
- **Languages**: English, Portuguese
