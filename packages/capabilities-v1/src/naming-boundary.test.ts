import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(file: string): string {
	return readFileSync(join(process.cwd(), "src", file), "utf8");
}

describe("capabilities-v1 naming boundary", () => {
	it("keeps public dependency contracts host-agnostic", () => {
		const source = [
			readSource("builtin-capabilities.ts"),
			readSource("host.ts"),
			readSource("index.ts"),
			readSource("mount.ts"),
		].join("\n");

		expect(source).not.toMatch(/\bRefarmCapabilityDeps\b/u);
		expect(source).not.toMatch(/\brefarmBuiltinCapabilities\b/u);
	});

	it("keeps the default web surface title product-neutral", () => {
		expect(readSource("web-ui.ts")).not.toContain("Refarm surface");
	});
});
