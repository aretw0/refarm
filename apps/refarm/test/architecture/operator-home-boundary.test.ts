import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = path.resolve(import.meta.dirname, "../../src");
const adapterPath = path.join(sourceRoot, "utils", "refarm-home.ts");

function sourceFiles(root: string): string[] {
	return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
		const candidate = path.join(root, entry.name);
		if (entry.isDirectory()) return sourceFiles(candidate);
		return entry.isFile() && candidate.endsWith(".ts") ? [candidate] : [];
	});
}

describe("operator home boundary", () => {
	it("keeps the ~/.refarm physical default inside the app adapter", () => {
		const offenders = sourceFiles(sourceRoot)
			.filter((file) => file !== adapterPath)
			.filter((file) => {
				const source = fs.readFileSync(file, "utf8");
				return /homedir\(\)[\s\S]{0,80}["']\.refarm["']/.test(source);
			})
			.map((file) => path.relative(sourceRoot, file));

		expect(offenders).toEqual([]);
	});
});
