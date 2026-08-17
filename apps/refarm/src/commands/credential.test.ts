import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildAccountView } from "@refarm.dev/model-account-contract-v1";

import { createCredentialCommand } from "./credential.js";

const TOKENS = {
	oauthCredentials: { "openai-codex": { access: "SECRET-TOKEN", expires: 1, accountId: "acc-1" } },
};

const CORPORATE = {
	credentialId: "model-account:AAAAAAAAAAAAAAAAAAAAAAAAAA",
	provider: "github-copilot",
	alias: "corporativa",
	identity: { status: "unverified" as const },
	secretRef: "model/github-copilot-corp",
	health: "healthy" as const,
	revision: "sha256:r1",
};

const written: unknown[][] = [];
const removed: string[] = [];

async function run(
	argv: string[],
	tokens: Record<string, unknown> = TOKENS,
	catalog: unknown[] = [],
	// Namespaced secrets, keyed by secretRef. Legacy credentials need no entry: their secret IS the
	// flat token map that produced the descriptor, and the view declares those present itself.
	secrets: Map<string, unknown> = new Map(),
	bindings: { workspaceId: string; credentialId: string }[] = [],
	home = "/nonexistent-home",
) {
	const chunks: string[] = [];
	const write = process.stdout.write.bind(process.stdout);
	const log = console.log;
	const err = console.error;
	// `console.log` TOO: `printJson` goes through it, so a capture that replaced only
	// `process.stdout.write` would read every `--json` assertion below as an empty string.
	const collect = (...args: unknown[]) => void chunks.push(args.map(String).join(" "));
	process.stdout.write = ((c: string) => (chunks.push(String(c)), true)) as never;
	console.log = collect;
	console.error = collect;
	process.exitCode = 0;
	try {
		await createCredentialCommand({
			homeOf: () => home,
			siloOf: () => ({
				loadTokens: async () => tokens,
				saveTokens: async () => tokens,
				removeSecret: async (_ns: string, id: string) => void removed.push(id),
			}),
			viewOf: async () =>
				buildAccountView({ tokens, catalog: catalog as never, secrets }),
			bindingsOf: () => bindings,
			// The STORED records. Deliberately a different list from what `viewOf` returns — the view
			// merges legacy descriptors synthesised from the tokens, and a fixture where the two
			// coincide cannot see ISS-133 at all.
			catalogOf: () => catalog as never,
			// The stored credential per account, which only the quota reader asks for. Empty here on
			// purpose: every other test in this file must pass without one, or the dependency has
			// leaked into commands that have no business holding secret material.
			credentialsOf: async () => new Map<string, unknown>(),
			// Frozen, so a declaration's recorded date is assertable rather than whatever day it ran.
			todayOf: () => "2026-08-17",
			writeCatalog: (next) => void written.push([...next]),
		}).parseAsync(argv, { from: "user" });
	} finally {
		process.stdout.write = write;
		console.log = log;
		console.error = err;
	}
	const exitCode = Number(process.exitCode ?? 0);
	process.exitCode = 0;
	return { out: chunks.join(""), exitCode };
}

describe("credential list", () => {
	it("lists a legacy credential as an account, and prints NO secret", async () => {
		// The acceptance row: "credential listing returns ids/aliases/protection only, never calls
		// value-returning listSecrets". Asserted against the whole output, not against field names.
		const { out } = await run(["list", "--json"]);
		expect(out).toContain("openai-codex");
		expect(out).toContain("default");
		expect(out).not.toContain("SECRET-TOKEN");
		expect(out).not.toContain("acc-1");
	});

	it("says a node with no credentials has none, rather than printing an empty table", async () => {
		const { out } = await run(["list", "--json"], {}, []);
		expect(out).toMatch(/"accounts":\s*\[\]/u);
	});

	it("shows an INCOMPLETE account rather than hiding it", async () => {
		// A descriptor whose secret is gone is the operator's evidence that a login happened. The
		// listing is where he finds out, so it must not filter to the healthy ones.
		const { out } = await run(["list", "--json"], TOKENS, [CORPORATE]);
		expect(out).toContain("incomplete");
		expect(out).toContain("corporativa");
	});
});

