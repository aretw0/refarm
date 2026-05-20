export interface StreamSessionEvent {
	stream_ref?: string | null;
	stream_kind?: StreamSessionKind | string | null;
	status?: StreamSessionStatus | string | null;
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
	streamKind: StreamSessionKind | string | null;
	status: StreamSessionStatus | string | null;
	startedAtNs: number | null;
	updatedAtNs: number | null;
	completedAtNs: number | null;
	lastSequence: number | null;
	chunkCount: number;
	metadata: unknown;
}

export type StreamSessionStateMap = Record<string, StreamSessionState>;

export const UNKNOWN_STREAM_SESSION_REF = "__homestead:no-stream-session-ref__";
export const STREAM_SESSION_KIND_AGENT_RESPONSE = "agent-response";
export const STREAM_SESSION_STATUS_ACTIVE = "active";
export const STREAM_SESSION_STATUS_COMPLETED = "completed";
export const STREAM_SESSION_STATUS_FAILED = "failed";

export type StreamSessionKind = typeof STREAM_SESSION_KIND_AGENT_RESPONSE;

export type StreamSessionStatus =
	| typeof STREAM_SESSION_STATUS_ACTIVE
	| typeof STREAM_SESSION_STATUS_COMPLETED
	| typeof STREAM_SESSION_STATUS_FAILED;

export interface StreamChunkEvent {
	stream_ref?: string | null;
	content?: string | null;
	sequence?: number | null;
	payload_kind?: StreamChunkPayloadKind | string | null;
	is_final?: boolean | null;
	metadata?: unknown;
	[key: string]: unknown;
}

export interface StreamChunkState {
	streamRef: string | null;
	content: string;
	lastSequence: number | null;
	isFinal: boolean;
	payloadKind: StreamChunkPayloadKind | string | null;
	metadata: unknown;
}

export type StreamChunkStateMap = Record<string, StreamChunkState>;

export const UNKNOWN_STREAM_REF = "__homestead:no-stream-ref__";
export const STREAM_CHUNK_PAYLOAD_KIND_TEXT_DELTA = "text_delta";
export const STREAM_CHUNK_PAYLOAD_KIND_FINAL_TEXT = "final_text";
export const STREAM_CHUNK_PAYLOAD_KIND_FINAL_TOOL_CALL = "final_tool_call";
export const STREAM_CHUNK_PAYLOAD_KIND_FINAL_EMPTY = "final_empty";

export type StreamChunkPayloadKind =
	| typeof STREAM_CHUNK_PAYLOAD_KIND_TEXT_DELTA
	| TerminalStreamChunkPayloadKind;

export type TerminalStreamChunkPayloadKind =
	| typeof STREAM_CHUNK_PAYLOAD_KIND_FINAL_TEXT
	| typeof STREAM_CHUNK_PAYLOAD_KIND_FINAL_TOOL_CALL
	| typeof STREAM_CHUNK_PAYLOAD_KIND_FINAL_EMPTY;

const TERMINAL_STREAM_CHUNK_PAYLOAD_KINDS = new Set([
	STREAM_CHUNK_PAYLOAD_KIND_FINAL_TEXT,
	STREAM_CHUNK_PAYLOAD_KIND_FINAL_TOOL_CALL,
	STREAM_CHUNK_PAYLOAD_KIND_FINAL_EMPTY,
]);

export interface StreamObservationViewInput {
	streamRef?: string | null;
	session?: StreamSessionState | null;
	chunk?: StreamChunkState | null;
}

export interface StreamObservationView {
	streamRef: string | null;
	content: string;
	status: StreamSessionState["status"] | null;
	payloadKind: StreamChunkState["payloadKind"] | null;
	isActive: boolean;
	isTerminal: boolean;
	lastSequence: number | null;
	chunkCount: number;
	projection: string | null;
	promptRef: string | null;
	providerFamily: string | null;
	model: string | null;
	durationNs: number | null;
	failureKind: string | null;
	failureReason: string | null;
}

export type StreamObservationViewMap = Record<string, StreamObservationView>;

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

export function applyStreamSessionEventToMap(
	stateMap: StreamSessionStateMap,
	event: StreamSessionEvent,
): StreamSessionStateMap {
	const key = streamSessionKey(event);
	const previous =
		stateMap[key] ??
		emptyStreamSessionState(
			key === UNKNOWN_STREAM_SESSION_REF ? null : key,
		);

	return {
		...stateMap,
		[key]: applyStreamSessionEvent(previous, event),
	};
}

