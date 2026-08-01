import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const DOC = new URL("../../docs/REFARM_DEVICE_OPERATOR_JOURNEYS.md", import.meta.url);
const FARM_CLIENT_PACKAGE = new URL("../../packages/farm-client/package.json", import.meta.url);
const ME_PACKAGE = new URL("../../apps/me/package.json", import.meta.url);

test("device journeys keep the operational-plan contract", async () => {
	const source = await readFile(DOC, "utf8");
	for (const heading of [
		"## Maturity ledger",
		"## Journey 1 — Bootstrap and operate from Termux",
		"## Journey 2 — Install and operate the PWA",
		"### Preconditions",
		"### Re-observe and undo",
		"### Proof plan",
		"## Completion rule",
	]) {
		assert.ok(source.includes(heading), `missing operational journey section: ${heading}`);
	}
	for (const command of [
		"refarm check --next-action --json",
		"farm-hello <farm-host>",
		"farm-start",
		"farm-attend",
		"smoke:pwa",
		"smoke:remote-device",
	]) {
		assert.ok(source.includes(command), `missing executable journey evidence: ${command}`);
	}
});

test("device journeys remain Refarm-owned and parameterized", async () => {
	const source = (await readFile(DOC, "utf8")).toLowerCase();
	assert.doesNotMatch(source, /\/home\/|\/users\/|[a-z]:\\/i, "device journey must not carry a workstation path");
	assert.doesNotMatch(source, /\b(?:10|100|127|169\.254|172|192\.168)\.\d+\.\d+\.\d+\b/, "device journey must not carry a concrete private address");
	assert.ok(source.includes("<farm-host>"), "network location must remain an operator-supplied parameter");
	assert.ok(source.includes("network transport is an operator choice"));
	assert.match(
		source,
		/its product vocabulary, repositories, paths, policies, and private data do not\s+belong here/,
	);
});

test("every named proof and device command exists in its shipping manifest", async () => {
	const farmClient = JSON.parse(await readFile(FARM_CLIENT_PACKAGE, "utf8"));
	const me = JSON.parse(await readFile(ME_PACKAGE, "utf8"));
	assert.deepEqual(
		["farm-hello", "farm-ask", "farm-start", "farm-attend", "farm-update"].filter(
			(command) => !(command in farmClient.bin),
		),
		[],
	);
	assert.deepEqual(
		["smoke:pwa", "smoke:offline-roundtrip", "smoke:real-daemon-roundtrip", "smoke:remote-device"].filter(
			(command) => !(command in me.scripts),
		),
		[],
	);
});
