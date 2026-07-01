export const vaultSeedPackages = [
	"artifact-contract-v1",
	"channel-policy-v1",
	"credentials-contract-v1",
	"dispatch-surface",
	"ds",
	"effort-contract-v1",
	"enrichment-contract-v1",
	"heartwood",
	"identity-contract-v1",
	"identity-heartwood",
	"process-handoff",
	"records-contract-v1",
	"release-engine",
	"silo",
	"source-contract-v1",
	"source-web",
	"storage-contract-v1",
	"storage-memory",
] as const;

export const governingDocs = [
	{
		title: "Distribution inventory",
		href: "https://github.com/aretw0/refarm/blob/develop/packages/DISTRIBUTION_STATUS.md",
		body: "Current release-policy selections, held surfaces, and publication rules.",
	},
	{
		title: "Ecosystem supply map",
		href: "https://github.com/aretw0/refarm/blob/develop/docs/ECOSYSTEM_SUPPLY_MAP.md",
		body: "Which blocks Refarm should supply and which product choices stay downstream.",
	},
	{
		title: "v0.1.0 release gate",
		href: "https://github.com/aretw0/refarm/blob/develop/docs/v0.1.0-release-gate.md",
		body: "Daily-driver hold, consumer-pulled exceptions, and npm publication posture.",
	},
] as const;
