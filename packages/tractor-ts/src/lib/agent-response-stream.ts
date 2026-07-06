export interface ResponseStreamEvent {
	prompt_ref?: string | null;
	content?: string | null;
	sequence?: number | null;
	is_final?: boolean | null;
	[key: string]: unknown;
}

export interface ResponseStreamState {
	promptRef: string | null;
	content: string;
	lastSequence: number | null;
	isFinal: boolean;
}

export type ResponseStreamStateMap = Record<
	string,
	ResponseStreamState
>;

export const UNKNOWN_AGENT_RESPONSE_PROMPT_REF = "__tractor:no-prompt-ref__";
export const AGENT_RESPONSE_STREAM_REF_PREFIX =
	"urn:tractor:stream:response:";

export function agentResponseStreamRef(promptRef: string): string {
	return `${AGENT_RESPONSE_STREAM_REF_PREFIX}${promptRef}`;
}

export function isAgentResponseStreamRef(streamRef: string): boolean {
	return streamRef.startsWith(AGENT_RESPONSE_STREAM_REF_PREFIX);
}

export function promptRefFromAgentResponseStreamRef(
	streamRef: string,
): string | null {
	return streamRef.startsWith(AGENT_RESPONSE_STREAM_REF_PREFIX)
		? streamRef.slice(AGENT_RESPONSE_STREAM_REF_PREFIX.length)
		: null;
}

export function emptyResponseStreamState(
	promptRef: string | null = null,
): ResponseStreamState {
	return {
		promptRef,
		content: "",
		lastSequence: null,
		isFinal: false,
	};
}

export function applyResponseStreamEvent(
	state: ResponseStreamState,
	event: ResponseStreamEvent,
): ResponseStreamState {
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

export function reduceResponseStreamEvents(
	events: readonly ResponseStreamEvent[],
	initialState: ResponseStreamState = emptyResponseStreamState(),
): ResponseStreamState {
	return events.reduce(applyResponseStreamEvent, initialState);
}

export function orderResponseStreamEvents<
	T extends ResponseStreamEvent,
>(events: readonly T[]): T[] {
	return [...events].sort((a, b) => streamSequence(a) - streamSequence(b));
}

function streamSequence(event: ResponseStreamEvent): number {
	return typeof event.sequence === "number" && Number.isFinite(event.sequence)
		? event.sequence
		: Number.MAX_SAFE_INTEGER;
}

export function agentResponseStreamKey(
	event: ResponseStreamEvent,
): string {
	return typeof event.prompt_ref === "string"
		? event.prompt_ref
		: UNKNOWN_AGENT_RESPONSE_PROMPT_REF;
}

export function applyResponseStreamEventToMap(
	stateMap: ResponseStreamStateMap,
	event: ResponseStreamEvent,
): ResponseStreamStateMap {
	const key = agentResponseStreamKey(event);
	const previous =
		stateMap[key] ??
		emptyResponseStreamState(
			key === UNKNOWN_AGENT_RESPONSE_PROMPT_REF ? null : key,
		);

	return {
		...stateMap,
		[key]: applyResponseStreamEvent(previous, event),
	};
}

export function reduceResponseStreamEventsByPrompt(
	events: readonly ResponseStreamEvent[],
	initialStateMap: ResponseStreamStateMap = {},
): ResponseStreamStateMap {
	return events.reduce(applyResponseStreamEventToMap, initialStateMap);
}

export function isTerminalResponseStreamEvent(
	event: ResponseStreamEvent,
): boolean {
	return event.is_final === true;
}

export function isTerminalResponseStreamState(
	state: ResponseStreamState,
): boolean {
	return state.isFinal === true;
}
