import { describe, expect, it } from "vitest";

import { defaultWranglerBin } from "./provider.js";

/**
 * MEASURED 2026-08-19, on the last mile of making this node runnable from an INSTALLED copy:
 *
 *   ✗  Cannot find module 'wrangler/package.json'
 *
 * `wrangler` is a devDependency, and this module resolved it at LOAD TIME — so importing the
 * package at all required a dependency that production installs deliberately omit, on a node that
 * may never touch Cloudflare.
 *
 * The repository already draws this line elsewhere: the delivery adapter registry is imported only
 * when a channel is declared, "which is what makes the undeclared delivery path free rather than
 * merely quiet". An optional capability must not make its dependency mandatory.
 */
describe("defaultWranglerBin", () => {
	it("resolves the bundled wrangler when it is installed", () => {
		// In this workspace it IS installed, so the happy path must keep working — the point is
		// to move WHEN it resolves, never to stop resolving.
		const resolved = defaultWranglerBin();
		expect(resolved).toMatch(/wrangler/u);
		expect(resolved.endsWith("wrangler.js")).toBe(true);
	});

	it("REFUSES with a sentence naming what to install, rather than a resolver stack trace", () => {
		// The failure an operator would actually meet on a production install. `Cannot find module
		// 'wrangler/package.json'` names a file nobody chose; this names the decision.
		const refusal = () =>
			defaultWranglerBin(() => {
				throw new Error("Cannot find module 'wrangler/package.json'");
			});
		expect(refusal).toThrowError(/wrangler/u);
		expect(refusal).toThrowError(/install|--wrangler|wranglerBin/iu);
	});
});
