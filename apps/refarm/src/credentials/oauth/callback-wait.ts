import type { CallbackServer } from "./callback-server.js";
import type { OAuthLoginCallbacks } from "./types.js";

export async function waitForOAuthCallback(
	server: CallbackServer,
	options: {
		timeoutMs?: number;
		callbacks?: Pick<OAuthLoginCallbacks, "onCallbackWait">;
		heartbeatMs?: number;
	} = {},
): Promise<{ code: string; state: string } | null> {
	const { timeoutMs, callbacks, heartbeatMs = 15_000 } = options;

	if (!server.listening) {
		callbacks?.onCallbackWait?.({
			phase: "callback-unavailable",
			message: `Local callback server is unavailable (${server.unavailableReason ?? "unknown reason"}); falling back to pasted redirect URL.`,
		});
		return server.waitForCode();
	}

	const startedAt = Date.now();
	callbacks?.onCallbackWait?.({
		phase: "callback-waiting",
		message:
			timeoutMs && timeoutMs > 0
				? `Waiting for browser callback for up to ${Math.ceil(timeoutMs / 1000)}s.`
				: "Waiting for browser callback.",
		elapsedMs: 0,
		...(timeoutMs && timeoutMs > 0 ? { timeoutMs } : {}),
		...(server.url ? { callbackUrl: server.url } : {}),
	});

	let timer: ReturnType<typeof setTimeout> | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;
	let timedOut = false;
	try {
		heartbeat = setInterval(() => {
			const elapsedMs = Date.now() - startedAt;
			callbacks?.onCallbackWait?.({
				phase: "callback-heartbeat",
				message:
					timeoutMs && timeoutMs > 0
						? `Still waiting for browser callback (${Math.floor(elapsedMs / 1000)}s elapsed of ${Math.ceil(timeoutMs / 1000)}s).`
						: `Still waiting for browser callback (${Math.floor(elapsedMs / 1000)}s elapsed).`,
				elapsedMs,
				...(timeoutMs && timeoutMs > 0 ? { timeoutMs } : {}),
				...(server.url ? { callbackUrl: server.url } : {}),
			});
		}, heartbeatMs);

		const result =
			timeoutMs && timeoutMs > 0
				? await Promise.race([
						server.waitForCode(),
						new Promise<null>((resolve) => {
							timer = setTimeout(() => {
								timedOut = true;
								server.cancelWait();
								resolve(null);
							}, timeoutMs);
						}),
					])
				: await server.waitForCode();

		if (result?.code) {
			callbacks?.onCallbackWait?.({
				phase: "callback-received",
				message: "Browser callback received.",
				elapsedMs: Date.now() - startedAt,
				...(server.url ? { callbackUrl: server.url } : {}),
			});
		} else if (timedOut) {
			callbacks?.onCallbackWait?.({
				phase: "callback-timeout",
				message: `No browser callback received after ${Math.ceil((timeoutMs ?? 0) / 1000)}s; switching to pasted redirect URL.`,
				elapsedMs: Date.now() - startedAt,
				...(timeoutMs && timeoutMs > 0 ? { timeoutMs } : {}),
				...(server.url ? { callbackUrl: server.url } : {}),
			});
		} else {
			callbacks?.onCallbackWait?.({
				phase: "callback-cancelled",
				message: "Browser callback wait stopped; using manual authorization input.",
				elapsedMs: Date.now() - startedAt,
				...(server.url ? { callbackUrl: server.url } : {}),
			});
		}
		return result;
	} finally {
		if (timer) clearTimeout(timer);
		if (heartbeat) clearInterval(heartbeat);
	}
}
