// The extension MATURITY TRAIL — the operational trust levels a plugin is promoted through, as
// data. This is Axis 3 of extension governance, distinct from the permission axis (what a plugin
// declares) and the form-completeness axis (permissive/complete). It answers "how much do we trust
// this extension to run, and where?" — an experiment, a productive extension, a sensitive-context
// one, or a catalog-published one — each with OBJECTIVE promotion criteria (manifest conformance,
// artifact integrity, telemetry coverage, capability strictness). Governance stops being binary
// (allowed / not) and becomes proportional to impact.
//
// A host CLASSIFIES an extension against this trail from its manifest + evidence; it never blocks
// on the contract (form validation is separate). Promotion to a higher level requires meeting that
// level's criteria — the objective gate the writeup's maturity figure (experiment → productive →
// sensitive → catalog) describes.

/**
 * @typedef {"experiment" | "productive" | "sensitive" | "catalog"} MaturityLevel
 * @typedef {"low" | "medium" | "high"} PermissionRisk
 */

/**
 * @typedef {object} MaturityCriterion
 * @property {string} id
 * @property {string} label
 * @property {string} detail
 */

/**
 * @typedef {object} MaturitySpec
 * @property {MaturityLevel} level
 * @property {number} rank         Ordering, 0 = lowest trust.
 * @property {string} label
 * @property {string} description
 * @property {MaturityCriterion[]} criteria  What must hold to sit at (or promote to) this level.
 */

/**
 * The trail, lowest trust first. Each level's criteria are cumulative — a `productive` extension
 * must also meet `experiment`'s, and so on. Mirrors the writeup's Figura 3 progression.
 * @type {readonly MaturitySpec[]}
 */
export const MATURITY_TRAIL = Object.freeze([
	{
		level: "experiment",
		rank: 0,
		label: "Experimento",
		description: "Low-risk experimentation. A plugin may exist as an experiment with minimal ceremony.",
		criteria: [{ id: "manifest-present", label: "Manifesto presente", detail: "The plugin declares an id and an entry." }],
	},
	{
		level: "productive",
		rank: 1,
		label: "Produtivo",
		description: "Productive use. Needs tests, records, and clear limits.",
		criteria: [
			{ id: "manifest-conformant", label: "Manifesto conforme", detail: "The manifest validates (id, version, entry, declared capabilities)." },
			{ id: "integrity-known", label: "Integridade conhecida", detail: "The artifact carries an integrity hash." },
			{ id: "telemetry-present", label: "Telemetria presente", detail: "At least the load/error lifecycle hooks are wired." },
		],
	},
	{
		level: "sensitive",
		rank: 2,
		label: "Sensível",
		description: "Sensitive contexts. Prioritize WASM, strong integrity, strict capabilities.",
		criteria: [
			{ id: "wasm-entry", label: "Entrada WASM", detail: "The entry is a WASM component (sandboxed by design)." },
			{ id: "integrity-strong", label: "Integridade forte", detail: "A full sha256 integrity, not a placeholder." },
			{ id: "capabilities-strict", label: "Capacidades estritas", detail: "No high-risk capability granted without human review." },
			{ id: "telemetry-full", label: "Telemetria completa", detail: "All required lifecycle hooks present." },
		],
	},
	{
		level: "catalog",
		rank: 3,
		label: "Catálogo",
		description: "Published in an internal catalog with versioning, an approval trail, and a revocation policy.",
		criteria: [
			{ id: "versioned", label: "Versionado", detail: "A semantic version is declared." },
			{ id: "approval-trail", label: "Trilha de aprovação", detail: "An approval record exists for the promotion." },
			{ id: "revocable", label: "Revogável", detail: "A revocation path is declared/available." },
		],
	},
]);

/** @type {Record<MaturityLevel, number>} */
const RANK = Object.freeze(Object.fromEntries(MATURITY_TRAIL.map((s) => [s.level, s.rank])));

/**
 * Look up a maturity spec by level.
 * @param {MaturityLevel} level
 * @returns {MaturitySpec | undefined}
 */
export function describeMaturity(level) {
	return MATURITY_TRAIL.find((s) => s.level === level);
}

