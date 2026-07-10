import type { CapabilityEntry } from "@refarm.dev/capabilities";

import {
	createRecordsCapabilityGroup,
	defaultRecordsDeps,
	type RecordsCommandDeps,
} from "./records-capability.js";
import { createSourceCapabilityGroup, type SourceCommandDeps } from "./source-capability.js";
import { createVaultCapabilityGroup, type VaultCommandDeps } from "./vault-capability.js";

/**
 * The deps bundle a host injects to build the three neutral capability groups. The
 * host supplies its own source/vault plumbing (cache location, provider discovery,
 * effort submission) and OPTIONALLY its own records manifest + seed; the package
 * supplies the neutral verbs. This is the two-layer seam: a white-label app builds
 * its OWN bundle (its own source fixture, its own manifest, its own vault seed) and
 * gets the same three verbs projected onto every surface.
 */
export interface CapabilityDeps {
	/** How the source verb materializes + inspects — the host's source provider. */
	source: SourceCommandDeps;
	/** How the vault verb discovers providers + submits efforts + (optionally) seeds. */
	vault: VaultCommandDeps;
	/** How the records verb loads its manifest + enriches. Defaults to the neutral
	 * (empty-manifest + reference-provider) deps if the host injects nothing. */
	records?: RecordsCommandDeps;
}

/**
 * The three neutral capability groups (vault, source, records), built from an
 * injected deps bundle. Any host app composes these
 * with its OWN work-specific verbs into a registry and projects a CLI/REPL/TUI/HTTP
 * from the single declaration. This package ships zero work vocabulary — the bundle is
 * where the host's plumbing enters.
 */
export function builtinCapabilities(deps: CapabilityDeps): CapabilityEntry[] {
	return [
		createVaultCapabilityGroup(deps.vault),
		createSourceCapabilityGroup(deps.source),
		createRecordsCapabilityGroup(deps.records ?? defaultRecordsDeps()),
	];
}
