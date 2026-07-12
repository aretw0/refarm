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
	return (await waitForRuntimeOutcome(sidecar, options)).ready;
}

/** Why a readiness wait ended — the honest three-way distinction a naked boolean lost.
 * `ready`: both endpoints answered. `timed-out-alive`: the deadline passed but the daemon
 * was REACHING back (endpoints connecting, just not ready yet) — it is booting, not dead.
 * `timed-out-dead`: the deadline passed and nothing ever answered (connection refused
 * throughout) — the daemon is not there. The last two look identical to a boolean, but a
 * surface must narrate them differently: "still starting…" vs "failed to start". */
export type RuntimeWaitStatus = "ready" | "timed-out-alive" | "timed-out-dead";

export interface RuntimeWaitOutcome {
	ready: boolean;
	status: RuntimeWaitStatus;
	/** How long the wait ran, ms. */
	elapsedMs: number;
	/** The last probe seen — carries the endpoint error/status for diagnostics. */
	lastProbe?: RuntimeReadinessProbe;
}

/** Does this probe error mean "nobody is listening" (daemon absent) rather than "someone
 * answered but not ready / slowly"? A refused/reset/unreachable connection = dead; a
 * timeout or an HTTP status = something IS there, still coming up. */
function probeIndicatesDead(probe: RuntimeReadinessProbe): boolean {
	if (probe.status !== undefined) return false; // an HTTP response came back → alive
	const error = probe.error ?? "";
	return /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENOTFOUND| made no reply|socket hang up/i.test(
		error,
	);
}

/**
 * Poll until the runtime is ready OR the deadline passes, returning WHY it stopped. On
 * timeout it reports whether the daemon was alive-but-booting or genuinely absent, so the
 * caller can narrate honestly instead of always crying "timed out". Tracks the last probe
 * across the loop: if any poll saw a live-but-not-ready signal, a final timeout is
 * `timed-out-alive`; if every poll was connection-refused, it is `timed-out-dead`.
 */
export async function waitForRuntimeOutcome(
	sidecar: SidecarUrlSource,
	options: RuntimeReadinessWaitOptions = {},
): Promise<RuntimeWaitOutcome> {
	const timeoutMs = options.timeoutMs ?? DEFAULT_RUNTIME_READY_TIMEOUT_MS;
	const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_RUNTIME_READY_POLL_INTERVAL_MS;
	const probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_RUNTIME_PROBE_TIMEOUT_MS;
	const start = Date.now();
	const deadline = start + timeoutMs;

	let sawAlive = false;
	let lastProbe: RuntimeReadinessProbe | undefined;

	while (Date.now() < deadline) {
		const probe = await probeRuntimeReadiness(sidecar, probeTimeoutMs);
		lastProbe = probe;
		if (probe.ready) {
			return { ready: true, status: "ready", elapsedMs: Date.now() - start, lastProbe: probe };
		}
		if (!probeIndicatesDead(probe)) sawAlive = true;
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}

	return {
		ready: false,
		status: sawAlive ? "timed-out-alive" : "timed-out-dead",
		elapsedMs: Date.now() - start,
		lastProbe,
	};
}
