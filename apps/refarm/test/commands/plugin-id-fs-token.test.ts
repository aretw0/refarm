import { describe, expect, it } from "vitest";

import { pluginIdToFsToken } from "@refarm.dev/config/plugin-identity";
import { sentinelPath } from "../../src/commands/plugin-shared.js";

/**
 * The filesystem-safe projection's SECURITY contract (containment, `..`/backslash
 * neutralization, metachar collapse) is unit-tested where the primitive lives:
 * packages/config/src/plugin-identity.test.js. Here we only pin the INTEGRATION —
 * that the plugin fs paths route through it, so install-write and read-back agree
 * on one encoding (previously the payload dir used the raw id while the sentinel
 * used a different ad-hoc flatten).
 */
describe("plugin fs paths route through pluginIdToFsToken", () => {
	it("the version sentinel uses the canonical token for a scoped id", () => {
		expect(sentinelPath("@refarm/agent")).toContain(
			pluginIdToFsToken("@refarm/agent"),
		);
		expect(sentinelPath("@refarm/agent")).toContain("refarm_agent");
	});
});
