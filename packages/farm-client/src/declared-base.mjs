import { homedir } from "node:os";
import { dirname } from "node:path";

/**
 * WHERE THIS DEVICE'S STATE LIVES — the third implementation of one chain, and the reason it is
 * allowed to exist.
 *
 * `@refarm.dev/config`'s `declaredBase()` is the same function in TypeScript;
 * `packages/tractor/src/host/plugin_host/config_node.rs` is the same function in Rust. This
 * package cannot import either: it ships to devices by `git pull` with ZERO runtime
 * dependencies, which is the whole point of `farm-client` and not a limitation to route around.
 *
 * What makes a third copy safe is not care, it is a test. `test/declared-base.test.mjs` runs
 * this function and the TypeScript one over the same table of environments and asserts they
 * agree, the same way `scripts/ci/check-config-node-keys.mjs` pins the Rust and TS key lists.
 * The test imports the config package by RELATIVE PATH — a test-only reach into the monorepo,
 * which leaves what actually ships dependency-free.
 *
 * Why it matters here specifically: the device token lives at
 * `<base>/.refarm/credentials/device-token`. Taking `<base>` from the OS instead of the
 * declaration meant a device with a declared `REFARM_HOME` looked for its credential in the
 * wrong place and answered 401 against a gated farm, with nothing in the error naming the
 * directory it had actually looked in.
 *
 * PURE over `env`. Step for step: SOVEREIGN_BASE, then the PARENT of REFARM_HOME (that variable
 * names the sovereign dir itself, and the base is what contains it), then HOME/USERPROFILE, then
 * the OS. `dirname` is used rather than a hand-rolled split so a relative or rootless
 * REFARM_HOME behaves the way `path.dirname` defines it — the exact case that diverged between
 * the TS and Rust twins (ISS-028).
 */
export function declaredBase(env = process.env) {
	const trimmed = (value) => (typeof value === "string" ? value.trim() : "");

	const base = trimmed(env?.SOVEREIGN_BASE);
	if (base) return base;

	const refarmHome = trimmed(env?.REFARM_HOME);
	if (refarmHome) return dirname(refarmHome);

	const home = trimmed(env?.HOME) || trimmed(env?.USERPROFILE);
	return home || homedir();
}
