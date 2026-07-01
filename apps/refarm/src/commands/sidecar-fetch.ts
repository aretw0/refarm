import { fetchWithTimeout, resolveRequestTimeoutMs } from "./fetch-with-timeout.js";

const SIDECAR_REQUEST_TIMEOUT_ENV_VAR = "REFARM_SIDE_REQUEST_TIMEOUT_MS";
const DEFAULT_SIDE_REQUEST_TIMEOUT_MS = 500;

function resolveSidecarRequestTimeoutMs(
	env: NodeJS.ProcessEnv = process.env,
	options: {
		timeoutEnvVar?: string;
		defaultTimeoutMs?: number;
		timeoutMs?: number;
	} = {},
): number {
	return resolveRequestTimeoutMs(env, {
		...options,
		timeoutEnvVar: options.timeoutEnvVar ?? SIDECAR_REQUEST_TIMEOUT_ENV_VAR,
		defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_SIDE_REQUEST_TIMEOUT_MS,
	});
}

export { SIDECAR_REQUEST_TIMEOUT_ENV_VAR, resolveSidecarRequestTimeoutMs };

export async function fetchSidecarWithTimeout(
	url: string | URL,
	init: RequestInit = {},
	options: {
		env?: NodeJS.ProcessEnv;
		timeoutEnvVar?: string;
		defaultTimeoutMs?: number;
		timeoutMs?: number;
		fetch?: typeof fetch;
	} = {},
): Promise<Response> {
	return fetchWithTimeout(url, init, {
		env: options.env,
		timeoutEnvVar: options.timeoutEnvVar ?? SIDECAR_REQUEST_TIMEOUT_ENV_VAR,
		defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_SIDE_REQUEST_TIMEOUT_MS,
		timeoutMs: options.timeoutMs,
		fetch: options.fetch,
	});
}

