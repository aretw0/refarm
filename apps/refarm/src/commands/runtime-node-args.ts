/**
 * THE ARGUMENTS THIS NODE'S RUNTIME NEEDS, DERIVED FROM THE NODE.
 *
 * MEASURED 2026-08-19, after moving this node off the development working tree onto an installed
 * copy: `refarm runtime ensure` answered `ensured: false, started: false, ok: false`. The launcher
 * resolves "repo script if present, else the binary on PATH", and the PATH branch launched a bare
 * `tractor` — because its arguments were a constant, `[]`.
 *
 * The node's real runtime runs as:
 *
 *   tractor --plugin …/refarm_agent/plugin.wasm --plugin …/refarm_lsp-code-ops/plugin.wasm \
 *           --refarm-dir ~/.refarm
 *
 * A runtime started without those is not the operator's node — no plugins, no sovereign directory
 * — and starting a different node under the same name is worse than refusing to start.
 *
 * `scripts/tractor-start.sh` builds them by shelling out to `resolve-boot-plugins.mjs`, which is a
 * thin bridge into THIS app. ADR-059 already assigns plugin discovery to the CLI; this is that
 * same discovery, reached directly, so an installed node needs no script and no repository.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { installedPluginWasmPath } from "./plugin-install-path.js";
import { readBootConfig, resolveBootPluginPaths } from "./resolve-boot-plugins.js";

/**
 * The agent is loaded on its own path — `resolveBootPluginPaths` skips it deliberately, and the
 * start script resolves it separately, preferring the REPO's wasm build. An installed node has no
 * repo, so the installed copy is the only right answer here.
 *
 * THE PACKAGE ID, not the runtime id. `trusted_plugins` names `agent`; the install layout is keyed
 * on `@refarm/agent` and lands in `plugins/refarm_agent/`. Measured 2026-08-19: passing the runtime
 * id produced `plugins/agent/plugin.wasm`, which does not exist, and the check silently added
 * nothing — a runtime that starts and cannot dispatch.
 */
const AGENT_PACKAGE_ID = "@refarm/agent";

/**
 * PURE-ish. `--plugin` for every plugin this node boots, then `--refarm-dir`.
 *
 * ORDER MATTERS and mirrors the script: plugins first, home last. A reader comparing a running
 * process against this list should not have to sort it mentally.
 *
 * Never throws. A node whose plugin declaration cannot be read still gets `--refarm-dir`, which
 * is the difference between a runtime that boots without its plugins and one that does not boot —
 * and the first is recoverable by the operator while the second needs someone at the keyboard.
 */
export function runtimeNodeArgs(refarmHome: string): string[] {
	const args: string[] = [];
	try {
		const config = readBootConfig(refarmHome);
		// THE AGENT FIRST, because `resolveBootPluginPaths` excludes it by design and the running
		// node measured on 2026-08-19 carries it. Omitting it starts a runtime that cannot
		// dispatch — running, answering `status`, and useless.
		const agent = installedPluginWasmPath(AGENT_PACKAGE_ID, path.join(refarmHome, "plugins"));
		if (existsSync(agent)) args.push("--plugin", agent);
		for (const plugin of resolveBootPluginPaths(path.join(refarmHome, "plugins"), config)) {
			args.push("--plugin", plugin);
		}
	} catch {
		// Deliberate: see the note above.
	}
	args.push("--refarm-dir", refarmHome);
	return args;
}
