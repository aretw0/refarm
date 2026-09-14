import { describe, expect, it } from "vitest";

import { credentialExpiry, credentialStaleness } from "./ask-credential-staleness.js";

const NOW = 1_787_000_000_000;
const at = (offsetMinutes: number) => ({ expires: NOW + offsetMinutes * 60_000 });

describe("credentialStaleness", () => {
	it("says how long a live credential has left", () => {
		expect(credentialStaleness(at(90), NOW)).toEqual({ state: "fresh", minutesLeft: 90 });
	});

	it("names an expired credential as EXPIRED, and says the runtime cannot pick up a new one", () => {
		// The whole point. The failure an operator actually saw was `HTTP 401: unauthorized: token
		// expired`, which reads like a revoked credential and sends them to re-authenticate
		// something that is fine. The host was handed this token at boot and reads it from its own
		// process env; only a restart replaces it.
		const verdict = credentialStaleness(at(-30), NOW);
		expect(verdict).toMatchObject({ state: "expired", minutesAgo: 30 });
		expect("because" in verdict && verdict.because).toMatch(/restart the runtime/iu);
		expect("because" in verdict && verdict.because).toMatch(/not the provider refusing/iu);
	});

	it("treats a MISSING expiry as unknown, never as fresh", () => {
		// Absent is not measured. Reporting it as fresh would let a credential that carries no
		// expiry mask exactly this failure.
		expect(credentialStaleness({}, NOW)).toEqual({ state: "unknown" });
		expect(credentialStaleness(null, NOW)).toEqual({ state: "unknown" });
		expect(credentialStaleness({ expires: "soon" }, NOW)).toEqual({ state: "unknown" });
	});

	it("reads the expiry in MILLISECONDS, the unit it is actually stored in", () => {
		// Measured on a real stored credential: `expires` is 1787193667000 — a day ahead in ms,
		// the year 58603 in seconds. The seconds reading shipped first and made this check inert:
		// every credential fresh for fifty thousand years. A guard that cannot fire is worse than
		// no guard, because it reads as coverage.
		const realShape = { expires: 1_787_193_667_000 };
		expect(credentialExpiry(realShape)).toBe(1_787_193_667_000);
		expect(credentialStaleness(realShape, 1_787_193_667_000 + 60_000)).toMatchObject({
			state: "expired",
			minutesAgo: 1,
		});
	});
});
