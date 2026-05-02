export function launchAvailabilityMessage(
	rendererLabel: string,
	launcherModes: string,
): string {
	return `${rendererLabel} launcher integration is available via --launch (${launcherModes}).`;
}

export function launchDryRunMessage(
	runtimeLabel: string,
	commandDisplay: string,
): string {
	return `[dry-run] would launch ${runtimeLabel}: ${commandDisplay}`;
}

export function launchStartMessage(
	runtimeLabel: string,
	commandDisplay: string,
): string {
	return `Launching ${runtimeLabel}: ${commandDisplay}`;
}

export function openDryRunMessage(url: string): string {
	return `[dry-run] would open browser URL: ${url}`;
}

export function openStartMessage(url: string): string {
	return `Opening browser URL: ${url}`;
}

export function openFailureMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return `Failed to open browser URL: ${message}`;
}
