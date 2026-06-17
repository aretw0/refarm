import { randomUUID } from "node:crypto";
import type { Effort } from "@refarm.dev/effort-contract-v1";

const TASK_TRANSPORTS = ["file", "http"] as const;
type StaticDispatchTransport = (typeof TASK_TRANSPORTS)[number];

export type ChannelDispatchTransport = `channel:${string}`;
export type DispatchTransport =
	| StaticDispatchTransport
	| ChannelDispatchTransport;

interface NativeDispatchTransportFile {
	tag: "file";
}

interface NativeDispatchTransportHttp {
	tag: "http";
}

interface NativeDispatchTransportChannel {
	tag: "channel";
	val: string;
}

type NativeDispatchTransport =
	| NativeDispatchTransportFile
	| NativeDispatchTransportHttp
	| NativeDispatchTransportChannel;

interface NativeDispatchSurface {
	parseTaskTransport(transport: string): NativeDispatchTransport;
	resolveChannelFromTransport(
		transport: NativeDispatchTransport,
	): string | undefined;
	isChannelEffortPayload(payloadJson: string): boolean;
	normalizeChannelSource(channel: string, source: string | undefined): string;
	normalizeChannelContext(
		contextJson: string,
		channel: string,
		replyTo: string | undefined,
		traceIdsJson: string | undefined,
	): string;
	buildChannelEffort(payloadJson: string, channel: string): string;
	buildChannelEffortsPath(baseUrl: string, channel: string): string;
	buildChannelEffortPath(
		baseUrl: string,
		channel: string,
		effortId: string,
		segment?: string,
	): string;
	encodeChannel(channel: string): string;
	decodeChannel(channel: string): string;
}

