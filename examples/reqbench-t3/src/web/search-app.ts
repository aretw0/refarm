import { createCapabilityRegistry, type CapabilityRegistry } from "@refarm.dev/capabilities";
import type { RecordsCommandDeps } from "@refarm.dev/capability-host";
import type { RecordsManifest } from "@refarm.dev/records-contract-v1";
import { createReferenceVaultSurface, type SearchDispatcher } from "@refarm.dev/vault-contract-v1";

import { reqManifest } from "../fixture.js";
import { createRequirementsSearchCapability } from "../search.js";

/**
 * A BROWSER-safe requirements registry for the search web face. Built entirely in the browser from
 * the seeded fixture manifest + the reference vault surface (no WASM component, no node) + the
 * isomorphic `requirements-search` verb — importing NOTHING from `../cli.js` or `../persona.js`
 * (which pull node:crypto + `@refarm.dev/capability-host/node` + the WASM vault component, crashing
 * at module init: the B1 defect). The analyst types a query, the SAME verb the CLI runs answers it,
 * and B2 paints the matches (the verb's `resultsHtml`) in place. State is the tab's for the session.
 */
export function createSearchWebRegistry(): CapabilityRegistry {
	const manifest: RecordsManifest = reqManifest();
	// The search verb only reads the manifest (loadManifest); saveManifest is never reached here.
	const records = {
		loadManifest: () => manifest,
		saveManifest: () => {},
	} as unknown as RecordsCommandDeps;
	// The reference vault surface (pure, no sandbox) satisfies the search dispatcher in-browser — the
	// same contract the sovereign WASM surface serves on the CLI, only the boundary differs.
	const vaultSurface = (): Promise<SearchDispatcher> => Promise.resolve(createReferenceVaultSurface());
	return createCapabilityRegistry([createRequirementsSearchCapability(records, vaultSurface)]);
}
