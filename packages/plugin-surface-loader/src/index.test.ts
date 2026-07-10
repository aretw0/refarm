import { REQUIRED_TOKENS, type DsTheme } from "@refarm.dev/ds";
import { createMockManifest } from "@refarm.dev/plugin-manifest";
import { describe, expect, it } from "vitest";
import {
	loadSkillsFromManifest,
	loadThemesFromManifest,
	PLUGIN_SURFACE_LOADER_CAPABILITY,
} from "./index.js";

function completeTheme(overrides: Partial<DsTheme> = {}): DsTheme {
	const theme = Object.fromEntries(REQUIRED_TOKENS.map((token) => [token, "#808080"])) as DsTheme;
	return { ...theme, ...overrides };
}

function manifestWithThemePacks(surfaces: { id: string; assets: string[] }[]) {
	return createMockManifest({
		extensions: {
			surfaces: surfaces.map((s) => ({
				layer: "asset",
				kind: "theme-pack",
				id: s.id,
				assets: s.assets,
			})),
		},
	});
}

describe("plugin-surface-loader", () => {
	it("exports the capability marker", () => {
		expect(PLUGIN_SURFACE_LOADER_CAPABILITY).toBe("plugin-surface-loader:v1");
	});

	it("registers a conformant plugin theme from the manifest", () => {
		const manifest = manifestWithThemePacks([
			{ id: "midnight", assets: ["./themes/midnight.json"] },
		]);
		const result = loadThemesFromManifest(manifest, () => ({
			theme: completeTheme({ primary: "#90b4e8" }),
		}));
		expect(result.registered).toEqual(["midnight"]);
		expect(result.rejected).toEqual([]);
	});

	it("rejects a token-incomplete plugin theme and reports missing tokens", () => {
		const manifest = manifestWithThemePacks([{ id: "broken", assets: ["./themes/broken.json"] }]);
		const result = loadThemesFromManifest(manifest, () => ({
			theme: { primary: "#fff" },
		}));
		expect(result.registered).toEqual([]);
		expect(result.rejected[0]?.id).toBe("broken");
		expect(result.rejected[0]?.missing.length).toBeGreaterThan(0);
	});

	it("ignores a manifest with no theme-pack surfaces", () => {
		const manifest = createMockManifest();
		const result = loadThemesFromManifest(manifest, () => ({}));
		expect(result.registered).toEqual([]);
		expect(result.results).toEqual([]);
	});

	it("loads multiple packs, registering only the conformant ones", () => {
		const manifest = manifestWithThemePacks([
			{ id: "good", assets: ["a.json"] },
			{ id: "bad", assets: ["b.json"] },
		]);
		const result = loadThemesFromManifest(manifest, (p) =>
			p === "a.json" ? { theme: completeTheme() } : { theme: { primary: "x" } },
		);
		expect(result.registered).toEqual(["good"]);
		expect(result.rejected.map((r) => r.id)).toEqual(["bad"]);
	});
});

const VALID_SKILL_MD = `---
name: source-research
description: Research open-source libraries with evidence-backed answers.
requiredCapabilities:
  - filesystem:v1
---

# Source Research

Answer questions about open-source libraries.
`;

function manifestWithSkills(skills: { id: string; assets: string[] }[]) {
	return createMockManifest({
		extensions: {
			surfaces: skills.map((s) => ({
				layer: "pi",
				kind: "skill",
				id: s.id,
				capabilities: ["filesystem:v1"],
				assets: s.assets,
			})),
		},
	});
}

describe("loadSkillsFromManifest", () => {
	it("loads and parses a plugin's SKILL.md into an addressable skill", () => {
		const manifest = manifestWithSkills([
			{ id: "research", assets: ["./skills/source-research/SKILL.md"] },
		]);
		const result = loadSkillsFromManifest(manifest, () => VALID_SKILL_MD);
		expect(result.rejected).toEqual([]);
		expect(result.loaded).toHaveLength(1);
		expect(result.loaded[0]).toMatchObject({
			surfaceId: "research",
			name: "source-research",
			description: expect.stringContaining("open-source libraries"),
			requiredCapabilities: ["filesystem:v1"],
		});
		expect(result.loaded[0]?.id).toContain("source-research");
		// The SKILL.md body is retained (not just the description) so a checker can
		// analyze the skill's real text.
		expect(result.loaded[0]?.instructions).toContain(
			"Answer questions about open-source libraries",
		);
	});

	it("rejects a malformed SKILL.md with its parse issues", () => {
		const manifest = manifestWithSkills([{ id: "broken", assets: ["./skills/broken/SKILL.md"] }]);
		const result = loadSkillsFromManifest(manifest, () => "no frontmatter here");
		expect(result.loaded).toEqual([]);
		expect(result.rejected[0]?.surfaceId).toBe("broken");
		expect(result.rejected[0]?.issues.length).toBeGreaterThan(0);
	});

	it("rejects a skill whose asset fails to load without crashing", () => {
		const manifest = manifestWithSkills([{ id: "missing", assets: ["./skills/missing/SKILL.md"] }]);
		const result = loadSkillsFromManifest(manifest, () => {
			throw new Error("ENOENT");
		});
		expect(result.loaded).toEqual([]);
		expect(result.rejected[0]?.issues[0]).toContain("could not load");
	});

	it("ignores a manifest with no skill surfaces", () => {
		const result = loadSkillsFromManifest(createMockManifest(), () => "");
		expect(result.loaded).toEqual([]);
		expect(result.rejected).toEqual([]);
	});
});
