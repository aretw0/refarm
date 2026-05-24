import {
	classifyRefarmStatusDiagnostics,
	REFARM_STATUS_DIAGNOSTICS,
	type RefarmStatusJson,
} from "@refarm.dev/cli/status";
import { InvalidArgumentError } from "commander";
import {
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_DOCTOR_NEXT_COMMAND,
	RUNTIME_NOT_READY_LAUNCH_HINT,
	RUNTIME_START_WAIT_COMMAND,
} from "./runtime-recovery.js";

export function resolveLaunchMode<TMode extends string>(
	input: unknown,
	allowed: readonly TMode[],
): TMode {
	if (typeof input === "string" && allowed.includes(input as TMode)) {
		return input as TMode;
	}

	throw new InvalidArgumentError(
		`Invalid --launcher value ${JSON.stringify(input)}. Use one of: ${allowed.join(", ")}.`,
	);
}

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
		? RUNTIME_NOT_READY_LAUNCH_HINT
		: ` Run \`${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND}\` for the next recovery action.`;
	return {
		readyToExecute: false,
		failures: diagnostics.failures,
		blockedReason: `Cannot launch ${target} due status failures: ${diagnostics.failures.join(", ")}.${recoveryHint}`,
		recoveryCommands: runtimeNotReady
			? [RUNTIME_START_WAIT_COMMAND, RUNTIME_DOCTOR_NEXT_COMMAND]
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
