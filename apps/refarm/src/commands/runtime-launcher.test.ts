import { describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	resolveRuntimeLaunchCommand,
	runtimeStartHelpLines,
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

