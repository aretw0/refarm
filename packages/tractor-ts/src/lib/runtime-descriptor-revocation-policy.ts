export type RuntimeDescriptorRevocationUnavailablePolicy =
	| "fail-closed"
	| "stale-allowed"
	| "fail-open";

export type RuntimeDescriptorRevocationProfile =
	| "dev"
	| "staging"
	| "production-sensitive";

export type RuntimeDescriptorRevocationPolicyResolutionSource =
	| "explicit-policy"
	| "explicit-profile"
	| "environment-policy"
	| "environment-profile"
	| "fallback";

export interface ResolveRuntimeDescriptorRevocationUnavailablePolicyInput {
	explicitPolicy?: string;
	explicitProfile?: string;
	environmentPolicy?: string;
	environmentProfile?: string;
	fallbackPolicy: RuntimeDescriptorRevocationUnavailablePolicy;
}

export interface ResolveRuntimeDescriptorRevocationUnavailablePolicyResult {
	policy: RuntimeDescriptorRevocationUnavailablePolicy;
	source: RuntimeDescriptorRevocationPolicyResolutionSource;
	profile?: RuntimeDescriptorRevocationProfile;
}

const PROFILE_POLICY: Record<
	RuntimeDescriptorRevocationProfile,
	RuntimeDescriptorRevocationUnavailablePolicy
> = {
	dev: "fail-open",
	staging: "stale-allowed",
	"production-sensitive": "fail-closed",
};

function normalizeValue(value: string | undefined): string {
	return String(value ?? "")
		.trim()
		.toLowerCase();
}

export function normalizeRuntimeDescriptorRevocationUnavailablePolicy(
	value: string | undefined,
): RuntimeDescriptorRevocationUnavailablePolicy | null {
	const candidate = normalizeValue(value);
	if (
		candidate === "fail-closed" ||
		candidate === "stale-allowed" ||
		candidate === "fail-open"
	) {
		return candidate;
	}
	return null;
}

export function normalizeRuntimeDescriptorRevocationProfile(
	value: string | undefined,
): RuntimeDescriptorRevocationProfile | null {
	const candidate = normalizeValue(value);
	if (
		candidate === "dev" ||
		candidate === "development" ||
		candidate === "local"
	) {
		return "dev";
	}

	if (
		candidate === "staging" ||
		candidate === "stage" ||
		candidate === "preprod" ||
		candidate === "pre-production" ||
		candidate === "qa"
	) {
		return "staging";
	}

	if (
		candidate === "production-sensitive" ||
		candidate === "prod-sensitive" ||
		candidate === "sensitive-prod" ||
		candidate === "production" ||
		candidate === "prod"
	) {
		return "production-sensitive";
	}

	return null;
}

export function getRuntimeDescriptorRevocationPolicyForProfile(
	profile: RuntimeDescriptorRevocationProfile,
): RuntimeDescriptorRevocationUnavailablePolicy {
	return PROFILE_POLICY[profile];
}

export function resolveRuntimeDescriptorRevocationUnavailablePolicy(
	input: ResolveRuntimeDescriptorRevocationUnavailablePolicyInput,
): ResolveRuntimeDescriptorRevocationUnavailablePolicyResult {
	const explicitPolicy = normalizeRuntimeDescriptorRevocationUnavailablePolicy(
		input.explicitPolicy,
	);
	if (explicitPolicy) {
		return {
			policy: explicitPolicy,
			source: "explicit-policy",
		};
	}

	const explicitProfile = normalizeRuntimeDescriptorRevocationProfile(
		input.explicitProfile,
	);
	if (explicitProfile) {
		return {
			policy: getRuntimeDescriptorRevocationPolicyForProfile(explicitProfile),
			source: "explicit-profile",
			profile: explicitProfile,
		};
	}

	const environmentPolicy =
		normalizeRuntimeDescriptorRevocationUnavailablePolicy(
			input.environmentPolicy,
		);
	if (environmentPolicy) {
		return {
			policy: environmentPolicy,
			source: "environment-policy",
		};
	}

	const environmentProfile = normalizeRuntimeDescriptorRevocationProfile(
		input.environmentProfile,
	);
	if (environmentProfile) {
		return {
			policy:
				getRuntimeDescriptorRevocationPolicyForProfile(environmentProfile),
			source: "environment-profile",
			profile: environmentProfile,
		};
	}

	return {
		policy: input.fallbackPolicy,
		source: "fallback",
	};
}
