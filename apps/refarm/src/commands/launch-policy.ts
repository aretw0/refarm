import {
	classifyRefarmStatusDiagnostics,
	type RefarmStatusJson,
} from "@refarm.dev/cli/status";

export function resolveLaunchMode<TMode extends string>(
	input: unknown,
	allowed: readonly TMode[],
): TMode {
	if (typeof input === "string" && allowed.includes(input as TMode)) {
		return input as TMode;
	}

	throw new Error(
		`Invalid --launcher value ${JSON.stringify(input)}. Use one of: ${allowed.join(", ")}.`,
	);
}

export function assertLaunchAllowed(
	json: RefarmStatusJson,
	target: string,
): void {
	const diagnostics = classifyRefarmStatusDiagnostics(json);
	if (diagnostics.failures.length > 0) {
		throw new Error(
			`Cannot launch ${target} due status failures: ${diagnostics.failures.join(", ")}.`,
		);
	}
}
