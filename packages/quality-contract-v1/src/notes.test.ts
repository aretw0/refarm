import { describe, expect, it } from "vitest";

import { createNoteQualityChecker, runNoteQualityRules } from "./notes.js";
import type { QualityProfile } from "./types.js";

const gates: QualityProfile = {
	name: "note-gates",
	rules: [
		{
			id: "require-tipo",
			severity: "fail",
			description: "a requirement note must declare its tipo",
			check: { type: "frontmatter-required", field: "tipo" },
		},
		{
			id: "min-body",
			severity: "warn",
			description: "a published note needs real content",
			check: { type: "min-words", min: 5 },
		},
		{
			id: "no-empty-link",
			severity: "warn",
			description: "an empty wikilink is a dangling reference",
			check: { type: "wikilink-shape" },
		},
	],
};

describe("note gates (frontmatter-required / min-words / wikilink-shape)", () => {
	it("flags a missing required frontmatter field", () => {
		const findings = runNoteQualityRules(
			{ path: "a.md", text: "---\ntitle: A\n---\n\ncorpo com bastante conteúdo aqui\n" },
			gates,
		);
		expect(findings.map((f) => f.ruleId)).toContain("require-tipo");
	});

	it("passes when the required field is present and the note has enough words", () => {
		const findings = runNoteQualityRules(
			{ path: "a.md", text: "---\ntipo: requisito\n---\n\num corpo com palavras suficientes ok\n" },
			gates,
		);
		expect(findings).toHaveLength(0);
	});

	it("flags a too-short body", () => {
		const findings = runNoteQualityRules(
			{ path: "a.md", text: "---\ntipo: requisito\n---\n\ncurto\n" },
			gates,
		);
		expect(findings.map((f) => f.ruleId)).toContain("min-body");
		expect(findings.find((f) => f.ruleId === "min-body")?.locus?.words).toBe(1);
	});

	it("flags an empty wikilink target", () => {
		const findings = runNoteQualityRules(
			{ path: "a.md", text: "---\ntipo: requisito\n---\n\nvê [[ ]] aqui um link vazio mesmo\n" },
			gates,
		);
		expect(findings.map((f) => f.ruleId)).toContain("no-empty-link");
	});

	it("skips unknown check types (forward-safe)", () => {
		const findings = runNoteQualityRules(
			{ path: "a.md", text: "---\ntipo: requisito\n---\n\ncorpo com palavras suficientes ok\n" },
			{ name: "x", rules: [{ id: "future", severity: "warn", description: "", check: { type: "not-yet-a-matcher" } }] },
		);
		expect(findings).toHaveLength(0);
	});
});

describe("createNoteQualityChecker", () => {
	it("is a quality:v1 checker in the note domain", () => {
		const checker = createNoteQualityChecker();
		expect(checker.domain).toBe("note");
		const findings = checker.check({ path: "a.md", text: "---\ntitle: A\n---\n\nx\n" }, gates);
		expect(Array.isArray(findings)).toBe(true);
	});
});
