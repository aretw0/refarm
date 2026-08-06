# A Workspace Is Not a Node — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a workspace a grammar for describing itself that cannot describe a node, and make the node's catalog the single runtime source of truth.

**Architecture:** A workspace declares an OFFER in `<workspace>/.refarm/workspace.json` — commands it provides, no catalog. `refarm workspace sync` brings an offer into the node's catalog, showing what changes, with the node's own declarations winning any collision. At runtime nothing merges: the catalog IS the answer, and the offer was a producer of it.

**Tech Stack:** TypeScript (`apps/refarm`, `packages/config`, vitest). No Rust, no WASM rebuild.

**Spec:** `docs/superpowers/specs/2026-08-06-a-workspace-is-not-a-node-design.md`

## The open question, decided

The spec deliberately left one thing open: where the workspace's declaration lives. **A distinct filename, `<workspace>/.refarm/workspace.json`** — not the existing `config.json`.

Reusing `config.json` would leave the trap armed. The spec's whole thesis is that one name serving two roles is the defect; a workspace file called `config.json` reads as "this workspace's refarm configuration" and invites node-shaped content back into it. A distinct name makes the wrong thing hard to write by accident, and makes the migration greppable rather than invisible.

## Why acceptance writes rather than merges

An earlier sketch had the runtime merge node catalog with workspace offers, resolving precedence on every read. This plan does not, and the simplification is the point.

`refarm workspace sync <id>` reads the offer, shows what would change, and on acceptance WRITES it into the node's catalog with provenance. So at runtime there is exactly one source, the catalog, and precedence was resolved once — visibly, by the operator — rather than silently on every resolution.

That is the decision-log principle already accepted in this repository: *every input source converges on one declaration*. The workspace's offer is a producer of the catalog, not a second catalog.

## Global Constraints

- **A workspace declaration can never name another workspace.** No `workspaces` map exists in its shape, and one found in a file is REJECTED with a message naming the correct grammar — never ignored, because an ignored declaration is believed by whoever wrote it.
- **An offer is not live until accepted.** A workspace's declaration arrives by `git pull`; if it took effect unreviewed, a repository update would silently change what the operator's machine executes.
- **The node wins a name collision AND says it won.** Silent precedence is how someone reads one declaration while a different one runs.
- **`path` in the node catalog is absolute.** A `"."` only means something relative to a base that moves.
- **rcdc5 is not migrated.** Its command stays declared in the node catalog and NOTHING is written into that repository. It is the operator's decision and the living example of a node administering a workspace that has done no refarm work.
- `apps/refarm` is TypeScript with `.js` import specifiers. No cargo commands are needed; never a bare `cargo test` in this repo regardless.
- Do not run `pnpm run diagrams:fix` — it dirties ~35 unrelated SVGs on this machine.

---

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `apps/refarm/src/commands/workspace-declaration.ts` | **New.** The offer's shape, pure parser, and its refusals. | 1 |
| `apps/refarm/src/commands/workspace-declaration.test.ts` | **New.** | 1 |
| `apps/refarm/src/commands/workspace-sync.ts` | **New.** Read an offer, diff it against the catalog, write on acceptance. | 2 |
| `apps/refarm/src/commands/workspace-sync.test.ts` | **New.** | 2 |
| `apps/refarm/src/commands/workspace.ts` | Register `sync`; `--local` writes the new shape. | 2 |
| `~/.refarm/config.json`, `<repo>/.refarm/config.json`, `<repo>/.refarm/workspace.json` | This machine's migration. | 3 |
| `docs/superpowers/specs/2026-08-06-a-workspace-is-not-a-node-design.md` | Record the filename decision. | 5 |

---

### Task 1: A grammar that cannot describe a node

**Files:**
- Create: `apps/refarm/src/commands/workspace-declaration.ts`
- Test: `apps/refarm/src/commands/workspace-declaration.test.ts`

**Interfaces:**
- Produces:
  - `export interface WorkspaceOffer { commands: Record<string, WorkspaceDeclaredCommand>; execution?: { preferredAdapter?: string } }`
  - `export type ParsedOffer = { offer: WorkspaceOffer } | { error: string }`
  - `export function parseWorkspaceOffer(raw: unknown): ParsedOffer`
  - `export function workspaceOfferPath(workspaceAbsolutePath: string): string`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { parseWorkspaceOffer, workspaceOfferPath } from "./workspace-declaration.js";

