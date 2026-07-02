import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

const serverEntry = new URL("../dist/server/index.mjs", import.meta.url);

test("Astro build emits a server handler for the health route", async () => {
	assert.equal(
		existsSync(serverEntry),
		true,
		"run pnpm -C validations/astro-wasi-ssr run build first",
	);

	const handler = await import(serverEntry);
	assert.equal(typeof handler.default?.fetch, "function");

	const response = await handler.default.fetch(
		new Request("http://refarm.local/health.json"),
	);
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("content-type"), "application/json");
	assert.deepEqual(await response.json(), {
		status: "ok",
		marker: "refarm-astro-wasi-ssr-poc",
	});
});
