import { describe, expect, it } from "vitest";
import { resolveNodeFarmSyncToken } from "./node-sync-token.js";

describe("resolveNodeFarmSyncToken", () => {
	it("returns undefined when FARM_TOKEN is unset and no explicit token is given", () => {
		expect(resolveNodeFarmSyncToken(undefined, {})).toBeUndefined();
	});

	it("treats an empty-string FARM_TOKEN as unset", () => {
		expect(resolveNodeFarmSyncToken(undefined, { FARM_TOKEN: "" })).toBeUndefined();
	});

	it("treats a whitespace-only FARM_TOKEN as unset", () => {
		expect(resolveNodeFarmSyncToken(undefined, { FARM_TOKEN: "   " })).toBeUndefined();
	});

	it("defaults to FARM_TOKEN, trimmed, when no explicit token is given", () => {
		expect(resolveNodeFarmSyncToken(undefined, { FARM_TOKEN: "  device-token  " })).toBe(
			"device-token",
		);
	});

	it("an explicit token wins over FARM_TOKEN, even when both are set", () => {
		expect(
			resolveNodeFarmSyncToken("explicit-token", { FARM_TOKEN: "env-token" }),
		).toBe("explicit-token");
	});

	it("an explicit token is used verbatim even when FARM_TOKEN is unset", () => {
		expect(resolveNodeFarmSyncToken("explicit-token", {})).toBe("explicit-token");
	});
});
