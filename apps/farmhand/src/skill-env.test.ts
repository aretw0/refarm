import { describe, expect, it } from "vitest";

import { buildSkillBodiesEnv, buildSkillDisclosureEnv, injectSkillEnv } from "./skill-env.js";

describe("buildSkillDisclosureEnv — progressive-disclosure packing", () => {
	it("packs one `name — description` line per skill", () => {
		const packed = buildSkillDisclosureEnv([
			{ name: "git-workflow", description: "Commit + PR flow. Use when a task edits code." },
			{ name: "vault-search", description: "Find notes. Use when asked to locate a note." },
		]);
		expect(packed).toBe(
			"git-workflow — Commit + PR flow. Use when a task edits code.\n" +
				"vault-search — Find notes. Use when asked to locate a note.",
		);
	});

	it("emits just the name when a skill has no description", () => {
		expect(buildSkillDisclosureEnv([{ name: "bare-skill" }])).toBe("bare-skill");
	});

	it("collapses multi-line descriptions to a single line (the agent splits on lines)", () => {
		const packed = buildSkillDisclosureEnv([
			{ name: "multi", description: "line one\n  line two\t\tline three" },
		]);
		expect(packed).toBe("multi — line one line two line three");
		expect(packed.split("\n")).toHaveLength(1);
	});

	it("drops skills with no usable name", () => {
		expect(
			buildSkillDisclosureEnv([
				{ name: "  ", description: "no name" },
				{ name: "real", description: "kept" },
			]),
		).toBe("real — kept");
	});

	it("returns an empty string for no skills (agent then gets a byte-identical prompt)", () => {
		expect(buildSkillDisclosureEnv([])).toBe("");
	});
});

describe("buildSkillBodiesEnv — the on-demand bodies for load_skill", () => {
	it("packs name → full instructions as a JSON map", () => {
		const json = buildSkillBodiesEnv([
			{ name: "pdf-fill", description: "d", instructions: "# Fill\nUse pdftk" },
			{ name: "git-triage", description: "d", instructions: "# Triage\ngit log first" },
		]);
		expect(JSON.parse(json)).toEqual({
			"pdf-fill": "# Fill\nUse pdftk",
			"git-triage": "# Triage\ngit log first",
		});
	});

	it("round-trips bodies with headings, quotes and newlines (JSON escaping is exact)", () => {
		const gnarly = '# Title\n"quoted" and `backtick`\n\n- a\n- b';
		const parsed = JSON.parse(buildSkillBodiesEnv([{ name: "s", instructions: gnarly }]));
		expect(parsed.s).toBe(gnarly);
	});

	it("drops skills with no name or empty body, and is a valid empty map when nothing packs", () => {
		expect(buildSkillBodiesEnv([{ name: "  ", instructions: "x" }])).toBe("{}");
		expect(buildSkillBodiesEnv([{ name: "s", instructions: "" }])).toBe("{}");
		expect(JSON.parse(buildSkillBodiesEnv([]))).toEqual({});
	});
});

describe("injectSkillEnv — best-effort, never fatal", () => {
	it("leaves MODEL_SKILLS unset when the plugins dir does not exist", () => {
		const env: NodeJS.ProcessEnv = {};
		const result = injectSkillEnv("/nonexistent/plugins/dir", env);
		expect(result.count).toBe(0);
		expect(env.MODEL_SKILLS).toBeUndefined();
		expect(env.MODEL_SKILL_BODIES).toBeUndefined();
	});
});
