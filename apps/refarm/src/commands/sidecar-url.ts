import {
	DEFAULT_RUNTIME_SIDECAR_URL,
	normalizeRuntimeSidecarUrl,
	resolveRuntimeSidecarUrl,
	resolveRuntimeSidecarUrlAsync,
	RUNTIME_SIDECAR_URL_ENV_VAR,
} from "../utils/runtime-config.js";
import { resolveSovereignConfig } from "../utils/sovereign-config.js";

export const DEFAULT_SIDECAR_URL = DEFAULT_RUNTIME_SIDECAR_URL;
export const SIDECAR_URL_ENV_VAR = RUNTIME_SIDECAR_URL_ENV_VAR;
export const normalizeSidecarUrl = normalizeRuntimeSidecarUrl;

export function resolveSidecarUrl(
	env: NodeJS.ProcessEnv = process.env,
): string {
	return resolveRuntimeSidecarUrl({ env }).value;
}

/**
 * Node-aware sidecar URL: env → home fs → cwd fs-first/graph-node-fallback →
 * default. Use this where a replicated (fs-less) device should still find its
 * sidecar from the config node; the sync {@link resolveSidecarUrl} stays for
 * callers that only need env+fs. Wires the sovereign-config seam into the async
 * resolver so runtime-config.ts stays storage-free.
 */
export async function resolveSidecarUrlAsync(
	env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
	return (
		await resolveRuntimeSidecarUrlAsync(() => resolveSovereignConfig(env), { env })
	).value;
}

export function sidecarUrl(
	pathname: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
	return `${resolveSidecarUrl(env)}${path}`;
}
