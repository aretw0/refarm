/**
 * THE BASE RESOLVER — split out of index.js so a config module can reach it without importing
 * the barrel that re-exports it. `workspaces-config.js` and `workspace-namespaces-config.js`
 * resolve declared workspace paths against the node base; importing `./index.js` for that would
 * be a cycle, and defaulting to `process.cwd()` to avoid the cycle is the defect itself.
 *
 * This module is ALLOWLISTED in scripts/no-os-resolution.mjs. It is the center: the one place in
 * this package permitted to ask the OS, and only as the last step of a declared chain.
 */
import os from "node:os";
import path from "node:path";

/** The neutral env var that names WHERE this node's declarations live — the directory
 * that contains the sovereign dir. Sibling of `SOVEREIGN_DIR_SELECTOR_KEY`, injected the same
 * way and read identically by the Rust host and this stack, so the two cannot answer from
 * different directories on the same node. */
export const SOVEREIGN_BASE_KEY = "SOVEREIGN_BASE";

/**
 * The base AND which step produced it — one function, so a caller can never label a step
 * `declaredBase` did not take.
 *
 * ISS-025: `refarm context` re-derived this precedence with its own ternary to fill
 * `cliBaseOrigin`, and a comment explaining that it "mirrors `declaredBase()`'s own precedence step
 * for step" is exactly the kind of promise that holds until one of the two changes. The label had
 * already been wrong once for that reason: it said `"cwd"` for months after the cwd fallback was
 * removed, a small untruth in a `--json` field.
 *
 * `origin` is the witness. `base` is what `declaredBase` returns, by construction — this IS its
 * implementation, and `declaredBase` is now a projection of it.
 */
export function declaredBaseWithOrigin(env = process.env) {
	const base = env[SOVEREIGN_BASE_KEY]?.trim();
	if (base) return { base, origin: "SOVEREIGN_BASE" };
	const refarmHome = env.REFARM_HOME?.trim();
	if (refarmHome) return { base: path.dirname(refarmHome), origin: "REFARM_HOME" };
	// ISS-027: step 3 honours the SAME `env` the first two steps honour.
	const home = env.HOME?.trim() || env.USERPROFILE?.trim();
	return home ? { base: home, origin: "env-home" } : { base: os.homedir(), origin: "os-home" };
}

export function declaredBase(env = process.env) {
	return declaredBaseWithOrigin(env).base;
}
