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
	it("uses porcelain status and tracked health files instead of extra diff probes", async () => {
		const root = createWorkspace();
		const calls: string[][] = [];
		vi.doMock("@refarm.dev/cli/git-command", () => ({
			readGitCommand: (args: string[]) => {
				calls.push(args);
				if (args.includes("--binary")) {
					throw new Error("binary diff should not be part of cache fingerprint");
				}
				if (args[0] === "diff") {
					throw new Error("status porcelain should provide changed paths");
				}
				if (args.join(" ") === "rev-parse --show-toplevel") return root;
				if (args[0] === "status") {
					return " M packages/example/package.json\0?? packages/example/new.ts\0";
				}
				if (args[0] === "ls-files") {
					return "packages/example/package.json\0packages/example/src/index.ts\0refarm.config.json\0";
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
		expect(calls.some((args) => args[0] === "ls-files")).toBe(true);
	});

	it("does not invalidate health cache for ordinary source edits when complexity is disabled", async () => {
		const root = createWorkspace();
		let status = "";
		vi.doMock("@refarm.dev/cli/git-command", () => ({
			readGitCommand: (args: string[]) => {
				if (args.join(" ") === "rev-parse --show-toplevel") return root;
				if (args[0] === "status") return status;
				if (args[0] === "ls-files") {
					return "packages/example/package.json\0packages/example/src/index.ts\0refarm.config.json\0";
				}
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

	it("does not invalidate health cache only because HEAD changed", async () => {
		const root = createWorkspace();
		let head = "abc123";
		vi.doMock("@refarm.dev/cli/git-command", () => ({
			readGitCommand: (args: string[]) => {
				if (args.join(" ") === "rev-parse --show-toplevel") return root;
				if (args.join(" ") === "rev-parse HEAD") return head;
				if (args[0] === "status") return "";
				if (args[0] === "ls-files") {
					return "packages/example/package.json\0packages/example/src/index.ts\0refarm.config.json\0";
				}
				return "";
			},
		}));

		const { buildHealthAuditFingerprint } = await import(
			"../../src/commands/health-audit-cache.js"
		);

		const clean = buildHealthAuditFingerprint(root);
		head = "def456";

		expect(buildHealthAuditFingerprint(root)).toBe(clean);
	});

	it("invalidates health cache when tracked health files change", async () => {
		const root = createWorkspace();
		vi.doMock("@refarm.dev/cli/git-command", () => ({
			readGitCommand: (args: string[]) => {
				if (args.join(" ") === "rev-parse --show-toplevel") return root;
				if (args[0] === "status") return "";
				if (args[0] === "ls-files") {
					return "packages/example/package.json\0packages/example/src/index.ts\0refarm.config.json\0";
				}
				return "";
			},
		}));

		const { buildHealthAuditFingerprint } = await import(
			"../../src/commands/health-audit-cache.js"
		);

		const before = buildHealthAuditFingerprint(root);
		fs.writeFileSync(
			path.join(root, "packages", "example", "package.json"),
			`${JSON.stringify({
				name: "@example/cache",
				main: "dist/changed.js",
				types: "dist/index.d.ts",
			}, null, 2)}\n`,
		);

		expect(buildHealthAuditFingerprint(root)).not.toBe(before);
	});
});
