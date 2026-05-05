import {
	isTerminalStreamChunkState,
	type StreamChunkState,
	type StreamChunkStateMap,
	streamChunkModel,
	streamChunkProjection,
	streamChunkPromptRef,
	streamChunkProviderFamily,
} from "./stream-chunk";
import {
	isActiveStreamSession,
	isTerminalStreamSession,
	type StreamSessionState,
	type StreamSessionStateMap,
	streamSessionDurationNs,
	streamSessionFailureKind,
	streamSessionFailureReason,
	streamSessionModel,
	streamSessionProjection,
	streamSessionPromptRef,
	streamSessionProviderFamily,
} from "./stream-session";

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

function coalesce(...values: Array<string | null>): string | null {
	return values.find((value) => value !== null) ?? null;
}
