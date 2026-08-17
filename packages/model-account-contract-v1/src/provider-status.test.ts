import { describe, expect, it } from "vitest";

import { explainRefusal, latestIncidentNote, readProviderStatus } from "./provider-status.js";

/**
 * RECORDED, not invented. This is GitHub's `summary.json` as it read on 2026-08-17 at ~19:5x UTC,
 * while a Copilot token exchange was answering 403 and refarm was telling the operator that GitHub
 * "may only honour known integration ids" — sending him to re-register an identity three times
 * against an endpoint the provider had publicly turned off.
 */
const GITHUB_DURING_INCIDENT = {
	status: { description: "Partial System Outage" },
	components: [
		{ name: "API Requests", status: "operational" },
		{ name: "Git Operations", status: "operational" },
		{ name: "Issues", status: "degraded_performance" },
		{ name: "Copilot", status: "major_outage", updated_at: "2026-08-17T19:13:00Z" },
	],
	incidents: [
		{
			name: "Incident with GitHub.com",
			impact: "critical",
			components: [{ name: "Copilot", status: "major_outage" }],
			incident_updates: [
				{
					status: "investigating",
					body: "We are continuing to investigate sporadic authentication failures. We have partially disabled authentication token retries.",
				},
			],
		},
	],
};

const GITHUB_HEALTHY = {
	status: { description: "All Systems Operational" },
	components: [
		{ name: "API Requests", status: "operational" },
		{ name: "Copilot", status: "operational" },
	],
	incidents: [],
};

describe("readProviderStatus", () => {
	it("reads a declared outage as IMPAIRED, in the provider's own words", () => {
		expect(readProviderStatus(GITHUB_DURING_INCIDENT, "Copilot")).toMatchObject({
			health: "impaired",
			summary: "Copilot is major outage",
		});
	});

	it("reads a healthy component as operational", () => {
		expect(readProviderStatus(GITHUB_HEALTHY, "Copilot").health).toBe("operational");
	});

	it("does not let a HEALTHY sibling answer for the one that is down", () => {
		// `API Requests` was operational throughout the incident while Copilot was in major outage —
		// reading the wrong component would have confirmed exactly the wrong conclusion.
		expect(readProviderStatus(GITHUB_DURING_INCIDENT, "API Requests").health).toBe("operational");
	});

	it("matches a component name EXACTLY, never by substring", () => {
		const doc = { components: [{ name: "Copilot Workspace", status: "operational" }] };
		// "Copilot" must not be answered by "Copilot Workspace" being fine.
		expect(readProviderStatus(doc, "Copilot").health).toBe("unknown");
	});

	it("says UNKNOWN when nobody could be asked, which is NOT operational", () => {
		// The distinction matters most exactly when the network is the broken thing: a status check
		// that could not run must not license the conclusion it exists to prevent.
		expect(readProviderStatus(undefined, "Copilot").health).toBe("unknown");
		expect(readProviderStatus({}, "Copilot").health).toBe("unknown");
		expect(readProviderStatus({ components: "nope" }, "Copilot").health).toBe("unknown");
	});

	it("treats maintenance as impaired, because a request refused during it says nothing either", () => {
		const doc = { components: [{ name: "Copilot", status: "under_maintenance" }] };
		expect(readProviderStatus(doc, "Copilot").health).toBe("impaired");
	});
});

describe("latestIncidentNote", () => {
	it("returns the provider's own most recent words for a component it touches", () => {
		const note = latestIncidentNote(GITHUB_DURING_INCIDENT, "Copilot");
		expect(note).toContain("Incident with GitHub.com");
		expect(note).toContain("authentication token retries");
	});

	it("returns nothing for a component no incident touches", () => {
		expect(latestIncidentNote(GITHUB_DURING_INCIDENT, "Actions")).toBeUndefined();
		expect(latestIncidentNote(GITHUB_HEALTHY, "Copilot")).toBeUndefined();
	});
});

describe("explainRefusal", () => {
	it("tells an operator to WAIT when the provider declared trouble", () => {
		// The sentence is the deliverable. The same HTTP 403 produced "re-register your identity"
		// three times; this one produces "wait".
		const text = explainRefusal(
			readProviderStatus(GITHUB_DURING_INCIDENT, "Copilot"),
			403,
			latestIncidentNote(GITHUB_DURING_INCIDENT, "Copilot"),
		);
		expect(text).toMatch(/DECLARED trouble/u);
		expect(text).toMatch(/says nothing about this node/u);
		expect(text).toMatch(/authentication token retries/u);
	});

	it("says the refusal IS about this node when the provider reports itself fine", () => {
		const text = explainRefusal(readProviderStatus(GITHUB_HEALTHY, "Copilot"), 403);
		expect(text).toMatch(/about this node or its credential/u);
	});

	it("says UNMEASURED when the status could not be consulted, and never guesses", () => {
		const text = explainRefusal({ health: "unknown" }, 403);
		expect(text).toMatch(/UNMEASURED/u);
		expect(text).not.toMatch(/about this node or its credential/u);
	});
});
