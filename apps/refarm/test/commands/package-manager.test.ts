import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createPackageScriptCommand,
	detectPackageManager,
} from "../../src/commands/package-manager.js";

describe("package manager command resolution", () => {
	it("uses REFARM_PACKAGE_MANAGER as an operator override", () => {
		expect(
			createPackageScriptCommand({
				cwd: "apps/dev",
				script: "dev",
				env: { REFARM_PACKAGE_MANAGER: "npm" },
			}),
		).toEqual({
			command: "npm",
			args: ["--prefix", "apps/dev", "run", "dev"],
			display: "npm --prefix apps/dev run dev",
		});
	});

	it("detects packageManager from package.json", () => {
		const dir = mkdtempSync(join(tmpdir(), "refarm-pm-test-"));
		writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: "yarn@4.0.0" }));

		try {
			expect(detectPackageManager({ cwd: dir, env: {} })).toBe("yarn");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("walks past package.json files without packageManager", () => {
		const dir = mkdtempSync(join(tmpdir(), "refarm-pm-walk-test-"));
		const appDir = join(dir, "apps", "refarm");
		writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: "pnpm@11.1.2" }));
		mkdirSync(appDir, { recursive: true });
		writeFileSync(join(appDir, "package.json"), JSON.stringify({ name: "@refarm.dev/refarm" }));

		try {
			expect(detectPackageManager({ cwd: appDir, env: {} })).toBe("pnpm");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("formats run commands for supported package managers", () => {
		expect(
			createPackageScriptCommand({
				cwd: "apps/dev",
				script: "preview",
				env: { REFARM_PACKAGE_MANAGER: "bun" },
			}),
		).toEqual({
			command: "bun",
			args: ["--cwd", "apps/dev", "run", "preview"],
			display: "bun --cwd apps/dev run preview",
		});
	});
});
