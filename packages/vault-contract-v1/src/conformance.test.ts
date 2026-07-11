import { describe, expect, it } from "vitest";

import { runVaultV1Conformance } from "./conformance.js";
import { profileForVerb, resolveVaultProfile } from "./profile.js";
import { createReferenceVaultSurface, runReferenceVault } from "./reference.js";
import {
	emptyVaultResult,
	VAULT_CAPABILITY,
	VAULT_VERBS,
	type VaultNote,
	type VaultProfile,
} from "./types.js";

const NOTE: VaultNote = {
	path: "00-Inbox/alpha-note.md",
	text: "---\ntitle: Alpha\nstate: doing\n---\n\nalpha body #project\n",
};

const PROFILE: VaultProfile = {
	name: "demo",
	rules: [
		{
			id: "find-alpha",
			verb: "search",
			match: JSON.stringify({ type: "contains", value: "alpha" }),
		},
		{
			id: "extract-frontmatter",
			verb: "extract",
			match: JSON.stringify({ type: "frontmatter", recordType: "VaultRecord" }),
		},
		{
			id: "route-project",
			verb: "organize",
			match: JSON.stringify({
				type: "prefix-route",
				marker: "#project",
				destination: "20-Projects",
			}),
		},
		{
			id: "require-summary",
			verb: "profile",
			severity: "warn",
			match: JSON.stringify({ type: "requires", value: "summary:" }),
		},
	],
};

describe("vault:v1 constants", () => {
	it("exposes the capability id and the four verbs", () => {
		expect(VAULT_CAPABILITY).toBe("vault:v1");
		expect([...VAULT_VERBS]).toEqual(["search", "extract", "organize", "profile"]);
	});

	it("emptyVaultResult carries the verb and four empty lists", () => {
		expect(emptyVaultResult("extract")).toEqual({
			verb: "extract",
			records: [],
			hits: [],
			plans: [],
			findings: [],
		});
	});
});

describe("reference vault surface — one honest matcher per verb", () => {
	it("search: a note containing the value is a hit with a locus", () => {
		const result = runReferenceVault("search", NOTE, profileForVerb(PROFILE, "search"));
		expect(result.hits).toHaveLength(1);
		expect(result.hits[0]?.path).toBe(NOTE.path);
		expect(result.hits[0]?.ruleId).toBe("find-alpha");
		expect(JSON.parse(result.hits[0]?.locus ?? "{}")).toMatchObject({ match: "alpha" });
	});

	it("extract: builds a KnowledgeRecord from frontmatter with a valid content hash", () => {
		const result = runReferenceVault("extract", NOTE, profileForVerb(PROFILE, "extract"));
		expect(result.records).toHaveLength(1);
		const record = result.records[0];
		expect(record?.id).toBe(NOTE.path);
		expect(record?.["@type"]).toBe("VaultRecord");
		expect(record?.fields).toEqual({ title: "Alpha", state: "doing" });
		expect(record?.sourceRefs).toEqual([NOTE.path]);
		// records-contract-v1 stamps a prefixed content hash, e.g. `fnv1a32:….`
		expect(record?.contentHash).toMatch(/^[a-z0-9]+:[a-f0-9]+$/);
	});

	it("organize: routes a marked note to a destination with a canonical name", () => {
		const result = runReferenceVault("organize", NOTE, profileForVerb(PROFILE, "organize"));
		expect(result.plans).toHaveLength(1);
		expect(result.plans[0]).toMatchObject({
			path: NOTE.path,
			destination: "20-Projects",
			fileName: "alpha-note.md",
		});
	});

	it("profile: flags a note MISSING required content", () => {
		const result = runReferenceVault("profile", NOTE, profileForVerb(PROFILE, "profile"));
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0]).toMatchObject({
			severity: "warn",
			ruleId: "require-summary",
		});
	});

	it("profile: no finding when the required content IS present", () => {
		const withSummary: VaultNote = {
			path: NOTE.path,
			text: `${NOTE.text}summary: done\n`,
		};
		const result = runReferenceVault("profile", withSummary, profileForVerb(PROFILE, "profile"));
		expect(result.findings).toHaveLength(0);
	});

	it("each verb populates ONLY its own output list", () => {
		for (const verb of VAULT_VERBS) {
			const result = runReferenceVault(verb, NOTE, profileForVerb(PROFILE, verb));
			const owner = {
				search: "hits",
				extract: "records",
				organize: "plans",
				profile: "findings",
			} as const;
			for (const field of ["records", "hits", "plans", "findings"] as const) {
				if (field === owner[verb]) continue;
				expect(result[field], `${verb} must not populate ${field}`).toHaveLength(0);
			}
		}
	});

	it("an unknown match.type fires nothing (forward-safe)", () => {
		const future: VaultProfile = {
			name: "future",
			rules: [{ id: "x", verb: "search", match: JSON.stringify({ type: "semantic", q: "alpha" }) }],
		};
		expect(runReferenceVault("search", NOTE, future).hits).toHaveLength(0);
	});

	it("a malformed match JSON fires nothing (never throws)", () => {
		const bad: VaultProfile = {
			name: "bad",
			rules: [{ id: "x", verb: "search", match: "{ not json" }],
		};
		expect(() => runReferenceVault("search", NOTE, bad)).not.toThrow();
		expect(runReferenceVault("search", NOTE, bad).hits).toHaveLength(0);
	});
});

describe("profile composition", () => {
	it("child rules override parent rules of the same id; cycles throw", () => {
		const base: VaultProfile = {
			name: "base",
			rules: [{ id: "r", verb: "profile", severity: "warn", match: "{}" }],
		};
		const strict: VaultProfile = {
			name: "strict",
			extends: "base",
			rules: [{ id: "r", verb: "profile", severity: "fail", match: "{}" }],
		};
		const resolved = resolveVaultProfile(strict, { base });
		expect(resolved.rules.find((r) => r.id === "r")?.severity).toBe("fail");

		const cyclic: VaultProfile = { name: "a", extends: "a", rules: [] };
		expect(() => resolveVaultProfile(cyclic, { a: cyclic })).toThrow(/cycle/);
	});

	it("profileForVerb narrows to a single verb's rules", () => {
		expect(profileForVerb(PROFILE, "search").rules).toHaveLength(1);
		expect(profileForVerb(PROFILE, "search").rules[0]?.verb).toBe("search");
	});
});

describe("vault:v1 conformance harness", () => {
	it("the reference surface passes conformance", async () => {
		const result = await runVaultV1Conformance(createReferenceVaultSurface());
		expect(result.failures).toEqual([]);
		expect(result.pass).toBe(true);
	});
});
