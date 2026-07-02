import type { QualityProfile, QualityRule } from "./types.js";

export function resolveQualityProfile(
	profile: QualityProfile,
	profiles: Record<string, QualityProfile> = {},
): QualityProfile {
	return resolveProfile(profile, profiles, []);
}

function resolveProfile(
	profile: QualityProfile,
	profiles: Record<string, QualityProfile>,
	stack: string[],
): QualityProfile {
	if (!profile.extends) {
		return {
			...profile,
			rules: [...profile.rules],
		};
	}

	if (stack.includes(profile.name)) {
		throw new Error(`Quality profile cycle detected: ${[...stack, profile.name].join(" -> ")}`);
	}

	const parent = profiles[profile.extends];
	if (!parent) {
		throw new Error(`Quality profile '${profile.name}' extends unknown profile '${profile.extends}'`);
	}

	const resolvedParent = resolveProfile(parent, profiles, [...stack, profile.name]);
	return {
		...resolvedParent,
		...profile,
		rules: mergeRules(resolvedParent.rules, profile.rules),
	};
}

function mergeRules(parentRules: QualityRule[], childRules: QualityRule[]): QualityRule[] {
	const rules = new Map<string, QualityRule>();
	for (const rule of parentRules) {
		rules.set(rule.id, rule);
	}
	for (const rule of childRules) {
		rules.set(rule.id, rule);
	}
	return [...rules.values()];
}