describe("credential current", () => {
	it("resolves the single legacy account and names the SOURCE it came from", async () => {
		const { out, exitCode } = await run(["current", "--json"]);
		expect(exitCode).toBe(0);
		expect(out).toContain("node-default");
	});

	it("REFUSES with model_credential_ambiguous when two accounts and no binding", async () => {
		// THE CATALOG IS NOT IN THE SILO (D2: "Silo stores the secret envelope … A separate
		// non-secret catalog stores the descriptor"). It is injected through `catalogOf`.
		const { out, exitCode } = await run(
			["current", "--provider", "github-copilot", "--json"],
			{ oauthCredentials: { "github-copilot": { access: "A" } } },
			[CORPORATE],
			new Map([[CORPORATE.secretRef, { access: "CORP" }]]),
		);
		expect(exitCode).toBe(1);
		expect(out).toContain("model_credential_ambiguous");
		expect(out).not.toContain("SECRET");
	});

	it("refuses without crashing when nothing is registered at all", async () => {
		const { out, exitCode } = await run(["current", "--json"], {}, []);
		expect(exitCode).toBe(1);
		expect(out).toMatch(/no model account|model_credential_none/u);
	});
});

describe("credential bind", () => {
	it("refuses to bind a workspace to an account that does not exist", async () => {
		const { out, exitCode } = await run(["bind", "rcdc5", "model-account:NOPE", "--json"]);
		expect(exitCode).toBe(1);
		expect(out).toMatch(/model_credential_none/u);
	});
});

describe("credential list — the identity profile is never silent", () => {
	it("says NOTHING when refarm uses its own identity", async () => {
		const { out } = await run(["list", "--json"]);
		expect(out).not.toMatch(/imitat/iu);
	});

	it("reports imitation, because a node that impersonates in silence breaks unexplained", async () => {
		// `homeOf` points at a directory with no config, so this asserts the DEFAULT path stays
		// quiet; the profile resolution itself is covered in copilot-identity.test.ts against every
		// declared value. What is pinned here is the wiring: the notice reaches the listing at all.
		const { out } = await run(["list"]);
		expect(out).toContain("openai-codex");
	});
});

