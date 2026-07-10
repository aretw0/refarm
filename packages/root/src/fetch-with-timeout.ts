const DEFAULT_REQUEST_TIMEOUT_MS = 500;

type FetchImplementation = (
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1],
) => ReturnType<typeof fetch>;

export interface FetchTimeoutOptions {
	env?: NodeJS.ProcessEnv;
	timeoutEnvVar?: string;
	defaultTimeoutMs?: number;
	timeoutMs?: number;
	fetch?: FetchImplementation;
}

function isValidTimeoutMs(timeoutMs: unknown): timeoutMs is number {
	return typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs >= 0;
}

export function resolveRequestTimeoutMs(
	env: NodeJS.ProcessEnv = process.env,
	options: {
		timeoutEnvVar?: string;
		defaultTimeoutMs?: number;
		timeoutMs?: number;
	} = {},
): number {
	if (isValidTimeoutMs(options.timeoutMs)) return options.timeoutMs;

	const envVar = options.timeoutEnvVar;
	if (!envVar) return options.defaultTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

	const raw = env[envVar];
	const parsed = Number.parseInt(raw ?? "", 10);
	if (Number.isNaN(parsed) || parsed < 0) {
		return options.defaultTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	}
	return parsed;
}

/**
 * `fetch` with a deadline: aborts the request after `timeoutMs` (resolved from an
 * explicit value, an env var, or a default), and chains any caller-supplied
 * `init.signal`. A generic HTTP primitive — no CLI or sidecar domain — so it
 * lives in the zero-dependency root utils, consumable by any package.
 */
export async function fetchWithTimeout(
	url: string | URL,
	init: RequestInit = {},
	options: FetchTimeoutOptions = {},
): Promise<Response> {
	const timeoutMs = resolveRequestTimeoutMs(options.env ?? process.env, options);

	const fetchImpl = options.fetch ?? ((...args) => fetch(...args));
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	let cleanup: (() => void) | undefined;

	if (init.signal) {
		if (init.signal.aborted) {
			controller.abort(init.signal.reason);
		} else {
			const onAbort = (): void => {
				controller.abort(init.signal?.reason);
			};
			init.signal.addEventListener("abort", onAbort, { once: true });
			cleanup = () => init.signal?.removeEventListener("abort", onAbort);
		}
	}

	try {
		timer = setTimeout(() => controller.abort(), timeoutMs);
		return await fetchImpl(url, { ...init, signal: controller.signal });
	} finally {
		if (timer) clearTimeout(timer);
		if (cleanup) cleanup();
	}
}
