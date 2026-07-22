/**
 * Where does this hub's browser runtime SYNC to? (multi-device seam)
 *
 * The daemon's CRDT WebSocket already listens on 0.0.0.0:42000 — any device on
 * the network can sync. What was missing is the pointer: the hub always dialed
 * `ws://localhost:42000`, i.e. the DEVICE itself, so a phone opening the hub
 * synced against nothing. Resolution order:
 *   1. explicit `REFARM_ME_SYNC_WS_URL` env, injected at build/dev time;
 *   2. derived from the page's own host — when another device opens the hub,
 *      `location.hostname` IS the serving host, so `ws://<hostname>:42000`
 *      reaches the daemon with zero configuration (and on localhost it equals
 *      the historical default).
 */

const REFARM_ME_SYNC_WS_PORT = 42000;

/** Validate the env-provided sync URL. Only ws/wss pass — the value is emitted
 *  into an inline script, so anything else is refused, not escaped. */
export function resolveRefarmMeSyncWsUrlFromEnv(
	env: Record<string, string | undefined>,
): string | undefined {
	const raw = env.REFARM_ME_SYNC_WS_URL?.trim();
	if (!raw) return undefined;
	try {
		const parsed = new URL(raw);
		if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") return undefined;
		return raw;
	} catch {
		return undefined;
	}
}

/** Derive the daemon URL from the page location. `https:` pages get `wss:` —
 *  browsers block plain `ws:` from secure origins as mixed content. */
export function deriveRefarmMeSyncWsUrl(
	location: { hostname: string; protocol: string } | undefined,
): string | undefined {
	const hostname = location?.hostname?.trim();
	if (!hostname) return undefined;
	const scheme = location?.protocol === "https:" ? "wss" : "ws";
	return `${scheme}://${hostname}:${REFARM_ME_SYNC_WS_PORT}`;
}
