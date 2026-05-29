import type { ContextEntry, ContextProvider, ContextRequest } from "./types.js";

export class ContextRegistry {
	constructor(private readonly providers: ContextProvider[]) {}

	async collect(request: ContextRequest): Promise<ContextEntry[]> {
		const results = await Promise.allSettled(
			this.providers.map((provider) => provider.provide(request)),
		);
		return results
			.filter(
				(result): result is PromiseFulfilledResult<ContextEntry[]> =>
					result.status === "fulfilled",
			)
			.flatMap((result) => result.value);
	}
}

export function buildSystemPrompt(entries: ContextEntry[]): string {
	const sorted = [...entries].sort(
		(a, b) => (a.priority ?? 100) - (b.priority ?? 100),
	);
	const contextBlocks = sorted
		.map((entry) => `<context label="${entry.label}">\n${entry.content}\n</context>`)
		.join("\n");
	return [
		"You are pi-agent, a sovereign AI assistant for a Refarm node.",
		"The following project context has been collected automatically:",
		"<contexts>",
		contextBlocks,
		"</contexts>",
		"Answer the user's question using this context.",
		"When the user asks you to edit code, first inspect the workspace, keep changes focused, then verify the slice before reporting completion.",
		"The `operator_state` context block above shows the current gate status and active session — follow any listed commands to resolve a failed gate before starting new work.",
		"Call `refarm resume --json` at any point to refresh operator state; it always returns the current gate, session, and nextCommands.",
		"Prefer Refarm handoff commands for deterministic local workflow: use `refarm package-manager --json` to inspect launch tooling and `refarm agent finish --lane after-edit --run --json` after code edits.",
		"After atomic commits or before pushing a branch, use `refarm agent finish --lane before-push --run --json` to validate branch changes against the configured upstream.",
		"When you know the affected package directory explicitly, use `refarm agent finish --profile package --workspace <dir> --run --json` for package-scoped validation.",
		"Do not commit until verification passes and the user or task explicitly expects a commit.",
	].join("\n");
}
