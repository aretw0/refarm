import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMockManifest } from "@refarm.dev/plugin-manifest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { REQUIRED_TOKENS } from "@refarm.dev/ds";

import { translateAgentSkill } from "./index.js";
import {
	findPluginDirs,
	loadAgentSkillsFromDir,
	loadCheckersFromPluginsDir,
	loadSkillsFromPluginsDir,
	loadThemesFromPluginsDir,
	readPluginManifest,
} from "./node.js";

const SKILL_MD = `---
name: source-research
description: Research open-source libraries with evidence-backed answers.
requiredCapabilities:
  - filesystem:v1
---

# Source Research

Answer questions about open-source libraries.
`;

// A permissive skill: name + description only, no declared capabilities. Valid
// FORM (the contract accepts it); it must load, not be rejected.
const PERMISSIVE_SKILL_MD = `---
name: quick-note
description: Jot a quick note with no declared capabilities.
---

# Quick Note

Just write it down.
`;

/** Write a plugin dir with a plugin.json + one SKILL.md asset. */
function writePlugin(
	pluginsDir: string,
	pluginId: string,
	skill: { id: string; asset: string; capabilities?: string[]; md: string },
): void {
	const pluginDir = join(pluginsDir, pluginId);
	mkdirSync(join(pluginDir, "skills", skill.id), { recursive: true });
	writeFileSync(join(pluginDir, skill.asset), skill.md, "utf-8");
	const manifest = createMockManifest({
		id: `@refarm.dev/${pluginId}`,
		extensions: {
			surfaces: [
				{
					layer: "pi",
					kind: "skill",
					id: skill.id,
					...(skill.capabilities
						? { capabilities: skill.capabilities }
						: {}),
					assets: [skill.asset],
				},
			],
		},
	});
	writeFileSync(
		join(pluginDir, "plugin.json"),
		JSON.stringify(manifest, null, 2),
		"utf-8",
	);
}

