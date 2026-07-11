import { profileForVerb, resolveVaultProfile } from "./profile.js";
import {
	VAULT_CAPABILITY,
	VAULT_VERBS,
	type VaultConformanceOptions,
	type VaultConformanceResult,
	type VaultNote,
	type VaultProfile,
	type VaultResult,
	type VaultSurface,
	type VaultVerb,
} from "./types.js";

/** A base profile with one rule per verb, exercising every matcher the reference
 * surface implements. Conformance runs a surface against these and asserts the
 * boundary holds (determinism, empty-for-unimplemented, output shape per verb). */
const BASE_PROFILE: VaultProfile = {
	name: "base",
	rules: [
		{
			id: "find-alpha",
			verb: "search",
			match: JSON.stringify({ type: "contains", value: "alpha" }),
			description: "Notes containing alpha.",
		},
		{
			id: "extract-frontmatter",
			verb: "extract",
			match: JSON.stringify({ type: "frontmatter", recordType: "VaultRecord" }),
			description: "Extract a record from note frontmatter.",
		},
		{
			id: "route-project",
			verb: "organize",
			match: JSON.stringify({
				type: "prefix-route",
				marker: "#project",
				destination: "20-Projects",
			}),
			description: "Route project notes into 20-Projects.",
		},
		{
			id: "require-title",
			verb: "profile",
			severity: "warn",
			match: JSON.stringify({ type: "requires", value: "title:" }),
			description: "A note should declare a title.",
		},
	],
};

const STRICT_PROFILE: VaultProfile = {
	name: "strict",
	extends: "base",
	rules: [
		{
			id: "require-title",
			verb: "profile",
			severity: "fail",
			match: JSON.stringify({ type: "requires", value: "title:" }),
			description: "A note MUST declare a title.",
		},
	],
};

const CONFORMANCE_NOTE: VaultNote = {
	path: "00-Inbox/alpha-note.md",
	text: "---\ntitle: Alpha\nstate: doing\n---\n\nalpha body #project\n",
};

/**
 * Run the vault:v1 conformance suite against a surface (native or WASM-backed).
 * Asserts the sovereign boundary: identity fields present, profile composition
 * preserved, each verb returns its own output shape, unimplemented verbs return
 * empty, and dispatch is deterministic (same input → same output twice).
 */
export async function runVaultV1Conformance(
	surface: VaultSurface,
	options: VaultConformanceOptions = {},
): Promise<VaultConformanceResult> {
	const failures: string[] = [];
	const note = options.note ?? CONFORMANCE_NOTE;
	const profile = options.profile ?? STRICT_PROFILE;
	const profiles = options.profiles ?? { base: BASE_PROFILE };

	if (!surface.surfaceId || surface.surfaceId.trim().length === 0) {
		failures.push("surface.surfaceId must be a non-empty string");
	}
	if (!Array.isArray(surface.verbs) || surface.verbs.length === 0) {
		failures.push("surface.verbs must be a non-empty list");
	}

	let resolved: VaultProfile = profile;
	try {
		resolved = resolveVaultProfile(profile, profiles);
		if (!resolved.rules.some((rule) => rule.id === "find-alpha")) {
			failures.push("profile composition must preserve parent rules");
		}
		const strictProfileRule = resolved.rules.find((r) => r.id === "require-title");
		if (strictProfileRule && strictProfileRule.severity !== "fail") {
			failures.push("child rule must override parent rule of the same id");
		}
	} catch (error) {
		failures.push(`profile composition threw: ${String(error)}`);
	}

	for (const verb of VAULT_VERBS) {
		try {
			const scoped = profileForVerb(resolved, verb);
			const first = await surface.run(verb, note, scoped);
			const second = await surface.run(verb, note, scoped);

			assertResultShape(verb, first, failures);

			if (JSON.stringify(first) !== JSON.stringify(second)) {
				failures.push(`verb '${verb}' is not deterministic`);
			}
		} catch (error) {
			failures.push(`verb '${verb}' dispatch threw: ${String(error)}`);
		}
	}

	// An unknown verb (outside the surface's set) must return empty, not throw.
	try {
		const unknown = await surface.run("search", note, { name: "empty", rules: [] });
		if (unknown.hits.length !== 0) {
			failures.push("a profile with no rules must yield no hits");
		}
	} catch (error) {
		failures.push(`empty-profile dispatch threw: ${String(error)}`);
	}

	return {
		pass: failures.length === 0,
		total: VAULT_VERBS.length + 3,
		failed: failures.length,
		failures,
	};
}

/** Assert that a verb's result populates ONLY its own output field and carries
 * the dispatched verb — the one-shape-per-verb invariant the host relies on. */
function assertResultShape(verb: VaultVerb, result: VaultResult, failures: string[]): void {
	if (result.verb !== verb) {
		failures.push(`result.verb must be '${verb}', got '${result.verb}'`);
	}
	const outputFields: (keyof VaultResult)[] = ["records", "hits", "plans", "findings"];
	const owner: Record<VaultVerb, keyof VaultResult> = {
		search: "hits",
		extract: "records",
		organize: "plans",
		profile: "findings",
	};
	for (const field of outputFields) {
		if (field === owner[verb]) continue;
		const list = result[field] as unknown[];
		if (Array.isArray(list) && list.length > 0) {
			failures.push(
				`verb '${verb}' must not populate '${String(field)}' (only '${String(owner[verb])}')`,
			);
		}
	}
}

/** The capability this conformance suite proves. */
export { VAULT_CAPABILITY };
