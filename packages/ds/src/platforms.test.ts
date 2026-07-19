import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import StyleDictionary from "style-dictionary";
import { describe, expect, it } from "vitest";

import { buildPlatformConfig } from "./sd-config.js";
import { dtcgToDsTheme, type DtcgTokenFile } from "./tokens-source.js";

const THEMES = ["tractor-green", "oceano", "terracota", "verde-jardim"] as const;
const tokensPath = (id: string) => fileURLToPath(new URL(`./tokens/${id}.tokens.json`, import.meta.url));
const COMMITTED = fileURLToPath(new URL("./platforms/", import.meta.url));

function committedFile(rel: string): string {
	return readFileSync(join(COMMITTED, rel), "utf8");
}
function loadSource(id: string): DtcgTokenFile {
	return JSON.parse(readFileSync(tokensPath(id), "utf8")) as DtcgTokenFile;
}

describe("platform exports are byte-faithful to a fresh Style Dictionary build (drift guard)", () => {
	// The inverse of scripts/generate-platforms.ts: re-run SD from the DTCG source into a temp dir and
	// assert every file equals the committed src/platforms/* byte for byte. If this fails, the DTCG source
	// and the committed platform exports diverged — run `pnpm -C packages/ds run generate`.
	it.each(THEMES)("%s: SD re-build matches the committed src/platforms files", async (id) => {
		const tmp = mkdtempSync(join(tmpdir(), "ds-sd-")) + "/";
		try {
			const config = buildPlatformConfig(id, tokensPath(id), tmp);
			await new StyleDictionary({ ...config, log: { verbosity: "silent" } }).buildAllPlatforms();
			for (const platform of Object.values(config.platforms)) {
				const sub = platform.buildPath.slice(tmp.length); // e.g. "scss/"
				for (const file of platform.files) {
					const generated = readFileSync(platform.buildPath + file.destination, "utf8");
					expect(generated, `${sub}${file.destination}`).toBe(committedFile(sub + file.destination));
				}
			}
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});
});

describe("one DTCG source → every platform, consistently (the multi-surface invariant on tokens)", () => {
	// The same design decision, expressed correctly per platform. `primary` #238636 (tractor-green) must
	// appear as: SCSS hex, iOS UIColor components, Android ARGB, Flutter Color(0xAARRGGBB).
	it("projects tractor-green's primary color to each platform's native form", () => {
		const primary = dtcgToDsTheme(loadSource("tractor-green")).primary; // "#238636"
		expect(primary).toBe("#238636");
		expect(committedFile("scss/tractor-green.scss")).toContain("$primary: #238636;");
		expect(committedFile("android/tractor-green.xml")).toContain('<color name="primary">#ff238636</color>');
		expect(committedFile("flutter/tractor_green.dart")).toContain("static const primary = Color(0xFF238636);");
		// iOS emits float components: 0x23/255≈0.137, 0x86/255≈0.525, 0x36/255≈0.212.
		expect(committedFile("ios/TractorGreenTokens.swift")).toMatch(
			/primary = UIColor\(red: 0\.137, green: 0\.525, blue: 0\.212, alpha: 1\)/,
		);
	});

	it("emits every theme to all four platforms (SCSS, iOS, Android, Flutter)", () => {
		for (const id of THEMES) {
			const snake = id.replace(/-/g, "_");
			const cls = id.split("-").map((p) => p[0]!.toUpperCase() + p.slice(1)).join("");
			expect(() => committedFile(`scss/${id}.scss`)).not.toThrow();
			expect(() => committedFile(`android/${id}.xml`)).not.toThrow();
			expect(() => committedFile(`flutter/${snake}.dart`)).not.toThrow();
			expect(() => committedFile(`ios/${cls}Tokens.swift`)).not.toThrow();
		}
	});
});
