import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function read(relPath: string): string {
	return readFileSync(fileURLToPath(new URL(relPath, import.meta.url)), "utf8");
}

describe("token scope discipline", () => {
	it("no theme assigns contract tokens on a bare :root", () => {
		const dir = fileURLToPath(new URL("./themes/", import.meta.url));
		for (const file of readdirSync(dir)) {
			const css = read(`./themes/${file}`);
			expect(/:root\s*\{/.test(css)).toBe(false);
			expect(css).toContain("[data-refarm-theme=");
		}
	});

	it("components.css styles only through tokens (no raw hex)", () => {
		const css = read("./components.css");
		expect(css).toContain(".ds-card");
		expect(css).toContain(".ds-btn");
		expect(/#[0-9a-fA-F]{3,8}\b/.test(css)).toBe(false);
	});
});
