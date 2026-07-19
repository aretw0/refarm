# Writeup captures — prints + records for the work (finalized in job-vault-bk)

A concrete shot-list: what to run, what to capture (a terminal print, a browser shot, or a saved file),
and the one-line claim each capture proves. Grouped by the story it tells. Commands assume the example's
CLI is built (`pnpm --filter <example> build`); swap `<cli>` for `dgk` (or a white-labeled `DGK_COMMAND`).

> Convention: **PRINT** = terminal screenshot · **SHOT** = browser screenshot · **FILE** = keep the
> emitted artifact (path noted). Prefer a real TTY for terminal shots so color + borders render.

## 1. One declaration → every surface (the invariant)

The spine of the whole system: a verb declared once appears on the CLI, the web, the agent, and the
laid-out terminal faces — with the SAME argument schema validated on each.

| Capture | Command / where | Proves |
| --- | --- | --- |
| PRINT | `<cli> --help` then `<cli> dashboard` | the same verbs as a flat CLI AND a laid-out card grid |
| PRINT | `<cli> dashboard -i` (arrow to a verb, Enter) | interactive navigation + dispatch; an args-verb opens an inline form |
| PRINT | `<cli> status-panel` | operator status as severity-colored stat-cards + Next steps |
| SHOT | the example's web face (`pnpm --filter <example> web:dev`) | the same verbs as web cards / forms |
| PRINT | a bad agent tool call rejected with a field message | "same schema → every surface" now covers the agent leg too (see §4) |

## 2. The TUI layout engine (converge internal + external effort)

The story: adopt the proven engine (Yoga flex, string-width metrics), author only what is genuinely
unserved (terminal projection). Same shape as the DTCG + Style-Dictionary token pipeline.

| Capture | Command / where | Proves |
| --- | --- | --- |
| PRINT | `<cli> dashboard` (wide + narrow terminal) | responsive wrapping card grid — flex, not a fixed list |
| PRINT | `reqbench-t3` a records/requirements **table** (aligned columns) | `renderTable` — the second high-use shape the engine unlocks |
| SHOT | the web `<table>` twin of that same data | `renderTableHtml` — one data declaration → TUI table + accessible web table |
| FILE | `docs/superpowers/plans/2026-07-19-tui-layout-engine.md` + `-tui-interactivity.md` | the plan-first record: adopt-vs-build gates, executed |

## 3. T1 — devbench-t1: the machine shows itself (agent / runtime)

The coding-agent bench, `live-*` verbs execute on the REAL WASM runtime (see `EVIDENCE.md`: REAL vs
SYNTHETIC).

| Capture | Command / where | Proves |
| --- | --- | --- |
| PRINT | `<cli> agent-telemetry --mock` | a real multi-turn agent run; the timeline from the runtime's own `agent:*` events |
| SHOT | the `agent-telemetry` web face | the run timeline as an accessible Metric/Value `<table>` |
| PRINT + SHOT | `<cli> plugin-catalog` | the Barn's sovereign inventory (plugin · cache · sha256) — TUI + web table |
| FILE | `enforce-evidence.json` (SHA-256 stamped) + `EVIDENCE.md` | the honest evidence ledger — what is REAL, what it emits, the limits |
| PRINT | `<cli> live-recursion` / `live-delegation` | plugin→plugin + agent→agent dispatch on the live runtime |

## 4. Rust — the sovereign runtime (do not leave it out of the story)

| Capture | Command / where | Proves |
| --- | --- | --- |
| PRINT | a plugin→plugin (`call_plugin`) call with bad args, rejected `InvalidSchema` | validation parity extended to the SPI — the 6th path, plugin→plugin |
| PRINT | an agent tool call with a wrong-typed arg, rejected before dispatch | the agent leg validates against the verb's declared schema (jsonschema, host-side) |
| FILE | `git log` of the `feat(tractor)` commits | the schema now guards web + HTTP + CLI + TUI + agent + plugin→plugin |

## 5. T2 / T3 — the products (result mode)

| Capture | Command / where | Proves |
| --- | --- | --- |
| PRINT/SHOT | `wallet-t2` (`dgk wallet`) — held items, verify, present | the citizen sees held items, not the machine (result mode) |
| PRINT/SHOT | `reqbench-t3` — login + fetch + records as a table/panel | requirements as a laid-out table + status panel |
| FILE | each example's `EVIDENCE.md` + report material (disclosure SVG, report.md) | the honest ledger + the record artifacts |

## Records to keep (the durable trail)

- **Plans** (`docs/superpowers/plans/2026-07-19-*.md`) — the adopt-vs-build gates, executed.
- **Verdict** (`docs/research/2026-07-18-reinventing-the-wheel-ds-i18n-a11y.md`) — what was adopted vs authored.
- **EVIDENCE.md** per example — REAL vs SYNTHETIC + limits.
- **Emitted artifacts** — `enforce-evidence.json` (SHA-256), disclosure SVGs, `report.md`.
- **Git history** — atomic commits are the change record (nothing is a version bump; all 0.1.0).

> Tip for the writing: each row's "Proves" column is a ready caption. Pair the PRINT/SHOT with it and the
> narrative writes itself: declare once → project everywhere → validate the same schema on every surface,
> adopting proven engines and authoring only the projection.
