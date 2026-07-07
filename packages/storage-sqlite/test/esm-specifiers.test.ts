import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

describe("@refarm.dev/storage-sqlite ESM specifiers", () => {
	it("uses explicit .js extensions for runtime relative exports", () => {
		const offenders: string[] = [];
		for (const sourceFile of ["src/index.ts", "src/node.ts"]) {
			const source = fs.readFileSync(path.join(packageRoot, sourceFile), "utf-8");
			const specifierPattern =
				/(?:\bfrom\s+["'](?<from>\.[^"']+)["']|\bexport\s+\*\s+from\s+["'](?<star>\.[^"']+)["'])/g;
			for (const match of source.matchAll(specifierPattern)) {
				const specifier = match.groups?.from ?? match.groups?.star;
				if (specifier && !specifier.endsWith(".js")) {
					offenders.push(`${sourceFile}: ${specifier}`);
				}
			}
		}

		expect(offenders).toEqual([]);
	});
});
