# notesbox-app (example)

A **consuming app** that declares refarm as a white-label capability host. It is the
rehearsal of the two-layer model: if refarm were fully published, a real work project
would be *exactly this* — a new folder that names a host, injects its own data, declares
its own verbs/manifests, and lets refarm project the surfaces.

```
┌─ level 1: refarm (generic substrate) ────────────────────────────┐
│  @refarm.dev/capabilities-v1  → source / records / vault verbs    │
│  defineCapabilityHost        → registry + CLI/REPL/TUI/HTTP host   │
│  (zero work vocabulary)                                           │
└──────────────────────────────────────────────────────────────────┘
                      ▲ declares host, injects deps
┌─ level 3: notesbox-app (this folder — the WORK layer) ───────────┐
│  fixture.ts   → the app's OWN source fixture + records manifest   │
│  deps.ts      → the app's OWN enrichment lookup + vault seed       │
│  requirements-verb.ts → the app's OWN work verb                    │
│  registry.ts  → declares a host + app verbs + plugin manifest      │
│  cli.ts       → thin entrypoint for the `notesbox` host             │
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

pnpm --filter notesbox-app notesbox actions --json     # host-declared surface actions
pnpm --filter notesbox-app notesbox status --base      # base operator model
pnpm --filter notesbox-app notesbox requirements        # the app's work verb
pnpm --filter notesbox-app notesbox requirements-moc    # the analyst's product view
pnpm --filter notesbox-app notesbox source pull web:notesbox-requirements
pnpm --filter notesbox-app notesbox records enrich
pnpm --filter notesbox-app notesbox vault init ./my-vault
```

`vault init` renders the app's seeded records into real Obsidian markdown (YAML-LD front
matter). `src/flow.e2e.test.ts` runs the whole chain through one composed registry,
proving the neutral blocks are reusable — no work vocabulary lives in refarm.

For manual exploratory recording, CLI state persists to `.notesbox/requirements.manifest.json`.
Set `NOTESBOX_STATE_PATH=/tmp/notesbox.json` to isolate a run.

## Two ways to extend (both land on the same surfaces)

This example shows BOTH, so the difference is concrete:

1. **Composition (plain software).** `fixture.ts` / `deps.ts` / `requirements-verb.ts`
   inject data and declare JS `run()` verbs; `registry.ts` passes them as host
   extensions. This is still ordinary engineering, but the app no longer hand-wires
   the registry, CLI, HTTP server, status, or actions.

2. **The refarm extension path (the interesting one).** `extension.ts` declares a
   PLUGIN MANIFEST (`provides: ["annotator:annotate"]`), and the host bridge surfaces
   its verb onto every surface from that one declaration — the app writes no `run()`
   for it. Run `notesbox --help` and `annotate` is there, "dispatched to the
   @notesbox/annotator plugin", with a host-built dispatch behind it. That is the
   effect that makes an installed extension appear on the CLI by itself — extending
   *the refarm way*, not importing a package. `src/extension.e2e.test.ts` proves it
   end-to-end.

```bash
pnpm --filter notesbox-app notesbox annotate note='{"path":"n.md"}'
# → dispatches across the bridge, returns a two-phase receipt {effortId, replyRef}
```

## Where levels 2 and 3 will diverge

Some extensions (e.g. `design-tells` / `text-tells`) are **level 2** — real, reusable
extensions that stay in refarm but that this example *consumes as if its own*. Others
are **level 3** — pure work performance (its own fixtures, seed, registered flows). The
boundary between the two is discovered as we build; this app is structured so a level-2
extension can be slotted in later without changing its shape.
