import { describe, expect, it } from "vitest";

import { composeWalletDefaultOptions } from "./cli.js";

/**
 * Regression guard for the sovereign-persistence bug: the wallet's default options come from a
 * *resolver thunk* (it reads the state-path env at call time). The sovereign path used to spread
 * that thunk — `{ ...resolver, ...sovereign }` — which yields no own keys, so `statePath` vanished
 * and `DGK_SOVEREIGN=1` reported `persisted: true` while writing nothing. These tests pin that the
 * composed options always carry a `statePath`, on both branches.
 */
describe("composeWalletDefaultOptions", () => {
	const base = () => ({ statePath: "/tmp/wallet.manifest.json" });

	it("preserves statePath on the plain (non-sovereign) branch", () => {
		const resolved = composeWalletDefaultOptions(base)();
		expect(resolved.statePath).toBe("/tmp/wallet.manifest.json");
	});

	it("preserves statePath AND layers the sovereign backing", () => {
		const credentialsProvider = { marker: "sovereign-creds" } as never;
		const identity = { marker: "sovereign-identity" } as never;
		const resolved = composeWalletDefaultOptions(base, { credentialsProvider, identity })();

		// The bug: without composition, statePath was dropped here.
		expect(resolved.statePath).toBe("/tmp/wallet.manifest.json");
		expect(resolved.credentialsProvider).toBe(credentialsProvider);
		expect(resolved.identity).toBe(identity);
	});

	it("re-reads the base resolver on every call (lazy env resolution is preserved)", () => {
		let calls = 0;
		const counting = () => ({ statePath: `/tmp/state-${++calls}.json` });
		const resolve = composeWalletDefaultOptions(counting);
		expect(resolve().statePath).toBe("/tmp/state-1.json");
		expect(resolve().statePath).toBe("/tmp/state-2.json");
	});
});
