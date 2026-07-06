import { fetchWithTimeout, resolveRequestTimeoutMs } from "@refarm.dev/root";

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

/**
 * `fetch` against the Refarm tractor daemon's HTTP sidecar with the sidecar's own
 * timeout defaults (env `REFARM_SIDE_REQUEST_TIMEOUT_MS`). A thin, domain-owned
 * wrapper over the generic {@link fetchWithTimeout} primitive — this is the ONE
 * client for talking to the daemon, consumed by the CLI, context providers, and
 * anything else that reaches the sidecar, so none of them reimplements the call
 * with a hardcoded port.
 */
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
