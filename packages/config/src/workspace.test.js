import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	affectedWorkspacePackagesFromChangedPaths,
	affectedWorkspacePackagesFromGitStatus,
	changedFilePathsFromGitNameOnly,
	changedFilePathsFromGitStatus,
	findWorkspacePackageForPath,
	findWorkspaceRoot,
	hasWorkspaceRootMarker,
} from "./workspace.js";

describe("workspace package detection", () => {
	it("parses changed paths from git short status output", () => {
		expect(
			changedFilePathsFromGitStatus(
				[
					" M apps/refarm/src/index.ts",
					"R  packages/old.ts -> packages/new.ts",
					'?? "apps/refarm/src/file with space.ts"',
				].join("\n"),
			),
		).toEqual([
			"apps/refarm/src/index.ts",
			"packages/new.ts",
			"apps/refarm/src/file with space.ts",
		]);
	});

	it("parses changed paths from git diff name-only output", () => {
		expect(
			changedFilePathsFromGitNameOnly(
				["apps/refarm/src/index.ts", '"apps/refarm/src/file with space.ts"'].join("\n"),
			),
		).toEqual(["apps/refarm/src/index.ts", "apps/refarm/src/file with space.ts"]);
	});

	it("finds affected workspace packages without promoting the repository root", () => {
		const root = mkdtempSync(join(tmpdir(), "refarm-config-workspace-"));
		try {
			const appDir = join(root, "apps", "refarm");
			mkdirSync(join(appDir, "src"), { recursive: true });
			mkdirSync(join(root, "docs"), { recursive: true });
			writeFileSync(join(root, "package.json"), JSON.stringify({ name: "root" }));
			writeFileSync(join(appDir, "package.json"), JSON.stringify({ name: "refarm" }));
			writeFileSync(join(appDir, "src", "index.ts"), "export {};\n");
			writeFileSync(join(root, "docs", "guide.md"), "# Guide\n");

			const status = [" M apps/refarm/src/index.ts", " M docs/guide.md"].join("\n");

			expect(affectedWorkspacePackagesFromGitStatus(root, status)).toEqual(["apps/refarm"]);
			expect(
				affectedWorkspacePackagesFromChangedPaths(root, [
					"apps/refarm/src/index.ts",
					"docs/guide.md",
				]),
			).toEqual(["apps/refarm"]);
			expect(findWorkspacePackageForPath(root, "docs/guide.md")).toBeNull();
			expect(findWorkspacePackageForPath(root, "docs/guide.md", { includeRoot: true })).toBe(".");
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("finds workspace roots from package.json workspaces", () => {
		const root = mkdtempSync(join(tmpdir(), "refarm-config-workspace-root-"));
		try {
			const appDir = join(root, "apps", "refarm");
			mkdirSync(appDir, { recursive: true });
			writeFileSync(
				join(root, "package.json"),
				JSON.stringify({
					private: true,
					workspaces: ["apps/*"],
				}),
			);
			writeFileSync(join(appDir, "package.json"), JSON.stringify({ name: "refarm" }));

			expect(findWorkspaceRoot(appDir)).toBe(root);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("finds workspace roots from package.json workspace package lists", () => {
		const root = mkdtempSync(join(tmpdir(), "refarm-config-workspace-root-list-"));
		try {
			const appDir = join(root, "packages", "config");
			mkdirSync(appDir, { recursive: true });
			writeFileSync(
				join(root, "package.json"),
				JSON.stringify({
					private: true,
					workspaces: { packages: ["packages/*"] },
				}),
			);
			writeFileSync(join(appDir, "package.json"), JSON.stringify({ name: "config" }));

			expect(findWorkspaceRoot(appDir)).toBe(root);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	// Pins the exported predicate `apps/refarm/src/commands/context.ts`'s
	// `resolveBuiltPluginPath` now takes as its default `hasMonorepoMarker` — so the
	// package.json-in-a-JSON-parse-failure case, and every marker kind, stay verified here
	// rather than only in the hand-copied duplicate this replaced.
	describe("hasWorkspaceRootMarker", () => {
		it("is true for a directory with a .git marker", () => {
			const root = mkdtempSync(join(tmpdir(), "refarm-config-marker-git-"));
			try {
				mkdirSync(join(root, ".git"));
				expect(hasWorkspaceRootMarker(root)).toBe(true);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

		it("is true for a directory with a pnpm-workspace.yaml marker", () => {
			const root = mkdtempSync(join(tmpdir(), "refarm-config-marker-pnpm-"));
			try {
				writeFileSync(join(root, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n");
				expect(hasWorkspaceRootMarker(root)).toBe(true);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

		it("is true for a package.json with a workspaces array", () => {
			const root = mkdtempSync(join(tmpdir(), "refarm-config-marker-array-"));
			try {
				writeFileSync(join(root, "package.json"), JSON.stringify({ workspaces: ["apps/*"] }));
				expect(hasWorkspaceRootMarker(root)).toBe(true);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

		it("is true for a package.json with a workspaces.packages list", () => {
			const root = mkdtempSync(join(tmpdir(), "refarm-config-marker-packages-"));
			try {
				writeFileSync(
					join(root, "package.json"),
					JSON.stringify({ workspaces: { packages: ["packages/*"] } }),
				);
				expect(hasWorkspaceRootMarker(root)).toBe(true);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

		it("is false for a directory with no marker at all", () => {
			const root = mkdtempSync(join(tmpdir(), "refarm-config-marker-none-"));
			try {
				expect(hasWorkspaceRootMarker(root)).toBe(false);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

		it("is false — not thrown — for an unparseable package.json", () => {
			const root = mkdtempSync(join(tmpdir(), "refarm-config-marker-bad-json-"));
			try {
				writeFileSync(join(root, "package.json"), "{ not valid json");
				expect(hasWorkspaceRootMarker(root)).toBe(false);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});

		it("is false for a package.json with no workspaces field", () => {
			const root = mkdtempSync(join(tmpdir(), "refarm-config-marker-plain-"));
			try {
				writeFileSync(join(root, "package.json"), JSON.stringify({ name: "leaf" }));
				expect(hasWorkspaceRootMarker(root)).toBe(false);
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		});
	});
});
