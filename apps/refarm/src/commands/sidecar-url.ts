export const DEFAULT_SIDECAR_URL = "http://127.0.0.1:42001";
export const SIDECAR_URL_ENV_VAR = "REFARM_SIDECAR_URL";

export function normalizeSidecarUrl(value: string): string {
	return value.trim().replace(/\/+$/, "");
}

export function resolveSidecarUrl(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const configured = env[SIDECAR_URL_ENV_VAR];
	if (!configured || configured.trim().length === 0) {
		return DEFAULT_SIDECAR_URL;
	}
	return normalizeSidecarUrl(configured);
}

export function sidecarUrl(
	pathname: string,
	env: NodeJS.ProcessEnv = process.env,
): string {
	const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
	return `${resolveSidecarUrl(env)}${path}`;
}
