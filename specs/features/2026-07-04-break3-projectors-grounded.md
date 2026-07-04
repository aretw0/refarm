# Break #3 — the http/tui/web projectors, grounded in reality

**Status:** Reconnaissance done (workflow `wf_4a6aa57b-737`, 8 agents source-verified). Corrects the earlier assumption that break #3 needs new hosts.

## The reorienting finding

**Break #3 is reader/wiring debt, not new-host debt — and the PRODUCERS already exist.** `model-capability.ts:115` already declares `renderers.web:{route:'/settings/model'}` and `:242` `renderers.tui:{section:'settings',shortcut:'ctrl+m'}`; `skill-capability.ts:697` declares `renderers.tui`. The three buckets (`transports.http`, `renderers.web`, `renderers.tui`) are read by ZERO source code today. Each projector has real entries to walk on day one; only the READERS are missing.

## Reality check (per surface — what has a host TODAY)

- **TUI — plant NOW, zero scaffolding.** `refarm tui` is a shipped command with a shipped non-launch output mode (`--actions`/`emitTuiActionRows`), walks the in-process populated `capabilityRegistry`, and producers already declare `renderers.tui`. Pure reader-debt. *Caveat:* `--sections` LISTS the keybound menu; actually BINDING shortcuts live needs a refarm-owned full-screen TUI runtime that does not exist (`--launch` hands off to the external tractor binary). First slice ships the PROJECTION, not live keybinding.
- **WEB — real host (apps/me Astro PWA) but needs ONE scaffolding slice first.** apps/me imports the wrong module (`@refarm.dev/cli/capability-index`, the catalog with no `run()`); no populated registry value is exported. Needs `createCapabilityRegistry()` value export, then reuses the existing homestead render seam (no new server, no new Astro route).
- **HTTP — projector plants NOW inside apps/refarm** (a tiny `http.createServer` where the registry lives — the correct semantic split, pure verbs off farmhand's effort plane). The farmhand plant (`HttpSidecar.addRouteHandler`, real node:http on 42001) is gated on the registry value export + adding `@refarm.dev/cli` to farmhand deps (farmhand can't import apps/refarm — app→app forbidden).

**The ONE true scaffolding:** `createCapabilityRegistry()` exported as a populated VALUE from packages/cli — small, isolated, independently valuable, the literal SDK lesson. Everything else is a ~30-80 line pure reader mirroring `capabilitySlashNames`/`capabilityCliCommands`.

## Ordered slices (all standalone commits)

1. **TUI reader** (S) — `capabilityTuiSections()` beside the sibling exports + `refarm tui --sections` flag cloned from `--actions`. Zero scaffolding, proves the whole break-#3 thesis (register once → third surface lights up).
2. **`createCapabilityRegistry()`** (S-M) — populated registry as a VALUE from packages/cli. The one prerequisite for web + farmhand-HTTP.
3. **HTTP reader** (S-M) — `createCapabilityRouteHandler(registry)` pure route-table function (new `capabilities/http-projector.ts`). ~80 lines, envelope IS the body.
4. **HTTP plant** (S) — mount inside apps/refarm behind a `refarm serve`/dev flag (bootstrap) or farmhand's sidecar (once #2 + dep). The PLANT carries the semantic-home decision.
5. **Web projector** (S) — `projectWebCapabilities(registry)` pure reader over `renderers.web`.
6. **Web plant** (M, deps #2+#5) — `createRefarmMeCapabilitySurfacePlugin` homestead surface plugin in apps/me + `envelopeToHtml`.

## Cultivation principles (for US + third parties)

- **ONE registration site, N derived surfaces.** A block registers once; every surface is a BLIND reader over `registry.list()` of ITS OWN bucket. Refarm's verbs and a third party's are the SAME neutral shape, so a third-party block auto-appears on whatever surfaces the host runs, zero host edits.
- **Neutral core, open buckets.** Core `{name,summary,args,options,run}` carries ZERO surface vocabulary; `transports`/`renderers` are open `[key:string]`. A new surface is additive — no core change. Never let a surface word leak into the core.
- **`run()` is a pure envelope-returning verb.** Same bytes: CLI prints them, HTTP body is them, panel data is them. No per-surface adapter, no forked logic.
- **Packaging-OR-NOT (descriptor is a VALUE):** (a) npm/in-process — publish a package exporting a CapabilityDescriptor, host calls `register(theirs)` once; (b) filesystem plugin — the same PluginExtensions manifest gains a capability slot; (c) naked adhoc — register an in-process descriptor object with NO package (form validated, completeness only warned). That's the "or not" end.
- **Filesystem-OR-NOT via content-addressing + sandbox.** Bytes addressed by hash (asset-resolver-contract-v1), resolvers interchangeable (fs/OPFS/p2p), hash-gate never returns tampered bytes; the p2p backend is itself a plugin. Content-addressing = INTEGRITY; WIT/WASM sandbox = CONTAINMENT. **Crucially: projecting a block's static hints (menu entry, route) is inert data, safe BEFORE any `run()` — only executing `run()` needs the sandbox.**
- **Keep `transports.http` and `gateway-rpc` SEPARATE.** `transports.http` = cheap per-verb endpoint. `gateway-rpc` = the interaction-driver's whole-loop promotion, fenced behind four proofs (lifecycle/steering/parity/budget). Mounting an endpoint must NOT drag in gateway blockers.
- **Cultivate the SDK VALUE export, not just the type.** capabilities/index.ts exports the class but no populated instance, so every surface re-registers by hand — the exact per-surface wiring the descriptor was meant to kill. `createCapabilityRegistry()` as a populated value makes "any host imports ONE live registry and projects" true for us and extenders.

## Open decisions (Arthur)

1. `createCapabilityRegistry()` recipe home: MOVE the built-in register() calls from apps/refarm into packages/cli (cli owns the built-in set, one registration site), OR cli exposes empty-factory + register API and apps/refarm keeps authoring? (Cleaner ONE-site = move down.)
2. HTTP canonical host: (a) farmhand sidecar, (b) apps/refarm `refarm serve` http.createServer (cleanest split, maps' lean for first slice), (c) gateway in front. First slice = (b); confirm long-term.
3. Reconcile the TWO CapabilityDescriptor shapes (governance catalog vs live registry) — break-#3 follow-on or separate track? Not on critical path.
4. Web route contract: `renderers.web.route` → client-side section key in the apps/me homestead panel, NOT a physical Astro page; Layout nav left alone in first slice. Confirm deferring real .astro routes.
