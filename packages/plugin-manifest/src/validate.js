import { detectEntryFormat } from "./entry-support.js";
import { EXTENSION_SURFACE_LAYERS } from "./extension-surfaces.js";
import { PERMISSIONS, unknownPermissions } from "./permission-vocab.js";
import { REQUIRED_TELEMETRY_HOOKS } from "./types.js";

const SEMVER_RE =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;
const INTEGRITY_HEX_RE = /^sha256-[0-9a-fA-F]{64}$/;
const INTEGRITY_BASE64_RE = /^sha256-(?:[A-Za-z0-9+/]{43}=|[A-Za-z0-9+/]{43})$/;

/**
 * @param {string[]} values
 * @returns {boolean}
 */
function hasDuplicates(values) {
	return new Set(values).size !== values.length;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isNonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {unknown} values
 * @returns {boolean}
 */
function isNonEmptyStringArray(values) {
	return Array.isArray(values) && values.every(isNonEmptyString);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isRelativePackagePath(value) {
	if (!isNonEmptyString(value)) return false;
	const trimmed = value.trim();
	return !trimmed.startsWith("/") && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed);
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isSkillMarkdownAsset(value) {
	return isRelativePackagePath(value) && /(^|\/)SKILL\.md$/.test(value.trim());
}

/**
 * @param {import('./types.js').ExtensionSurfaceDeclaration} surface
 * @param {number} index
 * @param {string[]} errors
 * @returns {void}
 */
function validatePiSkillSurface(surface, index, errors) {
	if (surface.layer !== "pi" || surface.kind !== "skill") return;

	if (surface.slot !== undefined) {
		errors.push(
			`extensions.surfaces[${index}].slot must not be provided for pi skill surfaces`,
		);
	}

	// Capabilities are OPTIONAL here, on purpose. Permissive-vs-complete maturity
	// is a generic, surface-agnostic concern (a skill with only name+description is
	// a valid *permissive* surface — see specs/features/2026-07-03-extension-
	// maturity-levels.md and skill-contract-v1, which already accept zero
	// capabilities). The generic surface loop already checks "capabilities, when
	// provided, must be non-empty strings"; requiring them HERE would re-couple the
	// permissive rule to the `pi` layer and reject a valid permissive skill upstream
	// of the contract that accepts it. The SKILL.md asset below stays required —
	// that is genuinely skill-shaped, not a maturity gate.

	if (!Array.isArray(surface.assets) || surface.assets.length === 0) {
		errors.push(
			`extensions.surfaces[${index}].assets must include a relative SKILL.md asset for pi skill surfaces`,
		);
		return;
	}

	if (!surface.assets.some(isSkillMarkdownAsset)) {
		errors.push(
			`extensions.surfaces[${index}].assets must include a relative SKILL.md asset for pi skill surfaces`,
		);
	}
}

/**
 * @param {import('./types.js').PluginManifest} manifest
 * @param {string[]} errors
 * @returns {void}
 */
function validateExtensionSurfaces(manifest, errors, warnings) {
	if (manifest.extensions === undefined) return;

	if (typeof manifest.extensions !== "object" || manifest.extensions === null) {
		errors.push("extensions must be an object when provided");
		return;
	}

	const surfaces = manifest.extensions.surfaces;
	if (surfaces === undefined) return;

	if (!Array.isArray(surfaces)) {
		errors.push("extensions.surfaces must be an array");
		return;
	}

	const surfaceKeys = [];
	for (const [index, surface] of surfaces.entries()) {
		if (typeof surface !== "object" || surface === null) {
			errors.push(`extensions.surfaces[${index}] must be an object`);
			continue;
		}

		// The surface LAYER is an open axis (ADR-085: surfaces are data). A layer outside
		// the known set is not a form error — it is a new surface. Validate FORM (a
		// non-empty string) and WARN (not reject) when it is unknown, so adding webxr/voice/
		// game to the platform does not invalidate the manifest. Doctrine: validation
		// validates form, not vocabulary; completeness/policy is a separate concern.
		if (!isNonEmptyString(surface.layer)) {
			errors.push(
				`extensions.surfaces[${index}].layer must be a non-empty string`,
			);
		} else if (!EXTENSION_SURFACE_LAYERS.has(surface.layer)) {
			warnings.push(
				`extensions.surfaces[${index}].layer "${surface.layer}" is outside the known set (tractor, homestead, pi, automation, desktop, asset) — treated as a new surface; a projector must exist for it to render.`,
			);
		}

		if (!isNonEmptyString(surface.kind)) {
			errors.push(
				`extensions.surfaces[${index}].kind must be a non-empty string`,
			);
		}

		if (!isNonEmptyString(surface.id)) {
			errors.push(
				`extensions.surfaces[${index}].id must be a non-empty string`,
			);
		}

		if (surface.slot !== undefined && !isNonEmptyString(surface.slot)) {
			errors.push(
				`extensions.surfaces[${index}].slot must be a non-empty string when provided`,
			);
		}

		if (
			surface.capabilities !== undefined &&
			!isNonEmptyStringArray(surface.capabilities)
		) {
			errors.push(
				`extensions.surfaces[${index}].capabilities must be an array of non-empty strings when provided`,
			);
		}

		if (
			surface.assets !== undefined &&
			!isNonEmptyStringArray(surface.assets)
		) {
			errors.push(
				`extensions.surfaces[${index}].assets must be an array of non-empty strings when provided`,
			);
		}

		validatePiSkillSurface(surface, index, errors);

		if (isNonEmptyString(surface.layer) && isNonEmptyString(surface.id)) {
			surfaceKeys.push(`${surface.layer}:${surface.id}`);
		}
	}

	if (hasDuplicates(surfaceKeys)) {
		errors.push(
			"extensions.surfaces must not contain duplicate layer/id pairs",
		);
	}
}

/**
 * @param {import('./types.js').PluginManifest} manifest
 * @returns {import('./types.js').ManifestValidationResult}
 */
export function validatePluginManifest(manifest) {
	const errors = [];
	/** Non-fatal advisories — e.g. a surface layer outside the known set (a new surface,
	 * not a form error). The manifest is still `valid`; warnings surface intent to open. */
	const warnings = [];

	if (!manifest.id || !manifest.id.startsWith("@")) {
		errors.push(
			"id must be a non-empty scoped package name (e.g. @vendor/plugin)",
		);
	}

	if (!manifest.name || manifest.name.trim().length < 3) {
		errors.push("name must be at least 3 characters");
	}

	if (!SEMVER_RE.test(manifest.version)) {
		errors.push("version must be valid semver");
	}

	const entryFormat = detectEntryFormat(manifest.entry);
	if (!manifest.entry || entryFormat === "unknown") {
		errors.push("entry must be a .js/.mjs/.cjs or .wasm path");
	}

	if (manifest.entry && manifest.entry.startsWith("/")) {
		errors.push("entry must not be an absolute filesystem path");
	}

	if (entryFormat === "wasm" && !manifest.integrity) {
		errors.push("integrity is required for .wasm entries");
	}

	if (
		manifest.integrity !== undefined &&
		!INTEGRITY_HEX_RE.test(manifest.integrity) &&
		!INTEGRITY_BASE64_RE.test(manifest.integrity)
	) {
		errors.push(
			"integrity must use sha256- prefix with 64 hex chars or base64 digest",
		);
	}

	if (!manifest.capabilities || manifest.capabilities.provides.length === 0) {
		errors.push("capabilities.provides must contain at least one capability");
	}

	if (hasDuplicates(manifest.capabilities.provides)) {
		errors.push("capabilities.provides must not contain duplicates");
	}

	if (hasDuplicates(manifest.capabilities.requires)) {
		errors.push("capabilities.requires must not contain duplicates");
	}

	if (
		manifest.capabilities.providesApi &&
		hasDuplicates(manifest.capabilities.providesApi)
	) {
		errors.push("capabilities.providesApi must not contain duplicates");
	}

	if (
		manifest.capabilities.requiresApi &&
		hasDuplicates(manifest.capabilities.requiresApi)
	) {
		errors.push("capabilities.requiresApi must not contain duplicates");
	}

	// `verbDocs` is permissive by FORM: optional per-verb prose. When present, every
	// key must be a `<key>:<verb>` string the plugin actually `provides` — a doc for
	// a verb it doesn't serve is a mistake, not extensibility. Values must be strings.
	if (manifest.capabilities.verbDocs !== undefined) {
		const verbDocs = manifest.capabilities.verbDocs;
		if (typeof verbDocs !== "object" || verbDocs === null || Array.isArray(verbDocs)) {
			errors.push("capabilities.verbDocs must be an object map of <key>:<verb> → string");
		} else {
			const provided = new Set(manifest.capabilities.provides ?? []);
			for (const [key, val] of Object.entries(verbDocs)) {
				if (typeof val !== "string") {
					errors.push(`capabilities.verbDocs["${key}"] must be a string`);
				}
				if (!provided.has(key)) {
					errors.push(`capabilities.verbDocs key "${key}" is not in capabilities.provides`);
				}
			}
		}
	}

	// `syncVerbs` is permissive by FORM: optional. It names the verbs the plugin serves
	// SYNCHRONOUSLY via `respond` (ADR-084's negotiated sync flag) — a per-verb MODE
	// attribute of what the plugin `provides`, NOT a new list of verbs. So every entry
	// must be a `<key>:<verb>` string the plugin actually provides; a verb absent from
	// `provides` cannot be sync. Verbs not listed here are async-default. The host reads
	// this to dispatch `respond` only to declared verbs (never a hung async-only call).
	if (manifest.capabilities.syncVerbs !== undefined) {
		if (!isNonEmptyStringArray(manifest.capabilities.syncVerbs)) {
			errors.push(
				"capabilities.syncVerbs must be an array of non-empty <key>:<verb> strings when provided",
			);
		} else {
			if (hasDuplicates(manifest.capabilities.syncVerbs)) {
				errors.push("capabilities.syncVerbs must not contain duplicates");
			}
			const provided = new Set(manifest.capabilities.provides ?? []);
			for (const verb of manifest.capabilities.syncVerbs) {
				if (!provided.has(verb)) {
					errors.push(`capabilities.syncVerbs entry "${verb}" is not in capabilities.provides`);
				}
			}
		}
	}

	// `subscribes` is permissive by FORM: optional (a plugin may be lifecycle-only),
	// but when present it must be a non-empty string array of event names, and must
	// not contain duplicates. The neutral event router reads it to deliver events.
	if (manifest.capabilities.subscribes !== undefined) {
		if (!isNonEmptyStringArray(manifest.capabilities.subscribes)) {
			errors.push(
				"capabilities.subscribes must be an array of non-empty event-name strings when provided",
			);
		} else if (hasDuplicates(manifest.capabilities.subscribes)) {
			errors.push("capabilities.subscribes must not contain duplicates");
		}
	}

	if (hasDuplicates(manifest.permissions)) {
		errors.push("permissions must not contain duplicates");
	}
	// Reject permissions outside the closed vocabulary (mirrors the Rust host).
	// A typo like `fs:reed` must fail validation rather than become an inert
	// dead grant — same reject-unknown posture as targets / trust.profile.
	if (Array.isArray(manifest.permissions)) {
		const unknown = unknownPermissions(manifest.permissions);
		if (unknown.length > 0) {
			errors.push(
				`permissions contains unknown capabilities: ${unknown.join(", ")} ` +
					`(known: ${PERMISSIONS.map((p) => p.id).join(", ")})`,
			);
		}
	}

	// Execution Targets Validation
	if (!Array.isArray(manifest.targets) || manifest.targets.length === 0) {
		errors.push(
			"targets must be a non-empty array of execution environments (browser, server, remote)",
		);
	} else {
		for (const target of manifest.targets) {
			if (!["browser", "server", "remote"].includes(target)) {
				errors.push(`invalid execution target: ${target}`);
			}
		}
	}

	// UI Validation
	if (manifest.ui) {
		if (manifest.ui.slots && !Array.isArray(manifest.ui.slots)) {
			errors.push("ui.slots must be an array");
		}
		if (
			manifest.ui.color &&
			!/^#([A-Fa-f0-9]{3}){1,2}$/.test(manifest.ui.color)
		) {
			errors.push("ui.color must be a valid hex color (e.g. #238636)");
		}
	}

	if (manifest.trust) {
		if (!["strict", "trusted-fast"].includes(manifest.trust.profile)) {
			errors.push("trust.profile must be one of: strict, trusted-fast");
		}

		if (
			manifest.trust.leaseHours !== undefined &&
			(!Number.isFinite(manifest.trust.leaseHours) ||
				manifest.trust.leaseHours <= 0)
		) {
			errors.push("trust.leaseHours must be a positive number when provided");
		}
	}

	const hooks = new Set(manifest.observability?.hooks ?? []);
	for (const requiredHook of REQUIRED_TELEMETRY_HOOKS) {
		if (!hooks.has(requiredHook)) {
			errors.push(`observability.hooks must include ${requiredHook}`);
		}
	}

	// Certification Validation
	if (!manifest.certification) {
		errors.push("certification metadata is required");
	} else {
		if (!manifest.certification.license)
			errors.push("certification.license is required");
		if (
			typeof manifest.certification.a11yLevel !== "number" ||
			manifest.certification.a11yLevel < 0 ||
			manifest.certification.a11yLevel > 3
		) {
			errors.push("certification.a11yLevel must be a number between 0 and 3");
		}
		if (
			!Array.isArray(manifest.certification.languages) ||
			manifest.certification.languages.length === 0
		) {
			errors.push("certification.languages must be a non-empty array");
		}
	}

	validateExtensionSurfaces(manifest, errors, warnings);

	return {
		valid: errors.length === 0,
		errors,
		warnings,
	};
}

/**
 * @param {import('./types.js').PluginManifest} manifest
 * @returns {void}
 */
export function assertValidPluginManifest(manifest) {
	const result = validatePluginManifest(manifest);
	if (!result.valid) {
		throw new Error(`Invalid plugin manifest: ${result.errors.join("; ")}`);
	}
}
