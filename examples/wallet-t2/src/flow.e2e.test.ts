import { hostCommandOverrideEnv } from "@refarm.dev/capability-host";
import { createCapabilityTestHarness } from "@refarm.dev/capability-host/testing";
import { afterEach, describe, expect, it } from "vitest";

import { DGK_COMMAND, buildRegistry, buildWalletBaseModel, buildWalletHost } from "./cli.js";

const harness = createCapabilityTestHarness({ tempPrefix: "dgk-wallet-state-" });

afterEach(() => {
	harness.cleanup();
});

function tempStatePath(): string {
	return harness.tempStatePath();
}

/**
 * The T2 flow through wallet's own CLI registry: the citizen views their sovereign
 * wallet (result mode — the product, not the machine) and curates an item.
 */
describe("wallet T2 — the sovereign citizen's digital wallet (result mode)", () => {
	it("mounts the neutral chain + the wallet dashboard verbs", () => {
		const names = buildRegistry()
			.list()
			.map((e) => e.name);
		expect(names).toEqual(
			expect.arrayContaining([
				"source",
				"records",
				"vault",
				"wallet",
				// The dashboard breadth — a card per review state, from pure declaration.
				"wallet-verified",
				"wallet-draft",
				"status",
				"actions",
			]),
		);
	});

	it("projects the wallet dashboard into a Homestead web panel of cards (RICH via breadth)", async () => {
		// T2 RESULT mode: the SAME registry becomes a citizen wallet dashboard on the web.
		// The three wallet views (main + verified + draft), all in the "wallet" section,
		// render as DS cards in one panel — richness from declarations, not a hand-rolled UI.
		const { walletWebSurface } = await import("./persona.js");
		const handle = walletWebSurface(buildRegistry());
		const result = (await handle.call?.("renderHomesteadSurface", {})) as { html: string };
		expect(result.html).toContain("Minha Carteira Digital");
		expect(result.html).toContain("wallet");
		expect(result.html).toContain("wallet-verified");
		expect(result.html).toContain("wallet-draft");
		expect(result.html).toContain("refarm-surface-card");
	});

	it("renders the ACTUAL wallet (not just launcher cards) via the content seam", async () => {
		// The web face is a real product, not a menu: the boot runs the `wallet` verb, whose
		// projection carries walletHtml, and feeds it to the surface's content seam. Prove the
		// verb produces the wallet content, and that the surface renders it when given that data.
		const { walletWebSurface, renderWalletHtml } = await import("./persona.js");
		const wallet = buildRegistry().get("wallet");
		if (!wallet || "actions" in wallet) throw new Error("wallet verb not mounted");
		const env = (await wallet.run({ args: {}, options: {}, json: true })) as unknown as {
			total: number;
			walletHtml: string;
		};
		// The verb's projection carries the rendered wallet.
		expect(typeof env.walletHtml).toBe("string");
		expect(env.walletHtml).toContain("Minha Carteira Digital");
		expect(env.walletHtml).toContain("Verificados");
		expect(env.walletHtml).toContain("data-wallet-item");
		expect(env.total).toBeGreaterThan(0);

		// The surface renders that content ABOVE the cards when the host provides it.
		const handle = walletWebSurface(buildRegistry());
		const rendered = (await handle.call?.("renderHomesteadSurface", {
			host: { data: { walletHtml: env.walletHtml } },
		})) as { html: string };
		expect(rendered.html).toContain("data-wallet-html");
		expect(rendered.html).toContain("Verificados");

		// renderWalletHtml is a pure projector — escapes and groups the same way.
		const direct = renderWalletHtml({
			summary: { total: 1, byState: { verified: 1 } },
			groups: [
				{
					key: "verified",
					label: "verified",
					count: 1,
					records: [{ title: "Doc <x>", link: "", review: { state: "verified" } }],
				},
			],
		} as never);
		expect(direct).toContain("Doc &lt;x&gt;"); // HTML-escaped
	});

	it("exposes a base operator model without importing the product app", () => {
		const statePath = tempStatePath();
		const model = buildWalletBaseModel({ statePath });
		expect(model).toMatchObject({
			schemaVersion: 1,
			command: DGK_COMMAND,
			operation: "base",
			ok: true,
			nextCommand: `${DGK_COMMAND} wallet --json`,
		});
		expect(model.units.map((unit) => unit.id)).toEqual(["capabilities", "wallet"]);
		expect(model.units.every((unit) => unit.owner === "examples/wallet-t2")).toBe(true);
		expect(model.units.find((unit) => unit.id === "wallet")).toMatchObject({
			state: "degraded",
			severity: "warning",
			summary: "Wallet has 3 held items; 1 item needs review.",
		});
		expect(model.nextCommands).toEqual([
			`${DGK_COMMAND} wallet --json`,
			`${DGK_COMMAND} records correct record:cred-assinatura verified --apply`,
		]);
	});

	it("declares a white-label host as the extension boundary", () => {
		const statePath = tempStatePath();
		const host = buildWalletHost({ statePath });
		expect(host.program().name()).toBe(DGK_COMMAND);
		expect(
			host
				.registry()
				.list()
				.map((entry) => entry.name),
		).toEqual(
			expect.arrayContaining(["source", "records", "vault", "wallet", "status", "actions"]),
		);
		const walletEntry = host
			.registry()
			.list()
			.find((entry) => entry.name === "wallet");
		expect(walletEntry).toBeTruthy();
		expect(walletEntry).toMatchObject({
			renderers: {
				web: { route: "/wallet", icon: "wallet" },
				tui: expect.any(Object),
			},
		});
		expect(host.baseModel()).toMatchObject({
			command: DGK_COMMAND,
			operation: "base",
			nextCommand: `${DGK_COMMAND} wallet --json`,
		});
		expect(host.surfaceActions().map((action) => action.id)).toEqual([
			"open-wallet",
			"verify-draft-credential",
		]);
	});

	it("supports overriding the host command for white-label use", () => {
		const command = "wallet-white-label";
		const host = buildWalletHost({ statePath: tempStatePath(), command });
		expect(host.program().name()).toBe(command);
		expect(host.baseModel()).toMatchObject({
			command,
			operation: "base",
			nextCommand: `${command} wallet --json`,
		});
	});

	it("supports overriding host command via explicit environment for white-label use", () => {
		const statePath = tempStatePath();
		const command = "wallet-white-label-env";
		const host = buildWalletHost({
			statePath,
			commandEnv: { [hostCommandOverrideEnv(DGK_COMMAND)]: command },
		});
		expect(host.program().name()).toBe(command);
		expect(
			buildWalletBaseModel({
				statePath,
				commandEnv: { [hostCommandOverrideEnv(DGK_COMMAND)]: command },
			}),
		).toMatchObject({
			command,
			nextCommand: `${command} wallet --json`,
		});
		expect(host.baseModel()).toMatchObject({
			command,
			nextCommand: `${command} wallet --json`,
		});
	});

	it("shows the citizen's held items as a product view", async () => {
		const env = await harness.runVerb(buildRegistry({ statePath: tempStatePath() }), "wallet");
		expect(env.ok).toBe(true);
		expect(env.total).toBe(3); // the three wallet items
		const wallet = env.wallet as string;
		expect(wallet).toContain("Minha Carteira Digital");
		expect(wallet).toContain("Documento de identidade");
	});

	it("the citizen curates an item and the wallet reflects it (local-first, their data)", async () => {
		const reg = buildRegistry({ statePath: tempStatePath() });
		// The citizen verifies their draft credential (persists via shared records deps).
		const corrected = await harness.runGroup(reg, "records", [
			"correct",
			"record:cred-assinatura",
			"verified",
			"--apply",
		]);
		expect(corrected.persisted).toBe(true);
		expect(corrected.nextCommand).toBe(`${DGK_COMMAND} records list`);
		expect(corrected.nextCommands).toEqual([`${DGK_COMMAND} records list`]);

		// Now all three items are verified — the wallet's verified group holds all.
		const env = await harness.runVerb(reg, "wallet");
		expect((env.byState as Record<string, number>).verified).toBe(3);
	});

	it("persists citizen curation across separate CLI processes when state is configured", async () => {
		const statePath = tempStatePath();
		const corrected = await harness.runGroup(buildRegistry({ statePath }), "records", [
			"correct",
			"record:cred-assinatura",
			"verified",
			"--apply",
		]);
		expect(corrected.persisted).toBe(true);
		expect(corrected.nextCommand).toBe(`${DGK_COMMAND} records list`);
		expect(corrected.nextCommands).toEqual([`${DGK_COMMAND} records list`]);

		const env = await harness.runVerb(buildRegistry({ statePath }), "wallet");
		expect((env.byState as Record<string, number>).verified).toBe(3);
		const model = buildWalletBaseModel({ statePath });
		expect(model.units.find((unit) => unit.id === "wallet")).toMatchObject({
			state: "ready",
			severity: "info",
			summary: "Wallet has 3 held items.",
		});
		expect(model.nextCommands).toEqual([`${DGK_COMMAND} wallet --json`]);
	});
});
