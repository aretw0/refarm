# @refarm.dev/context-provider-v1

Versioned capability contract (`context:v1`) for assembling AI system prompts from modular context providers. Powers pi-agent's system prompt injection pipeline.

## When to use

- You are building or extending pi-agent and need to inject structured context (files, git status, date, CWD) into an LLM system prompt.
- You want to add project-specific context (e.g., Tractor state, team knowledge) to an agent without modifying core pi-agent code.
- You need a parallel, error-isolated collection of context from multiple sources.

## Installation

```bash
npm install @refarm.dev/context-provider-v1
```

## Architecture

```
ContextRegistry.collect(request)
  ├─ CwdContextProvider       → label: "cwd"
  ├─ DateContextProvider      → label: "date"
  ├─ FilesContextProvider     → label: "files"
  ├─ GitStatusContextProvider → label: "git"
  └─ [your custom provider]   → label: "..."

buildSystemPrompt(entries) → XML-tagged system prompt string
```

Providers run in parallel. A failing provider logs and is skipped — it never crashes the assembly pipeline.

## Usage

### Using built-in providers

```typescript
import {
  ContextRegistry,
  buildSystemPrompt,
  CwdContextProvider,
  DateContextProvider,
  GitStatusContextProvider,
} from "@refarm.dev/context-provider-v1";

const registry = new ContextRegistry([
  new CwdContextProvider(),
  new DateContextProvider(),
  new GitStatusContextProvider(),
]);

const entries = await registry.collect({ cwd: process.cwd() });
const systemPrompt = buildSystemPrompt(entries);
```

### Writing a custom provider

```typescript
import type { ContextProvider, ContextEntry, ContextRequest } from "@refarm.dev/context-provider-v1";
import { CONTEXT_CAPABILITY } from "@refarm.dev/context-provider-v1";

export class TractorStateProvider implements ContextProvider {
  readonly name = "tractor-state";
  readonly capability = CONTEXT_CAPABILITY;

  async provide(req: ContextRequest): Promise<ContextEntry[]> {
    const state = await getTractorState();
    return [{ label: "tractor", content: JSON.stringify(state), priority: 10 }];
  }
}

// Register alongside built-ins
const registry = new ContextRegistry([..., new TractorStateProvider()]);
```

### System prompt output shape

```xml
<contexts>
  <context label="cwd">/workspaces/refarm</context>
  <context label="date">2026-05-03T...</context>
  <context label="git">M packages/storage-sqlite/README.md</context>
</contexts>
```

## API

### `ContextProvider`

```typescript
interface ContextProvider {
  readonly name: string;
  readonly capability: "context:v1";
  provide(request: ContextRequest): Promise<ContextEntry[]>;
}
```

### `ContextRegistry`

```typescript
class ContextRegistry {
  constructor(providers: ContextProvider[]);
  collect(request: ContextRequest): Promise<ContextEntry[]>;
}
```

### `buildSystemPrompt(entries)`

Assembles collected entries into an XML-tagged system prompt string for injection into LLM messages.

## Related packages

- [`@refarm.dev/pi-agent`](../pi-agent) — consumes this for system prompt assembly

## License

MIT
