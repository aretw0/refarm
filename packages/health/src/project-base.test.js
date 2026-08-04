import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectProjectBase } from "./project-base.js";

let rootDir;

describe("detectProjectBase", () => {
	beforeEach(() => {
		rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-health-project-base-"));
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("is NOT a project when the directory is neither a git repository nor has a package.json", () => {
		// This is the operator's sovereign base (`~`) shape: a bare directory that
		// may hold a `.refarm` node base, but no git repository and no manifest.
		const result = detectProjectBase(rootDir);
		expect(result.isProject).toBe(false);
		expect(result.reason).toContain(rootDir);
		expect(result.reason).toMatch(/not a git repository/i);
	});

	it("IS a project when the directory has a package.json, even without git", () => {
		fs.writeFileSync(path.join(rootDir, "package.json"), JSON.stringify({ name: "x" }), "utf-8");
		const result = detectProjectBase(rootDir);
		expect(result.isProject).toBe(true);
		expect(result.reason).toBeNull();
	});

	it("IS a project when the directory is a git repository, even without a package.json", () => {
		execFileSync("git", ["init", "--quiet"], { cwd: rootDir });
		const result = detectProjectBase(rootDir);
		expect(result.isProject).toBe(true);
		expect(result.reason).toBeNull();
	});

	it("IS a project from a subdirectory of a git working tree — the check walks up, not just `rootDir` itself", () => {
		execFileSync("git", ["init", "--quiet"], { cwd: rootDir });
		const nested = path.join(rootDir, "packages", "some-package");
		fs.mkdirSync(nested, { recursive: true });
		const result = detectProjectBase(nested);
		expect(result.isProject).toBe(true);
	});

	it("does not look INSIDE the directory for other people's repositories — a nested unrelated repo does not make the parent a project", () => {
		// This is the exact shape of the measured defect: `~/git/some-repo` is a
		// real git repository, but `~` itself is not, and must not be treated as
		// one just because something underneath it happens to be.
		const nestedRepo = path.join(rootDir, "git", "some-repo");
		fs.mkdirSync(nestedRepo, { recursive: true });
		execFileSync("git", ["init", "--quiet"], { cwd: nestedRepo });

		const result = detectProjectBase(rootDir);
		expect(result.isProject).toBe(false);
	});
});
