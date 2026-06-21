import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import { observedTaskResultError } from "./task-observation.js";
import { sidecarUrl } from "./sidecar-url.js";

const REFARM_STREAMS_DIR_ENV_VAR = "REFARM_STREAMS_DIR";
const REFARM_TASK_RESULTS_DIR_ENV_VAR = "REFARM_TASK_RESULTS_DIR";

export interface RuntimeEffortPollFallback {
	status: "ok" | "error";
	content?: string;
	metadata?: Record<string, unknown>;
	error?: string;
}

export interface RuntimeEffortResult {
	status: "ok" | "error";
	content?: string;
	metadata?: Record<string, unknown>;
	error?: string;
}

export interface FollowStreamOptions {
	timeoutMs?: number;
	submittedAtMs?: number;
	readFallback?: () => Promise<RuntimeEffortPollFallback | null>;
}

export interface RuntimeSessionFallbackResult {
	status: "ok";
	content: string;
	metadata?: Record<string, unknown>;
}

export async function readEffortAndSessionFallback(
	effortId: string,
	sessionId: string,
	deps: {
		readEffortResult?: (
			effortId: string,
		) => Promise<RuntimeEffortResult | null>;
		readSessionFallback?: (
			sessionId: string,
		) => Promise<RuntimeSessionFallbackResult | null>;
	},
): Promise<RuntimeEffortResult | RuntimeSessionFallbackResult | null> {
	const fallbackFromEffort = deps.readEffortResult
		? await deps.readEffortResult(effortId)
		: null;
	if (fallbackFromEffort) {
		return fallbackFromEffort;
	}

	if (!deps.readSessionFallback) {
		return null;
	}
	return deps.readSessionFallback(sessionId);
}

function stringEnv(value: string | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

export function resolveRuntimeStreamsDir(
	env: NodeJS.ProcessEnv = process.env,
): string {
	return (
		stringEnv(env[REFARM_STREAMS_DIR_ENV_VAR]) ??
		path.join(os.homedir(), ".refarm", "streams")
	);
}

export function resolveRuntimeTaskResultsDir(
	env: NodeJS.ProcessEnv = process.env,
): string {
	return (
		stringEnv(env[REFARM_TASK_RESULTS_DIR_ENV_VAR]) ??
		path.join(os.homedir(), ".refarm", "task-results")
	);
}

export function followStreamFile(
	streamsDir: string,
	effortId: string,
	onChunk: (chunk: StreamChunk) => void,
	readFallback?: () => Promise<RuntimeEffortPollFallback | null>,
	options?: FollowStreamOptions,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const submittedAtMs = options?.submittedAtMs ?? Date.now();
		const timeoutMs = options?.timeoutMs ?? 45_000;
		const deadline = Date.now() + timeoutMs;

		const resolveStreamFilePath = (): string | null => {
			const exactPath = path.join(streamsDir, `${effortId}.ndjson`);
			if (fs.existsSync(exactPath)) return exactPath;
			if (!fs.existsSync(streamsDir)) return null;

			const candidates = fs
				.readdirSync(streamsDir)
				.filter((filename) => filename.endsWith(".ndjson"))
				.map((filename) => {
					const filePath = path.join(streamsDir, filename);
					const mtimeMs = fs.statSync(filePath).mtimeMs;
					return { filePath, mtimeMs };
				})
				.filter((entry) => entry.mtimeMs >= submittedAtMs - 2_000)
				.sort((left, right) => right.mtimeMs - left.mtimeMs);

			return candidates[0]?.filePath ?? null;
		};

		let filePath: string | null = null;
		let offset = 0;
		let finished = false;
		let polling = false;

		function stopAndReject(message: string): void {
			if (finished) return;
			finished = true;
			clearInterval(timer);
			reject(new Error(message));
		}

		async function readNew(): Promise<void> {
			if (polling) return;
			polling = true;

			try {
				if (finished) return;
				if (!filePath) {
					filePath = resolveStreamFilePath();
				}
				if (filePath && fs.existsSync(filePath)) {
					const content = fs.readFileSync(filePath, "utf-8");
					const lines = content.split("\n").filter(Boolean);
					for (let index = offset; index < lines.length; index++) {
						let chunk: StreamChunk;
						try {
							chunk = JSON.parse(lines[index]!) as StreamChunk;
						} catch {
							continue;
						}
						onChunk(chunk);
						if (chunk.is_final) {
							finished = true;
							clearInterval(timer);
							resolve();
							return;
						}
					}
					offset = lines.length;
				}

				if (readFallback) {
					try {
						const fallback = await readFallback();
						if (
							fallback?.status === "ok" &&
							typeof fallback.content === "string"
						) {
							onChunk({
								stream_ref: effortId,
								sequence: Number.MAX_SAFE_INTEGER,
								content: fallback.content,
								is_final: true,
								metadata: fallback.metadata,
							});
							finished = true;
							clearInterval(timer);
							resolve();
							return;
						}
						if (fallback?.status === "error") {
							stopAndReject(
								fallback.error ?? `Effort ${effortId} failed without details`,
							);
							return;
						}
					} catch {
						// ignore fallback read errors and keep stream polling path
					}
				}

				if (Date.now() >= deadline) {
					stopAndReject(
						filePath
							? `Timed out waiting final stream chunk for effort ${effortId}`
							: `Timed out waiting for stream file for effort ${effortId}`,
					);
				}
			} finally {
				polling = false;
			}
		}

		const timer = setInterval(() => {
			void readNew();
		}, 100);
		void readNew();
	});
}

