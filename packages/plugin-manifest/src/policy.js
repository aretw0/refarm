import { validatePluginManifest } from "./validate.js";

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
			status:
				policyMode === "fail-fast"
					? "blocked-fail-fast"
					: "blocked-warn-continue",
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
