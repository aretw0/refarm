import assert from "node:assert/strict";
import { test } from "node:test";

import { declaredBase } from "../src/declared-base.mjs";
// RELATIVE, on purpose. `farm-client` ships to devices by `git pull` with zero runtime
// dependencies; adding `@refarm.dev/config` to its package.json would end that, for a check that
// only ever runs here. A test-only reach into the monorepo leaves what ships untouched.
import { declaredBase as declaredBaseTs } from "../../config/src/index.js";

/**
 * THE TABLE BOTH IMPLEMENTATIONS MUST ANSWER IDENTICALLY.
 *
 * Every row is a step of the chain or a case where two reasonable implementations diverge. The
 * relative and rootless `REFARM_HOME` rows are not hypothetical: `Path::parent()` and
 * `path.dirname()` disagree on exactly those, which is how the Rust and TypeScript twins came to
 * resolve one declaration to two directories (ISS-028).
 */
const CASES = [
	["nothing declared", {}],
	["SOVEREIGN_BASE wins over everything", { SOVEREIGN_BASE: "/declared", REFARM_HOME: "/other/.refarm", HOME: "/home/op" }],
	["an empty SOVEREIGN_BASE is no declaration", { SOVEREIGN_BASE: "   ", HOME: "/home/op" }],
	["REFARM_HOME resolves to its PARENT", { REFARM_HOME: "/home/op/.refarm", HOME: "/elsewhere" }],
	["a relative REFARM_HOME", { REFARM_HOME: ".refarm" }],
	["a rootless REFARM_HOME", { REFARM_HOME: "/" }],
	["a trailing-slash REFARM_HOME", { REFARM_HOME: "/home/op/.refarm/" }],
	["HOME answers when nothing above does", { HOME: "/home/op" }],
	["USERPROFILE answers where HOME is absent", { USERPROFILE: "C:\\Users\\op" }],
	["HOME wins over USERPROFILE", { HOME: "/home/op", USERPROFILE: "C:\\Users\\op" }],
	["an empty HOME falls through to USERPROFILE", { HOME: "", USERPROFILE: "C:\\Users\\op" }],
];

for (const [name, env] of CASES) {
	test(`declaredBase agrees with @refarm.dev/config: ${name}`, () => {
		assert.equal(
			declaredBase(env),
			declaredBaseTs(env),
			"farm-client carries a THIRD copy of this chain because it must ship dependency-free " +
				"(see src/declared-base.mjs). What makes that safe is this test, not care.",
		);
	});
}

test("the device token hangs off the base, and an explicit file still wins", async () => {
	const { farmTokenFile } = await import("../src/auth.mjs");
	assert.equal(
		farmTokenFile({ env: { SOVEREIGN_BASE: "/declared" } }),
		"/declared/.refarm/credentials/device-token",
	);
	assert.equal(
		farmTokenFile({ env: { REFARM_HOME: "/box/.refarm" } }),
		"/box/.refarm/credentials/device-token",
	);
	// FARM_TOKEN_FILE is the explicit override and outranks the whole chain.
	assert.equal(
		farmTokenFile({ env: { SOVEREIGN_BASE: "/declared", FARM_TOKEN_FILE: "/explicit/tok" } }),
		"/explicit/tok",
	);
});
