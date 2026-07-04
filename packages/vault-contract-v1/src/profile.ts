import type { VaultProfile, VaultRule, VaultVerb } from "./types.js";

/**
 * Resolve a vault profile's `extends` chain into a flat, effective profile —
 * the host does this BEFORE dispatch so a surface always receives a resolved
 * rule set. Mirrors resolveQualityProfile: child rules override parent rules of
 * the same id, cycles throw.
 */
export function resolveVaultProfile(
	profile: VaultProfile,
	profiles: Record<string, VaultProfile> = {},
): VaultProfile {
	return resolveProfile(profile, profiles, []);
}

function resolveProfile(
	profile: VaultProfile,
	profiles: Record<string, VaultProfile>,
	stack: string[],
): VaultProfile {
	if (!profile.extends) {
		return { ...profile, rules: [...profile.rules] };
	}

	if (stack.includes(profile.name)) {
		throw new Error(
			`Vault profile cycle detected: ${[...stack, profile.name].join(" -> ")}`,
		);
	}

	const parent = profiles[profile.extends];
	if (!parent) {
		throw new Error(
			`Vault profile '${profile.name}' extends unknown profile '${profile.extends}'`,
		);
	}

	const resolvedParent = resolveProfile(parent, profiles, [
		...stack,
		profile.name,
	]);
	return {
		...resolvedParent,
		...profile,
		rules: mergeRules(resolvedParent.rules, profile.rules),
	};
}

function mergeRules(
	parentRules: VaultRule[],
	childRules: VaultRule[],
): VaultRule[] {
	const rules = new Map<string, VaultRule>();
	for (const rule of parentRules) rules.set(rule.id, rule);
	for (const rule of childRules) rules.set(rule.id, rule);
	return [...rules.values()];
}

/**
 * Narrow a resolved profile to just the rules for one verb — what the host hands
 * a surface when dispatching that verb. The surface never sees rules for other
 * verbs, so its output shape is unambiguous.
 */
export function profileForVerb(
	profile: VaultProfile,
	verb: VaultVerb,
): VaultProfile {
	return {
		...profile,
		rules: profile.rules.filter((rule) => rule.verb === verb),
	};
}
