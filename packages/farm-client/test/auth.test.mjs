import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	farmAuthHeaders,
	farmCredentialStatus,
	farmSyncWsProtocols,
	farmTokenFile,
	removeFarmToken,
	saveFarmToken,
} from "../src/auth.mjs";

const absent = {
	read: () => {
		throw Object.assign(new Error("missing"), { code: "ENOENT" });
	},
	stat: () => {
		throw Object.assign(new Error("missing"), { code: "ENOENT" });
	},
};

test("no FARM_TOKEN → empty headers (an ungated farm is unaffected)", () => {
	assert.deepEqual(farmAuthHeaders({}, absent), {});
	assert.deepEqual(farmAuthHeaders({ FARM_TOKEN: "" }, absent), {});
	assert.deepEqual(farmAuthHeaders({ FARM_TOKEN: "   " }, absent), {});
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
	assert.equal(farmSyncWsProtocols({}, absent), undefined);
	assert.equal(farmSyncWsProtocols({ FARM_TOKEN: "" }, absent), undefined);
	assert.equal(farmSyncWsProtocols({ FARM_TOKEN: "   " }, absent), undefined);
});

test("the canonical file is outside the updateable kit and FARM_TOKEN_FILE can override it", () => {
	assert.equal(farmTokenFile({ env: {}, home: "/home/device" }), "/home/device/.refarm/credentials/device-token");
	assert.equal(
		farmTokenFile({ env: { FARM_TOKEN_FILE: "/run/device.secret" }, home: "/home/device" }),
		"/run/device.secret",
	);
});

test("save/status/remove keeps the secret private and never returns its value", async () => {
	const home = await mkdtemp(join(tmpdir(), "farm-auth-"));
	try {
		const saved = await saveFarmToken("  secret-value  ", { env: {}, home });
		assert.equal(await readFile(saved.path, "utf8"), "secret-value\n");
		if (process.platform !== "win32") {
			assert.equal((await stat(saved.path)).mode & 0o777, 0o600);
			assert.equal((await stat(join(home, ".refarm", "credentials"))).mode & 0o777, 0o700);
		}
		assert.deepEqual(farmCredentialStatus({ env: {}, home }), {
			ready: true,
			source: "file",
			path: saved.path,
			issue: null,
		});
		assert.deepEqual(farmAuthHeaders({}, { home }), { authorization: "Bearer secret-value" });
		await removeFarmToken({ env: {}, home });
		assert.equal(farmCredentialStatus({ env: {}, home }).issue, "missing");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("environment wins without touching the credential file", () => {
	const explosive = { read: () => { throw new Error("read"); }, stat: () => { throw new Error("stat"); } };
	assert.deepEqual(farmAuthHeaders({ FARM_TOKEN: "temporary" }, explosive), {
		authorization: "Bearer temporary",
	});
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
