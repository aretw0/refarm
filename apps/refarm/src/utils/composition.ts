/**
 * The COMPOSITION layer: which packages a scope activates, and which of a
 * package's surfaces are suppressed. This is a DIFFERENT axis from the
 * imported-skill node-ledger (that is the byte/pointer REGISTRY of what was
 * imported) and from the asset content-store (the bytes). Composition is the
 * human-editable declaration of what is turned ON — it lives in `config.json`
 * `plugins[]`, mirroring pi's `.pi/settings.json packages[]`.
 *
 * Shape and suppression semantics are ported 1:1 from pi's
 * `configuredExtensionActive` (agents-lab scripts/pi-parity.mjs:143-156) so a
 * refarm composition file reads the same way a pi one does. The only deliberate
 * divergence is the surface vocabulary: pi has one surface kind (`extensions`);
 * refarm's extension model has several (`skills`/`tools`/`themes`/`commands`),
 * so `surfaceActive` takes the surface kind as a parameter. Because of that, a
 * refarm composition file is intentionally NOT byte-portable with a real
 * `.pi/settings.json` — the SHAPE mirrors, the surface names are refarm's.
 */

/** A surface pattern: `"skills/foo"` allows (allowlist) / `"!skills/foo"` denies. */
export type SurfacePattern = string;

/** The refarm surface kinds a package may contribute (its extension-model surfaces). */
export type SurfaceKey = "skills" | "tools" | "themes" | "commands";

/** A package activated in object form, optionally suppressing some of its surfaces. */
export interface PackageSourceObject {
	/** Where the package resolves from: `npm:@scope/pkg`, a relative path, or an id. */
	source: string;
	skills?: SurfacePattern[];
	tools?: SurfacePattern[];
	themes?: SurfacePattern[];
	commands?: SurfacePattern[];
}

/**
 * A composition entry. A bare string activates the package with ALL surfaces on
 * (the common case); the object form is used only to suppress some surfaces.
 */
export type PackageSource = string | PackageSourceObject;

/** The source id of an entry, regardless of bare-string vs object form. */
export function getSource(entry: PackageSource): string {
	return typeof entry === "string" ? entry : entry.source;
}

/**
 * Normalize a surface path so a pattern and an id compare equal regardless of a
 * leading `./` or backslash separators (Windows-authored paths). Ported from pi's
 * `normalizeSurfacePath`.
 */
export function normalizeSurfacePath(value: string): string {
	return String(value ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Whether one surface `id` of a package is active under a composition `entry`.
 * Ported 1:1 from pi `configuredExtensionActive`:
 *
 * - a bare-string entry, or an entry whose surface array is ABSENT → all active
 * - a surface array that is PRESENT but EMPTY (`[]`) → suppress ALL of that surface
 * - otherwise split into allow (`x`) and deny (`!x`); active iff it is allowed
 *   (`no allowlist, or on the allowlist`) AND not denied.
 *
 * The PRESENT-EMPTY vs ABSENT distinction is load-bearing: `skills: []` means
 * "turn off every skill this package offers", while omitting `skills` means
 * "leave them all on". Do not collapse the two.
 */
export function surfaceActive(
	entry: PackageSource,
	surface: SurfaceKey,
	id: string,
): boolean {
	if (typeof entry === "string") return true; // bare string: all active
	const patterns = entry[surface];
	if (patterns === undefined) return true; // absent key: all active
	if (patterns.length === 0) return false; // present-[]: suppress all

	const includes = new Set<string>();
	const excludes = new Set<string>();
	for (const raw of patterns) {
		if (typeof raw !== "string") continue;
		if (raw.startsWith("!")) excludes.add(normalizeSurfacePath(raw.slice(1)));
		else includes.add(normalizeSurfacePath(raw));
	}

	const normalized = normalizeSurfacePath(id);
	return (
		(includes.size === 0 || includes.has(normalized)) &&
		!excludes.has(normalized)
	);
}
