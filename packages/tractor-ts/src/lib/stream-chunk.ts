export interface StreamChunkEvent {
	stream_ref?: string | null;
	content?: string | null;
	sequence?: number | null;
	payload_kind?: string | null;
	is_final?: boolean | null;
	metadata?: unknown;
	[key: string]: unknown;
}

export interface StreamChunkState {
	streamRef: string | null;
	content: string;
	lastSequence: number | null;
	isFinal: boolean;
	payloadKind: string | null;
}

export type StreamChunkStateMap = Record<string, StreamChunkState>;

export const UNKNOWN_STREAM_REF = "__tractor:no-stream-ref__";

export function emptyStreamChunkState(
	streamRef: string | null = null,
): StreamChunkState {
	return {
		streamRef,
		content: "",
		lastSequence: null,
		isFinal: false,
		payloadKind: null,
	};
}

export function applyStreamChunkEvent(
	state: StreamChunkState,
	event: StreamChunkEvent,
): StreamChunkState {
	const eventContent = typeof event.content === "string" ? event.content : "";
	const eventSequence =
		typeof event.sequence === "number" && Number.isFinite(event.sequence)
			? event.sequence
			: state.lastSequence;
	const streamRef =
		typeof event.stream_ref === "string" ? event.stream_ref : state.streamRef;
	const payloadKind =
		typeof event.payload_kind === "string"
			? event.payload_kind
			: state.payloadKind;

	return {
		streamRef,
		content:
			event.is_final === true ? eventContent : state.content + eventContent,
		lastSequence: eventSequence,
		isFinal: event.is_final === true,
		payloadKind,
	};
}

export function reduceStreamChunkEvents(
	events: readonly StreamChunkEvent[],
	initialState: StreamChunkState = emptyStreamChunkState(),
): StreamChunkState {
	return events.reduce(applyStreamChunkEvent, initialState);
}

export function streamChunkKey(event: StreamChunkEvent): string {
	return typeof event.stream_ref === "string"
		? event.stream_ref
		: UNKNOWN_STREAM_REF;
}

export function applyStreamChunkEventToMap(
	stateMap: StreamChunkStateMap,
	event: StreamChunkEvent,
): StreamChunkStateMap {
	const key = streamChunkKey(event);
	const previous =
		stateMap[key] ??
		emptyStreamChunkState(key === UNKNOWN_STREAM_REF ? null : key);

	return {
		...stateMap,
		[key]: applyStreamChunkEvent(previous, event),
	};
}

export function reduceStreamChunkEventsByStream(
	events: readonly StreamChunkEvent[],
	initialStateMap: StreamChunkStateMap = {},
): StreamChunkStateMap {
	return events.reduce(applyStreamChunkEventToMap, initialStateMap);
}
