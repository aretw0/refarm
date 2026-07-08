import { applicationCommand } from "./command-handoff.js";
import {
	classifyStatusDiagnostics,
	STATUS_DIAGNOSTICS,
	type StatusJson,
} from "./status.js";

function refarmAppCommand(args: string[]): string {
	return applicationCommand("refarm", args);
}

export const RUNTIME_STATUS_COMMAND = refarmAppCommand(["runtime", "status"]);
export const RUNTIME_ENSURE_WAIT_NEXT_COMMAND =
	refarmAppCommand(["runtime", "ensure", "--wait", "--next-command"]);
export const RUNTIME_DOCTOR_NEXT_ACTION_COMMAND =
	refarmAppCommand(["doctor", "--next-action"]);
export const RUNTIME_DOCTOR_NEXT_COMMAND =
	refarmAppCommand(["doctor", "--next-command"]);

export const RUNTIME_NOT_READY_LAUNCH_HINT =
	` Run \`${RUNTIME_STATUS_COMMAND}\`, then \`${RUNTIME_ENSURE_WAIT_NEXT_COMMAND}\`.`;

export interface LaunchReadiness {
	readyToExecute: boolean;
	failures: string[];
	blockedReason?: string;
	recoveryCommands: string[];
}

export function resolveLaunchReadiness(
	json: StatusJson,
	target: string,
): LaunchReadiness {
	const diagnostics = classifyStatusDiagnostics(json);
	if (diagnostics.failures.length === 0) {
		return { readyToExecute: true, failures: [], recoveryCommands: [] };
	}
	const runtimeNotReady = diagnostics.failures.includes(
		STATUS_DIAGNOSTICS.runtimeNotReady,
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
	json: StatusJson,
	target: string,
): void {
	const readiness = resolveLaunchReadiness(json, target);
	if (readiness.blockedReason) throw new Error(readiness.blockedReason);
}
