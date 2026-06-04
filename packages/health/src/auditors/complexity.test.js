import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ComplexityAuditor } from "./complexity.js";

let rootDir;

function writeFile(relativePath, content = "") {
    const filePath = path.join(rootDir, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf-8");
}

describe("ComplexityAuditor", () => {
    beforeEach(() => {
        rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-health-complexity-"));
    });

    afterEach(() => {
        fs.rmSync(rootDir, { recursive: true, force: true });
    });

    it("reports blocking large files above the configured budget", async () => {
        writeFile("packages/tool/src/index.ts", "one\ntwo\nthree\nfour\n");
        writeFile("packages/tool/src/small.ts", "one\ntwo\n");

        const report = await new ComplexityAuditor({
            maxLines: 3,
            paths: ["packages"],
        }).audit({ rootDir });

        expect(report.ok).toBe(false);
        expect(report.maxLines).toBe(3);
        expect(report.blockingFindings).toEqual([
            {
                allowed: false,
                category: "source",
                file: "packages/tool/src/index.ts",
                lines: 4,
                note: "over-limit",
                size: 19,
                type: "complexity_large_file",
            },
        ]);
        expect(report.topBlockingFindings).toEqual(report.blockingFindings);
        expect(report.summaryByCategory).toEqual({
            source: {
                allowed: 0,
                blocking: 1,
                files: 1,
                maxLines: 4,
                totalLines: 4,
            },
        });
    });

    it("keeps allowed large files visible without making them blocking", async () => {
        writeFile("docs/generated/api.md", "one\ntwo\nthree\nfour\n");

        const report = await new ComplexityAuditor({
            allowedPatterns: ["docs/generated/**"],
            maxLines: 3,
            paths: ["docs"],
        }).audit({ rootDir });

        expect(report.ok).toBe(true);
        expect(report.blockingFindings).toEqual([]);
        expect(report.allowedFindings).toHaveLength(1);
        expect(report.allowedFindings[0]).toMatchObject({
            allowed: true,
            category: "docs",
            file: "docs/generated/api.md",
            note: "allowed:docs/generated/**",
        });
    });
});
