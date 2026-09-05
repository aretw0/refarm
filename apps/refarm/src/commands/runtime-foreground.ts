import {
	startAttachedProcessHandoff,
	type AttachedProcessHandoff,
	type AttachedProcessHandoffOptions,
	type ProcessHandoffSpec,
} from "@refarm.dev/cli/process-handoff";

import type { LaunchRuntimeEngine } from "@refarm.dev/runtime-operator";

import { resolveRefarmHome } from "../utils/refarm-home.js";
import { resolveRuntimeLaunchCommand } from "./runtime-launcher.js";
import { runtimeNodeArgs } from "./runtime-node-args.js";
import { runtimeNodeEnv } from "./runtime-node-env.js";

/**
 * RUN THIS NODE'S RUNTIME IN THE FOREGROUND, deriving everything it needs at call time.
 *
 * This is what a supervisor's `ExecStart` points at, and the reason it exists rather than the
 * unit naming `tractor` directly:
 *
 *   · THE PLUGIN SET WOULD FREEZE. `runtime status` reports an argv carrying one `--plugin` per
 *     installed plugin, derived by `runtimeNodeArgs()`. Written into a unit file that list stops
 *     tracking: install a third plugin and the node returning from a reboot loads two, while
 *     `plugin status` reports honestly about a daemon running a different set. The unit stores
 *     the CALL; the derivation happens here, on every start.
 *   · THE ENVIRONMENT WOULD BE MISSING. Measured 2026-08-19 and recorded in `runtime-node-env.ts`:
 *     a runtime handed the arguments alone comes up healthy and refuses every dispatch — worse
 *     than one that fails to start, because `status` says ready, and under a supervisor it would
 *     be kept alive in that state.
 *
 * IT DOES NOT SPAWN ITSELF. The refarm app source may not reach for the child-process module —
 * the boundary guard in `test/architecture/process-boundary.test.ts` enforces that, and it caught
 * the first draft of this file. The attached mode lives in `@refarm.dev/process-handoff` beside
 * the captured and detached ones, which is where any consumer of the SDK can reach it.
 *
 * NOT A REPLACEMENT OF THIS PROCESS. Node has no `execve` binding, so this stays a real parent.
 * That has a consequence the supervisor makes load-bearing: the generated unit sets
 * `KillMode=mixed`, which sends SIGTERM to the MAIN process only — this one. The signal is
 * forwarded to the child so the daemon's own `drain_for_shutdown` runs; a wrapper that exited
 * without passing it on would turn that graceful drain into a SIGKILL when `TimeoutStopSec`
 * elapsed.
 */
export interface ForegroundRuntimeDeps {
	readonly startAttached?: (
		spec: ProcessHandoffSpec,
		options?: AttachedProcessHandoffOptions,
	) => AttachedProcessHandoff;
	readonly resolveHome?: () => string;
	readonly nodeEnv?: () => Promise<NodeJS.ProcessEnv>;
	/** Injected by tests. In production this registers real process signal handlers. */
	readonly onSignal?: (handler: (signal: NodeJS.Signals) => void) => void;
}

export interface ForegroundRuntimeResult {
	readonly command: string;
	readonly args: readonly string[];
	readonly exitCode: number;
}

/** What a supervisor asks a process to do when it wants it to stop, and what a terminal sends. */
const STOP_SIGNALS: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT"];

export async function runRuntimeForeground(
	repoRoot: string,
	engine: LaunchRuntimeEngine,
	deps: ForegroundRuntimeDeps = {},
): Promise<ForegroundRuntimeResult> {
	const home = (deps.resolveHome ?? resolveRefarmHome)();
	const launch = resolveRuntimeLaunchCommand(repoRoot, engine, runtimeNodeArgs(home));
	const env = await (deps.nodeEnv ?? runtimeNodeEnv)();
	const start = deps.startAttached ?? startAttachedProcessHandoff;
	const child = start(
		{ command: launch.command, args: [...launch.args], display: launch.display },
		{ env },
	);

	const register =
		deps.onSignal ??
		((handler: (signal: NodeJS.Signals) => void) => {
			for (const signal of STOP_SIGNALS) process.on(signal, () => handler(signal));
		});
	register((signal) => {
		child.kill(signal);
	});

	const exitCode = await child.wait();
	return { command: launch.command, args: launch.args, exitCode };
}
