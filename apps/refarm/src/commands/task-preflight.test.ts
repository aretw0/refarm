import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	checkTaskProvides,
	discoverInstalledProvides,
} from "./task-preflight.js";

describe("checkTaskProvides (advisory provides preflight)", () => {
	it("resolves <plugin>:<fn> and reports provided when the set advertises it", () => {
		const discover = () => new Set(["agent:respond", "agent:plan"]);
		expect(checkTaskProvides("agent", "respond", discover)).toEqual({
			target: "agent:respond",
			provided: true,
		});
	});

	it("reports NOT provided for an unadvertised target (warn, not block)", () => {
		const discover = () => new Set(["agent:respond"]);
		expect(checkTaskProvides("ghost", "process", discover)).toEqual({
			target: "ghost:process",
			provided: false,
		});
	});
});

describe("discoverInstalledProvides (reads provides, not the full manifest)", () => {
	let pluginsDir: string;
	beforeEach(() => {
		pluginsDir = mkdtempSync(join(tmpdir(), "task-provides-"));
	});
	afterEach(() => rmSync(pluginsDir, { recursive: true, force: true }));

	function writePlugin(id: string, manifest: unknown): void {
		const dir = join(pluginsDir, id);
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "plugin.json"), JSON.stringify(manifest));
	}

	it("collects provides across installed plugins", () => {
		writePlugin("@refarm/agent", {
			id: "@refarm/agent",
			capabilities: { provides: ["agent:respond", "agent:plan"] },
		});
		writePlugin("@demo/other", {
			id: "@demo/other",
			capabilities: { provides: ["other:run"] },
		});
		const provides = discoverInstalledProvides(pluginsDir);
		expect([...provides].sort()).toEqual([
			"agent:plan",
			"agent:respond",
			"other:run",
		]);
	});

	it("reads provides even when `entry` is a not-yet-installed template", () => {
		// The bundled agent ships with no executable entry until install; it still
		// ADVERTISES what it provides, so the preflight must see it.
		writePlugin("@refarm/agent", {
			id: "@refarm/agent",
			_note: "Entry injected at install time",
			capabilities: { provides: ["agent:respond"] },
		});
		expect([...discoverInstalledProvides(pluginsDir)]).toEqual(["agent:respond"]);
	});

	it("skips a malformed plugin.json without throwing (advisory)", () => {
		const dir = join(pluginsDir, "@bad/plugin");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "plugin.json"), "{ not json");
		expect(discoverInstalledProvides(pluginsDir)).toEqual(new Set());
	});

	it("returns an empty set when the plugins dir does not exist", () => {
		expect(discoverInstalledProvides(join(pluginsDir, "nope"))).toEqual(
			new Set(),
		);
	});
});
