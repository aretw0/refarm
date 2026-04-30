export interface StreamSessionEvent {
	stream_ref?: string | null;
	stream_kind?: string | null;
	status?: string | null;
	started_at_ns?: number | null;
	updated_at_ns?: number | null;
	completed_at_ns?: number | null;
	last_sequence?: number | null;
	chunk_count?: number | null;
	metadata?: unknown;
	[key: string]: unknown;
}

export interface StreamSessionState {
	streamRef: string | null;
	streamKind: string | null;
	status: string | null;
	startedAtNs: number | null;
	updatedAtNs: number | null;
	completedAtNs: number | null;
	lastSequence: number | null;
	chunkCount: number;
	metadata: unknown;
}

export type StreamSessionStateMap = Record<string, StreamSessionState>;

export const UNKNOWN_STREAM_SESSION_REF = "__tractor:no-stream-session-ref__";

export function emptyStreamSessionState(
	streamRef: string | null = null,
): StreamSessionState {
	return {
		streamRef,
		streamKind: null,
		status: null,
		startedAtNs: null,
		updatedAtNs: null,
		completedAtNs: null,
		lastSequence: null,
		chunkCount: 0,
		metadata: null,
	};
}

export function applyStreamSessionEvent(
	state: StreamSessionState,
	event: StreamSessionEvent,
): StreamSessionState {
	return {
		streamRef:
			typeof event.stream_ref === "string" ? event.stream_ref : state.streamRef,
		streamKind:
			typeof event.stream_kind === "string"
				? event.stream_kind
				: state.streamKind,
		status: typeof event.status === "string" ? event.status : state.status,
		startedAtNs: finiteNumberOr(event.started_at_ns, state.startedAtNs),
		updatedAtNs: finiteNumberOr(event.updated_at_ns, state.updatedAtNs),
		completedAtNs: finiteNumberOr(event.completed_at_ns, state.completedAtNs),
		lastSequence: finiteNumberOr(event.last_sequence, state.lastSequence),
		chunkCount: finiteNumberOr(event.chunk_count, state.chunkCount) ?? 0,
		metadata: event.metadata ?? state.metadata,
	};
}

export function reduceStreamSessionEvents(
	events: readonly StreamSessionEvent[],
	initialState: StreamSessionState = emptyStreamSessionState(),
): StreamSessionState {
	return events.reduce(applyStreamSessionEvent, initialState);
}

export function orderStreamSessionEvents<T extends StreamSessionEvent>(
	events: readonly T[],
): T[] {
	return [...events].sort(
		(a, b) => streamSessionSortValue(a) - streamSessionSortValue(b),
	);
}

export function streamSessionKey(event: StreamSessionEvent): string {
	return typeof event.stream_ref === "string"
		? event.stream_ref
		: UNKNOWN_STREAM_SESSION_REF;
}

export function applyStreamSessionEventToMap(
	stateMap: StreamSessionStateMap,
	event: StreamSessionEvent,
): StreamSessionStateMap {
	const key = streamSessionKey(event);
	const previous =
		stateMap[key] ??
		emptyStreamSessionState(key === UNKNOWN_STREAM_SESSION_REF ? null : key);

	return {
		...stateMap,
		[key]: applyStreamSessionEvent(previous, event),
	};
}

export function reduceStreamSessionEventsByStream(
	events: readonly StreamSessionEvent[],
	initialStateMap: StreamSessionStateMap = {},
): StreamSessionStateMap {
	return events.reduce(applyStreamSessionEventToMap, initialStateMap);
}

export function isTerminalStreamSessionStatus(status: string | null): boolean {
	return status === "completed" || status === "failed";
}

export function isTerminalStreamSession(state: StreamSessionState): boolean {
	return isTerminalStreamSessionStatus(state.status);
}

export function streamSessionFailureReason(
	state: StreamSessionState,
): string | null {
	return metadataStringField(state.metadata, "failure_reason");
}

export function streamSessionFailureKind(
	state: StreamSessionState,
): string | null {
	return metadataStringField(state.metadata, "failure_kind");
}

function streamSessionSortValue(event: StreamSessionEvent): number {
	return (
		finiteNumberOr(event.updated_at_ns, null) ??
		finiteNumberOr(event.completed_at_ns, null) ??
		finiteNumberOr(event.started_at_ns, null) ??
		Number.MAX_SAFE_INTEGER
	);
}

function metadataStringField(metadata: unknown, field: string): string | null {
	if (
		typeof metadata !== "object" ||
		metadata === null ||
		!(field in metadata)
	) {
		return null;
	}
	const value = (metadata as Record<string, unknown>)[field];
	return typeof value === "string" ? value : null;
}

function finiteNumberOr(
	value: number | null | undefined,
	fallback: number | null,
): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
