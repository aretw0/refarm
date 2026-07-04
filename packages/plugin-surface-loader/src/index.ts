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
import { parseSkillMarkdown } from "@refarm.dev/skill-contract-v1";

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

/** A skill discovered and parsed from a plugin, ready for the host to expose. */
export interface LoadedSkill {
	/** The surface id that declared the skill. */
	surfaceId: string;
	/** Stable manifest id (name + SKILL.md sha256). */
	id: string;
	name: string;
	/** The description the model matches against to self-select the skill. */
	description?: string;
	/** Capabilities the skill requires — the activation gate checks these. */
	requiredCapabilities: readonly string[];
	/**
	 * The SKILL.md body (its parsed `instructions`). Retained so a host can pass
	 * the skill's real text as a subject to a quality checker — a richer subject
	 * than the one-line description. It is the analysis surface for the plural
	 * evaluator layer (a checker sees the instructions, not just the summary).
	 */
	instructions: string;
}

export interface LoadSkillsResult {
	/** Skills that parsed and validated, ready to be made addressable. */
	loaded: LoadedSkill[];
	/** Skills that failed to parse/load, with the reasons. */
	rejected: { surfaceId: string; issues: string[] }[];
}

/**
 * Read a plugin manifest's pi-layer skill surfaces, load each declared SKILL.md
 * asset, and parse it into a validated skill manifest. Unlike themes, skills are
 * additive/model-invoked: this surfaces the parsed name + description so the host
 * can make the skill addressable (e.g. as `/skill:name`); it does NOT invoke the
 * skill (that stays with the runtime, behind the activation preflight). `loadAsset`
 * returns the SKILL.md text for an asset path; a missing/malformed skill is
 * rejected, never crashing plugin loading.
 */
export function loadSkillsFromManifest(
	manifest: PluginManifest,
	loadAsset: (assetPath: string) => string,
): LoadSkillsResult {
	const loaded: LoadedSkill[] = [];
	const rejected: { surfaceId: string; issues: string[] }[] = [];

	for (const surface of getExtensionSurfaces(manifest, "pi")) {
		if (surface.kind !== "skill") continue;
		const assetPath = surface.assets?.[0];
		if (!assetPath) {
			rejected.push({
				surfaceId: surface.id,
				issues: ["skill surface declares no SKILL.md asset"],
			});
			continue;
		}
		let source: string;
		try {
			source = loadAsset(assetPath);
		} catch (error) {
			rejected.push({
				surfaceId: surface.id,
				issues: [
					`could not load ${assetPath}: ${error instanceof Error ? error.message : String(error)}`,
				],
			});
			continue;
		}
		const parsed = parseSkillMarkdown(source);
		if (!parsed.ok || !parsed.manifest) {
			rejected.push({
				surfaceId: surface.id,
				issues: parsed.issues.map(
					(issue) => `${issue.code}: ${issue.message}`,
				),
			});
			continue;
		}
		const m = parsed.manifest;
		loaded.push({
			surfaceId: surface.id,
			id: m.id,
			name: m.name,
			...(m.description ? { description: m.description } : {}),
			requiredCapabilities: m.capabilities.requires,
			instructions: m.instructions,
		});
	}

	return { loaded, rejected };
}

/** The surface kind a plugin declares to contribute a quality checker. */
export const QUALITY_CHECKER_SURFACE_KIND = "quality-checker" as const;

/** A quality-checker surface a plugin declares — WHERE its component lives, not
 * the loaded checker (loading + sandboxing is the host's job). */
export interface DiscoveredChecker {
	/** The surface id that declared the checker. */
	surfaceId: string;
	/** The relative asset path to the transpiled component entry (the `.js`
	 * glue jco emits). Resolved against the plugin dir by the fs host. */
	entryAsset: string;
}

export interface LoadCheckersResult {
	/** Checker surfaces that declared a component entry asset. */
	loaded: DiscoveredChecker[];
	/** Surfaces rejected (no entry asset, etc.), with why. */
	rejected: { surfaceId: string; issues: string[] }[];
}

/**
 * Read a plugin manifest's quality-checker surfaces (`{kind:"quality-checker"}`,
 * any layer). Unlike skills, a checker surface points at a WASM component the
 * host will load + sandbox — so this only surfaces WHERE the component is
 * (`entryAsset`); it does NOT load or run it (that stays with the host loader,
 * behind the deny-all boundary). A surface with no asset is rejected, never
 * throwing. `kind` and `assets` are already open in the plugin-manifest schema,
 * so a checker surface needs no schema change.
 */
export function loadCheckersFromManifest(
	manifest: PluginManifest,
): LoadCheckersResult {
	const loaded: DiscoveredChecker[] = [];
	const rejected: { surfaceId: string; issues: string[] }[] = [];

	for (const surface of getExtensionSurfaces(manifest)) {
		if (surface.kind !== QUALITY_CHECKER_SURFACE_KIND) continue;
		const entryAsset = surface.assets?.[0];
		if (!entryAsset) {
			rejected.push({
				surfaceId: surface.id,
				issues: [
					"quality-checker surface declares no component entry asset",
				],
			});
			continue;
		}
		loaded.push({ surfaceId: surface.id, entryAsset });
	}

	return { loaded, rejected };
}

export { ThemeRegistry };
