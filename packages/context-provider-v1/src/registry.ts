import type { ContextEntry, ContextProvider, ContextRequest } from "./types.js";

export class ContextRegistry {
	constructor(private readonly providers: ContextProvider[]) {}

	async collect(request: ContextRequest): Promise<ContextEntry[]> {
		const results = await Promise.allSettled(
			this.providers.map((provider) => provider.provide(request)),
		);
		return results
			.filter(
				(result): result is PromiseFulfilledResult<ContextEntry[]> => result.status === "fulfilled",
			)
			.flatMap((result) => result.value);
	}
}

/** The app identity spoken in the agent's system prompt (ADR-087): this generic
 *  package names no product, so the app injects its own. REQUIRED — no default
 *  brand; a white-label app passes its own name and binary, or it fails up. */
export interface AgentPromptIdentity {
	/** Product display name the model addresses (e.g. "Refarm"). */
	productName: string;
	/** CLI binary woven into operator handoff commands (e.g. "refarm"). */
	binary: string;
}

export function buildSystemPrompt(entries: ContextEntry[], identity: AgentPromptIdentity): string {
	const { productName, binary } = identity;
	const sorted = [...entries].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
	const contextBlocks = sorted
		.map((entry) => `<context label="${entry.label}">\n${entry.content}\n</context>`)
		.join("\n");
	return [
		`You are the ${productName} runtime agent, a sovereign AI assistant for a ${productName} node.`,
		"The following project context has been collected automatically:",
		"<contexts>",
		contextBlocks,
		"</contexts>",
		"Answer the user's question using this context.",
		"When the user asks you to edit code, first inspect the workspace, keep changes focused, then verify the slice before reporting completion.",
		"Before making code changes, read any files listed in the `policy_files` context block — they define how agents must work in this project (source rules, build cycle, commit hygiene).",
		"The `operator_state` context block above shows the current gate status and active session — follow any listed commands to resolve a failed gate before starting new work.",
		`Call \`${binary} resume --json\` at any point to refresh operator state; it always returns the current gate, session, and nextCommands.`,
		`Prefer ${productName} handoff commands for deterministic local workflow: use \`${binary} package-manager --json\` to inspect launch tooling and \`${binary} agent finish --lane after-edit --run --json\` after code edits.`,
		`For build, test, lint, and \`${binary} agent finish\` bash calls, set \`timeout_ms\` to at least 90000 (90 s) — the default 30 s is insufficient for compilation. Always pass the \`cwd\` from the \`cwd\` context block so commands run in the project root.`,
		`After atomic commits or before pushing a branch, use \`${binary} agent finish --lane before-push --run --json\` to validate branch changes against the configured upstream.`,
		`When you know the affected package directory explicitly, use \`${binary} agent finish --profile package --workspace <dir> --run --json\` for package-scoped validation.`,
		"Do not commit until verification passes and the user or task explicitly expects a commit.",
	].join("\n");
}
