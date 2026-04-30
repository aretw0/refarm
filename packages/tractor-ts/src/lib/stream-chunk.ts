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
export const TERMINAL_STREAM_CHUNK_PAYLOAD_KINDS = new Set([
	"final_text",
	"final_tool_call",
	"final_empty",
]);

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

export function orderStreamChunkEvents<T extends StreamChunkEvent>(
	events: readonly T[],
): T[] {
	return [...events].sort((a, b) => streamSequence(a) - streamSequence(b));
}

function streamSequence(event: StreamChunkEvent): number {
	return typeof event.sequence === "number" && Number.isFinite(event.sequence)
		? event.sequence
		: Number.MAX_SAFE_INTEGER;
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

export function isTerminalStreamChunkPayloadKind(
	payloadKind: string | null,
): boolean {
	return (
		typeof payloadKind === "string" &&
		TERMINAL_STREAM_CHUNK_PAYLOAD_KINDS.has(payloadKind)
	);
}

export function isTerminalStreamChunk(event: StreamChunkEvent): boolean {
	return (
		event.is_final === true ||
		isTerminalStreamChunkPayloadKind(
			typeof event.payload_kind === "string" ? event.payload_kind : null,
		)
	);
}

export function isTerminalStreamChunkState(state: StreamChunkState): boolean {
	return (
		state.isFinal === true ||
		isTerminalStreamChunkPayloadKind(state.payloadKind)
	);
}
