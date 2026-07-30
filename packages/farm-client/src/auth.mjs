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

/**
 * The `Sec-WebSocket-Protocol` offer for the CRDT sync socket (ADR-093), from
 * FARM_TOKEN: `["refarm-sync-v1", "bearer.<token>"]`. `undefined` when unset —
 * passing `undefined` as `WebSocket`'s second argument is the same as omitting
 * it, so an ungated farm's handshake is byte-identical to before ADR-093.
 * Mirrors `@refarm.dev/sync-loro`'s `WS_SYNC_PROTOCOL`/`bearer.` convention;
 * duplicated (not imported) because this package stays zero-dependency.
 */
export function farmSyncWsProtocols(env = process.env) {
	const token = typeof env.FARM_TOKEN === "string" ? env.FARM_TOKEN.trim() : "";
	return token ? ["refarm-sync-v1", `bearer.${token}`] : undefined;
}
