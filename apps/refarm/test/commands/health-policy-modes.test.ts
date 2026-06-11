import { describe, expect, it } from "vitest";
import { healthCommand } from "../../src/commands/health.js";

describe("health policy modes", () => {
	it("rejects ambiguous policy mode combinations", async () => {
		await expect(
			healthCommand.parseAsync([
				"--policy",
				"--apply-suggested-policy",
				"--json",
			], { from: "user" }),
		).rejects.toThrow(
			"Choose only one health policy mode: --policy, --suggest-policy, or --apply-suggested-policy.",
		);
	});
});
