import { makeProcessCache } from "../utils/process-cache.js";
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
 * Node-aware sidecar URL: env → cwd fs-first/graph-node-fallback → home fs →
 * default. Use this where a replicated (fs-less) device should still find its
 * sidecar from the config node; the sync {@link resolveSidecarUrl} stays for
 * callers that only need env+fs. Wires the sovereign-config seam into the async
 * resolver so runtime-config.ts stays storage-free.
 *
 * MEMOIZED via the canonical process-cache primitive ({@link makeProcessCache}):
 * the sidecar URL is stable for a process's lifetime (you do not move the sidecar
 * mid-command), and each resolution touches fs + the tractor db. So a hot path
 * (per `/efforts`, `/sessions` request) resolves once and reuses the value. The
 * cache self-registers, so the vitest global reset clears it — no bespoke reset
 * to remember. resetAllProcessCaches() forces re-resolution after a config change
 * in a long-lived process.
 */
const sidecarUrlCache = makeProcessCache<string>();

export async function resolveSidecarUrlAsync(
	env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
	const cached = sidecarUrlCache.get();
	if (cached !== undefined) return cached;
	return sidecarUrlCache.set(
		(await resolveRuntimeSidecarUrlAsync(() => resolveSovereignConfig(env), { env }))
			.value,
	);
}

/**
 * Node-aware, memoized version of {@link sidecarUrl}: resolves the base URL once
 * (env → config file → graph node → default) and joins the path. Prefer this over
 * the sync `sidecarUrl()` on hot paths so a replicated device honors the config
 * node without re-reading config on every request.
 */
export async function sidecarUrlAsync(
	pathname: string,
	env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
	const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
	return `${await resolveSidecarUrlAsync(env)}${path}`;
}

export function sidecarUrl(
	pathname: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
	return `${resolveSidecarUrl(env)}${path}`;
}
