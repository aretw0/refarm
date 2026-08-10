# The Requirements Record Joins The Ledger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the operator's twelve requirements first-class data, let a work item declare which
one it serves, and turn *"which requirement is my next axis"* into a number a command returns.

**Architecture:** `.project/requirements.json` becomes the record (R1–R12 relocated verbatim out of
`docs/OPERATOR_REQUIREMENTS.md`, which becomes an index the gate keeps honest). The work-item
contract gains an optional `requirement` field, mirroring `axis` in all four places `axis` lives:
schema, neutral contract, writer verb, gate check. A new `refarm requirements` command family reads
both documents and reports per-requirement open counts plus an unserved bucket.

**Tech Stack:** TypeScript (`apps/refarm`, `packages/cli`), JavaScript (`packages/config`,
`scripts/`), vitest for TS, `node --test` for `scripts/*.mjs`, Commander for the CLI, JSON Schema
draft-07 for `.project/schemas/`.

**Spec:** [`docs/superpowers/specs/2026-08-09-requirements-join-the-ledger-design.md`](../specs/2026-08-09-requirements-join-the-ledger-design.md)

## Global Constraints

- **Source sovereignty.** Edit `src/` only. Never edit `dist/`, `build/`, `.turbo/`, or any generated
  `.d.ts`. After changing `packages/cli` or `packages/config`, run
  `pnpm --filter @refarm.dev/cli run build` / `pnpm --filter @refarm.dev/config run build` before
  `apps/refarm` consumes the change.
- **Ratchet.** `node scripts/no-os-resolution.mjs` must report **117, delta 0** at every commit. No
  new `?? process.cwd()` or `= process.cwd()` anywhere. The one deliberate cwd read per command
  module goes through a named wrapper, as `apps/refarm/src/commands/issues.ts:42` already does.
- **Lanes.** `refarm agent finish --lane after-edit --run --json` before each commit,
  `--lane after-commit` after it, `--lane handoffs` after any change to public JSON output or CLI
  contracts, `--lane before-push` before pushing.
- **Atomic commits.** One task, one commit, unless a task's steps say otherwise.
- **Relocation, never summary.** No prose moved in this plan may be shortened, rephrased or
  re-ordered. Task 3's byte-identity check is what proves it, and it is not optional.
- **No `refarm ask`.** It spends the operator's paid quota.
- **Vocabulary, fixed:** maturity tokens are `provado`, `parcial`, `projetado`, `ausente`,
  `decisao-do-operador`, `desconhecido`. Requirement ids are `R1`…`R12`, unprefixed.

## File Structure

| File | Responsibility | Task |
| --- | --- | --- |
| `.project/schemas/requirements.schema.json` | +5 optional fields (`title`, `maturity`, `maturity_note`, `evidence`, `acceptance_criteria_preamble`) | 2 |
| `scripts/migrate-operator-requirements.mjs` | Pure extractor: Markdown section → 12 records; `--write`, `--verify`, `--index` modes | 2, 3, 4 |
| `scripts/migrate-operator-requirements.test.mjs` | Extractor unit tests (`node --test`) | 2 |
| `.project/requirements.json` | +12 entries R1–R12 | 3 |
| `docs/OPERATOR_REQUIREMENTS.md` | *Resultados exigidos* becomes an index table | 4 |
| `packages/cli/src/work-items/contract.ts` | `requirement` in the neutral contract + capability table | 5 |
| `packages/cli/src/work-items/project-json-adapter.ts` | read/write `requirement`; `withAxis` → `withField`; `setRequirement` | 5 |
| `.project/schemas/issues.schema.json` | `requirement` property | 5 |
| `packages/config/src/workspaces-config.js` | `normalizeWorkspaceRequirements` | 6 |
| `packages/cli/src/workspace-scope.ts` | Workspace selection shared by both resolvers | 6 |
| `packages/cli/src/requirements/catalog.ts` | Requirement record shape + document reader | 6 |
| `packages/cli/src/requirements/resolve.ts` | `resolveWorkspaceRequirements` — five states | 6 |
| `apps/refarm/src/commands/issues.ts` | `set-requirement`, `--requirement`, `--unserved`, validate finding | 7 |
| `apps/refarm/src/commands/requirements.ts` | `list`, `set-maturity`, `validate` | 8 |
| `apps/refarm/src/program.ts` | register the command | 8 |
| `apps/refarm/src/commands/resume.ts` | one extra `nextCommand` | 8 |
| `scripts/ci/project-block-consistency.mjs` | citation check (blocks), proved-with-open (warns) | 9 |
| `docs/WORK_ITEM_LEDGER.md`, `.project/handoff.json` | reader's guide + the slice narrative | 10 |

---

### Task 1: Verify the spec's measurements before writing any code

**Files:**
- Create: `.superpowers/sdd/2026-08-09-requirements-join-the-ledger/task-1-report.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a verdict per measurement. **This task is a stop gate.** If any measurement below is
  false, STOP, add a dated erratum to the top of the spec (the pattern
  `docs/superpowers/specs/2026-08-08-the-ledger-is-alive-design.md` established), and re-plan the
  affected task before continuing.

The spec was written from six measurements. Five of them decide a design choice. A plan that starts
by trusting them repeats the defect this line of work exists to close.

- [ ] **Step 1: Re-take each measurement**

```bash
# M1 — the requirements record is stale, and by how much
git log -1 --format='%ad %h' --date=short -- .project/requirements.json
git rev-list --count "$(git log -1 --format=%H -- .project/requirements.json)..HEAD"
# expect: 2026-05-05 548c472d  /  ~2672 (grows with this branch; must be > 2000)

# M2 — the freshness anchor watches issues.json only
grep -n 'rev-list\|log -1' scripts/ci/project-block-consistency.mjs
# expect: the only path argument is .project/issues.json

# M3 — the second workspace's schema is identical and its document is empty
diff <(python3 -m json.tool ~/git/rcdc5/rcdc5/.project/schemas/requirements.schema.json) \
     <(python3 -m json.tool .project/schemas/requirements.schema.json) && echo IDENTICAL
cat ~/git/rcdc5/rcdc5/.project/requirements.json
# expect: IDENTICAL  /  {"requirements": []}

# M4 — blast radius
grep -rn "requirements.json" --include='*.ts' --include='*.mjs' --include='*.js' . \
  | grep -v node_modules | grep -v '/dist/'
# expect: scripts/ci/project-block-consistency.mjs only

# M5 — a declared `requirements` block is DROPPED by normalisation today
node -e '
const { normalizeDeclaredWorkspaces } = await import("./packages/config/src/workspaces-config.js");
' 2>/dev/null || node --input-type=module -e '
import { declaredWorkspacesFromConfig } from "./packages/config/src/index.js";
const out = declaredWorkspacesFromConfig(
  { workspaces: { w: { path: ".", requirements: { provider: "project-json" } } } },
  { baseDir: "/tmp" },
);
console.log(JSON.stringify(out, null, 2));
'
# expect: no `requirements` key on the normalised workspace — proving Task 6 is required for the
# declared state to be reachable at all, rather than dead code exercised only by tests.
```

- [ ] **Step 2: Verify the extractor's assumptions hold for all twelve blocks**

```bash
grep -c '^### R[0-9]' docs/OPERATOR_REQUIREMENTS.md          # expect 12
grep -c '^\*\*Necessidade\.\*\*' docs/OPERATOR_REQUIREMENTS.md   # expect 12
grep -c '^\*\*Critérios de aceitação\.\*\*' docs/OPERATOR_REQUIREMENTS.md  # expect 12
grep -c '^\*\*Estado:' docs/OPERATOR_REQUIREMENTS.md          # expect 12
grep -c '^\*\*Evidência\.\*\*' docs/OPERATOR_REQUIREMENTS.md  # expect 3 (R1, R2, R3)
grep -n '^\*\*Critérios de aceitação\.\*\* .' docs/OPERATOR_REQUIREMENTS.md  # expect 3 (R3, R8, R12)
```

Any count that differs means the extractor in Task 2 needs another branch. Record the real counts in
the report; do not adjust the expectation silently.

- [ ] **Step 3: Write the report and commit it**

The report records, per measurement: the command, its real output, and `CONFIRMED` / `DIVERGED`.
`.superpowers/sdd/` is gitignored (ISS-070), so **also** paste the six verdicts into the task-1
section of this plan file, which is tracked. That is the entire reason ISS-070 exists.

```bash
git add docs/superpowers/plans/2026-08-09-requirements-join-the-ledger.md
git commit -m "docs(plan): the requirements slice, with task 1's measurements confirmed in-tree"
```

---

### Task 2: Extend the requirements schema and build the verbatim extractor

**Files:**
- Modify: `.project/schemas/requirements.schema.json`
- Create: `scripts/migrate-operator-requirements.mjs`
- Test: `scripts/migrate-operator-requirements.test.mjs`

**Interfaces:**
- Consumes: nothing.
- Produces: `extractRequirements(markdown) → Requirement[]`, `dewrap(text) → string`,
  `renderIndexTable(requirements) → string`, `parseIndexTable(markdown) → {id,title,maturity}[]` —
  all exported from `scripts/migrate-operator-requirements.mjs`, all pure, all reused by Tasks 3, 4
  and 9.

**Why an extractor and not typing twelve records by hand:** the migration must be provably verbatim.
A script that slices strings out of the source can be tested against the source; a human retyping
430 lines of Portuguese cannot. This is the same choice the 2026-08-08 migration made when it sliced
handoff prose at runtime, and the reviewer who checked it split 26,551 characters into 147 chunks
and found 143 byte-identical.

- [ ] **Step 1: Extend the schema**

Add to `.project/schemas/requirements.schema.json`, inside `properties.requirements.items.properties`,
leaving `required` untouched so all 31 legacy entries stay valid:

```json
"title": {
	"type": "string",
	"description": "Short heading for the requirement, e.g. 'Continuidade operacional'. Optional: the May-era cohort has none."
},
"maturity": {
	"type": "string",
	"enum": ["provado", "parcial", "projetado", "ausente", "decisao-do-operador", "desconhecido"],
	"description": "What reality measures, in the operator's own six-state vocabulary (docs/OPERATOR_REQUIREMENTS.md). Distinct from `status`, which is what the operator DECIDED: a requirement can be accepted and parcial at once. Tokens are Portuguese because the table defining them is."
},
"maturity_note": {
	"type": "string",
	"description": "The justification paragraph carried verbatim from the source document, including any qualifier the enum cannot hold (R8: 'Parcial/Ausente por provedor.')."
},
"acceptance_criteria_preamble": {
	"type": "string",
	"description": "The qualifier between 'Critérios de aceitação.' and the bullets, when present (R3, R8, R12). Kept as its own field because folding it into a bullet would corrupt a criterion and dropping it would silently make conditional criteria unconditional."
},
"evidence": {
	"type": "array",
	"items": { "type": "string" },
	"description": "Markdown links to the documents that sustain the current maturity, verbatim."
}
```

- [ ] **Step 2: Write the failing tests**

Create `scripts/migrate-operator-requirements.test.mjs`. The fixture is a **verbatim copy** of R3's
block (the hardest shape: a criteria preamble, evidence, a wrapped need paragraph):

```javascript
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
	dewrap,
	extractRequirements,
	parseIndexTable,
	renderIndexTable,
} from "./migrate-operator-requirements.mjs";

