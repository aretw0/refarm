import { describe, expect, it } from "vitest";

import { buildHealthRecommendations } from "./health.js";

/**
 * DIAGNOSTICS THAT LEGITIMATELY HAVE NO COMMAND, named one by one.
 *
 * The rule is not "every recommendation must carry a command" — the `nodeTools` branch states
 * the other half: inventing a verb that does not exist puts a DEAD handoff into a list every
 * agent loop in this repo is told to follow. The rule is that the absence must be DELIBERATE.
 *
 * A new command-less failure has to be added here, which is a line in a diff someone reviews,
 * rather than appearing silently as prose with `nextCommands: []` (ISS-173).
 */
const NO_SINGLE_COMMAND_FIXES_THESE = new Set([
	"config_node_invalid",
]);

/** The three arrays `buildHealthRecommendations` maps unconditionally, and nothing else. */
function emptyResults() {
	return { git: [], builds: [], alignment: [] };
}

describe("health recommendations carry a command or say why not", () => {
	it("gives the config-node findings a command an agent can dispatch", () => {
		const recommendations = buildHealthRecommendations({
			...emptyResults(),
			configNode: [
				{ type: "config_node_drift", path: "urn:sovereign:config:workspace" },
				{ type: "config_node_unreachable", path: "urn:sovereign:config:workspace" },
			],
		} as never);
		const byType = new Map(recommendations.map((entry) => [entry.diagnostic, entry]));
		// THE MEASURED DEFECT. On 2026-08-27 a standing drift returned prose naming a fix and an
		// empty command list, so an agent following the handoff was told there was nothing to do.
		expect(byType.get("config_node_drift")?.command).toBeTruthy();
		expect(byType.get("config_node_unreachable")?.command).toBeTruthy();
	});

	it("routes drift at a verb that stays honest on a supervised node", () => {
		const [drift] = buildHealthRecommendations({
			...emptyResults(),
			configNode: [{ type: "config_node_drift", path: "x" }],
		} as never);
		// NOT a systemctl line: this node may have no supervisor, and `runtime restart` either
		// restarts or refuses AND hands over the exact supervisor command. One step either way.
		expect(drift?.command).toContain("runtime restart");
		expect(drift?.command).not.toContain("systemctl");
	});

	it("keeps the command-less exemptions explicit rather than ambient", () => {
		const [invalid] = buildHealthRecommendations({
			...emptyResults(),
			configNode: [{ type: "config_node_invalid", path: "x" }],
		} as never);
		// If someone gives this one a command, the exemption list must shrink in the same diff.
		expect(NO_SINGLE_COMMAND_FIXES_THESE.has(invalid?.diagnostic ?? "")).toBe(
			invalid?.command === undefined,
		);
	});
});