describe("plugin-surface-loader/node — fs enumeration", () => {
	let root: string;
	let pluginsDir: string;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "psl-node-"));
		pluginsDir = join(root, "plugins");
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("returns an empty list when the plugins dir does not exist", () => {
		expect(findPluginDirs(join(root, "nope"))).toEqual([]);
		expect(loadSkillsFromPluginsDir(join(root, "nope"))).toEqual({
			skills: [],
			rejected: [],
		});
	});

	it("discovers a flat plugin dir and a @scope/<id> dir", () => {
		writePlugin(pluginsDir, "alpha", {
			id: "research",
			asset: "skills/research/SKILL.md",
			capabilities: ["filesystem:v1"],
			md: SKILL_MD,
		});
		mkdirSync(join(pluginsDir, "@acme"), { recursive: true });
		writePlugin(join(pluginsDir, "@acme"), "beta", {
			id: "note",
			asset: "skills/note/SKILL.md",
			md: PERMISSIVE_SKILL_MD,
		});

		const dirs = findPluginDirs(pluginsDir);
		expect(dirs).toContain(join(pluginsDir, "alpha"));
		expect(dirs).toContain(join(pluginsDir, "@acme", "beta"));
	});

	it("loads skills across installed plugins, reading each SKILL.md by dir", () => {
		writePlugin(pluginsDir, "alpha", {
			id: "research",
			asset: "skills/research/SKILL.md",
			capabilities: ["filesystem:v1"],
			md: SKILL_MD,
		});

		const { skills, rejected } = loadSkillsFromPluginsDir(pluginsDir);
		expect(rejected).toEqual([]);
		expect(skills).toHaveLength(1);
		expect(skills[0]).toMatchObject({
			surfaceId: "research",
			name: "source-research",
			pluginId: "@refarm.dev/alpha",
			requiredCapabilities: ["filesystem:v1"],
		});
		expect(skills[0]!.pluginDir).toBe(join(pluginsDir, "alpha"));
	});

	it("loads a permissive skill (no capabilities) — not rejected", () => {
		writePlugin(pluginsDir, "notes", {
			id: "note",
			asset: "skills/note/SKILL.md",
			md: PERMISSIVE_SKILL_MD,
		});

		const { skills, rejected } = loadSkillsFromPluginsDir(pluginsDir);
		expect(rejected).toEqual([]);
		expect(skills).toHaveLength(1);
		expect(skills[0]).toMatchObject({
			name: "quick-note",
			requiredCapabilities: [],
		});
	});

	it("records an unreadable manifest in rejected without hiding other plugins", () => {
		writePlugin(pluginsDir, "good", {
			id: "research",
			asset: "skills/research/SKILL.md",
			capabilities: ["filesystem:v1"],
			md: SKILL_MD,
		});
		// A dir with a malformed plugin.json.
		mkdirSync(join(pluginsDir, "broken"), { recursive: true });
		writeFileSync(join(pluginsDir, "broken", "plugin.json"), "{ not json", "utf-8");

		const { skills, rejected } = loadSkillsFromPluginsDir(pluginsDir);
		expect(skills).toHaveLength(1); // the good plugin still loaded
		expect(rejected).toHaveLength(1);
		expect(rejected[0]!.pluginDir).toBe(join(pluginsDir, "broken"));
		expect(rejected[0]!.pluginId).toBeNull();
	});

	it("readPluginManifest reads + validates a plugin.json", () => {
		writePlugin(pluginsDir, "alpha", {
			id: "research",
			asset: "skills/research/SKILL.md",
			capabilities: ["filesystem:v1"],
			md: SKILL_MD,
		});
		const manifest = readPluginManifest(join(pluginsDir, "alpha"));
		expect(manifest.id).toBe("@refarm.dev/alpha");
	});

	it("locates a plugin's quality-checker surface as {pkgDir, entry}", () => {
		// A plugin that ships a transpiled checker component (its pkg dir) and
		// declares a {kind:quality-checker} surface pointing at the entry glue.
		const pluginDir = join(pluginsDir, "linter");
		mkdirSync(join(pluginDir, "checker-pkg"), { recursive: true });
		writeFileSync(
			join(pluginDir, "checker-pkg", "linter.js"),
			"// transpiled component entry\n",
			"utf-8",
		);
		const manifest = createMockManifest({
			id: "@refarm.dev/linter",
			extensions: {
				surfaces: [
					{
						layer: "pi",
						kind: "quality-checker",
						id: "text-linter",
						assets: ["checker-pkg/linter.js"],
					},
				],
			},
		});
		writeFileSync(
			join(pluginDir, "plugin.json"),
			JSON.stringify(manifest, null, 2),
			"utf-8",
		);

		const { checkers, rejected } = loadCheckersFromPluginsDir(pluginsDir);
		expect(rejected).toEqual([]);
		expect(checkers).toHaveLength(1);
		expect(checkers[0]).toMatchObject({
			pluginId: "@refarm.dev/linter",
			surfaceId: "text-linter",
			pkgDir: join(pluginDir, "checker-pkg"),
			entry: "linter.js",
		});
	});
});

describe("translateAgentSkill (Agent Skill → refarm-acceptable)", () => {
	it("leaves a well-formed LF+named skill untouched", () => {
		const clean =
			"---\nname: commit\ndescription: Read this before committing\n---\n\nBody.\n";
		const t = translateAgentSkill(clean, "commit");
		expect(t.source).toBe(clean);
		expect(t.nameInjected).toBe(false);
		expect(t.newlinesNormalized).toBe(false);
	});

	it("normalizes CRLF so the frontmatter fence matches refarm's `---\\n`", () => {
		const crlf = "---\r\nname: x\r\ndescription: y\r\n---\r\n\r\nBody.\r\n";
		const t = translateAgentSkill(crlf, "x");
		expect(t.newlinesNormalized).toBe(true);
		expect(t.source.startsWith("---\n")).toBe(true);
		expect(t.source).not.toContain("\r");
	});

	it("strips leading blank lines before the fence", () => {
		const leading = "\n\n---\nname: z\ndescription: w\n---\n\nBody.\n";
		const t = translateAgentSkill(leading, "z");
		expect(t.newlinesNormalized).toBe(true);
		expect(t.source.startsWith("---\n")).toBe(true);
	});

	it("injects name=<dir> when the skill omits it (the spec allows nameless)", () => {
		const nameless = "---\ndescription: only a description\n---\n\nBody.\n";
		const t = translateAgentSkill(nameless, "greet-op");
		expect(t.nameInjected).toBe(true);
		expect(t.source).toContain("name: greet-op");
	});
});

