import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMockManifest } from "@refarm.dev/plugin-manifest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	findPluginDirs,
	loadSkillsFromPluginsDir,
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
});
