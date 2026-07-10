import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("@refarm.dev/operator-state boundary", () => {
	it("does not import app, runtime, CLI, filesystem, HTTP, or renderer code", () => {
		const source = fs.readFileSync(path.join(packageRoot, "src/index.ts"), "utf-8");
		const forbidden = [
			"apps/refarm",
			"@refarm.dev/refarm",
			"@refarm.dev/runtime",
			"@refarm.dev/health",
			"@refarm.dev/sidecar-client",
			"@refarm.dev/storage-sqlite",
			"commander",
			"chalk",
			"node:fs",
			"node:path",
			"fetch(",
		];

		expect(forbidden.filter((token) => source.includes(token))).toEqual([]);
	});
});