const R3_FIXTURE = `## Resultados exigidos

### R3. Ledger universal de trabalho

**Necessidade.** Prestar contas de tudo em que esforço é gasto, inclusive trabalho realizado por
ferramentas ou plataformas que o Refarm não despachou.

**Critérios de aceitação.** Cada unidade de trabalho pode registrar, quando conhecido:

- identificador e relação com tarefa, sessão, cenário e resultado;
- lacunas de observação, truncamento e campos desconhecidos.

**Estado: Parcial.** \`BudgetObservation\` registra esforços despachados pelo Refarm e a atribuição de
workspace começou a chegar à origem.

**Evidência.**
[\`The budget belongs to whoever spawns\`](./superpowers/specs/2026-08-03-budget-laboratory-design.md),
[\`SOVEREIGN_RECORD_ORDERING.md\`](./SOVEREIGN_RECORD_ORDERING.md).

## Jornada mínima de confiança
`;

describe("dewrap", () => {
	it("joins hard-wrapped lines with a single space and changes nothing else", () => {
		assert.equal(dewrap("uma linha\nquebrada aqui"), "uma linha quebrada aqui");
	});

	it("leaves a single line untouched, including its punctuation and smart quotes", () => {
		assert.equal(dewrap("“onde eu estava?” — sem memória."), "“onde eu estava?” — sem memória.");
	});
});

describe("extractRequirements", () => {
	const [r3] = extractRequirements(R3_FIXTURE);

	it("takes the id and title from the heading", () => {
		assert.equal(r3.id, "R3");
		assert.equal(r3.title, "Ledger universal de trabalho");
	});

	it("carries the need paragraph verbatim, de-wrapped", () => {
		assert.equal(
			r3.description,
			"Prestar contas de tudo em que esforço é gasto, inclusive trabalho realizado por ferramentas ou plataformas que o Refarm não despachou.",
		);
	});

	it("keeps the criteria preamble as its own field, never as a criterion", () => {
		assert.equal(r3.acceptance_criteria_preamble, "Cada unidade de trabalho pode registrar, quando conhecido:");
		assert.equal(r3.acceptance_criteria.length, 2);
		assert.equal(r3.acceptance_criteria[0], "identificador e relação com tarefa, sessão, cenário e resultado;");
	});

	it("derives the maturity token from the first word and keeps the whole state text in the note", () => {
		assert.equal(r3.maturity, "parcial");
		assert.ok(r3.maturity_note.startsWith("Parcial. `BudgetObservation` registra"));
	});

	it("carries each evidence link whole, never split on the comma inside it", () => {
		assert.equal(r3.evidence.length, 2);
		assert.equal(
			r3.evidence[0],
			"[`The budget belongs to whoever spawns`](./superpowers/specs/2026-08-03-budget-laboratory-design.md)",
		);
	});

	it("stops at the next level-2 heading and returns exactly one requirement", () => {
		assert.equal(extractRequirements(R3_FIXTURE).length, 1);
	});
});

describe("qualified maturity states", () => {
	it("takes the family state for a dual state and keeps the qualifier verbatim in the note", () => {
		const dual = R3_FIXTURE.replace("**Estado: Parcial.**", "**Estado: Parcial/Ausente por provedor.**");
		const [req] = extractRequirements(dual);
		assert.equal(req.maturity, "parcial");
		assert.ok(req.maturity_note.startsWith("Parcial/Ausente por provedor."));
	});

	it("takes the state for a scoped state and keeps the scope verbatim in the note", () => {
		const scoped = R3_FIXTURE.replace("**Estado: Parcial.**", "**Estado: Ausente como visão integrada.**");
		const [req] = extractRequirements(scoped);
		assert.equal(req.maturity, "ausente");
		assert.ok(req.maturity_note.startsWith("Ausente como visão integrada."));
	});

	it("refuses a state word that is not in the vocabulary rather than guessing", () => {
		const bogus = R3_FIXTURE.replace("**Estado: Parcial.**", "**Estado: Quase.**");
		assert.throws(() => extractRequirements(bogus), /Quase/);
	});
});

describe("the index table round-trips", () => {
	it("parses back exactly what it renders", () => {
		const rows = [{ id: "R1", title: "Continuidade operacional", maturity: "parcial" }];
		assert.deepEqual(parseIndexTable(renderIndexTable(rows)), rows);
	});
});

describe("the live document", () => {
	const live = readFileSync("docs/OPERATOR_REQUIREMENTS.md", "utf8");

	it("yields twelve requirements with no missing field", () => {
		const all = extractRequirements(live);
		assert.equal(all.length, 12);
		for (const req of all) {
			assert.ok(req.id && req.title && req.description, `${req.id} is missing a core field`);
			assert.ok(req.acceptance_criteria.length > 0, `${req.id} has no criteria`);
			assert.ok(req.maturity && req.maturity_note, `${req.id} has no maturity`);
		}
	});
});
```

**Note on the last block:** once Task 4 rewrites the Markdown, `extractRequirements(live)` will find
zero requirements. Task 4 changes that test to read the pre-rewrite document out of git
(`git show <task-3-commit>:docs/OPERATOR_REQUIREMENTS.md`), which keeps the check runnable forever
instead of deleting it. Do not delete it.

- [ ] **Step 3: Run the tests and watch them fail**

```bash
node --test scripts/migrate-operator-requirements.test.mjs
```
Expected: `Cannot find module './migrate-operator-requirements.mjs'`.

- [ ] **Step 4: Write the extractor**

Create `scripts/migrate-operator-requirements.mjs`:

```javascript
#!/usr/bin/env node
/**
 * Relocates R1–R12 out of docs/OPERATOR_REQUIREMENTS.md into .project/requirements.json,
 * VERBATIM. Every string this file produces is a slice of the source with hard wrapping undone —
 * no word is added, removed or reordered — which is what makes the migration checkable instead of
 * trusted. See docs/superpowers/specs/2026-08-09-requirements-join-the-ledger-design.md.
 */
import { readFileSync, writeFileSync } from "node:fs";

const SECTION = "## Resultados exigidos";
const MATURITIES = ["provado", "parcial", "projetado", "ausente", "decisao-do-operador", "desconhecido"];

/** Hand-assigned, because the source document has no type vocabulary and the schema requires one.
 *  Kept as a visible table rather than inferred from prose: a wrong call here should be correctable
 *  by editing one line, not by re-reading a heuristic. */
const TYPES = {
	R1: "functional", R2: "functional", R3: "functional", R4: "functional",
	R5: "functional", R6: "functional", R7: "functional", R8: "integration",
	R9: "functional", R10: "constraint", R11: "non-functional", R12: "functional",
};

/** Undoes the source's hard wrapping. A wrapped paragraph and its single-line form are the same
 *  prose; collapsing the newline is the ONLY transformation this migration performs. */
export function dewrap(text) {
	return text.split("\n").map((line) => line.trim()).filter(Boolean).join(" ");
}

/** "Parcial/Ausente por provedor." → "parcial". The first word is the family's state; anything
 *  after it is a qualifier the enum cannot hold and `maturity_note` keeps verbatim. Two of the
 *  twelve are qualified this way (R8 dual, R12 scoped) and neither is special-cased. */
function maturityToken(stateText) {
	const first = stateText.split(/[\s/.,]/)[0].toLowerCase();
	const token = first
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^a-z]/g, "");
	const match = MATURITIES.find((candidate) => candidate.replace(/-/g, "") === token || candidate === token);
	if (!match) throw new Error(`Unknown maturity state: "${stateText}" (first word "${first}")`);
	return match;
}

function blockOf(lines, startIndex) {
	const out = [];
	for (let i = startIndex; i < lines.length; i += 1) {
		if (lines[i].startsWith("### ") || lines[i].startsWith("## ")) break;
		out.push(lines[i]);
	}
	return out;
}

/** Everything between a `**Label.**` marker and the next blank line or `**` marker. */
function paragraphAfter(lines, marker) {
	const index = lines.findIndex((line) => line.startsWith(marker));
	if (index === -1) return null;
	const collected = [lines[index].slice(marker.length)];
	for (let i = index + 1; i < lines.length; i += 1) {
		if (!lines[i].trim() || lines[i].startsWith("**") || lines[i].startsWith("- ")) break;
		collected.push(lines[i]);
	}
	return dewrap(collected.join("\n"));
}