describe("credential forget", () => {
	const CORP_ID = CORPORATE.credentialId;

	it("refuses an id nothing carries", async () => {
		const { out, exitCode } = await run(["forget", "model-account:NOPE", "--json"]);
		expect(exitCode).toBe(1);
		expect(out).toMatch(/model_credential_none/u);
	});

	it("REFUSES while a workspace is bound to it, naming the workspaces", async () => {
		// A binding persists the OPAQUE id, so removing the account underneath it would leave the
		// binding pointing at nothing — and the dispatch that discovered it would be the operator's
		// real work, not a check.
		written.length = 0;
		const { out, exitCode } = await run(
			["forget", CORP_ID, "--yes", "--json"],
			TOKENS,
			[CORPORATE],
			new Map([[CORPORATE.secretRef, { access: "C" }]]),
			[{ workspaceId: "rcdc5", credentialId: CORP_ID }],
		);
		expect(exitCode).toBe(1);
		expect(out).toContain("rcdc5");
		expect(written).toHaveLength(0);
	});

	it("asks before removing, and removes NOTHING without --yes", async () => {
		written.length = 0;
		removed.length = 0;
		const { out } = await run(
			["forget", CORP_ID],
			TOKENS,
			[CORPORATE],
			new Map([[CORPORATE.secretRef, { access: "C" }]]),
		);
		expect(out).toMatch(/--yes/u);
		expect(written).toHaveLength(0);
		expect(removed).toHaveLength(0);
	});

	it("removes the SECRET and then the descriptor, leaving the siblings alone", async () => {
		// Secret first: a failure between the two leaves an `incomplete` entry the operator can see
		// and repair. The reverse order would leave an `unclaimed` secret nothing describes.
		written.length = 0;
		removed.length = 0;
		await run(
			["forget", CORP_ID, "--yes", "--json"],
			TOKENS,
			[CORPORATE],
			new Map([[CORPORATE.secretRef, { access: "C" }]]),
		);
		// Removed by the id inside the secretRef, NOT by the credentialId. They coincide for a real
		// write, and this fixture deliberately does not: a descriptor points at its secret through the
		// ref, and following the id instead would miss a secret written under any other name.
		expect(removed).toEqual(["github-copilot-corp"]);
		expect(written).toHaveLength(1);
		expect(written[0]!.some((e) => (e as { credentialId: string }).credentialId === CORP_ID)).toBe(
			false,
		);
	});

	/**
	 * ISS-133. What is WRITTEN is the catalog; what is ANSWERED from is the view. They are not the
	 * same list — the view merges descriptors synthesised from the flat token map — and writing the
	 * view back promotes those into stored records. Measured on the operator's node: a descriptor
	 * naming `legacy:oauthCredentials/openai-codex` persisted in the catalog, outliving the flat
	 * entry that produced it, and counted as a second openai-codex account by the next `sow`.
	 */
	it("writes the CATALOG minus the entry, never the view minus the entry", async () => {
		written.length = 0;
		removed.length = 0;
		// The node's catalog holds one namespaced account; its silo still holds a legacy one. The
		// view sees two, and only one of them is a stored record.
		await run(
			["forget", CORP_ID, "--yes", "--json"],
			TOKENS,
			[CORPORATE],
			new Map([[CORPORATE.secretRef, { access: "C" }]]),
		);
		expect(written).toHaveLength(1);
		expect(written[0]).toEqual([]);
	});

	it("REMOVES a legacy record whose secret is already gone, which nothing else can", async () => {
		// The operator's node on 2026-08-17: a persisted legacy descriptor (ISS-133) outliving the
		// flat entry that produced it. `sow` keeps it — correctly, nothing proves whose it was — so
		// if this command refused it too, the record would be unremovable by any means the CLI has.
		written.length = 0;
		removed.length = 0;
		const FOSSIL = {
			credentialId: "model-account:CG4WNKR6KNSH3510XGHBWW0JXA",
			provider: "openai-codex",
			alias: "default",
			identity: { status: "unverified" as const },
			secretRef: "legacy:oauthCredentials/openai-codex",
			health: "healthy" as const,
			revision: "sha256:legacy",
		};
		const { exitCode } = await run(
			["forget", FOSSIL.credentialId, "--yes", "--json"],
			{ oauthCredentials: {} },
			[FOSSIL],
		);
		expect(exitCode).toBe(0);
		// The catalog loses it and no secret removal is attempted — there is none to remove.
		expect(written).toEqual([[]]);
		expect(removed).toHaveLength(0);
	});

	it("REFUSES to forget a legacy account, rather than reporting a removal it did not perform", async () => {
		// A legacy account's secret is the flat token entry, and this command touches only the
		// namespaced store and the catalog. Removing neither and printing success is how a node comes
		// to disagree with itself; the operator is told where the credential actually lives.
		written.length = 0;
		removed.length = 0;
		const legacyId = buildAccountView({ tokens: TOKENS, catalog: [], secrets: new Map() })
			.accounts[0]!.credentialId;
		const { out, exitCode } = await run(["forget", legacyId, "--yes", "--json"], TOKENS, []);
		expect(exitCode).toBe(1);
		expect(out).toMatch(/legacy/iu);
		expect(written).toHaveLength(0);
		expect(removed).toHaveLength(0);
	});
});

