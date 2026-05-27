import {
	classifyRefarmStatusDiagnostics,
	REFARM_STATUS_DIAGNOSTICS,
	type RefarmStatusJson,
} from "./status.js";

export const REFARM_RUNTIME_STATUS_COMMAND = "refarm runtime status";
export const REFARM_RUNTIME_ENSURE_WAIT_NEXT_COMMAND =
	"refarm runtime ensure --wait --next-command";
export const REFARM_RUNTIME_DOCTOR_NEXT_ACTION_COMMAND =
	"refarm doctor --next-action";
export const REFARM_RUNTIME_DOCTOR_NEXT_COMMAND =
	"refarm doctor --next-command";

export const REFARM_RUNTIME_NOT_READY_LAUNCH_HINT =
	` Run \`${REFARM_RUNTIME_STATUS_COMMAND}\`, then \`${REFARM_RUNTIME_ENSURE_WAIT_NEXT_COMMAND}\`.`;

export interface RefarmLaunchReadiness {
	readyToExecute: boolean;
	failures: string[];
	blockedReason?: string;
	recoveryCommands: string[];
}

export function resolveLaunchReadiness(
	json: RefarmStatusJson,
	target: string,
): RefarmLaunchReadiness {
	const diagnostics = classifyRefarmStatusDiagnostics(json);
	if (diagnostics.failures.length === 0) {
		return { readyToExecute: true, failures: [], recoveryCommands: [] };
	}
	const runtimeNotReady = diagnostics.failures.includes(
		REFARM_STATUS_DIAGNOSTICS.runtimeNotReady,
	);
	const recoveryHint = runtimeNotReady
		? REFARM_RUNTIME_NOT_READY_LAUNCH_HINT
		: ` Run \`${REFARM_RUNTIME_DOCTOR_NEXT_ACTION_COMMAND}\` for the next recovery action.`;
	return {
		readyToExecute: false,
		failures: diagnostics.failures,
		blockedReason: `Cannot launch ${target} due status failures: ${diagnostics.failures.join(", ")}.${recoveryHint}`,
		recoveryCommands: runtimeNotReady
			? [REFARM_RUNTIME_ENSURE_WAIT_NEXT_COMMAND, REFARM_RUNTIME_DOCTOR_NEXT_COMMAND]
			: [REFARM_RUNTIME_DOCTOR_NEXT_ACTION_COMMAND],
	};
}

export function assertLaunchAllowed(
	json: RefarmStatusJson,
	target: string,
): void {
	const readiness = resolveLaunchReadiness(json, target);
	if (readiness.blockedReason) throw new Error(readiness.blockedReason);
}
