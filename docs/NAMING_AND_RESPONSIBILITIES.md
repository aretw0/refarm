# Naming & Responsibilities

The Refarm ecosystem uses a farm metaphor plus descriptive contract names. Because several names rhyme
thematically, here is what each one is responsible for and what it is not.

| Name | Kind | Responsibility | Not |
| --- | --- | --- | --- |
| **refarm** | ecosystem / platform | The whole sovereign-compute farm: kernel, contracts, apps, and distribution policy. | Not a single app or runtime. |
| **tractor** | platform host / microkernel | Loads and runs WASM plugins with capability enforcement. | Not the agent; it runs plugins. |
| **farmhand** (`@refarm.dev/farmhand`, `apps/farmhand`) | assistant app | Headless daemon: the bridge between the human citizen and autonomous agents/workflows; bundles plugins and always-on sync. | Not the agent runtime; it hosts it. |
| **agent** (`@refarm.dev/agent`, `packages/agent`) | coding-agent runtime plugin | Sovereign AI coding agent: the loop, provider integration, session/task handling, and WASM plugin runtime. Inspired by Pi, differentiated by CRDT state and the WASM Component Model. | Not Pi. Not the app. Previously `pi-agent`; renamed to drop the Pi collision. |
| **Pi** | external engine | The external engine agents-lab curates today; Refarm is the second engine. | Not a Refarm component. |

Rule of thumb: **agent** is the worker runtime plugin; **farmhand** is the app you run; **tractor** is the
kernel that loads plugins; **refarm** is the ecosystem. **Pi** is an external engine we learn from.
