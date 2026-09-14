import { describe, expect, it } from "vitest";

import { EXPIRING_PROVIDERS, renewalCoverage } from "./credential-renewal.js";

/**
 * WHY A NODE SHOULD NOT LEARN THIS BY DYING.
 *
 * Measured 2026-08-19: a node that had been up a day answered every dispatch with `token expired`.
 * The credential renews, the host re-reads it, and a command hands it over — but only if something
 * RUNS that command. Leaving each operator to discover the requirement by having their node stop
 * working is the failure this check exists to prevent.
 *
 * It reports. It does not declare: writing a timer that talks to a provider every few minutes into
 * someone's machine is an operator's decision, and the node's job is to make sure they are making
 * it deliberately rather than discovering it.
 */
const copilot = { provider: "github-copilot", alias: "corporativo" };
const anthropic = { provider: "anthropic", alias: "api" };
const renewer = { name: "credential-warden", command: ["refarm", "credential", "renew"] };

describe("renewalCoverage", () => {
	it("says UNNEEDED when this node holds nothing that expires", () => {
		// An api-key provider has no short-lived token to renew. Reporting a gap here would be a
		// finding about nothing, and a node full of those is a node whose findings get skimmed.
		expect(renewalCoverage([anthropic], [])).toMatchObject({ state: "unneeded" });
	});

	it("says UNCOVERED when an expiring credential is held and nothing renews it", () => {
		const coverage = renewalCoverage([copilot, anthropic], []);
		expect(coverage).toMatchObject({ state: "uncovered" });
		expect(coverage.providers).toEqual(["github-copilot"]);
	});

	it("says COVERED when a declared process runs the renewal", () => {
		expect(renewalCoverage([copilot], [renewer])).toMatchObject({ state: "covered" });
	});

	it("recognises the renewal however the command was spelled", () => {
		// A declaration is a string an operator wrote. Matching one exact array shape would report
		// a gap on a node that is perfectly covered — the worst kind of false finding, because the
		// fix it suggests is already in place.
		for (const command of [
			["refarm", "credential", "renew"],
			["/home/op/.local/bin/refarm", "credential", "renew", "--json"],
			"refarm credential renew",
		]) {
			expect(renewalCoverage([copilot], [{ name: "w", command }]).state, JSON.stringify(command)).toBe(
				"covered",
			);
		}
	});

	it("does not accept a DIFFERENT credential command as coverage", () => {
		// `credential list` runs and renews nothing. Accepting any credential subcommand would
		// report covered on a node that still dies daily.
		expect(renewalCoverage([copilot], [{ name: "w", command: ["refarm", "credential", "list"] }]).state).toBe(
			"uncovered",
		);
	});

	it("names the providers whose tokens expire, so the list can be re-checked", () => {
		expect(EXPIRING_PROVIDERS).toContain("github-copilot");
	});
});
