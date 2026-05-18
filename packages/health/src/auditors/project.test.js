import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectAuditor, RefarmProjectAuditor } from "./project.js";

let rootDir;

function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function makeWorkspacePackage(workspaceRoot, name, packageJson, files = []) {
    const packageDir = path.join(rootDir, workspaceRoot, name);
    writeJson(path.join(packageDir, "package.json"), packageJson);
    for (const file of files) {
        fs.mkdirSync(path.dirname(path.join(packageDir, file)), { recursive: true });
        fs.writeFileSync(path.join(packageDir, file), "", "utf-8");
    }
    return packageDir;
}

describe("ProjectAuditor", () => {
    beforeEach(() => {
        rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-health-"));
    });

    afterEach(() => {
        fs.rmSync(rootDir, { recursive: true, force: true });
    });

    it("checks build configs across packages and apps", async () => {
        const auditor = new ProjectAuditor();
        makeWorkspacePackage(
            "packages",
            "has-build",
            { name: "@refarm.dev/has-build", main: "./dist/index.js" },
            ["tsconfig.json", "tsconfig.build.json"],
        );
        makeWorkspacePackage(
            "apps",
            "missing-build",
            { name: "@refarm.dev/missing-build", main: "./dist/index.js" },
            ["tsconfig.json"],
        );

        await expect(auditor.checkBuildConfigs(rootDir)).resolves.toEqual([
            { package: "apps/missing-build", type: "missing_build_config" },
        ]);
    });

    it("accepts custom workspace roots", async () => {
        const auditor = new ProjectAuditor({ workspaceRoots: ["modules"] });
        makeWorkspacePackage(
            "modules",
            "missing-build",
            { name: "@example/missing-build", main: "./dist/index.js" },
            ["tsconfig.json"],
        );
        makeWorkspacePackage(
            "apps",
            "ignored",
            { name: "@example/ignored", main: "./dist/index.js" },
            ["tsconfig.json"],
        );

        await expect(auditor.checkBuildConfigs(rootDir)).resolves.toEqual([
            { package: "modules/missing-build", type: "missing_build_config" },
        ]);
    });

    it("accepts custom auditor titles", () => {
        const auditor = new ProjectAuditor({ title: "Team Workspace Health" });

        expect(auditor.title).toBe("Team Workspace Health");
    });

    it("does not apply Refarm package exemptions by default", async () => {
        const auditor = new ProjectAuditor();
        makeWorkspacePackage(
            "packages",
            "tsconfig",
            { name: "@refarm.dev/tsconfig", main: "./dist/index.js" },
            ["tsconfig.json"],
        );

        await expect(auditor.checkBuildConfigs(rootDir)).resolves.toEqual([
            { package: "packages/tsconfig", type: "missing_build_config" },
        ]);
        await expect(auditor.checkResolutionStatus(rootDir)).resolves.toEqual([
            { package: "packages/tsconfig", mode: "LINKED (dist)" },
        ]);
    });

    it("allows callers to override package exemptions", async () => {
        const auditor = new ProjectAuditor();
        makeWorkspacePackage(
            "packages",
            "tsconfig",
            { name: "@example/tsconfig", main: "./dist/index.js" },
            ["tsconfig.json"],
        );
        makeWorkspacePackage(
            "modules",
            "meta",
            { name: "@example/meta", main: "./dist/index.js" },
            ["tsconfig.json"],
        );

        await expect(auditor.checkBuildConfigs(rootDir)).resolves.toEqual([
            { package: "packages/tsconfig", type: "missing_build_config" },
        ]);
        await expect(
            auditor.checkBuildConfigs(rootDir, {
                workspaceRoots: ["modules"],
                exemptPackageIds: ["modules/meta"],
            }),
        ).resolves.toEqual([]);
    });

    it("reports resolution status with workspace root prefixes", async () => {
        const auditor = new ProjectAuditor();
        makeWorkspacePackage("packages", "published", {
            name: "@refarm.dev/published",
            main: "./dist/index.js",
        });
        makeWorkspacePackage("apps", "local", {
            name: "@refarm.dev/local",
            main: "./src/index.ts",
        });

        await expect(auditor.checkResolutionStatus(rootDir)).resolves.toEqual([
            { package: "packages/published", mode: "LINKED (dist)" },
            { package: "apps/local", mode: "LINKED (types)" },
        ]);
    });
});

describe("RefarmProjectAuditor", () => {
    beforeEach(() => {
        rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-health-"));
    });

    afterEach(() => {
        fs.rmSync(rootDir, { recursive: true, force: true });
    });

    it("applies Refarm package exemptions as an explicit preset", async () => {
        const auditor = new RefarmProjectAuditor();
        makeWorkspacePackage(
            "packages",
            "tsconfig",
            { name: "@refarm.dev/tsconfig", main: "./dist/index.js" },
            ["tsconfig.json"],
        );

        expect(auditor.title).toBe("Refarm Monorepo Health");
        await expect(auditor.checkBuildConfigs(rootDir)).resolves.toEqual([]);
        await expect(auditor.checkResolutionStatus(rootDir)).resolves.toEqual([
            { package: "packages/tsconfig", mode: "LINKED (dist)" },
        ]);
    });
});
