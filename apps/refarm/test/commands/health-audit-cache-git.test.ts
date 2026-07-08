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
	return root;
}

describe("health audit git cache fingerprint", () => {
	it("uses changed path lists instead of raw binary diffs", async () => {
		const root = createWorkspace();
		const calls: string[][] = [];
		vi.doMock("@refarm.dev/cli/git-command", () => ({
			readGitCommand: (args: string[]) => {
				calls.push(args);
				if (args.includes("--binary")) {
					throw new Error("binary diff should not be part of cache fingerprint");
				}
				if (args.join(" ") === "rev-parse --show-toplevel") return root;
				if (args.join(" ") === "rev-parse HEAD") return "abc123";
				if (args[0] === "status") return " M packages/example/package.json\0";
				if (args[0] === "diff" && args.includes("--name-only")) {
					return "packages/example/package.json\0";
				}
				if (args[0] === "ls-files") return "";
				return "";
			},
		}));

		const { buildHealthAuditFingerprint } = await import(
			"../../src/commands/health-audit-cache.js"
		);

		expect(buildHealthAuditFingerprint(root)).toMatch(/^[a-f0-9]{64}$/);
		expect(calls.some((args) => args.includes("--binary"))).toBe(false);
		expect(calls.some((args) => args.includes("--name-only"))).toBe(true);
	});
});
