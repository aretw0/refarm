/**
 * CAN THIS WORKSPACE ACTUALLY RUN ITS OWN TOOLING?
 *
 * Everything the repo knew about a workspace's executor was READ FROM FILES: `turbo.json` exists,
 * a lockfile names a manager, `.turbo/cache` is a directory. `refarm workspace execution` reported
 * `available: true` for both adapters on a checkout where both aborted, and `refarm check
 * --next-action` — the composite "safe to proceed" gate — answered `nextAction: null` on it.
 * Measured 2026-08-19, after `pnpm deploy --legacy` left the recorded dependency status stale
 * (ISS-155). Declared is not runnable, and only running it can tell them apart.
 *
 * WHY IT PROBES THROUGH THE MANAGER. `pnpm --version` answers from the binary and never consults
 * the workspace, so it is green on a workspace that cannot run a single script. The probe has to
 * take the same path real work takes — the manager executing something IN this directory — or it
 * measures the wrong thing and says so confidently.
 *
 * THREE STATES. "It ran", "it refused", and "there was nothing here to ask" are different facts
 * with different repairs, and a workspace with no manager on PATH is not a broken workspace. This
 * is the same contract as `tool-requirements.js` next door, for the same reason.
 */
import { spawnSync as defaultSpawnSync } from "node:child_process";
import { existsSync as defaultExistsSync } from "node:fs";
import path from "node:path";

/**
 * Every state carries `workspace`: a measurement that does not know WHAT it measured makes each
 * consumer carry the subject alongside it, and the first one to pass the wrong pair reports a
 * healthy directory as broken.
 *
 * @typedef {{ kind: "ready", workspace: string, probe: string }
 *   | { kind: "broken", workspace: string, detail: string, repair: string }
 *   | { kind: "cannot-check", workspace: string, detail: string }} WorkspaceToolingMeasurement
 */

const DETAIL_LIMIT = 200;

/** Run something trivial THROUGH the manager. `node --version` because refarm already requires
 *  node, so a failure here is the manager's, never a missing probe. */
const PROBE_ARGS = ["exec", "node", "--version"];

/**
 * Ask the workspace's package manager to run something, and report what happened.
 *
 * @param {{
 *   cwd: string,
 *   packageManager: string,
 *   spawnSync?: typeof defaultSpawnSync,
 *   existsSync?: typeof defaultExistsSync,
 * }} options
 * @returns {WorkspaceToolingMeasurement}
 */
export function measureWorkspaceTooling(options) {
	const { cwd, packageManager } = options;
	const spawnSync = options.spawnSync ?? defaultSpawnSync;
	const existsSync = options.existsSync ?? defaultExistsSync;

	// No manifest, no workspace, no question — and no spawn to discover that. An installed node
	// runs `health` from wherever the operator stands, which is usually not a checkout.
	if (!existsSync(path.join(cwd, "package.json"))) {
		return { kind: "cannot-check", workspace: cwd, detail: `no package.json at ${cwd}` };
	}
	// NEVER INSTALLED IS NOT BROKEN. A manifest with no `node_modules` beside it is a workspace
	// nobody has set up yet, and "its tooling stopped working" is a claim about a workspace that
	// once worked. Saying it anyway would fire on every scratch directory that happens to hold a
	// package.json — and would spawn a package manager to reach a verdict already visible from the
	// filesystem. Whether a DECLARED workspace is installed is a different question, asked by the
	// sweep over declared workspaces rather than by an audit of wherever the operator is standing.
	if (!existsSync(path.join(cwd, "node_modules"))) {
		return {
			kind: "cannot-check",
			workspace: cwd,
			detail: `dependencies have never been installed at ${cwd}`,
		};
	}

	const probe = `${packageManager} ${PROBE_ARGS.join(" ")}`;
	let result;
	try {
		result = spawnSync(packageManager, [...PROBE_ARGS], { cwd, encoding: "utf8" });
	} catch (error) {
		return {
			kind: "cannot-check",
			workspace: cwd,
			detail: error instanceof Error ? error.message : String(error),
		};
	}
	// A manager that is not installed is not a broken workspace — it is a machine that cannot
	// answer the question, and sending the operator to `install` would be the wrong repair.
	if (result.error) return { kind: "cannot-check", workspace: cwd, detail: result.error.message };
	if (result.status === 0) return { kind: "ready", workspace: cwd, probe };

	const detail =
		String(result.stderr || result.stdout || "").trim().slice(0, DETAIL_LIMIT) ||
		`exited ${result.status}`;
	// The manager's own advice is not always the right one: pnpm answers a stale dependency status
	// by proposing to purge `node_modules`. An install is the honest first move for every reason
	// this probe fails, and it is what the operator should read.
	return { kind: "broken", workspace: cwd, detail, repair: `${packageManager} install` };
}

/**
 * PURE. What the operator reads.
 *
 * @param {WorkspaceToolingMeasurement} measurement
 * @returns {string}
 */
export function describeWorkspaceTooling(measurement) {
	const { workspace } = measurement;
	if (measurement.kind === "ready") {
		return `${workspace} can run its own tooling — \`${measurement.probe}\` succeeded.`;
	}
	if (measurement.kind === "broken") {
		return (
			`${workspace} cannot run its own tooling, so its builds, tests and scripts will fail the ` +
			`same way: ${measurement.detail} Start with \`${measurement.repair}\`.`
		);
	}
	return `Could not check whether ${workspace} can run its own tooling: ${measurement.detail}.`;
}
