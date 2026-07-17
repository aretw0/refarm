import { createCapabilityRegistry, type CapabilityRegistry } from "@refarm.dev/capabilities";

import { createGovernancePocCapability } from "../governance-verb.js";

/**
 * A BROWSER-safe devbench registry for the governance web face. The `governance-poc` verb is pure
 * compute (runGovernancePoc → decideCapabilityGrants from @refarm.dev/plugin-manifest, then
 * governanceToHtml) — its only side effect, writing artifacts to disk, is INJECTED via
 * options.writeArtifact, which we omit here, so the browser build never touches node:fs. It imports
 * nothing from ../cli.js or ../persona.js (both crash at module init through the capabilities-v1 /
 * capability-host/node chain). Same verb the CLI runs; here it renders the scorecard in the tab.
 */
export function createGovernanceWebRegistry(): CapabilityRegistry {
	return createCapabilityRegistry([createGovernancePocCapability()]);
}
