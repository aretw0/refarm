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
import { OperatorStateProvider } from "./operator-state.js";
import { PolicyFilesContextProvider } from "./policy-files.js";

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
			"refarm agent finish --lane after-edit --run --json",
		);
		expect(affected?.content).toContain(
			"refarm agent finish --lane before-push --run --json",
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

describe("OperatorStateProvider", () => {
	describe("parseResumeJson", () => {
		it("returns null for empty object", () => {
			expect(OperatorStateProvider.parseResumeJson({})).toBeNull();
		});

		it("surfaces failed finish with blocked command and pending steps", () => {
			const entry = OperatorStateProvider.parseResumeJson({
				finish: {
					status: "failed",
					failedCommand: "refarm tidy imports --check --json",
					nextCommands: ["refarm tidy imports --check --json"],
					remainingCommands: ["refarm health --next-action --json"],
				},
				session: { shortId: "abc123" },
			});
			expect(entry).not.toBeNull();
			expect(entry!.label).toBe("operator_state");
			expect(entry!.priority).toBe(15);
			expect(entry!.content).toContain("FAILED");
			expect(entry!.content).toContain("refarm tidy imports --check --json");
			expect(entry!.content).toContain("refarm health --next-action --json");
			expect(entry!.content).toContain("Resolve before starting new work:");
			expect(entry!.content).toContain("Session: abc123");
		});

		it("surfaces ok finish as clean state", () => {
			const entry = OperatorStateProvider.parseResumeJson({
				finish: { status: "ok" },
				session: { shortId: "def456", showCommand: "refarm tree show def456 --json" },
			});
			expect(entry!.content).toContain("OK — last gate passed");
			expect(entry!.content).toContain("Session: def456");
			expect(entry!.content).toContain("inspect: refarm tree show def456 --json");
		});

		it("shows no-gate-recorded when finish is absent", () => {
			const entry = OperatorStateProvider.parseResumeJson({
				session: { shortId: "ghi789" },
			});
			expect(entry!.content).toContain("no recent gate recorded");
			expect(entry!.content).toContain("Session: ghi789");
		});

		it("returns null when only finish with unknown status and no session", () => {
			expect(
				OperatorStateProvider.parseResumeJson({ finish: { status: "unknown" } }),
			).toBeNull();
		});
	});

	it("returns empty array when refarm is unavailable", async () => {
		const provider = new OperatorStateProvider();
		const entries = await provider.provide({ cwd: os.tmpdir() });
		expect(Array.isArray(entries)).toBe(true);
	});
});

describe("PolicyFilesContextProvider", () => {
	it("returns empty outside git repo", async () => {
		const provider = new PolicyFilesContextProvider();
		const entries = await provider.provide({ cwd: os.tmpdir() });
		expect(entries).toEqual([]);
	});

	it("returns empty when no known policy files exist at git root", () => {
		const files = PolicyFilesContextProvider.scanPolicyFiles(os.tmpdir());
		expect(files).toEqual([]);
	});

	it("detects AGENTS.md and builds a pointer entry", () => {
		const agentsMd = path.join(tempDir, "AGENTS.md");
		writeFileSync(agentsMd, "# Rules of Engagement\n\nDo not edit dist/\n", "utf8");

		const files = PolicyFilesContextProvider.scanPolicyFiles(tempDir);
		expect(files).toHaveLength(1);
		expect(files[0]!.relativePath).toBe("AGENTS.md");
		expect(files[0]!.absolutePath).toBe(agentsMd);
		expect(files[0]!.heading).toBe("Rules of Engagement");
		expect(files[0]!.lines).toBeGreaterThan(0);

		const entry = PolicyFilesContextProvider.buildEntry(files);
		expect(entry.label).toBe("policy_files");
		expect(entry.priority).toBe(12);
		expect(entry.content).toContain("Rules of Engagement");
		expect(entry.content).toContain(agentsMd);
		expect(entry.content).toContain("agent-fs.read");
	});

	it("detects multiple policy files and lists all", () => {
		writeFileSync(path.join(tempDir, "AGENTS.md"), "# Agent Rules\n", "utf8");
		writeFileSync(path.join(tempDir, "CLAUDE.md"), "# Claude Instructions\n", "utf8");

		const files = PolicyFilesContextProvider.scanPolicyFiles(tempDir);
		expect(files).toHaveLength(2);
		const relPaths = files.map((f) => f.relativePath);
		expect(relPaths).toContain("AGENTS.md");
		expect(relPaths).toContain("CLAUDE.md");
	});

	it("handles policy file with no heading", () => {
		writeFileSync(path.join(tempDir, "AGENTS.md"), "Do not edit dist/\n", "utf8");
		const files = PolicyFilesContextProvider.scanPolicyFiles(tempDir);
		expect(files[0]!.heading).toBeNull();
		const entry = PolicyFilesContextProvider.buildEntry(files);
		expect(entry.content).toContain("AGENTS.md");
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
