import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	resolveRuntimeLaunchCommand,
	runtimeStartHelpLines,
	startRuntimeProcess,
} from "./runtime-launcher.js";

describe("resolveRuntimeLaunchCommand", () => {
	it("uses the repo TS starter script when it exists", () => {
		const repoRoot = join(tmpdir(), `refarm-runtime-launcher-${Date.now()}`);
		mkdirSync(join(repoRoot, "scripts"), { recursive: true });
		writeFileSync(join(repoRoot, "scripts", "farmhand-start.sh"), "");

		try {
			expect(resolveRuntimeLaunchCommand(repoRoot, "ts")).toEqual({
				engine: "ts",
				command: "bash",
				args: [join(repoRoot, "scripts", "farmhand-start.sh"), "--background"],
				display: "bash scripts/farmhand-start.sh --background",
				source: "repo-script",
				logPath: join(repoRoot, ".refarm", "ts-runtime-start.log"),
			});
		} finally {
			rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("falls back to the TS runtime binary when no repo script exists", () => {
		const repoRoot = join(tmpdir(), `refarm-runtime-launcher-${Date.now()}`);
		mkdirSync(repoRoot, { recursive: true });

		try {
			expect(resolveRuntimeLaunchCommand(repoRoot, "ts")).toEqual({
				engine: "ts",
				command: "farmhand",
				args: ["--background"],
				display: "farmhand --background",
				source: "path",
			});
		} finally {
			rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("falls back to the Rust runtime binary when no repo script exists", () => {
		const repoRoot = join(tmpdir(), `refarm-runtime-launcher-${Date.now()}`);
		mkdirSync(repoRoot, { recursive: true });

		try {
			expect(resolveRuntimeLaunchCommand(repoRoot, "rust")).toEqual({
				engine: "rust",
				command: "tractor",
				args: [],
				display: "tractor",
				source: "path",
			});
		} finally {
			rmSync(repoRoot, { recursive: true, force: true });
		}
	});

	it("captures repo-script startup output for later diagnostics", async () => {
		const repoRoot = join(tmpdir(), `refarm-runtime-launcher-${Date.now()}`);
		const logPath = join(repoRoot, ".refarm", "ts-runtime-start.log");
		mkdirSync(join(repoRoot, "scripts"), { recursive: true });
		const script = join(repoRoot, "scripts", "farmhand-start.sh");
		writeFileSync(script, "echo startup failed\n");

		try {
			startRuntimeProcess({
				engine: "ts",
				command: "bash",
				args: [script],
				display: "bash scripts/farmhand-start.sh",
				source: "repo-script",
				logPath,
			});
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(readFileSync(logPath, "utf-8")).toContain("startup failed");
		} finally {
			rmSync(repoRoot, { recursive: true, force: true });
		}
	});
});

describe("runtimeStartHelpLines", () => {
	it("renders help from the same runtime launcher resolution", () => {
		const repoRoot = join(tmpdir(), `refarm-runtime-launcher-${Date.now()}`);
		mkdirSync(repoRoot, { recursive: true });

		try {
			expect(runtimeStartHelpLines(repoRoot)).toEqual([
				"Local TS start:   farmhand --background",
				"Local Rust start: tractor",
			]);
		} finally {
			rmSync(repoRoot, { recursive: true, force: true });
		}
	});
});
