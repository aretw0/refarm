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
	].join("\n");
}
