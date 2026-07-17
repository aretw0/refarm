// @vitest-environment jsdom
import type { CapabilityRegistry } from "@refarm.dev/capabilities";
import { createWalletCapabilities, walletCapabilityBundle } from "@refarm.dev/wallet";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mountConsentJourney } from "./consent-journey.js";

// Build the consent-journey verbs directly from the wallet block (fixture-backed, no WASM) —
// the CLI's buildRegistry eagerly imports the sovereign WASM signer, which can't load under jsdom.
const dirs: string[] = [];
afterEach(() => {
	dirs.length = 0;
});

function consentRegistry(): CapabilityRegistry {
	const statePath = join(mkdtempSync(join(tmpdir(), "dgk-consent-web-")), "state.json");
	dirs.push(statePath);
	const bundle = walletCapabilityBundle({ statePath });
	const verbs = createWalletCapabilities(bundle.records, {
		credentialsProvider: bundle.credentialsProvider,
		identity: bundle.identity,
		authorizationProvider: bundle.authorizationProvider,
	});
	const byName = new Map(verbs.map((v) => [v.name, v]));
	return { get: (name: string) => byName.get(name) } as unknown as CapabilityRegistry;
}

/** Seed one pending request through the real `request` verb, then mount the journey. */
async function mountWithPending(): Promise<{ mount: HTMLElement; registry: CapabilityRegistry }> {
	const registry = consentRegistry();
	const request = registry.get("request");
	if (!request || !("run" in request)) throw new Error("request verb not mounted");
	await request.run({
		args: { requester: "Loja Fictícia" },
		options: { purpose: "Confirmar maioridade", scope: "faixa_etaria", expires: "2026-12-31T00:00:00Z" },
		json: true,
	});
	const mount = document.createElement("div");
	document.body.appendChild(mount);
	await mountConsentJourney(registry, mount);
	return { mount, registry };
}

describe("consent journey web controller — the T2-F7 decision is LIVE", () => {
	it("renders the pending request as a prompt with the Authorize control", async () => {
		const { mount } = await mountWithPending();
		expect(mount.querySelector('[data-refarm-surface-action-id="authorization-authorize"]')).toBeTruthy();
		expect(mount.textContent).toContain("Loja Fictícia");
		expect(mount.textContent).toContain("faixa_etaria");
	});

	it("clicking Authorize grants the pending request and it disappears from the screen", async () => {
		const { mount, registry } = await mountWithPending();
		mount.querySelector<HTMLElement>('[data-refarm-surface-action-id="authorization-authorize"]')!.click();
		// The prompt disappears once the async grant + re-render settles.
		await vi.waitFor(() => expect(mount.textContent).not.toContain("Loja Fictícia"));
		// And it is genuinely granted — the pending queue is empty.
		const consent = registry.get("consent");
		const after = (await (consent as { run: (i: unknown) => Promise<unknown> }).run({
			args: {},
			options: {},
			json: true,
		})) as { pendingCount: number };
		expect(after.pendingCount).toBe(0);
	});

	it("clicking Decline removes the pending request (the sovereign no)", async () => {
		const { mount, registry } = await mountWithPending();
		mount.querySelector<HTMLElement>("[data-consent-decline]")!.click();
		await vi.waitFor(() => expect(mount.textContent).not.toContain("Loja Fictícia"));
		const after = (await (registry.get("consent") as { run: (i: unknown) => Promise<unknown> }).run({
			args: {},
			options: {},
			json: true,
		})) as { pendingCount: number };
		expect(after.pendingCount).toBe(0);
	});
});
