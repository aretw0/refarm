export interface RuntimeRecoveryDeps {
	submitEffort(effort: unknown): Promise<string>;
	recoverRuntime?(): Promise<boolean>;
	onRecoveringRuntime?(): void;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isRuntimeConnectionUnavailable(error: unknown): boolean {
	const message = errorMessage(error);
	return message.includes("ECONNREFUSED") || message.includes("fetch failed");
}

export async function submitEffortWithRuntimeRecovery(
	effort: unknown,
	deps: RuntimeRecoveryDeps,
): Promise<string> {
	try {
		return await deps.submitEffort(effort);
	} catch (error) {
		if (!deps.recoverRuntime || !isRuntimeConnectionUnavailable(error)) {
			throw error;
		}
		deps.onRecoveringRuntime?.();
		const recovered = await deps.recoverRuntime();
		if (!recovered) throw error;
		return deps.submitEffort(effort);
	}
}
