export interface LaunchGuardOption {
	enabled?: boolean;
	flag: string;
}

export interface LaunchGuardInput {
	json?: boolean;
	markdown?: boolean;
	launch?: boolean;
	dryRun?: boolean;
	requiresLaunch?: LaunchGuardOption[];
}

export function assertLaunchGuardOptions(input: LaunchGuardInput): void {
	if (input.json && input.markdown) {
		throw new Error("Choose only one output format: --json or --markdown.");
	}

	if (input.launch && (input.json || input.markdown)) {
		throw new Error("--launch cannot be combined with --json or --markdown.");
	}

	if (input.dryRun && !input.launch) {
		throw new Error("--dry-run requires --launch.");
	}

	for (const requirement of input.requiresLaunch ?? []) {
		if (requirement.enabled && !input.launch) {
			throw new Error(`${requirement.flag} requires --launch.`);
		}
	}
}
