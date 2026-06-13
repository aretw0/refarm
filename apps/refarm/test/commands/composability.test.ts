import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../src",
);

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(fullPath);
		return [".ts", ".js"].includes(extname(entry.name)) ? [fullPath] : [];
	});
}

describe("refarm CLI composability", () => {
	it("does not hard-exit from source modules", () => {
		const offenders = sourceFiles(sourceRoot)
			.map((file) => ({
				file,
				content: readFileSync(file, "utf-8"),
			}))
			.filter(({ content }) => /\bprocess\.exit\s*\(/.test(content))
			.map(({ file }) => file);

		expect(offenders).toEqual([]);
	});
});
