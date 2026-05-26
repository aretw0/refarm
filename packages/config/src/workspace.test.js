import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    affectedWorkspacePackagesFromGitStatus,
    changedFilePathsFromGitStatus,
    findWorkspacePackageForPath,
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
            expect(findWorkspacePackageForPath(root, "docs/guide.md")).toBeNull();
            expect(findWorkspacePackageForPath(root, "docs/guide.md", { includeRoot: true })).toBe(".");
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
