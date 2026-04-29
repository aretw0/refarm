export interface AgentResponseStreamEvent {
	prompt_ref?: string | null;
	content?: string | null;
	sequence?: number | null;
	is_final?: boolean | null;
	[key: string]: unknown;
}

export interface AgentResponseStreamState {
	promptRef: string | null;
	content: string;
	lastSequence: number | null;
	isFinal: boolean;
}

export type AgentResponseStreamStateMap = Record<
	string,
	AgentResponseStreamState
>;

export const UNKNOWN_AGENT_RESPONSE_PROMPT_REF = "__tractor:no-prompt-ref__";

export function emptyAgentResponseStreamState(
	promptRef: string | null = null,
): AgentResponseStreamState {
	return {
		promptRef,
		content: "",
		lastSequence: null,
		isFinal: false,
	};
}

export function applyAgentResponseStreamEvent(
	state: AgentResponseStreamState,
	event: AgentResponseStreamEvent,
): AgentResponseStreamState {
	const eventContent = typeof event.content === "string" ? event.content : "";
	const eventSequence =
		typeof event.sequence === "number" && Number.isFinite(event.sequence)
			? event.sequence
			: state.lastSequence;
	const promptRef =
		typeof event.prompt_ref === "string" ? event.prompt_ref : state.promptRef;

	if (event.is_final === true) {
		return {
			promptRef,
			content: eventContent,
			lastSequence: eventSequence,
			isFinal: true,
		};
	}

	return {
		promptRef,
		content: state.content + eventContent,
		lastSequence: eventSequence,
		isFinal: false,
	};
}

export function reduceAgentResponseStreamEvents(
	events: readonly AgentResponseStreamEvent[],
	initialState: AgentResponseStreamState = emptyAgentResponseStreamState(),
): AgentResponseStreamState {
	return events.reduce(applyAgentResponseStreamEvent, initialState);
}

export function agentResponseStreamKey(event: AgentResponseStreamEvent): string {
	return typeof event.prompt_ref === "string"
		? event.prompt_ref
		: UNKNOWN_AGENT_RESPONSE_PROMPT_REF;
}

export function applyAgentResponseStreamEventToMap(
	stateMap: AgentResponseStreamStateMap,
	event: AgentResponseStreamEvent,
): AgentResponseStreamStateMap {
	const key = agentResponseStreamKey(event);
	const previous = stateMap[key] ?? emptyAgentResponseStreamState(
		key === UNKNOWN_AGENT_RESPONSE_PROMPT_REF ? null : key,
	);

	return {
		...stateMap,
		[key]: applyAgentResponseStreamEvent(previous, event),
	};
}

export function reduceAgentResponseStreamEventsByPrompt(
	events: readonly AgentResponseStreamEvent[],
	initialStateMap: AgentResponseStreamStateMap = {},
): AgentResponseStreamStateMap {
	return events.reduce(applyAgentResponseStreamEventToMap, initialStateMap);
}
