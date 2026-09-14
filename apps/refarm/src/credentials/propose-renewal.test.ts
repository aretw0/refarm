import { describe, expect, it } from "vitest";

import { proposeRenewal, RENEWAL_EVERY_SECONDS } from "./propose-renewal.js";

const BIN = "/home/op/.local/bin/refarm";

describe("proposeRenewal", () => {
	it("proposes for a provider whose token expires and nothing renews", () => {
		expect(proposeRenewal("github-copilot", [], BIN)).toMatchObject({
			kind: "propose",
			name: "credential-renew",
			command: `${BIN} credential renew`,
			everySeconds: RENEWAL_EVERY_SECONDS,
		});
	});

	it("stays quiet for a provider that does not expire on a clock", () => {
		// An api-key provider has nothing to renew. Proposing a timer for it would be a process
		// that runs forever and does nothing, which is worse than silence.
		expect(proposeRenewal("anthropic", [], BIN).kind).toBe("not-needed");
	});

	it("stays quiet when something already renews, and names it", () => {
		const outcome = proposeRenewal(
			"github-copilot",
			[{ name: "warden", command: ["refarm", "credential", "renew"] }],
			BIN,
		);
		expect(outcome).toMatchObject({ kind: "not-needed" });
		expect("because" in outcome && outcome.because).toContain("warden");
	});

	it("refuses to propose a command it cannot name", () => {
		// A unit naming a binary the supervisor cannot find fails at boot, silently, in exactly
		// the way a supervised process is prone to. Nothing beats a broken declaration.
		expect(proposeRenewal("github-copilot", [], "   ").kind).toBe("not-needed");
	});

	it("uses an interval that FITS INSIDE the refresh margin rather than tying with it", () => {
		// The stored expiry already sits five minutes before the provider's deadline. A check
		// every five minutes renews, in the worst case, exactly at the wire.
		expect(RENEWAL_EVERY_SECONDS).toBeLessThan(5 * 60);
	});
});