export function emptyStreamChunkState(
	streamRef: string | null = null,
): StreamChunkState {
	return {
		streamRef,
		content: "",
		lastSequence: null,
		isFinal: false,
		payloadKind: null,
		metadata: null,
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
		metadata: event.metadata ?? state.metadata,
	};
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

export function streamObservationView({
	streamRef,
	session,
	chunk,
}: StreamObservationViewInput): StreamObservationView {
	const resolvedStreamRef =
		streamRef ?? session?.streamRef ?? chunk?.streamRef ?? null;
	const isTerminal = Boolean(
		(session && isTerminalStreamSession(session)) ||
			(chunk && isTerminalStreamChunkState(chunk)),
	);

	return {
		streamRef: resolvedStreamRef,
		content: chunk?.content ?? "",
		status: session?.status ?? null,
		payloadKind: chunk?.payloadKind ?? null,
		isActive: Boolean(session && isActiveStreamSession(session) && !isTerminal),
		isTerminal,
		lastSequence: session?.lastSequence ?? chunk?.lastSequence ?? null,
		chunkCount: session?.chunkCount ?? 0,
		projection: coalesce(
			session ? streamSessionProjection(session) : null,
			chunk ? streamChunkProjection(chunk) : null,
		),
		promptRef: coalesce(
			session ? streamSessionPromptRef(session) : null,
			chunk ? streamChunkPromptRef(chunk) : null,
		),
		providerFamily: coalesce(
			session ? streamSessionProviderFamily(session) : null,
			chunk ? streamChunkProviderFamily(chunk) : null,
		),
		model: coalesce(
			session ? streamSessionModel(session) : null,
			chunk ? streamChunkModel(chunk) : null,
		),
		durationNs: session ? streamSessionDurationNs(session) : null,
		failureKind: session ? streamSessionFailureKind(session) : null,
		failureReason: session ? streamSessionFailureReason(session) : null,
	};
}

export function streamObservationViewsByStream(
	sessions: StreamSessionStateMap = {},
	chunks: StreamChunkStateMap = {},
): StreamObservationViewMap {
	const keys = new Set([...Object.keys(sessions), ...Object.keys(chunks)]);
	const views: StreamObservationViewMap = {};

	for (const key of keys) {
		views[key] = streamObservationView({
			streamRef: key,
			session: sessions[key] ?? null,
			chunk: chunks[key] ?? null,
		});
	}

	return views;
}

function streamSessionKey(event: StreamSessionEvent): string {
	return typeof event.stream_ref === "string"
		? event.stream_ref
		: UNKNOWN_STREAM_SESSION_REF;
}

function streamChunkKey(event: StreamChunkEvent): string {
	return typeof event.stream_ref === "string"
		? event.stream_ref
		: UNKNOWN_STREAM_REF;
}

function isActiveStreamSession(state: StreamSessionState): boolean {
	return state.status === STREAM_SESSION_STATUS_ACTIVE;
}

function isTerminalStreamSession(state: StreamSessionState): boolean {
	return (
		state.status === STREAM_SESSION_STATUS_COMPLETED ||
		state.status === STREAM_SESSION_STATUS_FAILED
	);
}

function isTerminalStreamChunkState(state: StreamChunkState): boolean {
	return (
		state.isFinal === true ||
		(typeof state.payloadKind === "string" &&
			TERMINAL_STREAM_CHUNK_PAYLOAD_KINDS.has(state.payloadKind))
	);
}

function streamSessionProjection(
	state: StreamSessionState,
): string | null {
	return metadataStringField(state.metadata, "projection");
}

function streamSessionPromptRef(
	state: StreamSessionState,
): string | null {
	return metadataStringField(state.metadata, "prompt_ref");
}

function streamSessionProviderFamily(
	state: StreamSessionState,
): string | null {
	return metadataStringField(state.metadata, "provider_family");
}

function streamSessionModel(state: StreamSessionState): string | null {
	return metadataStringField(state.metadata, "model");
}

function streamSessionDurationNs(
	state: StreamSessionState,
): number | null {
	if (state.startedAtNs === null || state.completedAtNs === null) {
		return null;
	}
	return Math.max(0, state.completedAtNs - state.startedAtNs);
}

function streamSessionFailureReason(
	state: StreamSessionState,
): string | null {
	return metadataStringField(state.metadata, "failure_reason");
}

function streamSessionFailureKind(
	state: StreamSessionState,
): string | null {
	return metadataStringField(state.metadata, "failure_kind");
}

function streamChunkProjection(state: StreamChunkState): string | null {
	return metadataStringField(state.metadata, "projection");
}

function streamChunkPromptRef(state: StreamChunkState): string | null {
	return metadataStringField(state.metadata, "prompt_ref");
}

function streamChunkProviderFamily(
	state: StreamChunkState,
): string | null {
	return metadataStringField(state.metadata, "provider_family");
}

function streamChunkModel(state: StreamChunkState): string | null {
	return metadataStringField(state.metadata, "model");
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

function coalesce(...values: Array<string | null>): string | null {
	return values.find((value) => value !== null) ?? null;
}
