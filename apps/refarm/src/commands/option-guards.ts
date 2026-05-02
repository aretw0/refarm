export interface GuardedFlag {
	enabled?: boolean;
	flag: string;
}

export function assertAtMostOneFlagEnabled(
	flags: GuardedFlag[],
	message?: string,
): void {
	const enabled = flags.filter((flag) => flag.enabled);
	if (enabled.length <= 1) {
		return;
	}

	if (message) {
		throw new Error(message);
	}

	const label = enabled.map((flag) => flag.flag).join(" or ");
	throw new Error(`Choose only one option: ${label}.`);
}
