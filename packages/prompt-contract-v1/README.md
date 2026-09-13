# @refarm.dev/prompt-contract-v1

Typed, surface-neutral operator prompts for Node.js applications. It supplies
confirm, select, text and secret prompts plus stdio, scripted and automatic
channels. Applications own their commands, transport and product language;
this package owns the prompt contract and implementations.

```ts
import { createScriptedOperatorChannel } from "@refarm.dev/prompt-contract-v1";

const operator = createScriptedOperatorChannel([true]);
const approved = await operator.ask({
  type: "confirm",
  question: "Continue?",
  default: false,
});
```

Use `createStdioOperatorChannel()` for an attended terminal and
`createAutoOperatorChannel()` when no human is present. Run `test:conformance`
to verify another channel implementation against the contract.
