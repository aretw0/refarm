import { createCapabilityRegistry, type CapabilityRegistry } from "@refarm.dev/capabilities";
import type { RecordsCommandDeps } from "@refarm.dev/capability-host";
import { RECORDS_MANIFEST_VERSION, type RecordsManifest } from "@refarm.dev/records-contract-v1";
import {
	createInMemoryAuthorizationProviderFixture,
	createWalletAuthorizeCapability,
	createWalletConsentCapability,
	createWalletDeclineCapability,
	createWalletPresentCapability,
	createWalletRequestCapability,
	createWalletRevokeCapability,
} from "@refarm.dev/wallet/browser";

/**
 * A BROWSER-safe wallet registry for the consent web face. It is built entirely in the browser
 * from an in-memory records source + the isomorphic consent-journey verbs, importing NOTHING from
 * `../cli.js` (which pulls Commander + `@refarm.dev/capability-host/node` + `node:fs`, crashing at
 * module init — the B1 defect). State lives in the tab for the session; the demo seed populates it.
 */
export function createConsentWebRegistry(): CapabilityRegistry {
	let manifest: RecordsManifest = { manifestVersion: RECORDS_MANIFEST_VERSION, records: [] };
	// Only loadManifest/saveManifest are exercised by the consent-journey verbs; the rest of the
	// RecordsCommandDeps surface (enrichment, etc.) is never reached on this screen.
	const records = {
		loadManifest: () => manifest,
		saveManifest: (next: RecordsManifest) => {
			manifest = next;
		},
	} as unknown as RecordsCommandDeps;
	const authorizationProvider = createInMemoryAuthorizationProviderFixture().provider;
	return createCapabilityRegistry([
		createWalletRequestCapability(records),
		createWalletConsentCapability(records),
		createWalletDeclineCapability(records),
		createWalletAuthorizeCapability(records, authorizationProvider),
		createWalletRevokeCapability(records, authorizationProvider),
		createWalletPresentCapability(records, authorizationProvider),
	]);
}
