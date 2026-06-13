import { InvalidArgumentError } from "commander";
export {
	assertLaunchAllowed,
	resolveLaunchReadiness,
} from "@refarm.dev/cli/launch-policy";
export type {
	LaunchReadiness,
	RefarmLaunchReadiness,
} from "@refarm.dev/cli/launch-policy";

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