describe("loadAgentSkillsFromDir (import Agent Skills — convergence front-half)", () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "psl-pi-"));
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	function writePiSkill(dir: string, md: string): void {
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "SKILL.md"), md, "utf-8");
	}

	it("imports an Agent Skill (name/description/instructions) via parseSkillMarkdown", () => {
		writePiSkill(
			join(root, "commit"),
			"---\nname: commit\ndescription: Read this before committing\n---\n\nMake a conventional commit.\n",
		);
		const { skills, rejected } = loadAgentSkillsFromDir(root);
		expect(rejected).toEqual([]);
		expect(skills).toHaveLength(1);
		expect(skills[0]).toMatchObject({
			name: "commit",
			description: expect.stringContaining("committing"),
		});
		expect(skills[0]!.instructions).toContain("conventional commit");
		expect(skills[0]!.requiredCapabilities).toEqual([]); // permissive, 0 declared
	});

	it("imports a nameless CRLF Agent Skill by translating it first", () => {
		writePiSkill(
			join(root, "windows-skill"),
			"---\r\ndescription: authored on windows\r\n---\r\n\r\nBody.\r\n",
		);
		const { skills, rejected } = loadAgentSkillsFromDir(root);
		expect(rejected).toEqual([]);
		expect(skills).toHaveLength(1);
		expect(skills[0]!.name).toBe("windows-skill"); // injected from dir
		expect(skills[0]!.translated).toEqual({
			nameInjected: true,
			newlinesNormalized: true,
		});
	});

	it("rejects a genuinely malformed skill without throwing", () => {
		writePiSkill(join(root, "broken"), "no frontmatter at all\n");
		const { skills, rejected } = loadAgentSkillsFromDir(root);
		expect(skills).toEqual([]);
		expect(rejected).toHaveLength(1);
		expect(rejected[0]!.issues.join()).toContain("FRONTMATTER_MISSING");
	});
});

/** Write a plugin dir with a plugin.json declaring one theme-pack + its asset. */
function writeThemePlugin(
	pluginsDir: string,
	pluginId: string,
	theme: { id: string; asset: string; tokens: Record<string, string> },
): void {
	const pluginDir = join(pluginsDir, pluginId);
	mkdirSync(pluginDir, { recursive: true });
	writeFileSync(
		join(pluginDir, theme.asset),
		JSON.stringify({ id: theme.id, theme: theme.tokens }),
		"utf-8",
	);
	const manifest = createMockManifest({
		id: `@refarm.dev/${pluginId}`,
		extensions: {
			surfaces: [
				{ layer: "asset", kind: "theme-pack", id: theme.id, assets: [theme.asset] },
			],
		},
	});
	writeFileSync(
		join(pluginDir, "plugin.json"),
		JSON.stringify(manifest, null, 2),
		"utf-8",
	);
}

function completeTokens(): Record<string, string> {
	return Object.fromEntries(REQUIRED_TOKENS.map((t) => [t, "#101010"]));
}

describe("loadThemesFromPluginsDir — plugin theme discovery", () => {
	let root: string;
	let pluginsDir: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "psl-theme-"));
		pluginsDir = join(root, "plugins");
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("returns an empty set when the plugins dir does not exist", () => {
		const result = loadThemesFromPluginsDir(join(root, "nope"));
		expect(result.themes).toEqual([]);
		expect(result.rejected).toEqual([]);
	});

	it("discovers + registers a conformant plugin theme, tagged with its plugin", () => {
		writeThemePlugin(pluginsDir, "theme-plugin", {
			id: "midnight",
			asset: "midnight.theme.json",
			tokens: completeTokens(),
		});
		const result = loadThemesFromPluginsDir(pluginsDir);
		expect(result.themes).toHaveLength(1);
		expect(result.themes[0]).toMatchObject({
			id: "midnight",
			pluginId: "@refarm.dev/theme-plugin",
		});
		// The theme resolves out of the returned registry (id → tokens).
		expect(result.registry.get("midnight")?.source).toBe("plugin");
	});

	it("rejects a non-conformant theme (missing tokens) without crashing the scan", () => {
		writeThemePlugin(pluginsDir, "bad-plugin", {
			id: "broken",
			asset: "broken.theme.json",
			tokens: { background: "#000" }, // missing 28 required tokens
		});
		const result = loadThemesFromPluginsDir(pluginsDir);
		expect(result.themes).toEqual([]);
		expect(result.rejected).toHaveLength(1);
		expect(result.rejected[0]?.id).toBe("broken");
		expect(result.rejected[0]?.issues.join()).toContain("missing tokens");
	});
});