export function extractRequirements(markdown) {
	const lines = markdown.split("\n");
	const start = lines.findIndex((line) => line.trim() === SECTION);
	if (start === -1) return [];
	const scope = lines.slice(start + 1);
	const end = scope.findIndex((line) => line.startsWith("## "));
	const body = end === -1 ? scope : scope.slice(0, end);

	const requirements = [];
	for (let i = 0; i < body.length; i += 1) {
		const heading = /^### (R\d+)\. (.+)$/.exec(body[i]);
		if (!heading) continue;
		const [, id, title] = heading;
		const block = blockOf(body, i + 1);

		const state = paragraphAfter(block, "**Estado:");
		if (!state) throw new Error(`${id} has no **Estado:** paragraph`);
		const maturityNote = dewrap(state.replace(/^\s*/, "").replace(/\*\*/g, ""));

		const criteriaPreamble = paragraphAfter(block, "**Critérios de aceitação.**");
		const criteria = block
			.filter((line) => line.startsWith("- "))
			.map((line) => dewrap(line.slice(2)));
		const evidenceLine = paragraphAfter(block, "**Evidência.**") ?? "";
		const evidence = [...evidenceLine.matchAll(/\[[^\]]+\]\([^)]+\)/g)].map((match) => match[0]);

		const record = {
			id,
			title,
			description: paragraphAfter(block, "**Necessidade.**"),
			type: TYPES[id] ?? "functional",
			status: "accepted",
			priority: "must",
			acceptance_criteria: criteria,
			source: "human",
			maturity: maturityToken(maturityNote),
			maturity_note: maturityNote,
		};
		if (criteriaPreamble) record.acceptance_criteria_preamble = criteriaPreamble;
		if (evidence.length > 0) record.evidence = evidence;
		requirements.push(record);
	}
	return requirements;
}

export function renderIndexTable(rows) {
	return [
		"| Id | Resultado | Maturidade |",
		"| --- | --- | --- |",
		...rows.map((row) => `| ${row.id} | ${row.title} | ${row.maturity} |`),
	].join("\n");
}

export function parseIndexTable(markdown) {
	return markdown
		.split("\n")
		.map((line) => /^\| (R\d+) \| (.+?) \| ([a-z-]+) \|$/.exec(line.trim()))
		.filter(Boolean)
		.map(([, id, title, maturity]) => ({ id, title, maturity }));
}

