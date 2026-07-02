# Spec: Secure-Extensibility Demonstration — a white-label CLI over the refarm blocks

**Status:** DESIGN — a composition/showcase, not a new contract; it wires together existing blocks
**Authors:** Arthur Silva, Claude
**Date:** 2026-07-02
**Related:** [`2026-07-02-quality-contract-v1.md`](./2026-07-02-quality-contract-v1.md) (the gate),
`packages/pi-agent` (the engine, now public), `plugin-lifecycle.md` + `plugin-security-model.md` (install +
sandbox), `2026-06-25-skill-runtime-activation.md` (skills), `apps-refarm-scaffold.md` (deterministic
scaffold), `packages/toolbox` (white-label), [`../../docs/DAILY_DRIVER_PARITY.md`](../../docs/DAILY_DRIVER_PARITY.md)

---

## What this is (and is not)

A reproducible demonstration that the refarm blocks **compose** into secure extensibility: a white-label CLI
(refarm underneath) installs an agent, installs or authors sandboxed extensions, and does real work under a
quality gate. It is **not** a new contract or engine — every part already exists; this spec is the wiring
narrative and the demo's acceptance shape. Concrete downstream compositions (which template, which service,
which persona) live with the downstream consumers, not here.

The demo answers one question a reviewer asks of any agent platform: *is this a fixed toolset, or a real
extensibility ecosystem where third-party code runs safely?*

## The flow

```
install   a white-label CLI (refarm underneath, via toolbox)
agent     install the agent — @refarm.dev/pi-agent (farmhand), the public refarm engine
extend    install sandboxed WASM plugins from different authors (e.g. quality:v1 checkers);
          install OR author a skill (skill-contract) for a specific need
work      the CLI scaffolds a workspace DETERMINISTICALLY (reproducible, no model tokens);
          the agent spends real tokens only on genuine authoring (e.g. a new plugin)
gate      the quality:v1 checker plugins evaluate the output (maker/checker loop) until clean
```

## Principles this encodes

- **Determinism first, tokens where they earn it.** The reproducible base is scaffolded deterministically
  (`apps-refarm-scaffold`); model tokens are reserved for genuine creative work — authoring a new
  capability. Efficient, auditable AI use, not gratuitous. The agent does not "fill in a scaffold"; it
  creates something new.
- **Extensibility on every axis.** Sandboxed plugins (install from different authors — the security claim of
  `plugin-security-model` — *and* the agent authors one), skills (install *and* create, via
  `skill-runtime-activation`), a deterministic scaffold. Not a fixed toolset.
- **Agent-as-plugin.** The agent is itself a WASM plugin (`pi-agent`), sandboxed and capability-gated like
  any other — the platform has no privileged core the extensions cannot reach parity with.
- **Maker/checker.** The agent makes; the `quality:v1` checker plugins are the gate; the loop corrects until
  clean. The gate is composed, not hard-coded — a consumer swaps in its own profile.

## Reuse across downstream compositions

The plugin the agent authors in the demo is a real, distributed block — so it is genuinely reused by other
downstream compositions, not a throwaway. Build the block once (where authoring it *is* the point), and it
serves elsewhere. This keeps demonstrations honest: every screenshot is working software over distributed
blocks, never a mock. It also enforces **distribute-first**: the blocks must be built and published/handed
off before a downstream composition re-enacts over them.

## Acceptance (smoke shape)

A smoke proves the flow end-to-end without a model provider where possible:

1. the white-label CLI installs the agent and two checker plugins from distinct sources;
2. `plugin-security-model` enforcement holds — a checker plugin cannot reach fs/network;
3. a deterministic scaffold is byte-stable across runs (no tokens);
4. the `quality:v1` gate runs the checkers over the output and reports findings;
5. (model-gated) the agent authors a small plugin that then installs and runs.

## Boundaries

- Refarm owns the blocks (agent, quality:v1, plugin host, skills, scaffold, toolbox) and this composition.
- Downstream consumers own their template, their profile, their persona — the specialization, not the
  substrate.
- This spec references the block specs; it does not restate their contracts. When it needs a block to do
  more (e.g. the agents-lab invocation adapter for skills), that requirement lives in the block's own doc
  (here: `agents-lab-portability`, `DAILY_DRIVER_PARITY`), not here.

## Non-Goals

- No new contract, engine, or runtime — pure composition of existing blocks.
- No orchestration engine of its own — the maker/checker loop composes the agent with `quality:v1`.
- No downstream persona, branding, or domain content — those belong to the consumer.
