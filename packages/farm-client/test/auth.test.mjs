import assert from "node:assert/strict";
import { test } from "node:test";
import { farmAuthHeaders } from "../src/auth.mjs";

test("no FARM_TOKEN → empty headers (an ungated farm is unaffected)", () => {
	assert.deepEqual(farmAuthHeaders({}), {});
	assert.deepEqual(farmAuthHeaders({ FARM_TOKEN: "" }), {});
	assert.deepEqual(farmAuthHeaders({ FARM_TOKEN: "   " }), {});
});

test("FARM_TOKEN → a Bearer authorization header, trimmed", () => {
	assert.deepEqual(farmAuthHeaders({ FARM_TOKEN: "dev-token" }), {
		authorization: "Bearer dev-token",
	});
	assert.deepEqual(farmAuthHeaders({ FARM_TOKEN: "  spaced  " }), {
		authorization: "Bearer spaced",
	});
});
