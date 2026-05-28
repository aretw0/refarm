import { refarmCommand } from "./command-handoff.js";
import {
	classifyRefarmStatusDiagnostics,
	REFARM_STATUS_DIAGNOSTICS,
	type RefarmStatusJson,
} from "./status.js";

export const RUNTIME_STATUS_COMMAND = refarmCommand(["runtime", "status"]);
export const RUNTIME_ENSURE_WAIT_NEXT_COMMAND =
	refarmCommand(["runtime", "ensure", "--wait", "--next-command"]);
export const RUNTIME_DOCTOR_NEXT_ACTION_COMMAND =
	refarmCommand(["doctor", "--next-action"]);
export const RUNTIME_DOCTOR_NEXT_COMMAND =
	refarmCommand(["doctor", "--next-command"]);

export const RUNTIME_NOT_READY_LAUNCH_HINT =
	` Run \`${RUNTIME_STATUS_COMMAND}\`, then \`${RUNTIME_ENSURE_WAIT_NEXT_COMMAND}\`.`;

export interface LaunchReadiness {
	readyToExecute: boolean;
	failures: string[];
	blockedReason?: string;
	recoveryCommands: string[];
}

export function resolveLaunchReadiness(
	json: RefarmStatusJson,
	target: string,
): LaunchReadiness {
	const diagnostics = classifyRefarmStatusDiagnostics(json);
	if (diagnostics.failures.length === 0) {
		return { readyToExecute: true, failures: [], recoveryCommands: [] };
	}
	const runtimeNotReady = diagnostics.failures.includes(
		REFARM_STATUS_DIAGNOSTICS.runtimeNotReady,
	);
	const recoveryHint = runtimeNotReady
		? RUNTIME_NOT_READY_LAUNCH_HINT
		: ` Run \`${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND}\` for the next recovery action.`;
	return {
		readyToExecute: false,
		failures: diagnostics.failures,
		blockedReason: `Cannot launch ${target} due status failures: ${diagnostics.failures.join(", ")}.${recoveryHint}`,
		recoveryCommands: runtimeNotReady
			? [RUNTIME_ENSURE_WAIT_NEXT_COMMAND, RUNTIME_DOCTOR_NEXT_COMMAND]
			: [RUNTIME_DOCTOR_NEXT_ACTION_COMMAND],
	};
}

export function assertLaunchAllowed(
	json: RefarmStatusJson,
	target: string,
): void {
	const readiness = resolveLaunchReadiness(json, target);
	if (readiness.blockedReason) throw new Error(readiness.blockedReason);
}

export const REFARM_RUNTIME_STATUS_COMMAND = RUNTIME_STATUS_COMMAND;
export const REFARM_RUNTIME_ENSURE_WAIT_NEXT_COMMAND =
	RUNTIME_ENSURE_WAIT_NEXT_COMMAND;
export const REFARM_RUNTIME_DOCTOR_NEXT_ACTION_COMMAND =
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND;
export const REFARM_RUNTIME_DOCTOR_NEXT_COMMAND =
	RUNTIME_DOCTOR_NEXT_COMMAND;
export const REFARM_RUNTIME_NOT_READY_LAUNCH_HINT =
	RUNTIME_NOT_READY_LAUNCH_HINT;
export type RefarmLaunchReadiness = LaunchReadiness;
