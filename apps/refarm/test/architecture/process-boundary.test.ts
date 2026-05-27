import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_SRC_DIR = path.resolve(__dirname, "../../src");
const PROCESS_MODULE_PATTERNS = [
	/from\s+["']node:child_process["']/,
	/from\s+["']child_process["']/,
	/require\(["']node:child_process["']\)/,
	/require\(["']child_process["']\)/,
] as const;

function sourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const filePath = path.join(dir, entry);
		const stat = statSync(filePath);
		if (stat.isDirectory()) {
			files.push(...sourceFiles(filePath));
			continue;
		}
		if (/\.[cm]?[jt]s$/.test(entry)) files.push(filePath);
	}
	return files;
}

describe("process execution boundary", () => {
	it("keeps child process adapters out of the refarm app source", () => {
		const offenders = sourceFiles(APP_SRC_DIR).filter((filePath) => {
			const source = readFileSync(filePath, "utf-8");
			return PROCESS_MODULE_PATTERNS.some((pattern) => pattern.test(source));
		});

		expect(offenders.map((filePath) => path.relative(APP_SRC_DIR, filePath))).toEqual([]);
	});
});
