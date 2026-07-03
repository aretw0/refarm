import {
	registerThemePacks,
	resolveThemePacksFromSurfaces,
	ThemeRegistry,
	type ThemeRegistrationResult,
} from "@refarm.dev/ds";
import {
	getExtensionSurfaces,
	type PluginManifest,
} from "@refarm.dev/plugin-manifest";

export const PLUGIN_SURFACE_LOADER_CAPABILITY =
	"plugin-surface-loader:v1" as const;

/**
 * Loads the extension surfaces a plugin declares in its manifest into the host
 * registries — the missing link the recon flagged: a plugin can declare surfaces
 * ({layer,kind}) and the manifest validates them, but nothing loaded any layer
 * other than "homestead". This package reads a layer and hands each surface to
 * the right registry, starting with themes (`{layer:"asset",kind:"theme-pack"}`).
 *
 * It composes @refarm.dev/plugin-manifest (surface enumeration) and
 * @refarm.dev/ds (theme registry + conformance) so neither has to know about the
 * other. Asset I/O is injected as `loadAsset`, so the loader stays pure and
 * testable and the host chooses how to read a plugin's files.
 */

export interface LoadThemesResult {
	/** One registration result per resolved theme pack (ok + missing tokens). */
	results: ThemeRegistrationResult[];
	/** Theme ids that registered successfully. */
	registered: string[];
	/** Theme ids that were rejected, with why. */
	rejected: { id: string; missing: string[] }[];
}

/**
 * Read a plugin manifest's asset-layer theme-pack surfaces and register the
 * conformant ones into `registry`. `loadAsset(path)` reads+parses one asset
 * (injected). A pack missing required tokens is rejected (never registered);
 * a broken asset is skipped. Returns a summary the host can surface.
 */
export function loadThemesFromManifest(
	manifest: PluginManifest,
	loadAsset: (assetPath: string) => unknown,
	registry: ThemeRegistry = new ThemeRegistry(),
): LoadThemesResult {
	const surfaces = getExtensionSurfaces(manifest, "asset");
	const packs = resolveThemePacksFromSurfaces(surfaces, loadAsset);
	const results = registerThemePacks(registry, packs);
	return {
		results,
		registered: results.filter((r) => r.ok).map((r) => r.id),
		rejected: results
			.filter((r) => !r.ok)
			.map((r) => ({ id: r.id, missing: r.missing })),
	};
}

export { ThemeRegistry };