function main() {
	const markdown = readFileSync("docs/OPERATOR_REQUIREMENTS.md", "utf8");
	const extracted = extractRequirements(markdown);
	if (process.argv.includes("--write")) {
		const document = JSON.parse(readFileSync(".project/requirements.json", "utf8"));
		const existing = new Set(document.requirements.map((entry) => entry.id));
		const added = extracted.filter((entry) => !existing.has(entry.id));
		document.requirements.push(...added);
		writeFileSync(".project/requirements.json", `${JSON.stringify(document, null, 2)}\n`);
		console.log(`added ${added.length} requirement(s)`);
		return;
	}
	console.log(JSON.stringify(extracted, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

**The `import.meta.url` guard is not optional** — `scripts/ci/project-block-consistency.mjs` carries
the same one with a comment explaining that without it, importing the module for tests runs `main()`
and can kill the whole test file.

- [ ] **Step 5: Run the tests until they pass**

```bash
node --test scripts/migrate-operator-requirements.test.mjs
```
Expected: all pass, including `the live document → yields twelve requirements with no missing field`.

- [ ] **Step 6: Confirm the extraction by eye, once**

```bash
node scripts/migrate-operator-requirements.mjs | head -60
node scripts/migrate-operator-requirements.mjs | python3 -c "
import json,sys
for r in json.load(sys.stdin):
    print(r['id'], '|', r['maturity'], '|', len(r['acceptance_criteria']), 'criteria |',
          len(r.get('evidence',[])), 'evidence |', 'preamble' if r.get('acceptance_criteria_preamble') else '-')
"
```
Expected: 12 rows, `R8 | parcial`, `R12 | ausente`, preambles on R3/R8/R12 only, evidence on R1/R2/R3
only.

- [ ] **Step 7: Gate, then commit**

```bash
node scripts/ci/project-block-consistency.mjs   # must still pass — nothing was written yet
refarm agent finish --lane after-edit --run --json
git add .project/schemas/requirements.schema.json scripts/migrate-operator-requirements.mjs scripts/migrate-operator-requirements.test.mjs
git commit -m "feat(requirements): the schema learns maturity, and an extractor that can be checked"
refarm agent finish --lane after-commit --run --json
```

---

### Task 3: Migrate R1–R12 into the record, and prove it byte-identical

**Files:**
- Modify: `.project/requirements.json`

**Interfaces:**
- Consumes: `extractRequirements` from Task 2.
- Produces: 12 records with ids `R1`…`R12` in `.project/requirements.json`. Every later task assumes
  these ids exist.

- [ ] **Step 1: Write the records**

```bash
node scripts/migrate-operator-requirements.mjs --write
```
Expected: `added 12 requirement(s)`.

- [ ] **Step 2: Prove the schema still accepts the whole document, legacy entries included**

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
const doc = JSON.parse(readFileSync(".project/requirements.json", "utf8"));
console.log("total:", doc.requirements.length);
console.log("legacy untouched:", doc.requirements.filter(r => r.id.startsWith("REQ-")).length);
console.log("operator:", doc.requirements.filter(r => /^R\d+$/.test(r.id)).length);
'
```
Expected: `total: 43`, `legacy untouched: 31`, `operator: 12`.

- [ ] **Step 3: Prove the relocation is verbatim, not a summary**

Every extracted string must appear in the source document once its wrapping is undone. This is the
check that makes "relocation, not summarisation" a fact rather than a claim:

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { dewrap } from "./scripts/migrate-operator-requirements.mjs";
const source = dewrap(readFileSync("docs/OPERATOR_REQUIREMENTS.md", "utf8").replace(/\*\*/g, ""));
const doc = JSON.parse(readFileSync(".project/requirements.json", "utf8"));
let checked = 0, missing = [];
for (const req of doc.requirements.filter(r => /^R\d+$/.test(r.id))) {
  const strings = [req.title, req.description, req.maturity_note, req.acceptance_criteria_preamble,
                   ...req.acceptance_criteria, ...(req.evidence ?? [])].filter(Boolean);
  for (const value of strings) { checked++; if (!source.includes(value)) missing.push([req.id, value.slice(0, 70)]); }
}
console.log("strings checked:", checked, "| not found verbatim in source:", missing.length);
for (const [id, value] of missing) console.log("  MISSING", id, value);
process.exit(missing.length === 0 ? 0 : 1);
'
```
Expected: **`not found verbatim in source: 0`**, and roughly 110–130 strings checked. A non-zero
count means the extractor transformed prose — stop and fix the extractor, never the expectation.

- [ ] **Step 4: Gate, then commit**

```bash
node scripts/ci/project-block-consistency.mjs
refarm agent finish --lane after-edit --run --json
git add .project/requirements.json
git commit -m "feat(requirements): R1-R12 relocated into the governed record, verbatim"
refarm agent finish --lane after-commit --run --json
git log -1 --format=%H   # record this hash — Task 4 needs it
```

---

### Task 4: The Markdown becomes an index the gate keeps honest

**Files:**
- Modify: `docs/OPERATOR_REQUIREMENTS.md` (section *Resultados exigidos* only)
- Modify: `scripts/migrate-operator-requirements.test.mjs` (repoint the live-document test at git)

**Interfaces:**
- Consumes: `renderIndexTable`, `parseIndexTable` from Task 2; the commit hash from Task 3.
- Produces: an index table whose rows Task 9's `checkRequirementIndex` will compare against the
  record.

- [ ] **Step 1: Generate the table**

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { renderIndexTable } from "./scripts/migrate-operator-requirements.mjs";
const doc = JSON.parse(readFileSync(".project/requirements.json", "utf8"));
console.log(renderIndexTable(doc.requirements.filter(r => /^R\d+$/.test(r.id))));
'
```

- [ ] **Step 2: Replace the section**

Replace everything from `## Resultados exigidos` up to (not including) `## Jornada mínima de
confiança` with:

```markdown
## Resultados exigidos

Os doze resultados exigidos vivem em `.project/requirements.json`, o registro governado — com a
necessidade, os critérios de aceitação, o estado de maturidade e a evidência de cada um, **verbatim**
como foram escritos nesta seção em 2026-08-06. Esta tabela é o índice, e a divergência entre ela e o
registro é bloqueada pelo gate (`scripts/ci/project-block-consistency.mjs`).

<TABLE FROM STEP 1>

Para ler um resultado por inteiro, ou para saber quantos itens abertos separam você de qualquer um
deles:

```bash
refarm requirements list --workspace refarm --json
refarm issues list --workspace refarm --requirement R7 --json
refarm issues list --workspace refarm --unserved --json
```

A prosa não foi resumida ao mudar de arquivo: `refarm requirements list --json` devolve cada campo
inteiro. O histórico da seção original está em
`git show <TASK-3-COMMIT>:docs/OPERATOR_REQUIREMENTS.md`.
```

Substitute the real table and the real commit hash. **Every other section of the document stays
exactly as it is** — mission, principles, minimum journey, trust gates, cultivation order, the seven
operator decisions, the protocol and the next-review note.

- [ ] **Step 3: Repoint the live-document test instead of deleting it**

In `scripts/migrate-operator-requirements.test.mjs`, replace the `describe("the live document")`
block with:

```javascript
import { execFileSync } from "node:child_process";

describe("the source document, as it stood when the record was written", () => {
	// The live file is an index now (Task 4). The relocation's source is the pre-rewrite document,
	// which git holds forever — so this check keeps running rather than being deleted the moment it
	// would first have been able to catch a regression.
	const SOURCE_COMMIT = "<TASK-3-COMMIT>";
	const live = execFileSync("git", ["show", `${SOURCE_COMMIT}:docs/OPERATOR_REQUIREMENTS.md`], {
		encoding: "utf8",
	});

	it("yields twelve requirements with no missing field", () => {
		const all = extractRequirements(live);
		assert.equal(all.length, 12);
		for (const req of all) {
			assert.ok(req.id && req.title && req.description, `${req.id} is missing a core field`);
			assert.ok(req.acceptance_criteria.length > 0, `${req.id} has no criteria`);
			assert.ok(req.maturity && req.maturity_note, `${req.id} has no maturity`);
		}
	});

	it("matches the record that was written from it", () => {
		const doc = JSON.parse(readFileSync(".project/requirements.json", "utf8"));
		const record = doc.requirements.filter((entry) => /^R\d+$/.test(entry.id));
		assert.deepEqual(extractRequirements(live), record);
	});
});
```

- [ ] **Step 4: Run the tests**

```bash
node --test scripts/migrate-operator-requirements.test.mjs
```
Expected: all pass, including `matches the record that was written from it`.

- [ ] **Step 5: Verify the index agrees with the record, by hand this once**

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
import { parseIndexTable } from "./scripts/migrate-operator-requirements.mjs";
const rows = parseIndexTable(readFileSync("docs/OPERATOR_REQUIREMENTS.md", "utf8"));
const doc = JSON.parse(readFileSync(".project/requirements.json", "utf8"));
const record = doc.requirements.filter(r => /^R\d+$/.test(r.id));
console.log("rows:", rows.length, "| record:", record.length);
for (const row of rows) {
  const match = record.find(r => r.id === row.id);
  if (!match || match.title !== row.title || match.maturity !== row.maturity) console.log("  DRIFT", row.id);
}
'
```
Expected: `rows: 12 | record: 12`, no DRIFT lines. Task 9 turns this into a gate check.

- [ ] **Step 6: Commit**

```bash
refarm agent finish --lane after-edit --run --json
git add docs/OPERATOR_REQUIREMENTS.md scripts/migrate-operator-requirements.test.mjs
git commit -m "docs(requirements): the baseline becomes an index over the record it used to be"
refarm agent finish --lane after-commit --run --json
```

---

### Task 5: `requirement` joins the work-item contract

**Files:**
- Modify: `packages/cli/src/work-items/contract.ts`
- Modify: `packages/cli/src/work-items/project-json-adapter.ts`
- Modify: `packages/cli/src/work-items/adapter-contract.ts` (the shared suite)
- Modify: `.project/schemas/issues.schema.json`
- Test: `packages/cli/src/work-items/project-json-adapter.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `WorkItem.requirement?: string`
  - `WORK_ITEM_FIELDS` including `"requirement"` (between `axis` and `source`)
  - `WorkItemAdapter.setRequirement(id: string, requirement: string | null): WorkItemWriteResult`
  - `withField(record, key, value, anchors)` internal to the adapter

- [ ] **Step 1: Write the failing tests**

Append to `packages/cli/src/work-items/project-json-adapter.test.ts`:

```typescript
describe("requirement", () => {
	function adapterOver(records: unknown[]) {
		let contents = JSON.stringify({ issues: records });
		return {
			adapter: createProjectJsonAdapter({
				readDocument: () => contents,
				writeDocument: (next) => { contents = next; },
			}),
			read: () => JSON.parse(contents).issues,
		};
	}

	it("writes the requirement immediately after axis, keeping every other key in place", () => {
		const { adapter, read } = adapterOver([
			{ id: "ISS-1", title: "t", body: "b", location: "l", status: "open",
			  category: "issue", priority: "high", package: "p", axis: "cost", description: "rcdc5's extra" },
		]);
		const result = adapter.setRequirement("ISS-1", "R4");
		expect(result.ok).toBe(true);
		expect(Object.keys(read()[0])).toEqual([
			"id", "title", "body", "location", "status", "category", "priority", "package",
			"axis", "requirement", "description",
		]);
		expect(read()[0].description).toBe("rcdc5's extra");
	});

	it("falls back to the position after package when the item carries no axis", () => {
		const { adapter, read } = adapterOver([
			{ id: "ISS-2", title: "t", body: "b", location: "l", status: "resolved",
			  category: "issue", priority: "low", package: "p", resolved_by: "abc123" },
		]);
		adapter.setRequirement("ISS-2", "R9");
		expect(Object.keys(read()[0])).toEqual([
			"id", "title", "body", "location", "status", "category", "priority", "package",
			"requirement", "resolved_by",
		]);
	});

	it("clears the link by removing the key, never by writing an empty string", () => {
		const { adapter, read } = adapterOver([
			{ id: "ISS-3", title: "t", body: "b", location: "l", status: "open",
			  category: "issue", priority: "high", package: "p", axis: "cost", requirement: "R4" },
		]);
		adapter.setRequirement("ISS-3", null);
		expect("requirement" in read()[0]).toBe(false);
	});

	it("refuses an unknown id rather than writing a new record", () => {
		const { adapter, read } = adapterOver([]);
		const result = adapter.setRequirement("ISS-404", "R1");
		expect(result.ok).toBe(false);
		expect(result.error?.reason).toBe("unknown_id");
		expect(read()).toEqual([]);
	});

	it("round-trips the field through list()", () => {
		const { adapter } = adapterOver([
			{ id: "ISS-4", title: "t", body: "b", location: "l", status: "open",
			  category: "issue", priority: "high", package: "p", requirement: "R7" },
		]);
		expect(adapter.list().items[0].requirement).toBe("R7");
	});

	it("does not report `requirement` as an unmodelled extra field", () => {
		const { adapter } = adapterOver([
			{ id: "ISS-5", title: "t", body: "b", location: "l", status: "open",
			  category: "issue", priority: "high", package: "p", requirement: "R7" },
		]);
		expect(adapter.list().extraFields).toEqual([]);
	});

	it("an item classified later is byte-shaped like one added with the field", () => {
		const base = { id: "ISS-6", title: "t", body: "b", location: "l", status: "open" as const,
			category: "issue", priority: "high", package: "p", axis: "cost" as const };
		const { adapter: viaAdd, read: readAdd } = adapterOver([]);
		viaAdd.add({ ...base, requirement: "R2" });
		const { adapter: viaSet, read: readSet } = adapterOver([]);
		viaSet.add(base);
		viaSet.setRequirement("ISS-6", "R2");
		expect(readAdd()).toEqual(readSet());
	});
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter @refarm.dev/cli exec vitest run src/work-items/project-json-adapter.test.ts
```
Expected: `adapter.setRequirement is not a function`.

- [ ] **Step 3: Extend the contract**

In `packages/cli/src/work-items/contract.ts`:

```typescript
export const WORK_ITEM_FIELDS = [
	"id", "title", "body", "location", "status", "priority", "category", "package",
	"axis", "requirement", "source", "resolvedBy",
] as const;
```

```typescript
export interface WorkItem {
	// … existing fields …
	/** Absent means UNSERVED — the item serves no operator requirement, which is a real answer for
	 *  pure hygiene and NEVER folded into a requirement's count. Singular by design: overlapping
	 *  links would make per-requirement totals overlap and stop being decidable numbers. */
	requirement?: string;
}
```

```typescript
	/** Link (or unlink) an item to the operator requirement it serves. `null` CLEARS it — unlike
	 *  `setAxis`, which has no clear because the gate requires an axis on every open item. A wrong
	 *  link fabricates a false count in the exact number this field exists to produce, so the
	 *  writer must be able to undo one. */
	setRequirement(id: string, requirement: string | null): WorkItemWriteResult;
```

- [ ] **Step 4: Extend the adapter**

In `packages/cli/src/work-items/project-json-adapter.ts`:

- add `"requirement"` to `KNOWN_DOCUMENT_FIELDS` (after `"axis"`);
- add `requirement: "native"` to `PROJECT_JSON_CAPABILITIES`;
- in `toWorkItem`: `requirement: typeof record.requirement === "string" ? record.requirement : undefined,`
- in `toDocumentRecord`, after the `axis` line: `if (item.requirement) record.requirement = item.requirement;`
- generalise `withAxis`:

```typescript
/** Rebuilds one record with `key` set (or REMOVED when `value` is null), keeping EVERY other key —
 * including the ones this contract does not model, such as rcdc5's `description` — in its original
 * order. A record lacking the key gets it at the first `anchors` position that exists, so an item
 * classified later is byte-shaped like one classified at `add` and the document does not drift into
 * two layouts. A plain `{ ...record, key }` would append instead, and rebuilding from `toWorkItem`
 * would silently DROP the extra fields. Generalised from `withAxis`, whose two callers (`axis`,
 * `requirement`) differ only in key and anchor. */
function withField(
	record: Record<string, unknown>,
	key: string,
	value: string | null,
	anchors: string[],
): Record<string, unknown> {
	if (value === null) {
		const { [key]: _removed, ...rest } = record;
		return rest;
	}
	if (key in record) return { ...record, [key]: value };
	const anchor = anchors.find((candidate) => candidate in record);
	const next: Record<string, unknown> = {};
	for (const [existingKey, existingValue] of Object.entries(record)) {
		next[existingKey] = existingValue;
		if (existingKey === anchor) next[key] = value;
	}
	if (!(key in next)) next[key] = value;
	return next;
}
```

- `setAxis` now calls `withField(records[index], "axis", axis, ["package"])`;
- add `setRequirement`, mirroring `setAxis`'s shape (read, find, refuse `unknown_id`, write):

```typescript
		setRequirement(id: string, requirement: string | null): WorkItemWriteResult {
			try {
				const { records } = readRecords();
				const index = records.findIndex((record) => String(record.id) === id);
				if (index === -1) {
					return { ok: false, item: null, error: { reason: "unknown_id", message: `No work item with id ${id}.` } };
				}
				const next = [...records];
				next[index] = withField(records[index], "requirement", requirement, ["axis", "package"]);
				write(next);
				return { ok: true, item: toWorkItem(next[index] as Record<string, unknown>), error: null };
			} catch (error) {
				return { ok: false, item: null, error: documentUnreadableError(error) };
			}
		},
```

**No requirement-id validation here.** The adapter cannot see the requirement catalog; the CLI
validates before calling (Task 7) and the gate validates the document (Task 9). Two doors, both
covered, and neither pretending to be the other.

- [ ] **Step 5: Extend the shared adapter suite**

`packages/cli/src/work-items/adapter-contract.ts` runs one suite against every adapter. Add a case
asserting `setRequirement` round-trips and that clearing removes the key, so a future adapter cannot
claim conformance without it. Also update the capability assertion to expect the new field.

- [ ] **Step 6: Extend the issues schema**

In `.project/schemas/issues.schema.json`, after `axis`:

```json
"requirement": {
	"type": "string",
	"description": "Which operator requirement (R1-R12, .project/requirements.json) this item serves. OPTIONAL by decision: several items are pure hygiene and serving no requirement is a real answer. The CI gate requires the cited id to exist; it never requires an item to cite one."
},
```

- [ ] **Step 7: Run everything and build**

```bash
pnpm --filter @refarm.dev/cli exec vitest run src/work-items/
pnpm --filter @refarm.dev/cli run type-check
pnpm --filter @refarm.dev/cli run build
node scripts/no-os-resolution.mjs   # 117, delta 0
```

- [ ] **Step 8: Commit**

```bash
refarm agent finish --lane after-edit --run --json
git add packages/cli/src/work-items .project/schemas/issues.schema.json
git commit -m "feat(work-items): an item can declare which operator requirement it serves"
refarm agent finish --lane after-commit --run --json
```

---

### Task 6: Resolving a workspace's requirement catalog

**Files:**
- Modify: `packages/config/src/workspaces-config.js`
- Create: `packages/cli/src/workspace-scope.ts`
- Create: `packages/cli/src/requirements/catalog.ts`
- Create: `packages/cli/src/requirements/resolve.ts`
- Modify: `packages/cli/src/work-items/resolve.ts` (use the shared selector)
- Modify: `packages/cli/src/index.ts` (exports)
- Test: `packages/cli/src/requirements/resolve.test.ts`, `packages/config/test/workspaces-config.test.js`

**Interfaces:**
- Consumes: `LedgerWorkspace` from `work-items/resolve.ts`.
- Produces:
  - `selectWorkspace(input) → { ok: true, workspace, workspaceFrom } | { ok: false, reason, declared }`
  - `REQUIREMENT_MATURITIES: readonly string[]`
  - `RequirementRecord { id, title?, description, status, priority, type, maturity?, maturity_note?, evidence?, acceptance_criteria?, acceptance_criteria_preamble? }`
  - `resolveWorkspaceRequirements(input) → RequirementsResolution`
  - `RequirementsCatalogRead { ok, requirements, empty, error }`

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/src/requirements/resolve.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveWorkspaceRequirements } from "./resolve.js";

const CATALOG = [
	{ id: "refarm", absolutePath: "/home/op/github/refarm", issues: null,
	  requirements: { provider: "project-json", path: ".project/requirements.json" } },
	{ id: "rcdc5", absolutePath: "/home/op/git/rcdc5", issues: null, requirements: null },
	{ id: "bare", absolutePath: "/home/op/bare", issues: null, requirements: null },
];

const io = {
	loadWorkspaces: () => CATALOG,
	// rcdc5 has the file by convention; `bare` has nothing at all.
	fileExists: (p: string) => p === "/home/op/git/rcdc5/.project/requirements.json",
	readDocument: (p: string) =>
		p.includes("rcdc5")
			? JSON.stringify({ requirements: [] })
			: JSON.stringify({ requirements: [{ id: "R1", description: "d", type: "functional", status: "accepted", priority: "must", maturity: "parcial" }] }),
	writeDocument: () => {},
};

describe("resolveWorkspaceRequirements", () => {
	it("reports a declared catalog as declared", () => {
		const result = resolveWorkspaceRequirements({ workspace: "refarm", cwd: "/tmp", ...io });
		expect(result).toMatchObject({ ok: true, workspaceId: "refarm", workspaceFrom: "flag", providerFrom: "declared" });
	});

	it("finds a catalog by convention and says so", () => {
		const result = resolveWorkspaceRequirements({ workspace: "rcdc5", cwd: "/tmp", ...io });
		expect(result).toMatchObject({ ok: true, providerFrom: "convention" });
	});

	it("gives the same answer from any directory", () => {
		const a = resolveWorkspaceRequirements({ workspace: "refarm", cwd: "/tmp", ...io });
		const b = resolveWorkspaceRequirements({ workspace: "refarm", cwd: "/home/op/git/rcdc5", ...io });
		expect(a.ok && b.ok && a.documentPath).toBe(b.ok ? b.documentPath : "");
	});

	it("refuses a workspace with no catalog at all — never an empty list", () => {
		const result = resolveWorkspaceRequirements({ workspace: "bare", cwd: "/tmp", ...io });
		expect(result).toMatchObject({ ok: false, reason: "no_requirement_catalog" });
	});

	it("distinguishes an EMPTY catalog from an absent one", () => {
		const result = resolveWorkspaceRequirements({ workspace: "rcdc5", cwd: "/tmp", ...io });
		expect(result.ok).toBe(true);
		if (result.ok) {
			const read = result.read();
			expect(read.ok).toBe(true);
			expect(read.empty).toBe(true);
			expect(read.requirements).toEqual([]);
		}
	});

	it("reports an unreadable catalog as unreadable, never as empty", () => {
		const broken = { ...io, readDocument: () => "{ not json" };
		const result = resolveWorkspaceRequirements({ workspace: "refarm", cwd: "/tmp", ...broken });
		expect(result.ok).toBe(true);
		if (result.ok) {
			const read = result.read();
			expect(read.ok).toBe(false);
			expect(read.empty).toBe(false);
			expect(read.error?.reason).toBe("document_unreadable");
		}
	});

	it("refuses an unmatched cwd with the declared list", () => {
		const result = resolveWorkspaceRequirements({ cwd: "/somewhere/else", ...io });
		expect(result).toMatchObject({ ok: false, reason: "cwd_unmatched", declared: ["refarm", "rcdc5", "bare"] });
	});
});
```

**The empty-versus-absent pair is the point of this task.** rcdc5's real catalog is
`{"requirements": []}`; a resolver that collapsed those two states would be accidentally right in
refarm and wrong on the operator's other workspace.

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter @refarm.dev/cli exec vitest run src/requirements/
```

- [ ] **Step 3: Teach `packages/config` about a declared requirements block**

In `packages/config/src/workspaces-config.js`, mirroring `normalizeWorkspaceIssues` exactly
(including its three-state doc comment), add:

```javascript
/** Providers with a real adapter behind them. Same list as WORK_ITEM_PROVIDERS today and kept
 * separate on purpose: a backend that can hold issues does not automatically hold requirements. */
const REQUIREMENT_PROVIDERS = Object.freeze(["project-json"]);

/**
 * A workspace's declared REQUIREMENT CATALOG. Three states, never two — see
 * `normalizeWorkspaceIssues` above for why `unsupported` is not `null`.
 * @param {unknown} value
 * @returns {{ provider: string, path: string, unsupported?: true } | null}
 */
function normalizeWorkspaceRequirements(value) {
	if (!isRecord(value)) return null;
	const provider = typeof value.provider === "string" ? value.provider.trim() : "";
	if (!provider) return null;
	const declaredPath =
		typeof value.path === "string" && value.path.trim() ? value.path.trim() : ".project/requirements.json";
	if (!REQUIREMENT_PROVIDERS.includes(provider)) {
		return { provider, path: declaredPath, unsupported: true };
	}
	return { provider, path: declaredPath };
}
```

and in `normalizeDeclaredWorkspace`, beside `const issues = …`:

```javascript
	const requirements = normalizeWorkspaceRequirements(value.requirements);
```
returning it in the object literal after `issues`.

Add a test in `packages/config/test/workspaces-config.test.js` proving a declared block survives
normalisation and an unknown provider survives as `unsupported: true` — the defect the 2026-08-06
slice hit when `normalizeDeclaredWorkspace` dropped an unknown key and a declaration vanished
silently.

- [ ] **Step 4: Extract the shared workspace selector**

Create `packages/cli/src/workspace-scope.ts` by lifting lines 74–101 of
`packages/cli/src/work-items/resolve.ts` verbatim (`isInside` plus the flag / cwd-match / enumerated
selection), exported as:

```typescript
export interface WorkspaceScopeInput {
	workspace?: string;
	enumerated?: boolean;
	cwd: string;
	loadWorkspaces: () => Array<{ id: string; absolutePath: string }>;
}

export type WorkspaceSelection<T> =
	| { ok: true; workspace: T; workspaceFrom: "flag" | "cwd-match" | "enumerated"; declared: string[] }
	| { ok: false; reason: "no_such_workspace" | "cwd_unmatched"; declared: string[] };

export function selectWorkspace<T extends { id: string; absolutePath: string }>(
	input: WorkspaceScopeInput & { loadWorkspaces: () => T[] },
): WorkspaceSelection<T> { /* the lifted body */ }
```

Rewrite `resolveWorkspaceLedger` to call it. **Its existing tests must pass unchanged** — that is the
proof the extraction changed no behaviour. Do not modify a single ledger test in this step; if one
fails, the extraction is wrong.

- [ ] **Step 5: Write the requirements catalog reader and resolver**

`packages/cli/src/requirements/catalog.ts`:

```typescript
export const REQUIREMENT_MATURITIES = [
	"provado", "parcial", "projetado", "ausente", "decisao-do-operador", "desconhecido",
] as const;
export type RequirementMaturity = (typeof REQUIREMENT_MATURITIES)[number];

export interface RequirementRecord {
	id: string;
	title?: string;
	description: string;
	type: string;
	status: string;
	priority: string;
	acceptance_criteria?: string[];
	acceptance_criteria_preamble?: string;
	source?: string;
	maturity?: RequirementMaturity;
	maturity_note?: string;
	evidence?: string[];
}

export interface RequirementsCatalogRead {
	ok: boolean;
	requirements: RequirementRecord[];
	/** TRUE only when the document was READ successfully and holds zero entries. An unreadable
	 *  document is `ok: false` with `empty: false` — "nothing there" and "could not look" are
	 *  different facts, and rcdc5's real catalog is the first of the two. */
	empty: boolean;
	error: { reason: string; message: string } | null;
}

export function readRequirementsDocument(contents: string): RequirementsCatalogRead { /* parse, guard, return */ }
export function writeRequirementsDocument(records: RequirementRecord[]): string { /* JSON.stringify(…, 2) + "\n" */ }
```

`packages/cli/src/requirements/resolve.ts` mirrors `work-items/resolve.ts`: `selectWorkspace`, then
declared → convention (`.project/requirements.json`) → `no_requirement_catalog`, and on success
returns `{ ok: true, workspaceId, workspaceFrom, providerFrom, provider, documentPath, read(), write(records) }`.

**`write` preserves unmodelled keys**: it re-serialises the records it was given, and Task 8's
`set-maturity` mutates one entry in place rather than rebuilding it from `RequirementRecord`. Same
rule as `withField`.

- [ ] **Step 6: Export from the package index and build**

Add the new exports to `packages/cli/src/index.ts` beside the `work-items` block (lines 372–391).

```bash
pnpm --filter @refarm.dev/cli exec vitest run src/requirements/ src/work-items/
pnpm --filter @refarm.dev/config run test
pnpm --filter @refarm.dev/config run build
pnpm --filter @refarm.dev/cli run build
node scripts/no-os-resolution.mjs   # 117, delta 0
```

- [ ] **Step 7: Commit**

```bash
refarm agent finish --lane after-edit --run --json
git add packages/config packages/cli
git commit -m "feat(requirements): a workspace's requirement catalog resolves through the node catalog"
refarm agent finish --lane after-commit --run --json
```

---

### Task 7: `refarm issues set-requirement`, and the filters that go with it

**Files:**
- Modify: `apps/refarm/src/commands/issues.ts`
- Test: `apps/refarm/test/commands/issues.test.ts`

**Interfaces:**
- Consumes: `resolveWorkspaceRequirements` (Task 6), `setRequirement` (Task 5).
- Produces: `buildIssuesList` accepting `requirement?: string` and `unserved?: boolean`;
  `IssuesValidateFinding.reason` gaining `"unknown_requirement"`.

- [ ] **Step 1: Write the failing tests**

Add to `apps/refarm/test/commands/issues.test.ts`:

```typescript
describe("issues list --requirement", () => {
	it("filters to one requirement", () => {
		const outcome = buildIssuesList({ workspace: "refarm", cwd: "/tmp", requirement: "R7", ...ioWithItems });
		expect(outcome.kind).toBe("ok");
		if (outcome.kind === "ok") expect(outcome.groups.refarm.items.map((i) => i.id)).toEqual(["ISS-2"]);
	});

	it("refuses a requirement id the catalog does not have, before resolving anything", () => {
		const outcome = buildIssuesList({ workspace: "refarm", cwd: "/tmp", requirement: "R99", ...ioWithItems });
		expect(outcome).toMatchObject({ kind: "invalid_input", reason: "unknown_requirement" });
	});

	it("--unserved lists exactly the items with no requirement", () => {
		const outcome = buildIssuesList({ workspace: "refarm", cwd: "/tmp", unserved: true, ...ioWithItems });
		if (outcome.kind === "ok") expect(outcome.groups.refarm.items.map((i) => i.id)).toEqual(["ISS-1"]);
	});

	it("refuses --requirement together with --unserved", () => {
		const outcome = buildIssuesList({ workspace: "refarm", cwd: "/tmp", requirement: "R7", unserved: true, ...ioWithItems });
		expect(outcome).toMatchObject({ kind: "invalid_input", reason: "conflicting_requirement_filter" });
	});

	it("reports how many of the listed items serve no requirement", () => {
		const outcome = buildIssuesList({ workspace: "refarm", cwd: "/tmp", ...ioWithItems });
		if (outcome.kind === "ok") expect(outcome.groups.refarm.unserved).toBe(1);
	});
});

describe("issues validate", () => {
	it("finds an item citing a requirement that does not exist", () => {
		const outcome = buildIssuesValidate({ workspace: "refarm", cwd: "/tmp", ...ioWithBadCitation });
		if (outcome.kind === "ok") {
			expect(outcome.valid).toBe(false);
			expect(outcome.findings.find((f) => f.reason === "unknown_requirement")?.ids).toEqual(["ISS-9"]);
		}
	});

	it("does NOT report an item that serves no requirement", () => {
		const outcome = buildIssuesValidate({ workspace: "refarm", cwd: "/tmp", ...ioWithItems });
		if (outcome.kind === "ok") {
			expect(outcome.findings.map((f) => f.reason)).not.toContain("unknown_requirement");
		}
	});
});
```

Build `ioWithItems` from the file's existing `deps`/`CATALOG` fixture: three items where `ISS-1` has
no requirement, `ISS-2` has `R7`, and the requirements document holds `R7`. `ioWithBadCitation` adds
`ISS-9` citing `R99`.

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter refarm exec vitest run test/commands/issues.test.ts
```

- [ ] **Step 3: Implement**

In `apps/refarm/src/commands/issues.ts`:

1. `BuildIssuesListInput` gains `requirement?: string` and `unserved?: boolean`; `ListedItemGroup`
   gains `unserved: number`.
2. In `buildIssuesList`, before the workspace loop, mirror the existing `--axis` guard — refuse
   `conflicting_requirement_filter` when both are set, then resolve the requirement catalog once and
   refuse `unknown_requirement` naming the legal ids. **This is the eighth-instance rule for a value
   an enum cannot express**: `--axis costs` returning `count: 0` was the defect; `--requirement R70`
   must not repeat it.
3. Filter: `.filter((item) => (input.unserved ? !item.requirement : input.requirement ? item.requirement === input.requirement : true))`
   and set `unserved: items.filter((item) => !item.requirement).length`.
4. Add the two Commander options to `buildListCommand`.
5. New `buildSetRequirementCommand(io)`, structured exactly like `buildSetAxisCommand`
   (`issues.ts:599`) with these differences, each of which is a refusal branch:
   - `--clear` and `--requirement` are mutually exclusive → `conflicting_intent`;
   - neither given → `missing_requirement`;
   - the catalog resolves to `no_requirement_catalog` → refuse with that reason;
   - the catalog read fails → `catalog_unreadable`;
   - the catalog is **empty** → `empty_catalog`, a *different* refusal from `unknown_requirement`,
     because the fix is different (rcdc5, today);
   - the id is absent from a non-empty catalog → `unknown_requirement`, listing the ids.
6. `buildIssuesValidate` gains the `unknown_requirement` finding, computed against the same catalog
   read; when the catalog is absent, items citing anything at all are reported once as
   `unknown_requirement` with the catalog's absence in the message — never silently passed.
7. `validateNextCommands` gains a branch returning
   `refarm issues set-requirement --workspace <ws> --id <first> --clear --json`.
8. Register the subcommand in `createIssuesCommand`.

- [ ] **Step 4: Run the tests, type-check, ratchet**

```bash
pnpm --filter refarm exec vitest run test/commands/issues.test.ts
pnpm --filter refarm run type-check
node scripts/no-os-resolution.mjs   # 117, delta 0
```

- [ ] **Step 5: Commit and run the handoffs lane (public JSON changed)**

```bash
refarm agent finish --lane after-edit --run --json
git add apps/refarm/src/commands/issues.ts apps/refarm/test/commands/issues.test.ts
git commit -m "feat(issues): set-requirement, the filters, and a validate finding for a dead citation"
refarm agent finish --lane after-commit --run --json
refarm agent finish --lane handoffs --run --json
```

---

### Task 8: `refarm requirements` — the command that answers with a number

**Files:**
- Create: `apps/refarm/src/commands/requirements.ts`
- Modify: `apps/refarm/src/program.ts:26,344`
- Modify: `apps/refarm/src/commands/resume.ts` (`buildLedgerNextCommands`, ~line 333)
- Test: `apps/refarm/test/commands/requirements.test.ts`, `apps/refarm/test/commands/resume.test.ts`

**Interfaces:**
- Consumes: `resolveWorkspaceRequirements`, `resolveWorkspaceLedger`.
- Produces: `buildRequirementsList(input) → RequirementsListOutcome`,
  `buildRequirementsValidate(input) → RequirementsValidateOutcome`, `requirementsCommand`.

- [ ] **Step 1: Write the failing tests**

Create `apps/refarm/test/commands/requirements.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildRequirementsList, buildRequirementsValidate } from "../../src/commands/requirements.js";

const CATALOG = [
	{ id: "refarm", absolutePath: "/home/op/github/refarm", issues: null, requirements: null },
];
const REQUIREMENTS = {
	requirements: [
		{ id: "R1", title: "Continuidade", description: "d", type: "functional", status: "accepted", priority: "must", maturity: "parcial" },
		{ id: "R7", title: "Dispositivos", description: "d", type: "functional", status: "accepted", priority: "must", maturity: "parcial" },
	],
};
const ISSUES = {
	issues: [
		{ id: "ISS-1", title: "t", body: "b", location: "l", status: "open", category: "issue", priority: "high", package: "p", axis: "cost", requirement: "R7" },
		{ id: "ISS-2", title: "t", body: "b", location: "l", status: "open", category: "issue", priority: "high", package: "p", axis: "cost" },
	],
};

const io = {
	loadWorkspaces: () => CATALOG,
	fileExists: () => true,
	readDocument: (p: string) => JSON.stringify(p.endsWith("requirements.json") ? REQUIREMENTS : ISSUES),
	writeDocument: () => {},
};

describe("buildRequirementsList", () => {
	it("counts open items per requirement and never merges the unserved into one", () => {
		const outcome = buildRequirementsList({ workspace: "refarm", cwd: "/tmp", ...io });
		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") return;
		expect(outcome.requirements.find((r) => r.id === "R7")?.counts.open).toBe(1);
		expect(outcome.requirements.find((r) => r.id === "R1")?.counts.open).toBe(0);
		expect(outcome.unserved.open).toBe(1);
	});

	it("reports null counts and a reason when the LEDGER cannot be read — never zeros", () => {
		const broken = { ...io, readDocument: (p: string) => (p.endsWith("requirements.json") ? JSON.stringify(REQUIREMENTS) : "{ not json") };
		const outcome = buildRequirementsList({ workspace: "refarm", cwd: "/tmp", ...broken });
		if (outcome.kind !== "ok") throw new Error("expected ok");
		expect(outcome.ledger.readable).toBe(false);
		expect(outcome.ledger.reason).toBe("document_unreadable");
		expect(outcome.requirements[0].counts).toBeNull();
		expect(outcome.unserved).toBeNull();
	});

	it("reports an EMPTY catalog as empty, with the workspace's items still counted as unserved", () => {
		const empty = { ...io, readDocument: (p: string) => JSON.stringify(p.endsWith("requirements.json") ? { requirements: [] } : ISSUES) };
		const outcome = buildRequirementsList({ workspace: "refarm", cwd: "/tmp", ...empty });
		if (outcome.kind !== "ok") throw new Error("expected ok");
		expect(outcome.catalog.empty).toBe(true);
		expect(outcome.requirements).toEqual([]);
		expect(outcome.unserved?.open).toBe(2);
	});
});

describe("buildRequirementsValidate", () => {
	it("finds a proved requirement with no evidence", () => {
		const proved = { ...io, readDocument: (p: string) => JSON.stringify(p.endsWith("requirements.json")
			? { requirements: [{ ...REQUIREMENTS.requirements[0], maturity: "provado" }] }
			: ISSUES) };
		const outcome = buildRequirementsValidate({ workspace: "refarm", cwd: "/tmp", ...proved });
		if (outcome.kind !== "ok") throw new Error("expected ok");
		expect(outcome.valid).toBe(false);
		expect(outcome.findings[0].reason).toBe("proved_without_evidence");
	});
});
```

Add to `apps/refarm/test/commands/resume.test.ts`:

```typescript
it("hands off the requirements view for the workspace it selected", () => {
	const commands = buildLedgerNextCommands({
		workspaces: { refarm: { open: 9, unclassified: 0, byAxis: { cost: 9 } } },
		unreadable: {},
	});
	expect(commands).toContain("refarm requirements list --workspace refarm --json");
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
pnpm --filter refarm exec vitest run test/commands/requirements.test.ts
```

- [ ] **Step 3: Implement `apps/refarm/src/commands/requirements.ts`**

Structure it exactly like `issues.ts`: a module doc comment naming the one deliberate cwd read
(`currentDirectoryForCatalogMatch`), a `RequirementsIo` seam, `refuse` / `refuseAfterResolution`
helpers, and pure `build*` functions that never print or set `process.exitCode`.

`buildRequirementsList` resolves the catalog, then resolves the ledger **separately** — a failure on
the ledger side does not fail the command, it sets `ledger: { readable: false, reason }` and makes
every `counts` and `unserved` `null`. Sort `requirements` by `counts.open` descending for the text
render only; the JSON keeps catalog order so the output is stable.

`set-maturity` refuses in this order: unknown id → unknown maturity token (listing
`REQUIREMENT_MATURITIES`) → `provado` without `--evidence`. On success it mutates the matched entry
in place (`entry.maturity = …`, `entry.evidence = [...new Set([...(entry.evidence ?? []), ref])]`)
and re-serialises the document, so unmodelled keys survive.

`validate` findings: `duplicate_id`, `proved_without_evidence`, `unknown_maturity`.

- [ ] **Step 4: Register the command and extend resume**

`apps/refarm/src/program.ts`: import beside line 26, `program.addCommand(requirementsCommand)` beside
line 344. In `resume.ts`'s `buildLedgerNextCommands`, append the requirements command for the same
workspace already selected — **no new IO in `resume`**, it is one string.

- [ ] **Step 5: Run the tests, build, verify live**

```bash
pnpm --filter refarm exec vitest run test/commands/requirements.test.ts test/commands/resume.test.ts test/commands/issues.test.ts
pnpm --filter refarm run type-check
pnpm --filter refarm run build
node scripts/no-os-resolution.mjs   # 117, delta 0

refarm requirements list --workspace refarm --json | head -40
refarm requirements list --workspace rcdc5 --json    # empty catalog, 20 unserved
(cd /tmp && refarm requirements list --workspace refarm --json) | head -5
refarm requirements set-maturity --workspace refarm --id R1 --maturity provado --json   # must REFUSE
```

- [ ] **Step 6: Commit**

```bash
refarm agent finish --lane after-edit --run --json
git add apps/refarm/src/commands/requirements.ts apps/refarm/src/program.ts apps/refarm/src/commands/resume.ts apps/refarm/test
git commit -m "feat(requirements): the command that answers how many items stand between here and R7"
refarm agent finish --lane after-commit --run --json
refarm agent finish --lane handoffs --run --json
```

---

### Task 9: The gate learns the link

**Files:**
- Modify: `scripts/ci/project-block-consistency.mjs`
- Test: `scripts/ci/project-block-consistency.test.mjs`

**Interfaces:**
- Consumes: the record (Task 3), the index (Task 4), the `requirement` field (Task 5).
- Produces: `checkRequirementCitations`, `checkProvedWithOpenWork`, `checkRequirementIndex` — all
  pure, all exported, mirroring `checkHandoffCitations`'s shape.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/ci/project-block-consistency.test.mjs`:

```javascript
import {
	checkProvedWithOpenWork,
	checkRequirementCitations,
	checkRequirementIndex,
} from "./project-block-consistency.mjs";

describe("checkRequirementCitations", () => {
	const requirements = [{ id: "R1" }, { id: "R7" }];

	it("errors when an item cites a requirement that does not exist", () => {
		const result = checkRequirementCitations(requirements, [{ id: "ISS-1", requirement: "R99" }]);
		assert.ok(result.errors.includes("[issues] ISS-1 serves unknown requirement: R99"));
	});

	it("passes when an item cites an existing requirement", () => {
		assert.deepEqual(checkRequirementCitations(requirements, [{ id: "ISS-1", requirement: "R7" }]).errors, []);
	});

	it("does NOT require an item to cite a requirement — the field is optional by decision", () => {
		assert.deepEqual(checkRequirementCitations(requirements, [{ id: "ISS-1", status: "open" }]).errors, []);
	});
});

describe("checkProvedWithOpenWork", () => {
	it("warns when a proved requirement still has open work, and never errors", () => {
		const result = checkProvedWithOpenWork(
			[{ id: "R1", maturity: "provado" }],
			[{ id: "ISS-1", status: "open", requirement: "R1" }],
		);
		assert.deepEqual(result.errors, []);
		assert.match(result.warnings[0], /R1 is provado with 1 open item/);
	});

	it("is silent when the open item serves a partial requirement", () => {
		const result = checkProvedWithOpenWork(
			[{ id: "R1", maturity: "parcial" }],
			[{ id: "ISS-1", status: "open", requirement: "R1" }],
		);
		assert.deepEqual(result.warnings, []);
	});

	it("is silent when a proved requirement's remaining items are resolved", () => {
		const result = checkProvedWithOpenWork(
			[{ id: "R1", maturity: "provado" }],
			[{ id: "ISS-1", status: "resolved", requirement: "R1" }],
		);
		assert.deepEqual(result.warnings, []);
	});
});

describe("checkRequirementIndex", () => {
	const requirements = [{ id: "R1", title: "Continuidade", maturity: "parcial" }];
	const table = "| Id | Resultado | Maturidade |\n| --- | --- | --- |\n| R1 | Continuidade | parcial |";

	it("passes when the index matches the record", () => {
		assert.deepEqual(checkRequirementIndex(table, requirements).errors, []);
	});

	it("errors when a row's maturity drifts from the record", () => {
		const drifted = table.replace("parcial", "provado");
		assert.match(checkRequirementIndex(drifted, requirements).errors[0], /R1/);
	});

	it("errors when a requirement has no row at all", () => {
		const result = checkRequirementIndex(table, [...requirements, { id: "R2", title: "x", maturity: "parcial" }]);
		assert.match(result.errors[0], /R2/);
	});

	it("ignores the legacy REQ- cohort, which the index never claimed to cover", () => {
		const result = checkRequirementIndex(table, [...requirements, { id: "REQ-ENV-001", title: undefined }]);
		assert.deepEqual(result.errors, []);
	});
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
node --test scripts/ci/project-block-consistency.test.mjs
```

- [ ] **Step 3: Implement the three checks**

In `scripts/ci/project-block-consistency.mjs`, beside `checkHandoffCitations`, each with a comment
naming which class it belongs to (external anchor / deterministic vs judgement):

```javascript
// External anchor #3 (deterministic — feeds `errors`): an item may serve a requirement, and if it
// names one, that requirement must exist. Deliberately does NOT require an item to name one: the
// field is optional by the operator's decision, because several open items are pure hygiene and
// "serves no requirement" is a real answer, not missing data.
export function checkRequirementCitations(requirements, issues) {
	const errors = [];
	const ids = new Set(requirements.map((entry) => entry.id));
	for (const issue of issues) {
		if (!issue?.requirement) continue;
		if (!ids.has(issue.requirement)) {
			errors.push(`[issues] ${issue.id} serves unknown requirement: ${issue.requirement}`);
		}
	}
	return { errors };
}

// External anchor #4 (heuristic — feeds `warnings`, never `errors`): "proved" and "still has open
// work" can both be true — an item may sit beyond the journey that proved the requirement — so this
// is a judgement, and judgement warns. Same rule as the freshness check above.
export function checkProvedWithOpenWork(requirements, issues) {
	const warnings = [];
	for (const requirement of requirements) {
		if (requirement.maturity !== "provado") continue;
		const open = issues.filter((issue) => issue.status === "open" && issue.requirement === requirement.id);
		if (open.length > 0) {
			warnings.push(
				`[requirements] ${requirement.id} is provado with ${open.length} open item(s): ${open.map((i) => i.id).join(", ")}`,
			);
		}
	}
	return { errors: [], warnings };
}

// External anchor #5 (deterministic — feeds `errors`): docs/OPERATOR_REQUIREMENTS.md is an INDEX
// over this record, which means a requirement's title and maturity are now written in two places.
// An index free to drift from its record is the two-records defect this slice closed, rebuilt in
// miniature — so the drift blocks, and the fix is one table row. Only `R*` ids are indexed; the
// May-era REQ- cohort was never claimed by the table.
export function checkRequirementIndex(markdown, requirements) {
	const errors = [];
	const rows = new Map(
		markdown.split("\n")
			.map((line) => /^\| (R\d+) \| (.+?) \| ([a-z-]+) \|$/.exec(line.trim()))
			.filter(Boolean)
			.map(([, id, title, maturity]) => [id, { title, maturity }]),
	);
	for (const requirement of requirements) {
		if (!/^R\d+$/.test(requirement.id)) continue;
		const row = rows.get(requirement.id);
		if (!row) {
			errors.push(`[requirements] ${requirement.id} has no row in the docs index`);
			continue;
		}
		if (row.title !== requirement.title || row.maturity !== requirement.maturity) {
			errors.push(
				`[requirements] ${requirement.id} index row (${row.title} · ${row.maturity}) disagrees with the record (${requirement.title} · ${requirement.maturity})`,
			);
		}
	}
	return { errors };
}
```

Wire them into `main()` beside the existing citation call, reading the index with
`existsSync("docs/OPERATOR_REQUIREMENTS.md") ? readFileSync(…) : ""` — and when the file is absent,
push a **warning** that the index could not be read, never a silent pass. Three states, never two.

- [ ] **Step 4: Prove the gate BITES, not merely that it passes**

```bash
node --test scripts/ci/project-block-consistency.test.mjs
node scripts/ci/project-block-consistency.mjs; echo "clean exit=$?"        # expect 0

python3 - <<'PY'
import json
d = json.load(open(".project/issues.json"))
d["issues"][0]["requirement"] = "R99"
json.dump(d, open(".project/issues.json", "w"), indent="\t", ensure_ascii=False)
open(".project/issues.json", "a").write("\n")
PY
node scripts/ci/project-block-consistency.mjs; echo "poisoned exit=$?"     # expect 1
git checkout .project/issues.json
node scripts/ci/project-block-consistency.mjs; echo "reverted exit=$?"     # expect 0
```

The poison is a **hand edit on purpose**: `set-requirement` refuses to write `R99`, so this proves
the CLI and the gate are independent doors rather than one check reported twice.

- [ ] **Step 5: Commit**

```bash
refarm agent finish --lane after-edit --run --json
git add scripts/ci/project-block-consistency.mjs scripts/ci/project-block-consistency.test.mjs
git commit -m "feat(gate): a citation that does not exist blocks; a proof with open work warns"
refarm agent finish --lane after-commit --run --json
```

---

### Task 10: Take the measurement, then write down what it says

**Files:**
- Modify: `.project/issues.json` (via `set-requirement` only — never by hand)
- Modify: `docs/WORK_ITEM_LEDGER.md`, `.project/handoff.json`
- Create: new work items for the gaps this slice leaves open

**Interfaces:**
- Consumes: everything above.
- Produces: the number the operator asked for.

- [ ] **Step 1: Classify the 60 open items through the writer**

Read every open item's `body` (`refarm issues list --workspace refarm --status open --json`) and link
it **only** when the body names an outcome one requirement's acceptance criteria already covers.
Everything else stays unserved: hygiene serving no operator-facing requirement is the correct answer,
and inventing links would manufacture exactly the false precision the optional field exists to
prevent.

Drive it from a list so each write is one auditable command with an argv array, never a shell string:

```bash
while IFS=, read -r id req; do
  refarm issues set-requirement --workspace refarm --id "$id" --requirement "$req" --json | \
    python3 -c "import json,sys; d=json.load(sys.stdin); print(d['ok'], d.get('item',{}).get('qualifiedId'))"
done < /tmp/claude-*/scratchpad/requirement-links.csv
```

- [ ] **Step 2: Take the measurement**

```bash
refarm requirements list --workspace refarm --json | python3 -c "
import json,sys
d=json.load(sys.stdin)
for r in sorted(d['requirements'], key=lambda r: -r['counts']['open']):
    print(f\"{r['id']:>4} {r['maturity']:<8} open={r['counts']['open']:>3}  {r['title']}\")
print('unserved open:', d['unserved']['open'])
"
refarm requirements list --workspace rcdc5 --json | head -20
(cd /tmp && refarm requirements list --workspace refarm --json) > /tmp/from-tmp.json
(cd ~/git/rcdc5/rcdc5 && refarm requirements list --workspace refarm --json) > /tmp/from-rcdc5.json
refarm requirements list --workspace refarm --json > /tmp/from-repo.json
diff /tmp/from-tmp.json /tmp/from-rcdc5.json && diff /tmp/from-tmp.json /tmp/from-repo.json && echo "IDENTICAL FROM THREE DIRECTORIES"
```

- [ ] **Step 3: File what this slice did NOT do, as items rather than prose**

```bash
refarm issues add --workspace refarm --axis durability --category capability --priority medium \
  --package apps/refarm --location apps/refarm/src/commands/requirements.ts \
  --id ISS-091 --title "No CLI writer creates a requirement — refarm requirements add does not exist" \
  --body "…" --json
```

At minimum: `requirements add`; `--all-workspaces` for requirements; and any judgement call from
Step 1 that a second reader could reasonably decide the other way. Each gets a body carrying the
reasoning, not a one-liner.

- [ ] **Step 4: Write the reader's guide and the handoff**

Add a section to `docs/WORK_ITEM_LEDGER.md` — *"Which requirement does this serve?"* — carrying the
real table from Step 2, the three states of `set-requirement`'s refusals, and the sentence that the
count is a number to re-take rather than a paragraph to trust. Rewrite `.project/handoff.json`'s
`current_tasks` head entry as the slice narrative **citing ids**, and make sure every
`next_actions`/`blockers` entry still cites at least one existing id — the gate blocks otherwise.

- [ ] **Step 5: Full gate, then push**

```bash
node scripts/ci/project-block-consistency.mjs
node scripts/no-os-resolution.mjs               # 117, delta 0
refarm agent finish --lane after-edit --run --json
git add -A && git commit -m "feat(requirements): the sixty open items, counted by what they serve"
refarm agent finish --lane after-commit --run --json
refarm agent finish --lane before-push --run --json
refarm resume --json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['nextCommands'])"
```

---

## Self-review

**Spec coverage.** Record → Tasks 2–4. Link (contract, adapter, schema) → Task 5. Catalog resolution
incl. declared/convention/empty/absent/unreadable → Task 6. `set-requirement`, `--requirement`,
`--unserved`, `issues validate` finding → Task 7. `requirements list/set-maturity/validate`, the
null-not-zero rule, resume → Task 8. Gate checks 1–3 → Task 9. The measurement, the named gaps and
the docs → Task 10. The spec's "what is NOT in this spec" items appear as filed work items in
Task 10 Step 3, not as silent omissions.

**Type consistency.** `setRequirement(id, requirement: string | null)` is used with that exact
signature in Tasks 5, 7. `withField(record, key, value, anchors)` is defined in Task 5 and used by
`setAxis` and `setRequirement` there. `selectWorkspace` is defined in Task 6 Step 4 and consumed by
both resolvers in the same task. `REQUIREMENT_MATURITIES` is defined in Task 6 and used in Task 8's
`set-maturity`. `unserved` is a `number` on a list group (Task 7) and an object of counts on the
requirements view (Task 8) — different shapes, deliberately, because they answer different questions;
both are named in their task's Interfaces block.

**Known risk, named rather than discovered:** Task 6's `selectWorkspace` extraction touches a file
with live behaviour and no new feature of its own. Its proof is that every existing
`resolveWorkspaceLedger` test passes **unmodified**. If a ledger test needs editing to go green, the
extraction changed behaviour and must be reverted rather than accommodated.
