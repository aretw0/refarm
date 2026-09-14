export const OPERATOR_ATTENTION_PROFILE_TABLE = {
	"cross-device-handoff": {
		scope: "attention:cross-device-handoff",
		windowMs: 120000,
	},
	"mobile-ready": {
		scope: "attention:mobile-ready",
		windowMs: 90000,
	},
	"operator-sync": {
		scope: "attention:operator-sync",
		windowMs: 300000,
	},
} as const;

export type OperatorAttentionProfileName = keyof typeof OPERATOR_ATTENTION_PROFILE_TABLE;

export interface OperatorAttentionProfile {
	name: OperatorAttentionProfileName;
	scope: string;
	windowMs: number;
}

export function listOperatorAttentionProfileNames(): OperatorAttentionProfileName[] {
	return Object.keys(OPERATOR_ATTENTION_PROFILE_TABLE) as OperatorAttentionProfileName[];
}

export function resolveOperatorAttentionProfile(
	profileName?: string,
): OperatorAttentionProfile | null {
	const name = profileName?.trim();
	if (!name) return null;
	const table = OPERATOR_ATTENTION_PROFILE_TABLE as Record<string, { scope: string; windowMs: number }>;
	const profile = table[name];
	if (!profile) {
		const available = listOperatorAttentionProfileNames().join(", ");
		throw new Error(`Unknown --attention-profile '${name}'. Available profiles: ${available}.`);
	}
	return {
		name: name as OperatorAttentionProfileName,
		scope: profile.scope,
		windowMs: profile.windowMs,
	};
}
