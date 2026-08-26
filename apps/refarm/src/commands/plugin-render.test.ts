import { describe, expect, it } from "vitest";
import type { CapabilityEnvelope } from "@refarm.dev/capabilities";
import { formatStatusFromEnvelope } from "./plugin-render.js";
import type { RuntimePluginStatusReport } from "./plugin-shared.js";

/**
 * `formatStatusFromEnvelope` is the LIVE text projection of `plugin status`
 * (wired via `pluginCapabilityHooks("status")` ← `capability-registry.ts`) —
 * unlike `printRuntimePluginStatus` (plugin-runtime.ts), which had zero callers
 * anywhere in the repo and was deleted rather than left to drift from this one.
 * This is the surface an operator actually reads in a terminal, so the `development`
 * fact — the declaration that waives an absent integrity claim at load — must be
 * visible HERE, not just in `--json`.
 */
function baseReport(
	plugins: RuntimePluginStatusReport["plugins"],
): RuntimePluginStatusReport {
	return {
		command: "plugin",
		operation: "status",
		ok: true,
		available: true,
		plugins,
		nextAction: null,
		nextActions: [],
		nextCommand: null,
		nextCommands: [],
	};
}

describe("formatStatusFromEnvelope", () => {
	it("renders a DEV column distinguishing a declared-under-development plugin from an undeclared one", () => {
		const report = baseReport([
			{
				id: "@refarm/agent",
				runtimeId: "agent",
				manifestId: "@refarm/agent",
				dir: "/p/refarm_agent",
				requested: true,
				loaded: true,
				installed: true,
				integrity: "absent",
				known: true,
				development: true,
			},
			{
				id: "@refarm/lsp-code-ops",
				runtimeId: "lsp-code-ops",
				manifestId: "@refarm/lsp-code-ops",
				dir: "/p/refarm_lsp-code-ops",
				requested: true,
				loaded: true,
				installed: true,
				integrity: "matches",
				known: true,
				development: false,
			},
		]);

		const text = formatStatusFromEnvelope(report as unknown as CapabilityEnvelope);
		const lines = text.split("\n");

		// The header must name the column at all — a table with the fact in the data but not
		// the header is not readable as a column.
		const header = lines[0];
		expect(header).toContain("DEV");

		const agentLine = lines.find((l) => l.includes("@refarm/agent"));
		const lspLine = lines.find((l) => l.includes("@refarm/lsp-code-ops"));
		expect(agentLine).toBeDefined();
		expect(lspLine).toBeDefined();

		// The two rows must be TEXTUALLY DISTINGUISHABLE on this fact — the declared plugin
		// reads "yes", the undeclared one reads "no". A renderer that dropped `development`
		// from the row (leaving only the header) would make these two lines identical apart
		// from the id/integrity columns already covered elsewhere; this pins the DEV cell too.
		expect(agentLine).not.toEqual(lspLine);
		expect(agentLine).toMatch(/\byes\b/);
	});

	it("prints the runtime-unavailable recovery block, not a plugin table, when the runtime is not ready", () => {
		const report: RuntimePluginStatusReport = {
			command: "plugin",
			operation: "status",
			ok: false,
			available: false,
			plugins: [],
			nextAction: null,
			nextActions: [],
			nextCommand: null,
			nextCommands: [],
		};
		const text = formatStatusFromEnvelope(report as unknown as CapabilityEnvelope);
		expect(text).toContain("Refarm runtime plugin status is unavailable.");
	});
});
