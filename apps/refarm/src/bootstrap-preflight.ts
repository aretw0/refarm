export function isJsonRequested(args: string[]): boolean {
	return (
		args.includes("--json") || args.includes("--next-action") || args.includes("--next-command")
	);
}

export function isModuleResolutionError(error: unknown): boolean {
	return error instanceof Error && (error as { code?: string }).code === "ERR_MODULE_NOT_FOUND";
}

/** PURE. WHICH module was not found. Node states it in the message and nothing was reading it —
 *  measured 2026-08-19, three separate diagnoses in one session were slowed by a failure that
 *  named a remedy ("rebuild node_modules") and never named the cause. A message that hides the one
 *  fact needed to act is the same defect as a gate that reports a kill as a failure. */
export function unresolvedModule(error: unknown): string | null {
	const message = error instanceof Error ? error.message : "";
	const match = /Cannot find (?:module|package) '([^']+)'/u.exec(message);
	return match?.[1] ?? null;
}

export function renderBootstrapFailure(error: unknown): void {
	const missing = unresolvedModule(error);
	const action =
		(missing ? `\`${missing}\` did not resolve. ` : "") +
		"Run `node scripts/ci/check-node-substrate.mjs --json` from the repository root, then use an environment-owned checkout or rebuild node_modules from the environment that owns it.";
	const command = "node scripts/ci/check-node-substrate.mjs --json";
	if (isJsonRequested(process.argv)) {
		console.log(
			JSON.stringify(
				{
					ok: false,
					command: "bootstrap",
					operation: "preflight",
					diagnostic: "node-substrate:cli-runtime-unavailable",
					error: error instanceof Error ? error.message : String(error),
					nextAction: action,
					nextActions: [action],
					nextCommand: command,
					nextCommands: [command],
				},
				null,
				2,
			),
		);
		return;
	}

	process.stderr.write("refarm: CLI runtime dependencies are not available in this environment.\n");
	process.stderr.write(`${action}\n`);
}
