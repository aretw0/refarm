import { describe, expect, it } from "vitest";

import {
	copilotApiBaseUrl,
	copilotRefreshMargin,
	parseCopilotTokenFields,
	REFRESH_MARGIN_MS,
} from "./github-copilot-wire.js";

/**
 * THE UNDOCUMENTED WIRE, PINNED.
 *
 * GitHub publishes no model API billed against a Copilot subscription — confirmed on its own
 * community forum, which says there is no supported public endpoint and that the editor talks to
 * internal ones. So this shape is read from behaviour, not from a contract, and the only honest way
 * to depend on it is to state it explicitly and let a test fail the day it moves.
 *
 * These are pure: no network, no credential, no login. They are what a spike needs to exist before
 * it can measure anything.
 */
describe("parseCopilotTokenFields", () => {
	it("reads the semicolon-delimited pairs the token is made of", () => {
		const fields = parseCopilotTokenFields("tid=abc;exp=1700000000;proxy-ep=proxy.individual.githubcopilot.com;chat=1");
		expect(fields.get("proxy-ep")).toBe("proxy.individual.githubcopilot.com");
		expect(fields.get("exp")).toBe("1700000000");
	});

	it("returns an empty map for a token that is not in that shape", () => {
		// A token whose shape changed is not a token with no proxy: the caller must be able to tell
		// "no endpoint advertised" from "I could not read this at all".
		expect(parseCopilotTokenFields("opaque-blob").size).toBe(0);
		expect(parseCopilotTokenFields("").size).toBe(0);
	});
});

describe("copilotApiBaseUrl", () => {
	it("derives the API host from the endpoint the TOKEN advertises", () => {
		// The token carries its own routing. Hardcoding a host would send an enterprise operator's
		// traffic to the individual endpoint, or the reverse.
		expect(
			copilotApiBaseUrl("tid=x;proxy-ep=proxy.individual.githubcopilot.com", undefined),
		).toEqual({ kind: "from-token", baseUrl: "https://api.individual.githubcopilot.com" });
	});

	it("falls back to the ENTERPRISE host when the token advertises nothing", () => {
		expect(copilotApiBaseUrl("opaque", "company.ghe.com")).toEqual({
			kind: "from-enterprise-domain",
			baseUrl: "https://copilot-api.company.ghe.com",
		});
	});

	it("falls back to the individual host, and SAYS that it is a fallback", () => {
		// THREE STATES. A caller that cannot tell a token-advertised endpoint from a guessed one
		// cannot report why a request went where it went — and this endpoint is undocumented, so the
		// day the guess is wrong is a day someone has to debug it.
		expect(copilotApiBaseUrl("opaque", undefined)).toEqual({
			kind: "assumed-individual",
			baseUrl: "https://api.individual.githubcopilot.com",
		});
	});
});

describe("copilotRefreshMargin", () => {
	it("renews BEFORE expiry, by a margin, so an in-flight request does not race the clock", () => {
		const expiresAtSeconds = 1_700_000_000;
		expect(copilotRefreshMargin(expiresAtSeconds)).toBe(expiresAtSeconds * 1000 - REFRESH_MARGIN_MS);
	});

	it("never returns a moment in the past relative to the raw expiry", () => {
		expect(copilotRefreshMargin(0)).toBeLessThan(0);
		expect(REFRESH_MARGIN_MS).toBeGreaterThan(0);
	});
});
