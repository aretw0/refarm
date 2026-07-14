import { describe, expect, it } from "vitest";

import { createXyzzyCapability } from "./easter-egg.js";
import { DEVBENCH_THEMES, resolveDevbenchTheme } from "./theme.js";

describe("resolveDevbenchTheme — optional brand overlay", () => {
	it("defaults to the neutral bench when no theme is set", () => {
		expect(resolveDevbenchTheme({}).description).toBe("Digital Gardening Kit - extension bench");
	});

	it("applies the serpro theme when DGK_THEME=serpro", () => {
		const t = resolveDevbenchTheme({ DGK_THEME: "serpro" });
		expect(t.description).toContain("Extensibilidade Segura");
		expect(t.tagline).toContain("governança");
	});

	it("falls back to neutral for an unknown theme", () => {
		expect(resolveDevbenchTheme({ DGK_THEME: "nope" }).description).toBe("Digital Gardening Kit - extension bench");
	});

	it("lists the known themes for discovery", () => {
		expect(DEVBENCH_THEMES).toEqual(expect.arrayContaining(["neutral", "serpro"]));
	});

	it("the tagline is CONSUMED — it reaches the web face header (not a dead export)", async () => {
		const { devWebSurface } = await import("./persona.js");
		const { buildRegistry } = await import("./cli.js");
		const handle = devWebSurface(buildRegistry());
		const result = (await handle.call?.("renderHomesteadSurface", {})) as { html: string };
		// The neutral tagline frames the web header (DGK_THEME unset in test → neutral).
		expect(result.html).toContain(resolveDevbenchTheme({}).tagline);
	});

	it("DEVBENCH_THEMES is CONSUMED — the CLI description surfaces the discovery hint", async () => {
		const { buildProgram } = await import("./cli.js");
		const program = buildProgram();
		// The host description carries "(DGK_THEME: neutral | serpro)" so --help lists them.
		expect(program.description()).toContain("DGK_THEME:");
		for (const name of DEVBENCH_THEMES) expect(program.description()).toContain(name);
	});
});

describe("xyzzy easter egg", () => {
	it("is a real capability that reveals the hidden T1→T3 continuity", async () => {
		const env = (await createXyzzyCapability().run({ args: {}, options: {}, json: true })) as unknown as {
			message: string;
			continuity: string;
		};
		expect(env.message).toContain("Nothing happens");
		expect(env.continuity).toContain("same WASM plugin");
	});
});
