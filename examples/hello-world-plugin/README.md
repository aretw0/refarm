# @refarm/hello-world-plugin

A minimal reference implementation of a Refarm plugin.

## Quick Start

1. Clone the repo.
2. `npm install`
3. `npm run build`
4. Load the generated WASM into a Refarm Tractor.

## Installation

```bash
npm install @refarm/hello-world-plugin
```

## Usage

This plugin serves as a smoke test for the Tractor:

```typescript
const hello = await tractor.plugins.load(manifest);
await hello.call("greet", { name: "Sovereign User" });
```

## Certification
- **License**: MIT
- **A11y**: Level 4
- **Languages**: en