const COMMAND = { run: ["node", "x.mjs"], description: "d" };

describe("parseWorkspaceOffer", () => {
	it("accepts commands and execution", () => {
		const parsed = parseWorkspaceOffer({ commands: { build: COMMAND } });
		expect("offer" in parsed && parsed.offer.commands.build).toEqual(COMMAND);
	});

	it("REFUSES a workspaces map, naming the correct grammar", () => {
		const parsed = parseWorkspaceOffer({ workspaces: { other: { path: "/x" } } });
		expect("error" in parsed).toBe(true);
		if ("error" in parsed) {
			expect(parsed.error).toMatch(/workspaces/);
			expect(parsed.error).toMatch(/node/i);
		}
	});

	it("refuses a workspaces map even alongside valid commands — partial acceptance would teach the wrong shape", () => {
		expect("error" in parseWorkspaceOffer({ commands: { build: COMMAND }, workspaces: {} })).toBe(true);
	});

	it("refuses a `path` key — where a workspace IS is the node's to say", () => {
		expect("error" in parseWorkspaceOffer({ path: "/somewhere", commands: {} })).toBe(true);
	});

	it("an empty declaration is valid — a workspace that offers nothing is not an error", () => {
		const parsed = parseWorkspaceOffer({});
		expect("offer" in parsed && parsed.offer.commands).toEqual({});
	});

	it("refuses a non-object", () => {
		expect("error" in parseWorkspaceOffer("nope")).toBe(true);
		expect("error" in parseWorkspaceOffer(null)).toBe(true);
	});
});

