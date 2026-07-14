import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildRegistry } from "./cli.js";
import { createGovernanceAuditCapability, readAuditTrail } from "./live-audit.js";

describe("governance-audit — the runtime audit trail parser (no daemon)", () => {
	it("parses only host-effect lines from a scarecrow-audit.ndjson", () => {
		const dir = mkdtempSync(path.join(os.tmpdir(), "audit-parse-"));
		writeFileSync(
			path.join(dir, "scarecrow-audit.ndjson"),
			[
				JSON.stringify({ ts: 1, event: "host-effect:fs:read", plugin_id: "agent", path: "/x" }),
				JSON.stringify({ ts: 2, event: "agent:route", plugin_id: "agent" }), // NOT a host effect
				JSON.stringify({ ts: 3, event: "host-effect:shell:spawn", plugin_id: "agent" }),
				"not json",
				"",
			].join("\n"),
		);
		const trail = readAuditTrail(dir);
		expect(trail.map((l) => l.event)).toEqual(["host-effect:fs:read", "host-effect:shell:spawn"]);
		expect(trail[0]?.pluginId ?? trail[0]?.plugin_id).toBe("agent");
	});

	it("returns [] when the audit file is absent", () => {
		expect(readAuditTrail(mkdtempSync(path.join(os.tmpdir(), "audit-empty-")))).toEqual([]);
	});

	it("is mounted with a governance section + IDE command", () => {
		const verb = buildRegistry().get("governance-audit");
		if (!verb || "actions" in verb) throw new Error("governance-audit not mounted");
		expect(verb.summary).toContain("audit trail");
		const ide = verb.renderers?.ide as { command?: string } | undefined;
		expect(ide?.command).toBe("dgk.governance-audit");
	});
});