export interface RawChannelEffortPayload extends Partial<Effort> {
	direction: string;
	tasks: Effort["tasks"];
	replyTo?: unknown;
	traceIds?: unknown;
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function toNativeDispatchTransport(
	transport: DispatchTransport,
): NativeDispatchTransport {
	if (transport === "file") return { tag: "file" };
	if (transport === "http") return { tag: "http" };
	return { tag: "channel", val: transport.slice("channel:".length) };
}

function nativeDispatchTransportToString(
	transport: NativeDispatchTransport,
): DispatchTransport {
	switch (transport.tag) {
		case "file":
			return "file";
		case "http":
			return "http";
		case "channel":
			return `channel:${transport.val}`;
		default:
			throw new Error("Invalid dispatch transport payload from Rust backend");
	}
}

function isNativeEnabled(): boolean {
	if (typeof process === "undefined") return false;
	if (process.env.DISPATCH_SURFACE_SKIP_RUST === "1") return false;
	return process.env.DISPATCH_SURFACE_USE_RUST !== "0";
}

async function loadNativeBinding(): Promise<NativeDispatchSurface | null> {
	if (!isNativeEnabled()) return null;

	try {
		const moduleUrl = new URL(
			"../../dispatch-surface-rs/pkg/dispatch_surface.js",
			import.meta.url,
		);
		const module = (await import(moduleUrl.href)) as {
			dispatchSurfaceControl?: NativeDispatchSurface;
		};
		if (!module.dispatchSurfaceControl) return null;
		return module.dispatchSurfaceControl;
	} catch {
		return null;
	}
}

const nativeBinding = await loadNativeBinding();

export function isChannelDispatchTransport(
	value: string,
): value is ChannelDispatchTransport {
	return (
		value.startsWith("channel:") &&
		value.slice("channel:".length).trim().length > 0
	);
}

export function parseTaskTransport(value: string): DispatchTransport {
	if (nativeBinding) {
		try {
			return nativeDispatchTransportToString(
				nativeBinding.parseTaskTransport(value),
			);
		} catch {
			// Fallback to TS implementation
		}
	}

	if ((TASK_TRANSPORTS as readonly string[]).includes(value)) {
		return value as DispatchTransport;
	}
	if (isChannelDispatchTransport(value)) {
		return value as DispatchTransport;
	}
	throw new Error(
		`Invalid task transport "${value}". Use: ${TASK_TRANSPORTS.join(", ")}, channel:<name>`,
	);
}

export function resolveChannelFromTransport(
	transport: DispatchTransport,
): string | undefined {
	if (nativeBinding) {
		try {
			return nativeBinding.resolveChannelFromTransport(
				toNativeDispatchTransport(transport),
			);
		} catch {
			// Fallback to local behavior
		}
	}
	if (!isChannelDispatchTransport(transport)) return undefined;
	return transport.slice("channel:".length);
}

export function isChannelEffortPayload(
	value: unknown,
): value is RawChannelEffortPayload {
	if (nativeBinding) {
		try {
			return nativeBinding.isChannelEffortPayload(
				typeof value === "string" ? value : JSON.stringify(value),
			);
		} catch {
			// Fallback to local behavior.
		}
	}

	if (!isRecord(value)) return false;
	if (typeof value.direction !== "string" || value.direction.length === 0)
		return false;
	if (!Array.isArray(value.tasks)) return false;
	return true;
}

export function encodeChannel(channel: string): string {
	if (nativeBinding) {
		return nativeBinding.encodeChannel(channel);
	}
	return encodeURIComponent(channel);
}

export function decodeChannel(channel: string): string {
	if (nativeBinding) {
		return nativeBinding.decodeChannel(channel);
	}
	return decodeURIComponent(channel);
}

export function normalizeChannelSource(
	channel: string,
	source: unknown,
): string {
	if (nativeBinding) {
		const value =
			isString(source) && source.trim().length > 0 ? source : undefined;
		return nativeBinding.normalizeChannelSource(channel, value);
	}
	if (isString(source) && source.trim().length > 0) return source;
	return `channel:${channel}`;
}

export function normalizeChannelContext(
	context: unknown,
	channel: string,
	replyTo: unknown,
	traceIds: unknown,
): Record<string, unknown> {
	if (nativeBinding) {
		const contextJson = isRecord(context) ? JSON.stringify(context) : "{}";
		const replyToJson = isString(replyTo)
			? replyTo
			: replyTo === undefined
				? undefined
				: JSON.stringify(replyTo);
		const traceIdsJson = Array.isArray(traceIds)
			? JSON.stringify(traceIds)
			: undefined;
		return JSON.parse(
			nativeBinding.normalizeChannelContext(
				contextJson,
				channel,
				replyToJson,
				traceIdsJson,
			),
		);
	}

	const existing = isRecord(context)
		? (context as Record<string, unknown>)
		: {};
	const next: Record<string, unknown> = { ...existing, channel };
	if (replyTo !== undefined) next.replyTo = replyTo;
	if (Array.isArray(traceIds)) next.traceIds = traceIds;
	return next;
}

export function buildChannelEffort(
	body: RawChannelEffortPayload,
	channel: string,
): Effort {
	if (nativeBinding) {
		const effort = JSON.parse(
			nativeBinding.buildChannelEffort(JSON.stringify(body), channel),
		) as Effort;
		if (isRecord(effort)) {
			return {
				id: effort.id ?? body.id ?? randomUUID(),
				direction: effort.direction ?? body.direction,
				tasks: effort.tasks ?? body.tasks,
				source: effort.source ?? `channel:${channel}`,
				context:
					effort.context && isRecord(effort.context)
						? effort.context
						: isRecord(body.context)
							? body.context
							: { channel },
				submittedAt: effort.submittedAt ?? new Date().toISOString(),
				...(typeof effort.priority === "number"
					? { priority: effort.priority }
					: typeof body.priority === "number"
						? { priority: body.priority }
						: {}),
				...(Array.isArray(effort.tags)
					? { tags: effort.tags }
					: Array.isArray(body.tags)
						? { tags: body.tags }
						: {}),
			};
		}
	}

	return {
		id: body.id ?? randomUUID(),
		direction: body.direction,
		tasks: body.tasks,
		source: normalizeChannelSource(channel, body.source),
		context: normalizeChannelContext(
			body.context,
			channel,
			body.replyTo,
			body.traceIds,
		),
		submittedAt: body.submittedAt ?? new Date().toISOString(),
		...(typeof body.priority === "number" ? { priority: body.priority } : {}),
		...(Array.isArray(body.tags) ? { tags: body.tags } : {}),
	};
}

export function buildChannelEffortsPath(
	baseUrl: string,
	channel: string,
): string {
	if (nativeBinding) {
		return nativeBinding.buildChannelEffortsPath(baseUrl, channel);
	}
	return `${baseUrl.replace(/\/$/, "")}/channels/${encodeURIComponent(
		channel,
	)}/efforts`;
}

export function buildChannelEffortPath(
	baseUrl: string,
	channel: string,
	effortId: string,
	segment?: string,
): string {
	if (nativeBinding) {
		return nativeBinding.buildChannelEffortPath(
			baseUrl,
			channel,
			effortId,
			segment,
		);
	}
	return `${buildChannelEffortsPath(baseUrl, channel)}/${encodeURIComponent(
		effortId,
	)}${segment ? `/${segment}` : ""}`;
}
