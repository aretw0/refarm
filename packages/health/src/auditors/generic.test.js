import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileSystemAuditor } from "./generic.js";

let rootDir;

function writeFile(relativePath, content = "") {
    const filePath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

describe("FileSystemAuditor", () => {
    beforeEach(() => {
        rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-health-fs-"));
        fs.mkdirSync(path.join(rootDir, ".git"));
    });

    afterEach(() => {
        fs.rmSync(rootDir, { recursive: true, force: true });
    });

    it("reports ignored source files unless policy excludes their pattern", async () => {
        writeFile(".gitignore", "*.generated.ts\n");
        writeFile("src/generated.generated.ts");
        writeFile("src/handwritten.ts");

        const auditor = new FileSystemAuditor();
        await expect(auditor.checkGitVisibility(rootDir, rootDir)).resolves.toEqual([
            {
                file: "src/generated.generated.ts",
                type: "git_ignored",
                path: path.join(rootDir, "src/generated.generated.ts"),
            },
        ]);

        const policyAuditor = new FileSystemAuditor({
            ignoredGitVisibilityPatterns: ["**/*.generated.ts"],
        });
        await expect(policyAuditor.checkGitVisibility(rootDir, rootDir)).resolves.toEqual([]);
    });

    it("supports exact ignored git visibility paths", async () => {
        writeFile(".gitignore", "src/bindings.rs\n");
        writeFile("src/bindings.rs");

        const auditor = new FileSystemAuditor({
            ignoredGitVisibilityPatterns: ["src/bindings.rs"],
        });

        await expect(auditor.checkGitVisibility(rootDir, rootDir)).resolves.toEqual([]);
    });
});
