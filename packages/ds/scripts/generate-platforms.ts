// Generate the PLATFORM token exports from the DTCG source via Style Dictionary — the formats SD is best
// at and our local emitter does not do: SCSS (Sass web), iOS (Swift/UIColor), Android (XML resources),
// Flutter (Dart Color). One DTCG source (src/tokens/<id>.tokens.json) → every platform, so refarm's
// design system distributes to any consumer, not just our bespoke web CSS. Run via `pnpm generate`.
//
// Division of labour: the local emitter (generate-tokens.ts) owns the bespoke web CSS + BUILTIN_THEMES
// (JS); Style Dictionary owns the platform exports here. Both read the SAME DTCG source, so nothing can
// diverge. Native exports use the BASE (default) palette only — light/dark modes are a web concern.
//
// Output is DETERMINISTIC (showFileHeader:false removes SD's timestamped header), so the committed files
// under src/platforms/ are stable and drift-guarded by platforms.test.ts.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { buildPlatformConfig, PLATFORM_TARGETS } from "../src/sd-config.js";
import type { ThemesManifest } from "../src/tokens-manifest.js";

const TOKENS_DIR = new URL("../src/tokens/", import.meta.url);
const PLATFORMS_DIR = fileURLToPath(new URL("../src/platforms/", import.meta.url));

const manifest = JSON.parse(
	readFileSync(fileURLToPath(new URL("themes.manifest.json", TOKENS_DIR)), "utf8"),
) as ThemesManifest;

const { default: StyleDictionary } = await import("style-dictionary");

for (const theme of manifest.themes) {
	const source = fileURLToPath(new URL(theme.base, TOKENS_DIR));
	const sd = new StyleDictionary(buildPlatformConfig(theme.id, source, PLATFORMS_DIR));
	await sd.buildAllPlatforms();
	console.log(`generated platforms for ${theme.id} (${PLATFORM_TARGETS.join(", ")})`);
}
