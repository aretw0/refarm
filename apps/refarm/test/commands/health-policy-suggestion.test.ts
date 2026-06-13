import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	applySuggestedHealthPolicy,
	runHealthPolicySuggestion,
} from "../../src/commands/health.js";

describe("health policy suggestion", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		while (tempDirs.length > 0) {
			rmSync(tempDirs.pop()!, { force: true, recursive: true });
		}
	});

	function tempWorkspace(): string {
		const dir = mkdtempSync(path.join(tmpdir(), "refarm-health-policy-"));
		tempDirs.push(dir);
		return dir;
	}

	it("does not create project config while suggesting external workspace policy", async () => {
		const rootDir = tempWorkspace();
		const configPath = path.join(rootDir, ".refarm", "config.json");

		const report = await runHealthPolicySuggestion(rootDir);

		expect(report).toMatchObject({
			command: "health",
			operation: "policy-suggestion",
			ok: true,
			policy: {
				preset: "workspace",
			},
			nextAction: null,
			nextActions: [],
			nextCommand: null,
			nextCommands: [],
		});
		expect(existsSync(configPath)).toBe(false);
	});

	it("creates project config only through explicit apply", async () => {
		const rootDir = tempWorkspace();
		const configPath = path.join(rootDir, ".refarm", "config.json");

		await applySuggestedHealthPolicy(rootDir);

		expect(existsSync(configPath)).toBe(true);
	});
});
