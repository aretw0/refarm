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

export type RuntimeDescriptorRevocationConfigInputSlot =
	| "explicit-policy"
	| "explicit-profile"
	| "environment-policy"
	| "environment-profile";

export interface RuntimeDescriptorRevocationInvalidInput {
	slot: RuntimeDescriptorRevocationConfigInputSlot;
	value: string;
}

export interface RuntimeDescriptorRevocationConfigConflict {
	slot: "environment-profile";
	preferredSource: RuntimeDescriptorRevocationEnvironmentProfileSource;
	preferredValue: string;
	preferredProfile: RuntimeDescriptorRevocationProfile;
	ignoredSource: RuntimeDescriptorRevocationEnvironmentProfileSource;
	ignoredValue: string;
	ignoredProfile: RuntimeDescriptorRevocationProfile;
}

export type RuntimeDescriptorRevocationEnvironmentProfileSource =
	| "dedicated-profile"
	| "generic-environment";

export interface ResolveRuntimeDescriptorRevocationEnvironmentProfileInput {
	dedicatedProfile?: string;
	genericEnvironment?: string;
}

export interface ResolveRuntimeDescriptorRevocationEnvironmentProfileResult {
	profile?: RuntimeDescriptorRevocationProfile;
	source?: RuntimeDescriptorRevocationEnvironmentProfileSource;
	invalidInputs?: RuntimeDescriptorRevocationInvalidInput[];
	conflicts?: RuntimeDescriptorRevocationConfigConflict[];
}

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
	invalidInputs?: RuntimeDescriptorRevocationInvalidInput[];
	conflicts?: RuntimeDescriptorRevocationConfigConflict[];
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

export function dedupeRuntimeDescriptorRevocationInvalidInputs(
	inputs: RuntimeDescriptorRevocationInvalidInput[],
): RuntimeDescriptorRevocationInvalidInput[] {
	return inputs.filter(
		(input, index, all) =>
			all.findIndex(
				(candidate) =>
					candidate.slot === input.slot && candidate.value === input.value,
			) === index,
	);
}