describe("workspaceOfferPath", () => {
	it("is workspace.json inside the workspace's sovereign dir, never config.json", () => {
		const p = workspaceOfferPath("/home/op/github/refarm");
		expect(p).toContain("workspace.json");
		expect(p).not.toContain("config.json");
	});
});
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm --filter @refarm.dev/refarm exec vitest run src/commands/workspace-declaration.test.ts`

- [ ] **Step 3: Implement**

The refusal messages carry weight: they are what teaches the grammar to whoever wrote the wrong shape. Name what was found, say where that belongs instead (the node's catalog, `~/.refarm/config.json`), and name the command that puts it there. Follow `parseWorkspaceOption` in `dispatch-capability.ts` for the `{ value } | { error }` idiom this codebase already uses.

Reuse the existing `WorkspaceDeclaredCommand` type from `workspace.ts` rather than defining a second command shape — two shapes for one concept is the defect this plan exists to end.

- [ ] **Step 4: Verify and commit.**

---

### Task 2: `refarm workspace sync` — the offer becomes a proposal

**Files:**
- Create: `apps/refarm/src/commands/workspace-sync.ts` and its test
- Modify: `apps/refarm/src/commands/workspace.ts` (register the subcommand; make `--local` write the offer shape)

**Interfaces:**
- Consumes: `parseWorkspaceOffer`, `workspaceOfferPath` from Task 1.
- Produces: `export function planWorkspaceSync(input: { offer: WorkspaceOffer; catalogEntry: DeclaredWorkspaceConfig }): SyncPlan` — pure. `SyncPlan` carries `additions`, `collisions` (name, node's definition, workspace's rejected one) and `unchanged`.

- [ ] **Step 1: Write the failing test**

Cover: an offer with commands the catalog lacks (all additions); an offer whose command name the catalog already declares (a collision, the NODE's definition retained, the workspace's recorded as rejected); an offer identical to what the catalog holds (unchanged, no noise); an empty offer (a valid no-op).

The collision case is the one that matters. Assert the plan keeps the node's definition AND surfaces the rejected one — a plan that merely dropped the workspace's version would be silent precedence with extra steps.

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement the pure planner, then the command**

`refarm workspace sync <id>` resolves the workspace from the node catalog, reads its offer, prints the plan, and writes only on confirmation. `--json` prints the plan without writing. Accepted commands are written into the node catalog carrying provenance — the operator must be able to tell what he authored from what he accepted, which is the same distinction `workspace_source` draws for attribution.

`--local` on `refarm workspace add` currently writes a `workspaces` map into the workspace's `config.json`. Point it at `workspace.json` and the offer shape. If that turns out to change the meaning of the flag rather than its target, say so in the report rather than forcing it — a flag whose name no longer matches what it does is its own defect.

- [ ] **Step 4: Verify** — unit tests, `pnpm --filter @refarm.dev/refarm run type-check`, full package suite.

- [ ] **Step 5: Commit.**

---

### Task 3: Migrate this machine

**Files:** `~/.refarm/config.json`, `<repo>/.refarm/config.json`, `<repo>/.refarm/workspace.json`

Back up every file before touching it, as `~/.refarm/config.json.bak-antes-da-base-declarada` already demonstrates the house does.

1. `~/.refarm/config.json`: `refarm` keeps `path` (absolute), `kind`, `execution`. **Remove its five VPN commands** — they were copied there on 2026-08-06 and belong to the workspace.
2. `<repo>/.refarm/workspace.json`: **new**, carrying those five commands as the refarm workspace's offer.
3. `<repo>/.refarm/config.json`: **remove the `workspaces` map entirely.** If nothing else remains in the file, say so and leave the decision about deleting it to the report rather than removing a file that might carry other keys.
4. **`rcdc5`: untouched.** Its `code-boundaries` command stays in the node catalog; nothing is written into that repository. Verify at the end that it still resolves.

- [ ] Do each step, then run `refarm workspace list --json` and confirm both workspaces still resolve with `refarm` carrying no commands until synced.
- [ ] Run `refarm workspace sync refarm --json` and confirm the plan proposes exactly the five commands as additions.
- [ ] Accept it, and confirm they appear in the node catalog with provenance.
- [ ] Commit the repo-side files; the home config is outside the repository, so record its before/after in the report instead.

---

### Task 4: Prove the separation on the node

**Files:** none — evidence.

- [ ] **Step 1: The catalog no longer depends on where you stand**

```bash
pnpm --filter @refarm.dev/refarm run build
for d in "$PWD" ~/git/rcdc5 /tmp; do
  echo "--- from $d"
  (cd "$d" && SOVEREIGN_BASE="$HOME" refarm workspace list --json | python3 -c "
import sys,json; d=json.load(sys.stdin); print(' ', sorted(w['id'] for w in d['workspaces']))")
done
```

Expected: identical output from all three. Before this line of work it was `[refarm, rcdc5]`, `[]`, `[]`.

- [ ] **Step 2: A workspace cannot declare a node**

Write a `workspaces` map into a scratch copy of a `workspace.json`, run the reader against it, and confirm it is REFUSED with the grammar named. Do this against a temporary file, not against the real repository declaration. Paste the message.

- [ ] **Step 3: rcdc5 still works with nothing written into it**

```bash
refarm workspace list --json | python3 -c "
import sys,json
d=json.load(sys.stdin)
w=[x for x in d['workspaces'] if x['id']=='rcdc5'][0]
print('path:', w['absolutePath'], '| commands:', list((w.get('commands') or {}).keys()))
"
ls ~/git/rcdc5/rcdc5/.refarm 2>&1 | head -2
```

Expected: `code-boundaries` present, and NO `.refarm` directory in the rcdc5 repository.

- [ ] **Step 4: Gate and commit the evidence.**

---

### Task 5: Record the decision and what it unblocks

**Files:** Modify the spec, and `.project/handoff.json` if the loose-ends queue is affected.

- [ ] Record in the spec that the filename question is decided — `workspace.json`, distinct from `config.json` — and why: one name for two roles is the defect the spec exists to end.
- [ ] Record that `<repo>/.refarm/` is now free of catalog duties, which is what the isolated sandbox launcher needed. Name it as unblocked rather than done.
- [ ] Record what is NOT closed: the CLI's own base still resolves from the current directory when `SOVEREIGN_BASE` is unexported, so the CLI and node can still disagree. That remains the operator's decision.

---

## Self-Review

| Requirement | Task |
| --- | --- |
| A workspace declaration cannot name another workspace | 1 |
| A `workspaces` map is refused with the grammar named, not ignored | 1, 4 |
| A distinct filename, decided and recorded | 1, 5 |
| An offer is not live until accepted | 2 |
| The node wins a collision and the rejected definition is surfaced | 2 |
| Accepted commands carry provenance | 2 |
| The catalog resolves identically from any directory | 4 |
| rcdc5 untouched, still working | 3, 4 |
| One runtime source of truth | 2 (acceptance writes; nothing merges at read time) |

**Known follow-up, out of scope:** the CLI's positional base fallback; the workspace hatch; the sandbox launcher itself. The loose-ends queue in `.project/handoff.json` carries ten items from earlier plans, none touched here.
