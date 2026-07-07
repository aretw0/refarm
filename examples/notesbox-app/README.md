# notesbox-app (example)

A **consuming app** that imports refarm as a white-label host. It is the rehearsal of
the two-layer model: if refarm were fully published, a real work project would be
*exactly this* — a new folder that imports refarm, renames the CLI, injects its own
data + verbs, and registers its flows.

```
┌─ level 1: refarm (generic substrate) ────────────────────────────┐
│  @refarm.dev/capabilities-v1  → source / records / vault verbs    │
│  @refarm.dev/cli/capabilities → registry + CLI/REPL/TUI/HTTP proj │
│  (zero work vocabulary)                                           │
└──────────────────────────────────────────────────────────────────┘
                      ▲ imports, injects deps
┌─ level 3: notesbox-app (this folder — the WORK layer) ───────────┐
│  fixture.ts   → the app's OWN source fixture + records manifest   │
│  deps.ts      → the app's OWN enrichment lookup + vault seed       │
│  requirements-verb.ts → the app's OWN work verb                    │
│  registry.ts  → composes builtins + the work verb into ONE registry│
│  cli.ts       → mounts a CLI named `notesbox`                       │
└──────────────────────────────────────────────────────────────────┘
```

The only things that make this "notesbox" and not "refarm" are the program name, the
app's injected deps, and its own `requirements` verb. Everything else — the verbs, the
surface projection — is the unchanged substrate.

## The flow (T3 note box)

Build once, then run the CLI (the built path mirrors a published-package consumer,
which always resolves the compiled `dist`):

```bash
pnpm --filter notesbox-app build

pnpm --filter notesbox-app notesbox requirements        # the app's work verb
pnpm --filter notesbox-app notesbox source pull web:notesbox-requirements
pnpm --filter notesbox-app notesbox records enrich
pnpm --filter notesbox-app notesbox vault init ./my-vault
```

`vault init` renders the app's seeded records into real Obsidian markdown (YAML-LD front
matter). `src/flow.e2e.test.ts` runs the whole chain through one composed registry,
proving the neutral blocks are reusable — no work vocabulary lives in refarm.

## Where levels 2 and 3 will diverge

Some extensions (e.g. `design-tells` / `text-tells`) are **level 2** — real, reusable
extensions that stay in refarm but that this example *consumes as if its own*. Others
are **level 3** — pure work performance (its own fixtures, seed, registered flows). The
boundary between the two is discovered as we build; this app is structured so a level-2
extension can be slotted in later without changing its shape.
