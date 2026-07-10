import { describe, expect, it } from "vitest";

import { buildSkillDisclosureEnv, injectSkillEnv } from "./skill-env.js";

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

describe("injectSkillEnv — best-effort, never fatal", () => {
	it("leaves MODEL_SKILLS unset when the plugins dir does not exist", () => {
		const env: NodeJS.ProcessEnv = {};
		const result = injectSkillEnv("/nonexistent/plugins/dir", env);
		expect(result.count).toBe(0);
		expect(env.MODEL_SKILLS).toBeUndefined();
	});
});
