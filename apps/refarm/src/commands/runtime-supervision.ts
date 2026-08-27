import type { ProcessStatus } from "@refarm.dev/process-contract-v1";

import { runProcessStatus } from "./process.js";

/**
 * IS THIS NODE'S DAEMON UNDER A SUPERVISOR, and what stops it if so?
 *
 * WHY THE QUESTION EXISTS. `refarm runtime stop` sends SIGTERM by pid. Under a unit with
 * `Restart=always` that reads to the supervisor as a CRASH, and the daemon returns five seconds
 * later — the operator's intent defeated without a word. Measured 2026-08-27 with a throwaway
 * unit: an explicit `systemctl stop` leaves the unit inactive and it STAYS inactive, while a
 * `kill -9` brings it back with `NRestarts=1`. Both halves are what an operator wants; only one
 * of them is reachable by killing a pid.
 *
 * WHY IT REFUSES RATHER THAN RUNNING SYSTEMCTL. `apps/refarm/src/commands/process.ts` draws the
 * boundary and names its precedent: "refarm does the part that can be shown, reviewed and undone,
 * and does not reach into a running session on the operator's behalf." `process install` writes
 * the unit and hands over the activation line; this hands over the stop line.
 */
export const SUPERVISED_RUNTIME_PROCESS = "runtime";

export interface RuntimeSupervision {
	readonly supervised: boolean;
	readonly unit: string;
	readonly stopCommand: string;
	readonly restartCommand: string;
}

export interface RuntimeSupervisionDeps {
	/** Injected by tests. Defaults to the same reader `refarm process status` uses, so there is
	 *  one answer to "is it supervised" rather than a second implementation of the question. */
	readonly readStatuses?: () => Promise<readonly ProcessStatus[]>;
}

function unitNameFor(name: string): string {
	return `refarm-${name}.service`;
}

async function defaultReadStatuses(): Promise<readonly ProcessStatus[]> {
	const result = await runProcessStatus([SUPERVISED_RUNTIME_PROCESS]);
	return result.statuses;
}

export async function readRuntimeSupervision(
	deps: RuntimeSupervisionDeps = {},
): Promise<RuntimeSupervision> {
	const unit = unitNameFor(SUPERVISED_RUNTIME_PROCESS);
	const base = {
		unit,
		stopCommand: `systemctl --user stop ${unit}`,
		restartCommand: `systemctl --user restart ${unit}`,
	};
	try {
		const statuses = await (deps.readStatuses ?? defaultReadStatuses)();
		const row = statuses.find((entry) => entry.name === SUPERVISED_RUNTIME_PROCESS);
		// STRICT `=== true`. `supervised` is `boolean | null`, and null means "could not ask
		// systemd". An unknown read as supervised would refuse the only stop the operator has
		// left — so this one fails OPEN, deliberately, against the integrity default: a wrong
		// refusal strands a running daemon, a wrong stop is one command to undo.
		return { ...base, supervised: row?.supervised === true };
	} catch {
		// A reader that throws is an unknown, and an unknown is not supervision.
		return { ...base, supervised: false };
	}
}