function parseEffortResultPayload(result: unknown): RuntimeEffortResult | null {
	if (!result || typeof result !== "object") return null;
	const effort = result as {
		status?: string;
		results?: Array<{ status?: string; result?: unknown; error?: unknown }>;
	};
	if (effort.status !== "done" && effort.status !== "failed") return null;
	const task = Array.isArray(effort.results) ? effort.results[0] : undefined;
	if (!task || typeof task !== "object") return null;
	if (task.status === "error") {
		return {
			status: "error",
			error:
				typeof task.error === "string"
					? task.error
					: "Effort finished with task error",
		};
	}

	const observedError = observedTaskResultError(task.result);
	if (observedError) {
		return { status: "error", error: observedError };
	}

	let payload: unknown = task.result;
	if (typeof payload === "string") {
		const rawContent = payload;
		try {
			payload = JSON.parse(payload);
		} catch {
			return { status: "ok", content: rawContent };
		}
	}

	if (typeof payload === "string") return { status: "ok", content: payload };
	if (!payload || typeof payload !== "object") return null;

	const value = payload as {
		content?: unknown;
		model?: unknown;
		provider?: unknown;
		usage?: unknown;
	};
	const content = value.content;
	if (typeof content !== "string") return null;

	const metadata: Record<string, unknown> = {};
	if (typeof value.model === "string") metadata.model = value.model;
	if (typeof value.provider === "string") metadata.provider = value.provider;
	if (value.usage && typeof value.usage === "object") {
		const usage = value.usage as {
			tokens_in?: unknown;
			tokens_out?: unknown;
			pricing_mode?: unknown;
			estimated_usd?: unknown;
		};
		if (typeof usage.tokens_in === "number")
			metadata.tokens_in = usage.tokens_in;
		if (typeof usage.tokens_out === "number")
			metadata.tokens_out = usage.tokens_out;
		if (typeof usage.pricing_mode === "string")
			metadata.pricing_mode = usage.pricing_mode;
		if (typeof usage.estimated_usd === "number")
			metadata.estimated_usd = usage.estimated_usd;
	}

	return {
		status: "ok",
		content,
		metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
	};
}

export function readEffortResultFile(
	resultsDir: string,
	effortId: string,
): Promise<RuntimeEffortResult | null> {
	const resultPath = path.join(resultsDir, `${effortId}.json`);
	if (!fs.existsSync(resultPath)) return Promise.resolve(null);

	try {
		const raw = fs.readFileSync(resultPath, "utf-8");
		const parsed = JSON.parse(raw) as unknown;
		return Promise.resolve(parseEffortResultPayload(parsed));
	} catch {
		return Promise.resolve(null);
	}
}

export async function readLatestAgentEntryFromSession(
	sessionId: string,
): Promise<{
	status: "ok";
	content: string;
	metadata?: Record<string, unknown>;
} | null> {
	try {
		const response = await fetch(
			sidecarUrl(`/sessions/${encodeURIComponent(sessionId)}/history`),
		);
		if (!response.ok) return null;
		const payload = (await response.json()) as {
			entries?: Array<{ kind?: unknown; content?: unknown }>;
		};
		const agentEntry = [...(payload.entries ?? [])]
			.reverse()
			.find(
				(entry) => entry.kind === "agent" && typeof entry.content === "string",
			);
		if (!agentEntry || typeof agentEntry.content !== "string") return null;
		return {
			status: "ok",
			content: agentEntry.content,
			metadata: { source: "session-history" },
		};
	} catch {
		return null;
	}
}
