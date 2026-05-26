import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTEXT_CAPABILITY } from "../types.js";
import { CwdContextProvider } from "./cwd.js";
import { DateContextProvider } from "./date.js";
import { FilesContextProvider } from "./files.js";
import { GitStatusContextProvider } from "./git-status.js";

let tempDir = "";

beforeEach(() => {
	tempDir = mkdtempSync(path.join(os.tmpdir(), "ctx-files-test-"));
	writeFileSync(path.join(tempDir, "small.txt"), "hello world", "utf8");
	writeFileSync(path.join(tempDir, "big.txt"), "x".repeat(5 * 1024), "utf8");
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

describe("CwdContextProvider", () => {
	it("returns cwd context", async () => {
		const provider = new CwdContextProvider();
		expect(provider.capability).toBe(CONTEXT_CAPABILITY);
		const entries = await provider.provide({ cwd: "/workspace/refarm" });
		expect(entries).toEqual([
			{ label: "cwd", content: "/workspace/refarm", priority: 10 },
		]);
	});
});

describe("DateContextProvider", () => {
	it("returns date context", async () => {
		const provider = new DateContextProvider();
		const entries = await provider.provide({ cwd: "/" });
		expect(entries).toHaveLength(1);
		expect(entries[0].label).toBe("date");
		expect(entries[0].content).toMatch(/^\d{4}-\d{2}-\d{2},\s+\w+$/);
	});
});

describe("GitStatusContextProvider", () => {
	it("returns empty outside git repo", async () => {
		const provider = new GitStatusContextProvider();
		const entries = await provider.provide({ cwd: os.tmpdir() });
		expect(entries).toEqual([]);
	});

	it("reports affected workspace candidates from changed files", async () => {
		execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore" });
		const appDir = path.join(tempDir, "apps", "refarm");
		mkdirSync(appDir, { recursive: true });
		writeFileSync(path.join(appDir, "package.json"), JSON.stringify({ name: "refarm" }), "utf8");
		writeFileSync(path.join(appDir, "index.ts"), "export const value = 1;\n", "utf8");

		const provider = new GitStatusContextProvider();
		const entries = await provider.provide({ cwd: tempDir });

		const affected = entries.find((entry) => entry.label === "affected_workspaces");
		expect(affected?.content).toContain("Changed workspace candidates:");
		expect(affected?.content).toContain("- apps/refarm");
		expect(affected?.content).toContain("Preferred aggregate validation command:");
		expect(affected?.content).toContain(
			"refarm agent finish --profile affected --run --json",
		);
		expect(affected?.content).toContain(
			"refarm agent finish --profile package --workspace apps/refarm --run --json",
		);
	});

	it("reports affected workspaces relative to git root from package subdirs", async () => {
		execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore" });
		const appDir = path.join(tempDir, "apps", "refarm");
		mkdirSync(appDir, { recursive: true });
		writeFileSync(path.join(appDir, "package.json"), JSON.stringify({ name: "refarm" }), "utf8");
		writeFileSync(path.join(appDir, "index.ts"), "export const value = 1;\n", "utf8");

		const provider = new GitStatusContextProvider();
		const entries = await provider.provide({ cwd: appDir });

		const affected = entries.find((entry) => entry.label === "affected_workspaces");
		expect(affected?.content).toContain("- apps/refarm");
		expect(affected?.content).not.toContain("- .");
	});

	it("does not suggest root package validation for repository-level changes", async () => {
		execFileSync("git", ["init"], { cwd: tempDir, stdio: "ignore" });
		writeFileSync(path.join(tempDir, "package.json"), JSON.stringify({ name: "root" }), "utf8");
		mkdirSync(path.join(tempDir, "docs"), { recursive: true });
		writeFileSync(path.join(tempDir, "docs", "guide.md"), "# Guide\n", "utf8");

		const provider = new GitStatusContextProvider();
		const entries = await provider.provide({ cwd: tempDir });

		const affected = entries.find((entry) => entry.label === "affected_workspaces");
		expect(affected).toBeUndefined();
	});
});

describe("FilesContextProvider", () => {
	it("reads relative files and truncates large files", async () => {
		const provider = new FilesContextProvider(["small.txt", "big.txt"]);
		const entries = await provider.provide({ cwd: tempDir });
		expect(entries).toHaveLength(2);
		expect(entries[0].label).toBe("file:small.txt");
		expect(entries[0].content).toContain("hello world");
		expect(entries[1].content).toContain("[truncated at 4 KB]");
	});

	it("skips missing files", async () => {
		const provider = new FilesContextProvider(["missing.txt"]);
		const entries = await provider.provide({ cwd: tempDir });
		expect(entries).toEqual([]);
	});
});