export function dedupeRuntimeDescriptorRevocationConfigConflicts(
	conflicts: RuntimeDescriptorRevocationConfigConflict[],
): RuntimeDescriptorRevocationConfigConflict[] {
	return conflicts.filter(
		(conflict, index, all) =>
			all.findIndex(
				(candidate) =>
					candidate.slot === conflict.slot &&
					candidate.preferredSource === conflict.preferredSource &&
					candidate.preferredValue === conflict.preferredValue &&
					candidate.preferredProfile === conflict.preferredProfile &&
					candidate.ignoredSource === conflict.ignoredSource &&
					candidate.ignoredValue === conflict.ignoredValue &&
					candidate.ignoredProfile === conflict.ignoredProfile,
			) === index,
	);
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

export function normalizeRuntimeDescriptorRevocationEnvironmentName(
	value: string | undefined,
): RuntimeDescriptorRevocationProfile | null {
	const candidate = normalizeValue(value);

	if (
		candidate === "dev" ||
		candidate === "development" ||
		candidate === "local" ||
		candidate === "test" ||
		candidate === "testing"
	) {
		return "dev";
	}

	if (
		candidate === "staging" ||
		candidate === "stage" ||
		candidate === "qa" ||
		candidate === "preview" ||
		candidate === "preprod" ||
		candidate === "pre-production"
	) {
		return "staging";
	}

	if (
		candidate === "production" ||
		candidate === "prod" ||
		candidate === "live" ||
		candidate === "production-sensitive"
	) {
		return "production-sensitive";
	}

	return null;
}

export function resolveRuntimeDescriptorRevocationEnvironmentProfile(
	input: ResolveRuntimeDescriptorRevocationEnvironmentProfileInput,
): ResolveRuntimeDescriptorRevocationEnvironmentProfileResult {
	const invalidInputs: RuntimeDescriptorRevocationInvalidInput[] = [];
	const conflicts: RuntimeDescriptorRevocationConfigConflict[] = [];

	const dedicatedProfileRaw =
		typeof input.dedicatedProfile === "string"
			? input.dedicatedProfile.trim()
			: "";
	const genericEnvironmentRaw =
		typeof input.genericEnvironment === "string"
			? input.genericEnvironment.trim()
			: "";

	const dedicatedProfile = dedicatedProfileRaw
		? normalizeRuntimeDescriptorRevocationProfile(dedicatedProfileRaw)
		: null;
	const genericEnvironmentProfile = genericEnvironmentRaw
		? normalizeRuntimeDescriptorRevocationEnvironmentName(genericEnvironmentRaw)
		: null;

	if (dedicatedProfileRaw.length > 0 && !dedicatedProfile) {
		invalidInputs.push({
			slot: "environment-profile",
			value: input.dedicatedProfile!,
		});
	}

	if (genericEnvironmentRaw.length > 0 && !genericEnvironmentProfile) {
		invalidInputs.push({
			slot: "environment-profile",
			value: input.genericEnvironment!,
		});
	}

	if (dedicatedProfile && genericEnvironmentProfile) {
		if (dedicatedProfile !== genericEnvironmentProfile) {
			conflicts.push({
				slot: "environment-profile",
				preferredSource: "dedicated-profile",
				preferredValue: input.dedicatedProfile!,
				preferredProfile: dedicatedProfile,
				ignoredSource: "generic-environment",
				ignoredValue: input.genericEnvironment!,
				ignoredProfile: genericEnvironmentProfile,
			});
		}

		return {
			profile: dedicatedProfile,
			source: "dedicated-profile",
			invalidInputs: invalidInputs.length > 0 ? invalidInputs : undefined,
			conflicts: conflicts.length > 0 ? conflicts : undefined,
		};
	}

	if (dedicatedProfile) {
		return {
			profile: dedicatedProfile,
			source: "dedicated-profile",
			invalidInputs: invalidInputs.length > 0 ? invalidInputs : undefined,
		};
	}

	if (genericEnvironmentProfile) {
		return {
			profile: genericEnvironmentProfile,
			source: "generic-environment",
			invalidInputs: invalidInputs.length > 0 ? invalidInputs : undefined,
		};
	}

	return {
		invalidInputs: invalidInputs.length > 0 ? invalidInputs : undefined,
	};
}

export function getRuntimeDescriptorRevocationPolicyForProfile(
	profile: RuntimeDescriptorRevocationProfile,
): RuntimeDescriptorRevocationUnavailablePolicy {
	return PROFILE_POLICY[profile];
}

export function resolveRuntimeDescriptorRevocationUnavailablePolicy(
	input: ResolveRuntimeDescriptorRevocationUnavailablePolicyInput,
): ResolveRuntimeDescriptorRevocationUnavailablePolicyResult {
	const invalidInputs: RuntimeDescriptorRevocationInvalidInput[] = [];

	if (
		typeof input.explicitPolicy === "string" &&
		input.explicitPolicy.trim().length > 0 &&
		!normalizeRuntimeDescriptorRevocationUnavailablePolicy(input.explicitPolicy)
	) {
		invalidInputs.push({
			slot: "explicit-policy",
			value: input.explicitPolicy,
		});
	}

	if (
		typeof input.explicitProfile === "string" &&
		input.explicitProfile.trim().length > 0 &&
		!normalizeRuntimeDescriptorRevocationProfile(input.explicitProfile)
	) {
		invalidInputs.push({
			slot: "explicit-profile",
			value: input.explicitProfile,
		});
	}

	if (
		typeof input.environmentPolicy === "string" &&
		input.environmentPolicy.trim().length > 0 &&
		!normalizeRuntimeDescriptorRevocationUnavailablePolicy(
			input.environmentPolicy,
		)
	) {
		invalidInputs.push({
			slot: "environment-policy",
			value: input.environmentPolicy,
		});
	}

	if (
		typeof input.environmentProfile === "string" &&
		input.environmentProfile.trim().length > 0 &&
		!normalizeRuntimeDescriptorRevocationProfile(input.environmentProfile)
	) {
		invalidInputs.push({
			slot: "environment-profile",
			value: input.environmentProfile,
		});
	}

	const withInvalidInputs = (
		result: ResolveRuntimeDescriptorRevocationUnavailablePolicyResult,
	): ResolveRuntimeDescriptorRevocationUnavailablePolicyResult => {
		if (invalidInputs.length === 0) return result;
		return {
			...result,
			invalidInputs,
		};
	};

	const explicitPolicy = normalizeRuntimeDescriptorRevocationUnavailablePolicy(
		input.explicitPolicy,
	);
	if (explicitPolicy) {
		return withInvalidInputs({
			policy: explicitPolicy,
			source: "explicit-policy",
		});
	}

	const explicitProfile = normalizeRuntimeDescriptorRevocationProfile(
		input.explicitProfile,
	);
	if (explicitProfile) {
		return withInvalidInputs({
			policy: getRuntimeDescriptorRevocationPolicyForProfile(explicitProfile),
			source: "explicit-profile",
			profile: explicitProfile,
		});
	}

	const environmentPolicy =
		normalizeRuntimeDescriptorRevocationUnavailablePolicy(
			input.environmentPolicy,
		);
	if (environmentPolicy) {
		return withInvalidInputs({
			policy: environmentPolicy,
			source: "environment-policy",
		});
	}

	const environmentProfile = normalizeRuntimeDescriptorRevocationProfile(
		input.environmentProfile,
	);
	if (environmentProfile) {
		return withInvalidInputs({
			policy:
				getRuntimeDescriptorRevocationPolicyForProfile(environmentProfile),
			source: "environment-profile",
			profile: environmentProfile,
		});
	}

	return withInvalidInputs({
		policy: input.fallbackPolicy,
		source: "fallback",
	});
}
