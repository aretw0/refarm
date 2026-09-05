import { describe, expect, it } from "vitest";

import { descriptorRevision, reconcileCatalog, renameAlias, upsertDescriptor } from "./catalog.js";
import { isRefusal } from "./resolve.js";
import type { ModelAccountDescriptor } from "./types.js";

const account = (
	alias: string,
	overrides: Partial<ModelAccountDescriptor> = {},
): ModelAccountDescriptor => ({
	credentialId: `model-account:${alias.toUpperCase().padEnd(26, "X")}`,
	provider: "github-copilot",
	alias,
	identity: { status: "unverified" },
	secretRef: `model/${alias}`,
	health: "healthy",
	revision: "sha256:r1",
	...overrides,
});

describe("reconcileCatalog", () => {
	it("marks a descriptor whose secret is missing INCOMPLETE, and never deletes it", () => {
		// D2's recoverable consistency rule. The acceptance row is "descriptor write succeeds, secret
		// write fails → entry is incomplete and ineligible, never healthy". Deleting it would discard
		// the only record that the login happened.
		const [entry] = reconcileCatalog([account("blue")], []);
		expect(entry).toMatchObject({ alias: "blue", health: "incomplete" });
	});

	it("surfaces a secret with no descriptor as UNCLAIMED rather than hiding it", () => {
		// A secret nothing describes is the operator's material and may be the only copy. Silence
		// here is how it gets deleted by someone tidying up.
		const catalog = reconcileCatalog([], ["model/orphan"]);
		expect(catalog).toHaveLength(1);
		expect(catalog[0]).toMatchObject({ health: "unclaimed", secretRef: "model/orphan" });
	});

	it("gives each orphan a DISTINCT id, so two do not collapse into one row", () => {
		// A shared constant id would merge two unclaimed secrets in `credential list`, and one of the
		// operator's secrets would vanish from the only surface that reports it.
		const catalog = reconcileCatalog([], ["model/orphan-a", "model/orphan-b"]);
		expect(new Set(catalog.map((e) => e.credentialId)).size).toBe(2);
	});

	it("calls a matched pair healthy", () => {
		expect(reconcileCatalog([account("blue")], ["model/blue"])[0]).toMatchObject({
			health: "healthy",
		});
	});

	it("is deterministic in order, so two runs produce the same listing", () => {
		const a = reconcileCatalog([account("green"), account("blue")], ["model/blue", "model/green"]);
		const b = reconcileCatalog([account("blue"), account("green")], ["model/green", "model/blue"]);
		expect(a.map((e) => e.alias)).toEqual(b.map((e) => e.alias));
	});
});

describe("upsertDescriptor", () => {
	it("adds a second account of the SAME provider without touching the first", () => {
		// The whole point, and the acceptance row: "login alias blue, then account-03 → both
		// credentials remain independently usable".
		const catalog = upsertDescriptor([account("blue")], account("account-03"));
		expect(catalog).toHaveLength(2);
		expect(catalog.find((e) => e.alias === "blue")).toEqual(account("blue"));
	});

	it("replaces an entry with the same id, leaving siblings byte-identical", () => {
		// "re-login account-03 → blue secret and revision are unchanged".
		const blue = account("blue");
		const before = upsertDescriptor([blue], account("account-03"));
		const after = upsertDescriptor(before, account("account-03", { revision: "sha256:r2" }));
		expect(after).toHaveLength(2);
		expect(after.find((e) => e.alias === "blue")).toEqual(blue);
		expect(after.find((e) => e.alias === "account-03")?.revision).toBe("sha256:r2");
	});
});

describe("renameAlias", () => {
	it("changes ONLY the alias — id, secretRef and revision survive", () => {
		// "rename blue to client-x → opaque id, binding, secret and history are unchanged". A rename
		// that moved the id would break every binding pointing at it.
		const blue = account("blue");
		const renamed = renameAlias([blue], blue.credentialId, "client-x");
		expect(isRefusal(renamed)).toBe(false);
		const entry = (renamed as ModelAccountDescriptor[])[0]!;
		expect(entry).toMatchObject({
			alias: "client-x",
			credentialId: blue.credentialId,
			secretRef: blue.secretRef,
			revision: blue.revision,
		});
	});

	it("refuses a collision within one provider, and allows it ACROSS providers", () => {
		// D1: "Aliases are unique only within a provider on the node, so github-copilot/blue and
		// kimi-api/blue may coexist."
		const catalog = [account("blue"), account("green")];
		expect(isRefusal(renameAlias(catalog, catalog[1]!.credentialId, "blue"))).toBe(true);

		const across = [account("blue"), account("kimi", { provider: "kimi-api" })];
		expect(isRefusal(renameAlias(across, across[1]!.credentialId, "blue"))).toBe(false);
	});

	it("refuses an id nothing carries, rather than silently doing nothing", () => {
		expect(isRefusal(renameAlias([account("blue")], "model-account:NOPE", "x"))).toBe(true);
	});
});

describe("descriptorRevision", () => {
	it("changes when the secret changes and when metadata changes", () => {
		const base = { secretDigest: "s1", provider: "p", alias: "a", identitySubject: undefined };
		expect(descriptorRevision(base)).toBe(descriptorRevision({ ...base }));
		expect(descriptorRevision({ ...base, secretDigest: "s2" })).not.toBe(descriptorRevision(base));
		expect(descriptorRevision({ ...base, alias: "b" })).not.toBe(descriptorRevision(base));
	});
});
