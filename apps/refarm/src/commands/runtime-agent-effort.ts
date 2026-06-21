import { RUNTIME_AGENT_PLUGIN_ID } from "@refarm.dev/config";
import type { Effort } from "@refarm.dev/effort-contract-v1";

export interface RuntimeAgentRespondEffortOptions {
	prompt: string;
	system: string;
	sessionId: string;
	source: "refarm-ask" | "refarm-ask:worker" | "refarm-ask:monitor" | "refarm-chat";
	historyTurns: number;
	modelProvider?: string;
	modelId?: string;
	now?: () => Date;
	randomUUID?: () => string;
}

export function createRuntimeAgentRespondEffort({
	prompt,
	system,
	sessionId,
	source,
	historyTurns,
	modelProvider,
	modelId,
	now = () => new Date(),
	randomUUID = () => crypto.randomUUID(),
}: RuntimeAgentRespondEffortOptions): Effort {
	const args: Record<string, unknown> = {
		prompt,
		system,
		session_id: sessionId,
		history_turns: historyTurns,
	};
	if (modelProvider) args.provider = modelProvider;
	if (modelId) args.model = modelId;

	return {
		id: randomUUID(),
		direction: "ask",
		tasks: [
			{
				id: randomUUID(),
				pluginId: RUNTIME_AGENT_PLUGIN_ID,
				fn: "respond",
				args,
			},
		],
		source,
		submittedAt: now().toISOString(),
	};
}
