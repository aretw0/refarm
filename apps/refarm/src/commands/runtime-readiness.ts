import { sidecarUrl } from "./sidecar-url.js";

export interface RuntimeReadinessWaitOptions {
	timeoutMs?: number;
	pollIntervalMs?: number;
	probeTimeoutMs?: number;
}

const DEFAULT_RUNTIME_READY_TIMEOUT_MS = 10_000;
const DEFAULT_RUNTIME_READY_POLL_INTERVAL_MS = 300;
const DEFAULT_RUNTIME_PROBE_TIMEOUT_MS = 1_500;

export async function probeRuntimeReady(
	probeTimeoutMs = DEFAULT_RUNTIME_PROBE_TIMEOUT_MS,
): Promise<boolean> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const controller = new AbortController();
		timer = setTimeout(() => controller.abort(), probeTimeoutMs);
		const response = await fetch(sidecarUrl("/efforts/summary"), {
			signal: controller.signal,
		});
		return response.ok;
	} catch {
		return false;
	} finally {
		if (timer) clearTimeout(timer);
	}
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
