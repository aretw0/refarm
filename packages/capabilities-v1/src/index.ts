export {
	createSourceCapabilityGroup,
	defaultSourceDeps,
	type SourceCommandDeps,
} from "./source-capability.js";
export {
	createRecordsCapabilityGroup,
	defaultRecordsDeps,
	type RecordsCommandDeps,
} from "./records-capability.js";
export {
	createVaultCapabilityGroup,
	defaultVaultDeps,
	type VaultCommandDeps,
} from "./vault-capability.js";
export type {
	VaultDiscoveryResult,
	VaultProviderSummary,
} from "./vault-discovery-types.js";
export {
	refarmBuiltinCapabilities,
	type RefarmCapabilityDeps,
} from "./builtin-capabilities.js";
