import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildWorkspaceExecutionStatus,
	workspaceCanUseTurboAdapter,
} from "./workspace-execution.js";

let tempRoot: string;

beforeEach(() => {
	tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-cli-workspace-"));
});

afterEach(() => {
	fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("workspace execution discovery", () => {
	it("selects the turbo adapter when the workspace declares turbo and has turbo.json", () => {
		writeJson(path.join(tempRoot, "package.json"), {
			devDependencies: {
				turbo: "^2.0.0",
			},
		});
		writeJson(path.join(tempRoot, "turbo.json"), {
			tasks: {},
		});
		const nested = path.join(tempRoot, "apps", "demo");
		fs.mkdirSync(nested, { recursive: true });

		const status = buildWorkspaceExecutionStatus({ cwd: nested, packageManager: "pnpm" });

		expect(status.root).toBe(tempRoot);
		expect(status.rootSource).toBe("turbo");
		expect(status.executor.selected).toBe("turbo");
		expect(status.adapters.turbo).toMatchObject({
			available: true,
			configured: true,
			declared: true,
			configPath: path.join(tempRoot, "turbo.json"),
			installCommand: null,
		});
		expect(workspaceCanUseTurboAdapter(nested)).toBe(true);
	});

	it("reports the install command when turbo is configured but not declared", () => {
		writeJson(path.join(tempRoot, "package.json"), {
			devDependencies: {},
		});
		writeJson(path.join(tempRoot, "turbo.json"), {
			tasks: {},
		});

		const status = buildWorkspaceExecutionStatus({
			cwd: tempRoot,
			packageManager: "yarn",
		});

		expect(status.executor.selected).toBe("direct-script");
		expect(status.adapters.turbo).toMatchObject({
			available: false,
			configured: true,
			declared: false,
			installCommand: "yarn add -D -W turbo",
		});
	});

	it("uses shared package-manager primitives for adapter install handoffs", () => {
		writeJson(path.join(tempRoot, "package.json"), {
			devDependencies: {},
		});
		writeJson(path.join(tempRoot, "turbo.json"), {
			tasks: {},
		});

		expect(buildWorkspaceExecutionStatus({
			cwd: tempRoot,
			packageManager: "npm",
		}).adapters.turbo.installCommand).toBe("npm install --save-dev turbo");
		expect(buildWorkspaceExecutionStatus({
			cwd: tempRoot,
			packageManager: "bun",
		}).adapters.turbo.installCommand).toBe("bun add -d turbo");
	});

	it("infers the package manager for adapter install handoffs", () => {
		writeJson(path.join(tempRoot, "package.json"), {
			packageManager: "pnpm@11.7.0",
			devDependencies: {},
		});
		writeJson(path.join(tempRoot, "turbo.json"), {
			tasks: {},
		});

		const status = buildWorkspaceExecutionStatus({
			cwd: tempRoot,
		});

		expect(status.adapters.turbo.installCommand).toBe("pnpm add -D -w turbo");
	});

	it("falls back to lockfile package manager discovery for adapter install handoffs", () => {
		writeJson(path.join(tempRoot, "package.json"), {
			devDependencies: {},
		});
		writeJson(path.join(tempRoot, "turbo.json"), {
			tasks: {},
		});
		fs.writeFileSync(path.join(tempRoot, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");

		const status = buildWorkspaceExecutionStatus({
			cwd: tempRoot,
		});

		expect(status.adapters.turbo.installCommand).toBe("pnpm add -D -w turbo");
	});

	it("uses pnpm-workspace.yaml as a workspace root marker", () => {
		fs.writeFileSync(path.join(tempRoot, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n");
		const nested = path.join(tempRoot, "apps", "demo");
		fs.mkdirSync(nested, { recursive: true });

		const status = buildWorkspaceExecutionStatus({ cwd: nested });

		expect(status.root).toBe(tempRoot);
		expect(status.rootSource).toBe("pnpm-workspace");
		expect(status.executor.selected).toBe("direct-script");
		expect(status.adapters.turbo.configured).toBe(false);
	});

	it("falls back to the nearest package.json when no workspace marker exists", () => {
		writeJson(path.join(tempRoot, "package.json"), {
			name: "demo",
		});
		const nested = path.join(tempRoot, "src");
		fs.mkdirSync(nested, { recursive: true });

		const status = buildWorkspaceExecutionStatus({ cwd: nested });

		expect(status.root).toBe(tempRoot);
		expect(status.rootSource).toBe("package-json");
	});

	it("reports local and remote turbo cache readiness", () => {
		writeJson(path.join(tempRoot, "package.json"), {
			devDependencies: {
				turbo: "^2.0.0",
			},
		});
		writeJson(path.join(tempRoot, "turbo.json"), {
			tasks: {},
		});
		fs.mkdirSync(path.join(tempRoot, ".turbo", "cache"), { recursive: true });

		const status = buildWorkspaceExecutionStatus({
			cwd: tempRoot,
			env: {
				TURBO_CACHE_API_URL: "https://cache.example.test",
				TURBO_CACHE_TOKEN: "secret",
			},
		});

		expect(status.cache.local).toEqual({
			available: true,
			path: path.join(tempRoot, ".turbo", "cache"),
		});
		expect(status.cache.remote).toEqual({
			configured: true,
			apiUrlEnv: "TURBO_CACHE_API_URL",
			tokenEnv: "TURBO_CACHE_TOKEN",
		});
	});
});

function writeJson(filePath: string, value: unknown): void {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
