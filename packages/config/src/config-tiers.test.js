import { describe, expect, it } from "vitest";

import {
	CONFIG_KEY_OWNERSHIP,
	CONFIG_REQUEST_BLOCK_KEY,
	auditConfigTier,
	classifyConfigKey,
	pendingRequests,
} from "./config-tiers.js";

describe("classifyConfigKey — three states, never two", () => {
	it("names the owner of a key the table declares", () => {
		const verdict = classifyConfigKey("approvedPermissions");
		expect(verdict.state).toBe("known");
		expect(verdict.owner).toBe("node");
		expect(verdict.requestable).toBe(true);
	});

	// The failure mode this guards: a capability key added next quarter is workspace-declarable
	// on the day it ships, because "not in the table" read as "allowed".
	it("reports an unnamed key as unknown rather than allowed or forbidden", () => {
		expect(classifyConfigKey("somethingNobodyClassified")).toEqual({
			state: "unknown",
			key: "somethingNobodyClassified",
		});
	});

	it("every entry carries a reason a reader can re-check", () => {
		for (const [key, entry] of Object.entries(CONFIG_KEY_OWNERSHIP)) {
			expect(entry.reason.split(" ").length >= 5, `${key} needs a reason, not a label`).toBeTruthy();
			expect(["node", "workspace"].includes(entry.owner), `${key} has an unknown owner`).toBeTruthy();
		}
	});
});

describe("auditConfigTier — the privilege boundary", () => {
	// The live case, measured 2026-08-10: this repository's own .refarm/config.json carries
	// approvedPermissions, spawnEnv, connections, surfaces and trusted_plugins — every one of
	// them node-owned. The Rust host enforces the first two.
	it("drops a node-owned capability key declared by a workspace, at HIGH severity", () => {
		const audit = auditConfigTier(
			{ approvedPermissions: { "@refarm/lsp-code-ops": ["fs:read", "fs:write"] }, health: {} },
			"workspace",
		);
		expect(audit.dropped).toEqual(["approvedPermissions"]);
		expect(Object.keys(audit.kept)).toEqual(["health"]);
		expect(audit.findings[0].severity).toBe("high");
		expect(audit.findings[0].problem).toBe("wrong-tier");
		expect(audit.findings[0].message).toMatch(/states this as a NEED/);
	});

	// Fail open for availability: the node keeps booting with a wrong config. An operator whose
	// daily driver refuses to start over a stray key fixes it by deleting the guard.
	it("keeps every key the tier does own, so a wrong key never costs a working node", () => {
		const audit = auditConfigTier({ health: { ignoredGitVisibilityPatterns: ["dist"] } }, "workspace");
		expect(audit.dropped).toEqual([]);
		expect(audit.findings).toEqual([]);
		expect(audit.kept.health).toBeTruthy();
	});

	it("keeps an unclassified key but says nothing knows who owns it", () => {
		const audit = auditConfigTier({ brandNewKey: 1 }, "node");
		expect(audit.dropped).toEqual([]);
		expect(audit.kept.brandNewKey).toBe(1);
		expect(audit.findings[0].problem).toBe("unclassified-key");
		expect(audit.findings[0].severity).toBe("warning");
	});

	it("a workspace-owned key in the node tier is dropped too — the boundary runs both ways", () => {
		const audit = auditConfigTier({ health: {} }, "node");
		expect(audit.dropped).toEqual(["health"]);
	});

	// No default tier, ever: a default is the untagged read this whole module exists to end.
	it("refuses to audit without being told which tier it is looking at", () => {
		expect(() => auditConfigTier({}, undefined)).toThrow(/Unknown config tier/);
		expect(() => auditConfigTier({}, "user")).toThrow(/Unknown config tier/);
	});
});

describe("requests — a workspace states a need, it never holds a grant", () => {
	it("accepts a requestable key and never composes it into effective config", () => {
		const audit = auditConfigTier(
			{ [CONFIG_REQUEST_BLOCK_KEY]: { approvedPermissions: { "@refarm/x": ["fs:read"] } } },
			"workspace",
		);
		expect(audit.findings).toEqual([]);
		expect(audit.requests.approvedPermissions).toBeTruthy();
		expect(audit.kept[CONFIG_REQUEST_BLOCK_KEY], "a request must never reach effective config").toBe(undefined);
	});

	it("refuses a request for a key that has no meaning from a workspace", () => {
		const audit = auditConfigTier({ [CONFIG_REQUEST_BLOCK_KEY]: { surfaces: {} } }, "workspace");
		expect(audit.findings[0].problem).toBe("not-requestable");
		expect(audit.requests.surfaces).toBe(undefined);
	});

	it("a node that asks instead of granting is reported", () => {
		const audit = auditConfigTier({ [CONFIG_REQUEST_BLOCK_KEY]: { spawnEnv: {} } }, "node");
		expect(audit.findings[0].problem).toBe("requests-outside-workspace");
	});
});

describe("pendingRequests — the onboarding queue", () => {
	it("lists what the operator has not decided yet", () => {
		const pending = pendingRequests(
			{ [CONFIG_REQUEST_BLOCK_KEY]: { approvedPermissions: { "@refarm/x": ["fs:read"] }, delivery: {} } },
			{ delivery: { telegram: {} } },
		);
		expect(pending.map((entry) => entry.key)).toEqual(["approvedPermissions"]);
	});

	// Granting and REFUSING are both decisions. Re-asking a decided question is how an operator
	// learns to approve without reading.
	it("an answered request is not pending, whatever the answer was", () => {
		const pending = pendingRequests(
			{ [CONFIG_REQUEST_BLOCK_KEY]: { trusted_plugins: ["x"] } },
			{ trusted_plugins: [] },
		);
		expect(pending).toEqual([]);
	});

	it("no request block means nothing is pending", () => {
		expect(pendingRequests({ health: {} }, {})).toEqual([]);
	});
});
