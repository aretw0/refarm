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
