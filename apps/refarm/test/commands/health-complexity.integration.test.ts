import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runHealthAudit } from "../../src/commands/health.js";

let rootDir: string;

function writeFile(relativePath: string, content = ""): void {
	const filePath = path.join(rootDir, relativePath);
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
}

describe("health complexity integration", () => {
	beforeEach(() => {
		rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-health-complexity-cli-"));
	});

	afterEach(() => {
		fs.rmSync(rootDir, { recursive: true, force: true });
	});

	it("reports configured large-file pressure through the real health audit", async () => {
		writeFile("refarm.config.json", JSON.stringify({
			health: {
				workspaceRoots: ["src"],
				complexity: {
					enabled: true,
					maxLines: 3,
					paths: ["src"],
					reportLimit: 5,
				},
			},
		}));
		writeFile("src/large.ts", "one\ntwo\nthree\nfour\n");
		writeFile("src/small.ts", "one\ntwo\n");

		const report = await runHealthAudit(rootDir);

		expect(report.ok).toBe(false);
		expect(report.issueCount).toBe(1);
		expect(report.results.complexity).toEqual([
			expect.objectContaining({
				file: "src/large.ts",
				lines: 4,
				note: "over-limit",
				type: "complexity_large_file",
			}),
		]);
		expect(report.results.complexitySummary).toMatchObject({
			maxLines: 3,
			reportLimit: 5,
			topBlockingFindings: [
				expect.objectContaining({ file: "src/large.ts" }),
			],
		});
		expect(report.nextCommands).toEqual(["refarm health --suggest-policy --json"]);
	});
});
