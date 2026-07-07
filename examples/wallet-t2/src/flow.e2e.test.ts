import {
	isCapabilityGroup,
	resolveGroupAction,
	type CapabilityEntry,
	type CapabilityGroup,
} from "@refarm.dev/capabilities-v1";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildRegistry, buildWalletBaseModel, buildWalletHost } from "./cli.js";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop()!, { force: true, recursive: true });
	}
});

function tempStatePath(): string {
	const dir = mkdtempSync(path.join(tmpdir(), "dgk-wallet-state-"));
	tempDirs.push(dir);
	return path.join(dir, "manifest.json");
}

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
		expect(names).toEqual(expect.arrayContaining([
			"source",
			"records",
			"vault",
			"wallet",
			"status",
			"actions",
		]));
	});

	it("exposes a base operator model without importing the Refarm app", () => {
		const model = buildWalletBaseModel();
		expect(model).toMatchObject({
			schemaVersion: 1,
			command: "dgk",
			operation: "base",
			ok: true,
			nextCommand: "dgk wallet --json",
		});
		expect(model.units.map((unit) => unit.id)).toEqual(["capabilities", "wallet"]);
		expect(model.units.every((unit) => unit.owner === "examples/wallet-t2")).toBe(true);
		expect(JSON.stringify(model)).not.toContain("apps/refarm");
		expect(model.units.find((unit) => unit.id === "wallet")).toMatchObject({
			state: "degraded",
			severity: "warning",
			summary: "Wallet has 3 held items; 1 item needs review.",
		});
		expect(model.nextCommands).toEqual([
			"dgk wallet --json",
			"dgk records correct record:cred-assinatura verified --apply",
		]);
	});

	it("declares a white-label host as the extension boundary", () => {
		const host = buildWalletHost();
		expect(host.program().name()).toBe("dgk");
		expect(host.registry().list().map((entry) => entry.name)).toEqual(
			expect.arrayContaining(["source", "records", "vault", "wallet", "status", "actions"]),
		);
		expect(host.baseModel()).toMatchObject({
			command: "dgk",
			operation: "base",
			nextCommand: "dgk wallet --json",
		});
		expect(host.surfaceActions().map((action) => action.id)).toEqual([
			"open-wallet",
			"verify-draft-credential",
		]);
	});

	it("shows the citizen's held items as a product view", async () => {
		const env = await runVerb(buildRegistry(), "wallet");
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
		expect(corrected.nextCommand).toBe("dgk records list");
		expect(corrected.nextCommands).toEqual(["dgk records list"]);

		// Now all three items are verified — the wallet's verified group holds all.
		const env = await runVerb(reg, "wallet");
		expect((env.byState as Record<string, number>).verified).toBe(3);
	});

	it("persists citizen curation across separate CLI processes when state is configured", async () => {
		const statePath = tempStatePath();
		const corrected = await runGroup(buildRegistry({ statePath }), "records", [
			"correct",
			"record:cred-assinatura",
			"verified",
			"--apply",
		]);
		expect(corrected.persisted).toBe(true);
		expect(corrected.nextCommand).toBe("dgk records list");
		expect(corrected.nextCommands).toEqual(["dgk records list"]);

		const env = await runVerb(buildRegistry({ statePath }), "wallet");
		expect((env.byState as Record<string, number>).verified).toBe(3);
		const model = buildWalletBaseModel({ statePath });
		expect(model.units.find((unit) => unit.id === "wallet")).toMatchObject({
			state: "ready",
			severity: "info",
			summary: "Wallet has 3 held items.",
		});
		expect(model.nextCommands).toEqual(["dgk wallet --json"]);
	});
});
