import { fetchSidecarWithTimeout } from "@refarm.dev/sidecar-client";

/**
 * Probe and wait for the runtime daemon's HTTP sidecar to be ready — the readiness half
 * of the runtime operator. It is storage-free by design: the sidecar URL is INJECTED
 * (a base URL or a resolver), so this package never reads the sovereign config. An app
 * that resolves its sidecar URL from a config node passes a resolver; a test or a simple
 * host passes a literal base URL. Either way the probe/poll logic is shared.
 */

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

/** How the operator learns where the sidecar is: a fixed base URL, or a (possibly
 * async) resolver an app wires to its own config. The path is appended by the probe. */
export type SidecarUrlSource = string | (() => string | Promise<string>);

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

async function resolveBaseUrl(source: SidecarUrlSource): Promise<string> {
	const base = typeof source === "function" ? await source() : source;
	return base.replace(/\/+$/, "");
}

async function probeRuntimeEndpoint(
	base: string,
	path: string,
	probeTimeoutMs: number,
): Promise<RuntimeReadinessProbe> {
	const url = `${base}${path}`;
	try {
		const response = await fetchSidecarWithTimeout(url, {}, { timeoutMs: probeTimeoutMs });
		return { url, ready: response.ok, status: response.status };
	} catch (error) {
		return { url, ready: false, ...readinessError(error) };
	}
}

/** Ready = the effort protocol AND sessions both answer. Mirrors the two-endpoint
 * check the refarm runtime command has always used. */
export async function probeRuntimeReadiness(
	sidecar: SidecarUrlSource,
	probeTimeoutMs = DEFAULT_RUNTIME_PROBE_TIMEOUT_MS,
): Promise<RuntimeReadinessProbe> {
	const base = await resolveBaseUrl(sidecar);
	const effortsProbe = await probeRuntimeEndpoint(base, "/efforts/summary", probeTimeoutMs);
	if (!effortsProbe.ready) return effortsProbe;

	const sessionsProbe = await probeRuntimeEndpoint(base, "/sessions", probeTimeoutMs);
	if (!sessionsProbe.ready) return sessionsProbe;

	return { ...effortsProbe, status: sessionsProbe.status };
}

/** Liveness = the effort protocol answers (weaker than readiness). */
export async function probeRuntimeLiveness(
	sidecar: SidecarUrlSource,
	probeTimeoutMs = DEFAULT_RUNTIME_PROBE_TIMEOUT_MS,
): Promise<RuntimeReadinessProbe> {
	const base = await resolveBaseUrl(sidecar);
	return probeRuntimeEndpoint(base, "/efforts/summary", probeTimeoutMs);
}

export async function probeRuntimeReady(
	sidecar: SidecarUrlSource,
	probeTimeoutMs = DEFAULT_RUNTIME_PROBE_TIMEOUT_MS,
): Promise<boolean> {
	return (await probeRuntimeReadiness(sidecar, probeTimeoutMs)).ready;
}

export async function waitForRuntimeReady(
	sidecar: SidecarUrlSource,
	options: RuntimeReadinessWaitOptions = {},
): Promise<boolean> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_RUNTIME_READY_TIMEOUT_MS;
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_RUNTIME_READY_POLL_INTERVAL_MS;
	const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_RUNTIME_PROBE_TIMEOUT_MS;
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (await probeRuntimeReady(sidecar, probeTimeoutMs)) return true;
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}
	return false;
}
