import { detectEntryFormat } from "./entry-support.js";
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
 * @param {import('./types.js').PluginManifest} manifest
 * @returns {import('./types.js').ManifestValidationResult}
 */
export function validatePluginManifest(manifest) {
	const errors = [];

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

	if (hasDuplicates(manifest.permissions)) {
		errors.push("permissions must not contain duplicates");
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

	return {
		valid: errors.length === 0,
		errors,
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
