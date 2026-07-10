import type { CapabilityDeps } from "./builtin-capabilities.js";
import { defaultRecordsDeps, type RecordsCommandDeps } from "./records-capability.js";
import { defaultSourceDeps, type SourceCommandDeps } from "./source-capability.js";
import { createLocalVaultCommandDeps, type VaultCommandDeps } from "./vault-capability.js";

export interface LocalCapabilityDepsOptions {
	source?: SourceCommandDeps;
	vault?: VaultCommandDeps;
	records?: RecordsCommandDeps;
}

export function createLocalCapabilityDeps(
	options: LocalCapabilityDepsOptions = {},
): CapabilityDeps {
	return {
		source: options.source ?? defaultSourceDeps(),
		vault: options.vault ?? createLocalVaultCommandDeps(),
		records: options.records ?? defaultRecordsDeps(),
	};
}
