/**
 * auth — the credential a device presents to a gated farm.
 *
 * A farm with the auth gate on (REFARM_AUTH_POLICY set) requires a per-device
 * bearer credential on every sidecar request, or answers 401. A device carries
 * it as FARM_TOKEN. Absent (the default, ungated farm), these headers are empty
 * — so nothing changes for a farm with no gate. Pure: env is injectable.
 */

/** The Authorization header for the farm, from FARM_TOKEN. `{}` when unset. */
export function farmAuthHeaders(env = process.env) {
	const token = typeof env.FARM_TOKEN === "string" ? env.FARM_TOKEN.trim() : "";
	return token ? { authorization: `Bearer ${token}` } : {};
}
