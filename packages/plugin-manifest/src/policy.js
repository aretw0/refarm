import { PERMISSIONS } from "./permission-vocab.js";
import { validatePluginManifest } from "./validate.js";

/** Rank the closed risk vocabulary so a ceiling can be compared. @type {Record<import('./permission-vocab.js').PermissionRisk, number>} */
const RISK_RANK = { low: 0, medium: 1, high: 2 };

/** The declared risk of a capability, from the permission vocabulary (single source of
 * truth). An unknown capability is treated as `high` — fail-closed. */
function riskOfCapability(capability) {
	const spec = PERMISSIONS.find((p) => p.id === capability);
	return spec ? spec.risk : "high";
}

/**
 * Decide, per requested capability, whether it is GRANTED, DENIED, or REVIEW-REQUIRED
 * under a grant set + an auto-grant risk ceiling. This is the risk-tiered companion to
 * `evaluateCapabilityGrant` (which only reports the not-granted set): a capability outside
 * the grant is `denied`; one inside the grant but above the `maxAutoRisk` ceiling needs
 * human `review-required`; one inside and at/below the ceiling is `granted`. Risk comes
 * from the permission vocabulary, so host and manifest never drift.
 *
 * PURE: requests + injected grant/ceiling in, decisions out. No host, no install.
 *
 * @param {string[]} requests - the capabilities the extension requests
 * @param {{ granted: string[], maxAutoRisk: import('./permission-vocab.js').PermissionRisk }} options
 * @returns {Array<{ capability: string, risk: import('./permission-vocab.js').PermissionRisk, decision: 'granted' | 'denied' | 'review-required', reason: string }>}
 */
export function decideCapabilityGrants(requests, options) {
	const grantSet = new Set(Array.isArray(options?.granted) ? options.granted : []);
	const ceiling = RISK_RANK[options?.maxAutoRisk] ?? RISK_RANK.low;
	return (Array.isArray(requests) ? requests : []).map((capability) => {
		const risk = riskOfCapability(capability);
		if (!grantSet.has(capability)) {
			return { capability, risk, decision: "denied", reason: "capability outside the environment grant" };
		}
		if (RISK_RANK[risk] > ceiling) {
			return {
				capability,
				risk,
				decision: "review-required",
				reason: `${risk}-risk capability exceeds the auto-grant ceiling (${options.maxAutoRisk}); needs human review`,
			};
		}
		return { capability, risk, decision: "granted", reason: `within the grant, at or below the ${options.maxAutoRisk} auto ceiling` };
	});
}

/**
 * Capability-grant decision for a plugin manifest.
 *
 * This is a pure decision core: a manifest plus an *injected* grant set in, a
 * decision out. It does not own the grant set, read any host, or perform an
 * install — plugin-manifest is a schema/validation contract, not a runtime
 * capability owner. A host (CLI, runtime, review command) supplies the grants
 * and consumes the decision; the audit receipt for a denial is a separate,
 * downstream concern.
 *
 * @typedef {'warn+continue' | 'fail-fast'} PluginPolicyMode
 * @typedef {'completed' | 'blocked-warn-continue' | 'blocked-fail-fast' | 'invalid-manifest'} PluginPolicyStatus
 * @typedef {{
 *   pluginId: string,
 *   status: PluginPolicyStatus,
 *   policyMode: PluginPolicyMode,
 *   manifestValid: boolean,
 *   manifestErrors: string[],
 *   missingCapabilities: string[],
 * }} PluginPolicyDecision
 */

/**
 * Capabilities a manifest requires that are not in the granted set.
 *
 * @param {string[]} requires - `manifest.capabilities.requires`
 * @param {string[]} grantedCapabilities - capabilities the host is willing to grant
 * @returns {string[]} the required capabilities that are not granted
 */
export function evaluateCapabilityGrant(requires, grantedCapabilities) {
	const required = Array.isArray(requires) ? requires : [];
	const granted = Array.isArray(grantedCapabilities) ? grantedCapabilities : [];
	return required.filter((capability) => !granted.includes(capability));
}

/**
 * Decide whether a plugin manifest may be admitted under a capability grant.
 *
 * Validates the manifest shape first (an invalid manifest short-circuits to
 * `invalid-manifest`), then denies when any required capability is not granted.
 * Under `fail-fast` a denial is `blocked-fail-fast`; under `warn+continue` it is
 * `blocked-warn-continue`. A satisfied grant is `completed`.
 *
 * @param {import('./index.js').PluginManifest} manifest
 * @param {{ grantedCapabilities: string[], policyMode: PluginPolicyMode }} options
 * @returns {PluginPolicyDecision}
 */
export function decidePluginPolicy(manifest, options) {
	const { grantedCapabilities, policyMode } = options;
	const validation = validatePluginManifest(manifest);

	if (!validation.valid) {
		return {
			pluginId: manifest?.id,
			status: "invalid-manifest",
			policyMode,
			manifestValid: false,
			manifestErrors: validation.errors,
			missingCapabilities: [],
		};
	}

	const missingCapabilities = evaluateCapabilityGrant(
		manifest.capabilities.requires,
		grantedCapabilities,
	);

	if (missingCapabilities.length > 0) {
		return {
			pluginId: manifest.id,
			status: policyMode === "fail-fast" ? "blocked-fail-fast" : "blocked-warn-continue",
			policyMode,
			manifestValid: true,
			manifestErrors: [],
			missingCapabilities,
		};
	}

	return {
		pluginId: manifest.id,
		status: "completed",
		policyMode,
		manifestValid: true,
		manifestErrors: [],
		missingCapabilities: [],
	};
}
