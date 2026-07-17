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

	async function consentState(registry: CapabilityRegistry): Promise<{ pendingCount: number; authorizationCount: number }> {
		return (await (registry.get("consent") as { run: (i: unknown) => Promise<unknown> }).run({
			args: {},
			options: {},
			json: true,
		})) as { pendingCount: number; authorizationCount: number };
	}

	it("clicking Authorize turns the prompt into a granted, revocable authorization", async () => {
		const { mount, registry } = await mountWithPending();
		mount.querySelector<HTMLElement>('[data-refarm-surface-action-id="authorization-authorize"]')!.click();
		// The pending prompt's Authorize control disappears (the request is granted) …
		await vi.waitFor(() =>
			expect(mount.querySelector('[data-refarm-surface-action-id="authorization-authorize"]')).toBeNull(),
		);
		// … and the authorization now shows in the granted list with a Revoke control.
		expect(mount.querySelector('[data-refarm-surface-action-id="authorization-revoke"]')).toBeTruthy();
		expect(mount.textContent).toContain("Loja Fictícia"); // still there — now as a granted authorization
		const after = await consentState(registry);
		expect(after.pendingCount).toBe(0);
		expect(after.authorizationCount).toBe(1);
	});

	it("clicking Revoke on a granted authorization revokes it (the control disappears)", async () => {
		const { mount } = await mountWithPending();
		// Grant it first, then revoke it.
		mount.querySelector<HTMLElement>('[data-refarm-surface-action-id="authorization-authorize"]')!.click();
		await vi.waitFor(() =>
			expect(mount.querySelector('[data-refarm-surface-action-id="authorization-revoke"]')).toBeTruthy(),
		);
		mount.querySelector<HTMLElement>('[data-refarm-surface-action-id="authorization-revoke"]')!.click();
		// Revoked → the Revoke control is gone and the status reads "Revogada".
		await vi.waitFor(() =>
			expect(mount.querySelector('[data-refarm-surface-action-id="authorization-revoke"]')).toBeNull(),
		);
		expect(mount.textContent).toContain("Revogada");
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
