import assert from "node:assert/strict";
import { test } from "node:test";
import { farmAuthHeaders, farmSyncWsProtocols } from "../src/auth.mjs";

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

test("no FARM_TOKEN → no WS subprotocols offered (an ungated farm's handshake is unchanged)", () => {
	assert.equal(farmSyncWsProtocols({}), undefined);
	assert.equal(farmSyncWsProtocols({ FARM_TOKEN: "" }), undefined);
	assert.equal(farmSyncWsProtocols({ FARM_TOKEN: "   " }), undefined);
});

test("FARM_TOKEN → the sync protocol plus a bearer.<token> subprotocol, trimmed", () => {
	assert.deepEqual(farmSyncWsProtocols({ FARM_TOKEN: "dev-token" }), [
		"refarm-sync-v1",
		"bearer.dev-token",
	]);
	assert.deepEqual(farmSyncWsProtocols({ FARM_TOKEN: "  spaced  " }), [
		"refarm-sync-v1",
		"bearer.spaced",
	]);
});
