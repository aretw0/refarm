import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createPackageBinaryCommand,
	createPackageScriptCommand,
	detectPackageManager,
} from "../../src/commands/package-manager.js";

describe("package manager command resolution", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

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

	it("warns when REFARM_PACKAGE_MANAGER is ignored", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		expect(
			createPackageScriptCommand({
				cwd: "apps/dev",
				script: "dev",
				env: { REFARM_PACKAGE_MANAGER: "pip" },
			}),
		).toEqual({
			command: "pnpm",
			args: ["-C", "apps/dev", "run", "dev"],
			display: "pnpm -C apps/dev run dev",
		});

		const errors = errorSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(errors).toContain("Ignored invalid REFARM_PACKAGE_MANAGER=pip");
		expect(errors).toContain("Use: pnpm, npm, yarn, bun");
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

	it("formats binary commands for supported package managers", () => {
		expect(
			createPackageBinaryCommand("jco", ["transpile", "plugin.wasm"], {
				env: { REFARM_PACKAGE_MANAGER: "npm" },
			}),
		).toEqual({
			command: "npm",
			args: ["exec", "--", "jco", "transpile", "plugin.wasm"],
			display: "npm exec -- jco transpile plugin.wasm",
		});

		expect(
			createPackageBinaryCommand("jco", ["transpile", "plugin.wasm"], {
				env: { REFARM_PACKAGE_MANAGER: "yarn" },
			}),
		).toEqual({
			command: "yarn",
			args: ["jco", "transpile", "plugin.wasm"],
			display: "yarn jco transpile plugin.wasm",
		});

		expect(
			createPackageBinaryCommand("jco", ["transpile", "plugin.wasm"], {
				env: { REFARM_PACKAGE_MANAGER: "bun" },
			}),
		).toEqual({
			command: "bun",
			args: ["x", "jco", "transpile", "plugin.wasm"],
			display: "bun x jco transpile plugin.wasm",
		});
	});
});
