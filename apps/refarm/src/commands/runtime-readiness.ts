import { fetchSidecarWithTimeout } from "./sidecar-fetch.js";
import { sidecarUrl } from "./sidecar-url.js";

export interface RuntimeReadinessProbe {
	url: string;
	ready: boolean;
	status?: number;
	error?: string;
	timedOut?: boolean;
}

export interface RuntimeReadinessWaitOptions {
	timeoutMs?: number;
	pollIntervalMs?: number;
	probeTimeoutMs?: number;
}

const DEFAULT_RUNTIME_READY_TIMEOUT_MS = 10_000;
const DEFAULT_RUNTIME_READY_POLL_INTERVAL_MS = 300;
const DEFAULT_RUNTIME_PROBE_TIMEOUT_MS = 1_500;

function readinessError(error: unknown): { error: string; timedOut?: boolean } {
	if (error instanceof Error) {
		const cause = (error as Error & { cause?: unknown }).cause;
		const causeMessage =
			cause instanceof Error
				? cause.message
				: typeof cause === "object" && cause && "message" in cause
					? String((cause as { message?: unknown }).message)
					: null;
		const code =
			typeof cause === "object" && cause && "code" in cause
				? String((cause as { code?: unknown }).code)
				: null;
		return {
			error: [error.message, code, causeMessage]
				.filter((value): value is string => Boolean(value))
				.join(": "),
			...(error.name === "AbortError" ? { timedOut: true } : {}),
		};
	}
	return { error: String(error) };
}

type RuntimeProbeResult = {
	url: string;
	ready: boolean;
	status?: number;
	error?: string;
	timedOut?: boolean;
};

async function probeRuntimeEndpoint(
	path: string,
	probeTimeoutMs: number,
): Promise<RuntimeProbeResult> {
	const url = sidecarUrl(path);
	try {
		const response = await fetchSidecarWithTimeout(url, {}, { timeoutMs: probeTimeoutMs });
		return {
			url,
			ready: response.ok,
			status: response.status,
		};
	} catch (error) {
		return {
			url,
			ready: false,
			...readinessError(error),
		};
	}
}

export async function probeRuntimeReadiness(
	probeTimeoutMs = DEFAULT_RUNTIME_PROBE_TIMEOUT_MS,
): Promise<RuntimeReadinessProbe> {
	const effortsProbe = await probeRuntimeEndpoint("/efforts/summary", probeTimeoutMs);
	if (!effortsProbe.ready) return effortsProbe;

	const sessionsProbe = await probeRuntimeEndpoint("/sessions", probeTimeoutMs);
	if (!sessionsProbe.ready) return sessionsProbe;

	return {
		...effortsProbe,
		status: sessionsProbe.status,
	};
}

export async function probeRuntimeLiveness(
	probeTimeoutMs = DEFAULT_RUNTIME_PROBE_TIMEOUT_MS,
): Promise<RuntimeReadinessProbe> {
	return probeRuntimeEndpoint("/efforts/summary", probeTimeoutMs);
}

export async function probeRuntimeReady(
	probeTimeoutMs = DEFAULT_RUNTIME_PROBE_TIMEOUT_MS,
): Promise<boolean> {
	return (await probeRuntimeReadiness(probeTimeoutMs)).ready;
}

export async function waitForRuntimeReady(
	options: RuntimeReadinessWaitOptions = {},
): Promise<boolean> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_RUNTIME_READY_TIMEOUT_MS;
	const pollIntervalMs =
		options.pollIntervalMs ?? DEFAULT_RUNTIME_READY_POLL_INTERVAL_MS;
	const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_RUNTIME_PROBE_TIMEOUT_MS;
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (await probeRuntimeReady(probeTimeoutMs)) return true;
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}
	return false;
}