/**
 * The evidence a host gathers about an extension, to assess its maturity. All optional — absent
 * evidence simply fails the criteria that need it.
 * @typedef {object} MaturityEvidence
 * @property {boolean} [manifestConformant]  The manifest validates.
 * @property {string} [integrity]            The artifact integrity string (a sha256 hex or a placeholder).
 * @property {boolean} [wasmEntry]           The entry is a WASM component.
 * @property {readonly string[]} [telemetryHooks]  The lifecycle hooks wired.
 * @property {boolean} [capabilitiesStrict]  No high-risk capability auto-granted (review-gated).
 * @property {string} [version]              The declared semantic version.
 * @property {boolean} [approvalTrail]       An approval record exists.
 * @property {boolean} [revocable]           A revocation path exists.
 */

const REQUIRED_HOOKS = ["onLoad", "onInit", "onRequest", "onError", "onTeardown"];
const SHA256_HEX = /^(sha256[-:])?[0-9a-f]{64}$/i;

/**
 * Does the extension meet one criterion, given the evidence? PURE.
 * @param {string} criterionId
 * @param {MaturityEvidence} e
 * @returns {boolean}
 */
function meets(criterionId, e) {
	switch (criterionId) {
		case "manifest-present":
			return true; // reaching assessment means a manifest was read
		case "manifest-conformant":
			return e.manifestConformant === true;
		case "integrity-known":
			return typeof e.integrity === "string" && e.integrity.length > 0;
		case "telemetry-present":
			return Array.isArray(e.telemetryHooks) && e.telemetryHooks.includes("onLoad") && e.telemetryHooks.includes("onError");
		case "wasm-entry":
			return e.wasmEntry === true;
		case "integrity-strong":
			return typeof e.integrity === "string" && SHA256_HEX.test(e.integrity);
		case "capabilities-strict":
			return e.capabilitiesStrict === true;
		case "telemetry-full":
			return Array.isArray(e.telemetryHooks) && REQUIRED_HOOKS.every((h) => e.telemetryHooks.includes(h));
		case "versioned":
			return typeof e.version === "string" && e.version.length > 0;
		case "approval-trail":
			return e.approvalTrail === true;
		case "revocable":
			return e.revocable === true;
		default:
			return false;
	}
}

/**
 * @typedef {object} MaturityAssessment
 * @property {MaturityLevel} level        The highest level whose (cumulative) criteria all hold.
 * @property {MaturityLevel | null} next  The next level up, or null at the top.
 * @property {{ id: string, label: string, detail: string }[]} missing  What blocks promotion to `next`.
 * @property {{ level: MaturityLevel, met: boolean }[]} trail  Each level's met/unmet status.
 */

/**
 * Classify an extension on the maturity trail from its evidence: the level is the HIGHEST whose
 * criteria (and every lower level's) all hold; `missing` is what blocks promotion to the next
 * level. The host classifies, never blocks — promotion is the objective gate. PURE + deterministic.
 * @param {MaturityEvidence} evidence
 * @returns {MaturityAssessment}
 */
export function assessExtensionMaturity(evidence) {
	const e = evidence ?? {};
	// A level is satisfied when its own criteria AND all lower levels' criteria hold (cumulative).
	const cumulative = [];
	let satisfied = -1;
	for (const spec of MATURITY_TRAIL) {
		const ownMet = spec.criteria.every((c) => meets(c.id, e));
		const met = ownMet && (cumulative.length === 0 || cumulative[cumulative.length - 1].met);
		cumulative.push({ level: spec.level, met });
		if (met) satisfied = spec.rank;
	}
	const currentSpec = MATURITY_TRAIL.find((s) => s.rank === Math.max(0, satisfied)) ?? MATURITY_TRAIL[0];
	const level = satisfied < 0 ? MATURITY_TRAIL[0].level : currentSpec.level;
	const nextSpec = MATURITY_TRAIL.find((s) => s.rank === RANK[level] + 1);
	const missing = nextSpec ? nextSpec.criteria.filter((c) => !meets(c.id, e)).map((c) => ({ id: c.id, label: c.label, detail: c.detail })) : [];
	return {
		level,
		next: nextSpec ? nextSpec.level : null,
		missing,
		trail: cumulative,
	};
}
