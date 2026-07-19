// The Style Dictionary platform config, shared by the generator (scripts/generate-platforms.ts) and the
// drift guard (platforms.test.ts) so the committed platform exports and the re-generation check can never
// use different settings. PURE (no I/O, no style-dictionary import) — SD consumes this shape at generate
// and test time. A local structural type keeps src decoupled from the SD type surface (SD is a devDep).

/** One output file in a platform (SD `File`). */
interface PlatformFile {
	destination: string;
	format: string;
	options?: Record<string, unknown>;
}
/** One platform (SD `PlatformConfig`). */
interface PlatformDef {
	transformGroup: string;
	buildPath: string;
	files: PlatformFile[];
}
/** The subset of the Style Dictionary config we build. */
export interface PlatformConfig {
	usesDtcg: boolean;
	source: string[];
	platforms: Record<string, PlatformDef>;
}

/** The platform targets we emit from the DTCG source (the formats SD does and our local emitter does not:
 * Sass web, Apple, Google, Flutter). Native exports use the theme's BASE palette; modes are web-only. */
export const PLATFORM_TARGETS = ["scss", "ios", "android", "flutter"] as const;

/** `tractor-green` → `TractorGreen` (for Swift/Dart class names). */
function pascalCase(id: string): string {
	return id
		.split(/[-_]/)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join("");
}

/**
 * Build the Style Dictionary config that emits the platform exports for one theme from its DTCG `source`
 * into `buildRoot` (which must end with `/`). Deterministic — `showFileHeader:false` removes SD's
 * timestamped header, so the output is stable and the committed files are drift-guardable.
 */
export function buildPlatformConfig(themeId: string, source: string, buildRoot: string): PlatformConfig {
	const className = `${pascalCase(themeId)}Tokens`;
	const snake = themeId.replace(/-/g, "_");
	return {
		usesDtcg: true,
		source: [source],
		platforms: {
			scss: {
				transformGroup: "scss",
				buildPath: `${buildRoot}scss/`,
				files: [{ destination: `${themeId}.scss`, format: "scss/variables", options: { showFileHeader: false } }],
			},
			ios: {
				transformGroup: "ios-swift",
				buildPath: `${buildRoot}ios/`,
				files: [{ destination: `${className}.swift`, format: "ios-swift/class.swift", options: { showFileHeader: false, className } }],
			},
			android: {
				transformGroup: "android",
				buildPath: `${buildRoot}android/`,
				files: [{ destination: `${themeId}.xml`, format: "android/resources", options: { showFileHeader: false } }],
			},
			flutter: {
				transformGroup: "flutter",
				buildPath: `${buildRoot}flutter/`,
				files: [{ destination: `${snake}.dart`, format: "flutter/class.dart", options: { showFileHeader: false, className } }],
			},
		},
	};
}
