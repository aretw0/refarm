import {
	DEFAULT_RUNTIME_SIDECAR_URL,
	normalizeRuntimeSidecarUrl,
	resolveRuntimeSidecarUrl,
	RUNTIME_SIDECAR_URL_ENV_VAR,
} from "../utils/runtime-config.js";

export const DEFAULT_SIDECAR_URL = DEFAULT_RUNTIME_SIDECAR_URL;
export const SIDECAR_URL_ENV_VAR = RUNTIME_SIDECAR_URL_ENV_VAR;
export const normalizeSidecarUrl = normalizeRuntimeSidecarUrl;

export function resolveSidecarUrl(
	env: NodeJS.ProcessEnv = process.env,
): string {
	return resolveRuntimeSidecarUrl({ env }).value;
}

export function sidecarUrl(
	pathname: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
	return `${resolveSidecarUrl(env)}${path}`;
}
