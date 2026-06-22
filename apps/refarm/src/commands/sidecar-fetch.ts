const SIDECAR_REQUEST_TIMEOUT_ENV_VAR = "REFARM_SIDE_REQUEST_TIMEOUT_MS";
const DEFAULT_SIDE_REQUEST_TIMEOUT_MS = 500;

function resolveSidecarRequestTimeoutMs(
	env: NodeJS.ProcessEnv = process.env,
	opts: {
		timeoutEnvVar?: string;
		defaultTimeoutMs?: number;
		timeoutMs?: number;
	} = {},
): number {
	if (typeof opts.timeoutMs === "number") {
		if (Number.isNaN(opts.timeoutMs) || opts.timeoutMs < 0) return DEFAULT_SIDE_REQUEST_TIMEOUT_MS;
		return opts.timeoutMs;
	}
	const envVar = opts.timeoutEnvVar ?? SIDECAR_REQUEST_TIMEOUT_ENV_VAR;
	const raw = env[envVar];
	const parsed = Number.parseInt(raw ?? "", 10);
	const fallback = opts.defaultTimeoutMs ?? DEFAULT_SIDE_REQUEST_TIMEOUT_MS;
	if (Number.isNaN(parsed) || parsed < 0) return fallback;
	return parsed;
}

export {
	SIDECAR_REQUEST_TIMEOUT_ENV_VAR,
	resolveSidecarRequestTimeoutMs,
	};

	export async function fetchSidecarWithTimeout(
	url: string | URL,
	init: RequestInit = {},
	options: {
		env?: NodeJS.ProcessEnv;
		timeoutEnvVar?: string;
		defaultTimeoutMs?: number;
		timeoutMs?: number;
	} = {},
	): Promise<Response> {
	const timeoutMs = resolveSidecarRequestTimeoutMs(
		options.env ?? process.env,
		options,
	);
	const controller = new AbortController();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		timer = setTimeout(() => controller.abort(), timeoutMs);
		return await fetch(url, {
			...init,
			signal: controller.signal,
		});
	} finally {
		if (timer) clearTimeout(timer);
	}
	}
