import { classifyStatusDiagnostics, STATUS_DIAGNOSTICS, type StatusJson } from "./status.js";

/**
 * The brand-specific recovery handoffs this policy weaves into its messages
 * (ADR-087). The generic package must not know the app's binary name, so the app
 * supplies these already-formatted command strings (e.g. `<binary> runtime status`).
 * The `runtime-not-ready` path and the generic-failure path each get their own set.
 */
export interface LaunchRecoveryHints {
	/** Full hint appended when the runtime isn't ready (e.g. "Run `x`, then `y`."). */
	runtimeNotReadyHint: string;
	/** The command shown for the next recovery action on a generic failure. */
	doctorNextActionCommand: string;
	/** The recovery commands offered when the runtime isn't ready. */
	runtimeNotReadyCommands: string[];
}

/** A neutral default when no app hints are supplied — brand-free, so the generic
 *  package stays agnostic even if called bare. */
const NEUTRAL_RECOVERY_HINTS: LaunchRecoveryHints = {
	runtimeNotReadyHint: "",
	doctorNextActionCommand: "",
	runtimeNotReadyCommands: [],
};

export interface LaunchReadiness {
	readyToExecute: boolean;
	failures: string[];
	blockedReason?: string;
	recoveryCommands: string[];
}

export function resolveLaunchReadiness(
	json: StatusJson,
	target: string,
	hints: LaunchRecoveryHints = NEUTRAL_RECOVERY_HINTS,
): LaunchReadiness {
	const diagnostics = classifyStatusDiagnostics(json);
	if (diagnostics.failures.length === 0) {
		return { readyToExecute: true, failures: [], recoveryCommands: [] };
	}
	const runtimeNotReady = diagnostics.failures.includes(STATUS_DIAGNOSTICS.runtimeNotReady);
	const recoveryHint = runtimeNotReady
		? hints.runtimeNotReadyHint
		: hints.doctorNextActionCommand
			? ` Run \`${hints.doctorNextActionCommand}\` for the next recovery action.`
			: "";
	return {
		readyToExecute: false,
		failures: diagnostics.failures,
		blockedReason: `Cannot launch ${target} due status failures: ${diagnostics.failures.join(", ")}.${recoveryHint}`,
		recoveryCommands: runtimeNotReady
			? hints.runtimeNotReadyCommands
			: hints.doctorNextActionCommand
				? [hints.doctorNextActionCommand]
				: [],
	};
}

export function assertLaunchAllowed(
	json: StatusJson,
	target: string,
	hints?: LaunchRecoveryHints,
): void {
	const readiness = resolveLaunchReadiness(json, target, hints);
	if (readiness.blockedReason) throw new Error(readiness.blockedReason);
}
