/**
 * Where does this hub's browser runtime SYNC to? (multi-device seam)
 *
 * The hub always dialed `ws://localhost:42000`, i.e. the DEVICE running the
 * browser, so a phone opening the hub synced against nothing. This resolves the
 * pointer instead.
 *
 * NOTE ON REACHABILITY (this used to claim the daemon "already listens on
 * 0.0.0.0:42000 — any device on the network can sync"; it does not, and should
 * not have): the daemon's CRDT WebSocket binds LOOPBACK and refuses any wider
 * bind, because that socket has no credential gate — anyone who reaches it can
 * read and write the whole document and dispatch `user:prompt`. So a derived
 * `ws://<hostname>:42000` only connects when something authenticated fronts it —
 * in practice `refarm web serve`, whose `/sync` upgrade proxies to the daemon's
 * loopback socket. Resolution order:
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

/** Derive the daemon URL from the page location.
 *  - `http:` pages dial the daemon's WS directly (`ws://<host>:42000`) — the
 *    daemon already listens on all interfaces.
 *  - `https:` pages go SAME-ORIGIN (`wss://<origin>/sync`): the daemon speaks
 *    plain ws, so a secure page syncs through the `/sync` proxy of the origin
 *    that served it (`refarm web serve` forwards it to the daemon). One origin,
 *    no mixed content, no TLS on the daemon. */
export function deriveRefarmMeSyncWsUrl(
	location: { hostname: string; protocol: string; port?: string } | undefined,
): string | undefined {
	const hostname = location?.hostname?.trim();
	if (!hostname) return undefined;
	if (location?.protocol === "https:") {
		const port = location.port?.trim();
		return `wss://${hostname}${port ? `:${port}` : ""}/sync`;
	}
	return `ws://${hostname}:${REFARM_ME_SYNC_WS_PORT}`;
}
