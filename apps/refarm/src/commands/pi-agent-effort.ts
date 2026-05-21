import type { Effort } from "@refarm.dev/effort-contract-v1";
import { PI_AGENT_PLUGIN_ID } from "@refarm.dev/config";

export interface PiAgentRespondEffortOptions {
	prompt: string;
	system: string;
	sessionId: string;
	source: "refarm-ask" | "refarm-chat";
	historyTurns: number;
	now?: () => Date;
	randomUUID?: () => string;
}

export function createPiAgentRespondEffort({
	prompt,
	system,
	sessionId,
	source,
	historyTurns,
	now = () => new Date(),
	randomUUID = () => crypto.randomUUID(),
}: PiAgentRespondEffortOptions): Effort {
	return {
		id: randomUUID(),
		direction: "ask",
		tasks: [
			{
				id: randomUUID(),
				pluginId: PI_AGENT_PLUGIN_ID,
				fn: "respond",
				args: {
					prompt,
					system,
					session_id: sessionId,
					history_turns: historyTurns,
				},
			},
		],
		source,
		submittedAt: now().toISOString(),
	};
}
