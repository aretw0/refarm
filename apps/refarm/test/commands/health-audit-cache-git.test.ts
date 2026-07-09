import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempRoots: string[] = [];

afterEach(() => {
	for (const root of tempRoots.splice(0)) {
		fs.rmSync(root, { force: true, recursive: true });
	}
	vi.resetModules();
	vi.restoreAllMocks();
});

function createWorkspace(): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-health-git-cache-"));
	tempRoots.push(root);
	fs.mkdirSync(path.join(root, "packages", "example"), { recursive: true });
	fs.writeFileSync(
		path.join(root, "refarm.config.json"),
		`${JSON.stringify({
			health: {
				preset: "workspace",
				workspaceRoots: ["packages"],
				ignoredGitVisibilityPatterns: [],
			},
		}, null, 2)}\n`,
	);
	fs.writeFileSync(
		path.join(root, "packages", "example", "package.json"),
		`${JSON.stringify({
			name: "@example/cache",
			main: "dist/index.js",
			types: "dist/index.d.ts",
		}, null, 2)}\n`,
	);
	fs.mkdirSync(path.join(root, "packages", "example", "src"), { recursive: true });
	fs.writeFileSync(
		path.join(root, "packages", "example", "src", "index.ts"),
		"export const value = 1;\n",
	);
	return root;
}

describe("health audit git cache fingerprint", () => {
	it("uses porcelain status paths instead of extra diff and untracked probes", async () => {
		const root = createWorkspace();
		const calls: string[][] = [];
		vi.doMock("@refarm.dev/cli/git-command", () => ({
			readGitCommand: (args: string[]) => {
				calls.push(args);
				if (args.includes("--binary")) {
					throw new Error("binary diff should not be part of cache fingerprint");
				}
				if (args[0] === "diff" || args[0] === "ls-files") {
					throw new Error("status porcelain should provide changed paths");
				}
				if (args.join(" ") === "rev-parse --show-toplevel") return root;
				if (args.join(" ") === "rev-parse HEAD") return "abc123";
				if (args[0] === "status") {
					return " M packages/example/package.json\0?? packages/example/new.ts\0";
				}
				return "";
			},
		}));

		const { buildHealthAuditFingerprint } = await import(
			"../../src/commands/health-audit-cache.js"
		);

		expect(buildHealthAuditFingerprint(root)).toMatch(/^[a-f0-9]{64}$/);
		expect(calls.some((args) => args.includes("--binary"))).toBe(false);
		expect(calls.some((args) => args[0] === "diff")).toBe(false);
		expect(calls.some((args) => args[0] === "ls-files")).toBe(false);
	});

	it("does not invalidate health cache for ordinary source edits when complexity is disabled", async () => {
		const root = createWorkspace();
		let status = "";
		vi.doMock("@refarm.dev/cli/git-command", () => ({
			readGitCommand: (args: string[]) => {
				if (args.join(" ") === "rev-parse --show-toplevel") return root;
				if (args.join(" ") === "rev-parse HEAD") return "abc123";
				if (args[0] === "status") return status;
				return "";
			},
		}));

		const { buildHealthAuditFingerprint } = await import(
			"../../src/commands/health-audit-cache.js"
		);

		const clean = buildHealthAuditFingerprint(root);
		status = " M packages/example/src/index.ts\0";

		expect(buildHealthAuditFingerprint(root)).toBe(clean);
	});
});
