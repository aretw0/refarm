import {
	classifyRefarmStatusDiagnostics,
	REFARM_STATUS_DIAGNOSTICS,
	type RefarmStatusJson,
} from "@refarm.dev/cli/status";
import { InvalidArgumentError } from "commander";
import {
	RUNTIME_DOCTOR_NEXT_ACTION_COMMAND,
	RUNTIME_NOT_READY_LAUNCH_HINT,
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

export function assertLaunchAllowed(
	json: RefarmStatusJson,
	target: string,
): void {
	const diagnostics = classifyRefarmStatusDiagnostics(json);
	if (diagnostics.failures.length > 0) {
		const recoveryHint = diagnostics.failures.includes(
			REFARM_STATUS_DIAGNOSTICS.runtimeNotReady,
		)
			? RUNTIME_NOT_READY_LAUNCH_HINT
			: ` Run \`${RUNTIME_DOCTOR_NEXT_ACTION_COMMAND}\` for the next recovery action.`;
		throw new Error(
			`Cannot launch ${target} due status failures: ${diagnostics.failures.join(", ")}.${recoveryHint}`,
		);
	}
}
