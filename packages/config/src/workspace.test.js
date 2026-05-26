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
} from "./workspace.js";

describe("workspace package detection", () => {
    it("parses changed paths from git short status output", () => {
        expect(changedFilePathsFromGitStatus([
            " M apps/refarm/src/index.ts",
            "R  packages/old.ts -> packages/new.ts",
            "?? \"apps/refarm/src/file with space.ts\"",
        ].join("\n"))).toEqual([
            "apps/refarm/src/index.ts",
            "packages/new.ts",
            "apps/refarm/src/file with space.ts",
        ]);
    });

    it("parses changed paths from git diff name-only output", () => {
        expect(changedFilePathsFromGitNameOnly([
            "apps/refarm/src/index.ts",
            "\"apps/refarm/src/file with space.ts\"",
        ].join("\n"))).toEqual([
            "apps/refarm/src/index.ts",
            "apps/refarm/src/file with space.ts",
        ]);
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

            const status = [
                " M apps/refarm/src/index.ts",
                " M docs/guide.md",
            ].join("\n");

            expect(affectedWorkspacePackagesFromGitStatus(root, status)).toEqual([
                "apps/refarm",
            ]);
            expect(affectedWorkspacePackagesFromChangedPaths(root, [
                "apps/refarm/src/index.ts",
                "docs/guide.md",
            ])).toEqual(["apps/refarm"]);
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
            writeFileSync(join(root, "package.json"), JSON.stringify({
                private: true,
                workspaces: ["apps/*"],
            }));
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
            writeFileSync(join(root, "package.json"), JSON.stringify({
                private: true,
                workspaces: { packages: ["packages/*"] },
            }));
            writeFileSync(join(appDir, "package.json"), JSON.stringify({ name: "config" }));

            expect(findWorkspaceRoot(appDir)).toBe(root);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