/**
 * ISS-131 tier 3 — what this node is authorised to spend, declared rather than inferred.
 *
 * The operator's ruling: a node with nothing associated must DECLARE that, either "approved to use
 * everything this node holds" or "approved only for these". Blanket approval is legitimate and
 * cheap; it just has to be GIVEN, so a node that never chose stays distinguishable from one that
 * chose everything. Here, silence spends money.
 */
describe("credential authorize", () => {
	const CORP_ID = CORPORATE.credentialId;
	const homes: string[] = [];

	function tmpHome(): string {
		const dir = mkdtempSync(join(tmpdir(), "refarm-authz-"));
		homes.push(dir);
		return dir;
	}

	afterEach(() => {
		for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	const readConfig = (home: string) =>
		JSON.parse(readFileSync(join(home, "config.json"), "utf8")) as Record<string, unknown>;

	it("shows an UNDECLARED node what it has not said, and writes nothing", async () => {
		const home = tmpHome();
		const { out, exitCode } = await run(
			["authorize", "--json"],
			TOKENS,
			[CORPORATE],
			new Map([[CORPORATE.secretRef, { access: "C" }]]),
			[],
			home,
		);
		expect(exitCode).toBe(0);
		expect(out).toContain("undeclared");
		expect(out).toMatch(/has not declared/u);
		expect(existsSync(join(home, "config.json"))).toBe(false);
	});

	it("records blanket approval WITH the date it was given", async () => {
		// The date is the difference between a standing decision and one nobody remembers making.
		const home = tmpHome();
		await run(
			["authorize", "--all", "--json"],
			TOKENS,
			[CORPORATE],
			new Map([[CORPORATE.secretRef, { access: "C" }]]),
			[],
			home,
		);
		expect(readConfig(home).modelAuthorization).toEqual({
			scope: "all",
			declaredAt: "2026-08-17",
		});
	});

	it("records a named list by OPAQUE id", async () => {
		const home = tmpHome();
		await run(
			["authorize", CORP_ID, "--json"],
			TOKENS,
			[CORPORATE],
			new Map([[CORPORATE.secretRef, { access: "C" }]]),
			[],
			home,
		);
		expect(readConfig(home).modelAuthorization).toMatchObject({
			scope: "declared",
			accounts: [CORP_ID],
		});
	});

	it("REFUSES an id this node does not hold, rather than writing a stale declaration", async () => {
		// A declaration naming an account that is not here is stale the moment it is written, and
		// the operator would believe he had approved something.
		const home = tmpHome();
		const { out, exitCode } = await run(
			["authorize", "model-account:NOPE", "--json"],
			TOKENS,
			[CORPORATE],
			new Map([[CORPORATE.secretRef, { access: "C" }]]),
			[],
			home,
		);
		expect(exitCode).toBe(1);
		expect(out).toContain("model-account:NOPE");
		expect(existsSync(join(home, "config.json"))).toBe(false);
	});

	it("REFUSES --all together with a list, because they say different things", async () => {
		const home = tmpHome();
		const { exitCode } = await run(
			["authorize", "--all", CORP_ID, "--json"],
			TOKENS,
			[CORPORATE],
			new Map([[CORPORATE.secretRef, { access: "C" }]]),
			[],
			home,
		);
		expect(exitCode).toBe(1);
		expect(existsSync(join(home, "config.json"))).toBe(false);
	});

	it("keeps the rest of the config, because this writes one key and owns only that one", async () => {
		const home = tmpHome();
		writeFileSync(
			join(home, "config.json"),
			JSON.stringify({ modelBindings: { rcdc5: CORP_ID }, somethingElse: 1 }),
		);
		await run(
			["authorize", "--all", "--json"],
			TOKENS,
			[CORPORATE],
			new Map([[CORPORATE.secretRef, { access: "C" }]]),
			[],
			home,
		);
		const config = readConfig(home);
		expect(config.modelBindings).toEqual({ rcdc5: CORP_ID });
		expect(config.somethingElse).toBe(1);
	});
});
