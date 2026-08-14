import { describe, expect, it } from "vitest";

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

async function run(
	argv: string[],
	tokens: Record<string, unknown> = TOKENS,
	catalog: unknown[] = [],
	// Namespaced secrets, keyed by secretRef. Legacy credentials need no entry: their secret IS the
	// flat token map that produced the descriptor, and the view declares those present itself.
	secrets: Map<string, unknown> = new Map(),
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
			homeOf: () => "/nonexistent-home",
			siloOf: () => ({ loadTokens: async () => tokens, saveTokens: async () => tokens }),
			viewOf: async () =>
				buildAccountView({ tokens, catalog: catalog as never, secrets }),
			bindingsOf: () => [],
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
