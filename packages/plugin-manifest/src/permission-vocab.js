// The canonical permission vocabulary — TS mirror of the Rust source of truth.
//
// The host (Rust) is the authoritative runtime (ADR-059), so the vocabulary
// SOURCE OF TRUTH is `packages/tractor/src/host/permission.rs`. This module
// mirrors it for the TS side (manifest validation + the persona approval UX
// which renders labels/risk on the multi-surface). A CI guard
// (`scripts/ci/check-permission-vocab.mjs`, mirroring `check:wit`) fails if the
// two drift — so this table is never edited alone; it tracks the Rust enum.
//
// This is Axis 1: the WASI / host-effect capabilities a plugin DECLARES in its
// manifest `permissions[]` and an operator APPROVES. It is DISTINCT from the
// inter-plugin dependency axis (`capabilities.requires`, e.g. `storage:v1`).

/**
 * @typedef {"low" | "medium" | "high"} PermissionRisk
 * @typedef {{ id: string, label: string, risk: PermissionRisk }} PermissionSpec
 */

/**
 * The closed vocabulary, in the Rust enum's order. Each entry mirrors one
 * `Permission` variant's `as_str()` / `label()` / `risk()`.
 * @type {readonly PermissionSpec[]}
 */
export const PERMISSIONS = Object.freeze([
	{ id: "fs:read", label: "Read files", risk: "low" },
	{ id: "fs:write", label: "Write and edit files", risk: "medium" },
	{ id: "shell:spawn", label: "Run system commands", risk: "high" },
	{ id: "network:outbound", label: "Make network requests", risk: "medium" },
]);

/** The set of known permission id strings. @type {ReadonlySet<string>} */
export const KNOWN_PERMISSIONS = Object.freeze(new Set(PERMISSIONS.map((p) => p.id)));

/**
 * Whether `id` is a permission in the closed vocabulary.
 * @param {string} id
 * @returns {boolean}
 */
export function isKnownPermission(id) {
	return KNOWN_PERMISSIONS.has(id);
}

/**
 * Return the permissions in `declared` that are OUTSIDE the vocabulary. Empty
 * means all known. Mirrors the Rust `unknown_permissions`.
 * @param {readonly string[]} declared
 * @returns {string[]}
 */
export function unknownPermissions(declared) {
	if (!Array.isArray(declared)) return [];
	return declared.filter((id) => !KNOWN_PERMISSIONS.has(id));
}

/**
 * The human-readable spec for a known permission (for the approval surface), or
 * undefined if unknown.
 * @param {string} id
 * @returns {PermissionSpec | undefined}
 */
export function describePermission(id) {
	return PERMISSIONS.find((p) => p.id === id);
}
