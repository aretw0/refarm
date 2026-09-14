#!/usr/bin/env node
/**
 * Relocates R1–R12 out of `docs/OPERATOR_REQUIREMENTS.md` into `.project/requirements.json`,
 * VERBATIM.
 *
 * Every string this file produces is a slice of the source with hard wrapping undone — no word is
 * added, removed or reordered — which is what makes the migration CHECKABLE rather than trusted.
 * That is the whole reason it is a script and not twelve records typed by hand: a human retyping 430
 * lines of Portuguese cannot be diffed against the source, and the 2026-08-08 ledger migration
 * proved the point in the other direction when a reviewer split 26,551 removed characters into 147
 * chunks and found 143 byte-identical in the items.
 *
 * Design: `docs/superpowers/specs/2026-08-09-requirements-join-the-ledger-design.md`.
 *
 * Usage:
 *   node scripts/migrate-operator-requirements.mjs            # print the extracted records
 *   node scripts/migrate-operator-requirements.mjs --write    # append the missing ones
 */
import { readFileSync, writeFileSync } from "node:fs";

const SECTION = "## Resultados exigidos";
const MATURITIES = ["provado", "parcial", "projetado", "ausente", "decisao-do-operador", "desconhecido"];

/**
 * Hand-assigned, because the source document has no type vocabulary and the schema requires one.
 * Kept as a visible table rather than inferred from prose: a wrong call here should be correctable
 * by editing one line, not by re-reading a heuristic. R8 is `integration` because it IS the
 * integrations requirement; R10 is `constraint` because its criteria are rules about HOW assimilation
 * happens rather than an outcome; R11 is `non-functional` for the same reason security requirements
 * usually are.
 */
const TYPES = {
	R1: "functional",
	R2: "functional",
	R3: "functional",
	R4: "functional",
	R5: "functional",
	R6: "functional",
	R7: "functional",
	R8: "integration",
	R9: "functional",
	R10: "constraint",
	R11: "non-functional",
	R12: "functional",
};

/** Undoes the source's hard wrapping. A wrapped paragraph and its single-line form are the same
 * prose; collapsing the newline is the ONLY transformation this migration performs, and the
 * verbatim check in the plan asserts every produced string appears in the de-wrapped source. */
export function dewrap(text) {
	return text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.join(" ");
}

/**
 * "Parcial/Ausente por provedor." → "parcial". The first word is the family's state; anything after
 * it is a qualifier the enum cannot hold and `maturity_note` keeps verbatim. Two of the twelve are
 * qualified this way — R8 (two states) and R12 ("Ausente como visão integrada") — and NEITHER is
 * special-cased: the same rule produces the right token for both, which is why it is a rule and not
 * a lookup table.
 */
export function maturityToken(stateText) {
	const first = stateText.split(/[\s/.,]/)[0].toLowerCase();
	const normalised = first.normalize("NFD").replace(/\p{Diacritic}/gu, "");
	const match = MATURITIES.find((candidate) => candidate.replace(/-/g, "") === normalised || candidate === normalised);
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

/** Everything from a `**Label.**` marker to the next blank line, bullet, or `**` marker. */
function paragraphAfter(lines, marker) {
	const index = lines.findIndex((line) => line.startsWith(marker));
	if (index === -1) return null;
	const collected = [lines[index].slice(marker.length)];
	for (let i = index + 1; i < lines.length; i += 1) {
		if (!lines[i].trim() || lines[i].startsWith("**") || lines[i].startsWith("- ")) break;
		collected.push(lines[i]);
	}
	const text = dewrap(collected.join("\n"));
	return text.length > 0 ? text : null;
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
		const maturityNote = dewrap(state.replace(/\*\*/g, "")).replace(/^\s+/, "");

		const criteriaPreamble = paragraphAfter(block, "**Critérios de aceitação.**");
		const criteria = block.filter((line) => line.startsWith("- ")).map((line) => dewrap(line.slice(2)));
		const evidenceLine = paragraphAfter(block, "**Evidência.**") ?? "";
		const evidence = [...evidenceLine.matchAll(/\[[^\]]+\]\([^)]+\)/g)].map((match) => match[0]);

		const record = {
			id,
			title,
			description: paragraphAfter(block, "**Necessidade.**"),
			type: TYPES[id] ?? "functional",
			// `status` is what the operator DECIDED — he accepted all twelve at the 2026-08-06
			// interview. `maturity` is what reality measures. Both are kept; neither is derived from
			// the other, and collapsing them would destroy the distinction the six-state vocabulary
			// exists to protect.
			status: "accepted",
			// The section is titled "Resultados exigidos". Inventing a MoSCoW ranking the operator
			// never gave would be a second, quieter requirements document; the ordering he DID give
			// lives in "Ordem de cultivo derivada dos requisitos" and stays in the Markdown.
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
		process.stdout.write(`added ${added.length} requirement(s)\n`);
		return;
	}
	process.stdout.write(`${JSON.stringify(extracted, null, 2)}\n`);
}

// GUARD: the test file imports the pure functions above. Without this, `main()` would run at import
// time and read the repo's files from whatever cwd the test runner happens to have — the same idiom
// `scripts/ci/project-block-consistency.mjs` and `scripts/no-os-resolution.mjs` both carry.
if (import.meta.url === `file://${process.argv[1]}`) main();
