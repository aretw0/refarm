import {
	isCapabilityGroup,
	resolveGroupAction,
	type CapabilityEntry,
	type CapabilityGroup,
} from "@refarm.dev/cli/capabilities";
import { describe, expect, it } from "vitest";

import { buildRegistry } from "./cli.js";

/**
 * The T2 flow through wallet's own CLI registry: the citizen views their sovereign
 * wallet (result mode — the product, not the machine) and curates an item.
 */
function group(reg: ReturnType<typeof buildRegistry>, name: string): CapabilityGroup {
	const entry = reg.list().find((e: CapabilityEntry) => e.name === name);
	if (!entry || !isCapabilityGroup(entry)) throw new Error(`no group ${name}`);
	return entry;
}

async function runGroup(
	reg: ReturnType<typeof buildRegistry>,
	name: string,
	tokens: string[],
): Promise<Record<string, unknown>> {
	const resolved = resolveGroupAction(group(reg, name), tokens);
	if (!resolved) throw new Error(`cannot resolve ${name} ${tokens.join(" ")}`);
	return (await resolved.action.run(resolved.input)) as unknown as Record<string, unknown>;
}

async function runVerb(
	reg: ReturnType<typeof buildRegistry>,
	name: string,
): Promise<Record<string, unknown>> {
	const entry = reg.list().find((e) => e.name === name);
	if (!entry || isCapabilityGroup(entry)) throw new Error(`no verb ${name}`);
	return (await entry.run({ args: {}, options: {}, json: true })) as unknown as Record<
		string,
		unknown
	>;
}

describe("wallet T2 — the sovereign citizen's digital wallet (result mode)", () => {
	it("mounts the neutral chain + the one persona verb", () => {
		const names = buildRegistry().list().map((e) => e.name);
		expect(names).toEqual(expect.arrayContaining(["source", "records", "vault", "wallet-show"]));
	});

	it("shows the citizen's held items as a product view", async () => {
		const env = await runVerb(buildRegistry(), "wallet-show");
		expect(env.ok).toBe(true);
		expect(env.total).toBe(3); // the three wallet items
		const wallet = env.wallet as string;
		expect(wallet).toContain("Minha Carteira Digital");
		expect(wallet).toContain("Documento de identidade");
	});

	it("the citizen curates an item and the wallet reflects it (local-first, their data)", async () => {
		const reg = buildRegistry();
		// The citizen verifies their draft credential (persists via shared records deps).
		const corrected = await runGroup(reg, "records", [
			"correct",
			"record:cred-assinatura",
			"verified",
			"--apply",
		]);
		expect(corrected.persisted).toBe(true);

		// Now all three items are verified — the wallet's verified group holds all.
		const env = await runVerb(reg, "wallet-show");
		expect((env.byState as Record<string, number>).verified).toBe(3);
	});
});
