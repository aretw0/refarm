import { loadRawSovereignConfig } from "@refarm.dev/config";
import {
	parseSurfaces,
	resolveDeclaredSurfaceBind,
	SURFACE_DAEMON_WS,
	type SurfaceCatalog,
} from "@refarm.dev/std";
import { WebSocket, WebSocketServer } from "ws";

/**
 * WebSocketSyncTransport
 *
 * Pure binary relay transport for Loro CRDT updates.
 * Sends and receives Uint8Array frames — no JSON serialization.
 *
 * When a peer sends a binary CRDT update:
 *   1. The update is broadcast to all OTHER connected peers (relay mode).
 *   2. The local message handler is notified (applies to local LoroCRDTStorage).
 *
 * Architecture: ADR-045 — Loro binary delta over WebSocket.
 * Replaces the JSON CRDTOperation transport from @refarm.dev/sync-crdt (stub).
 *
 * BIND SAFETY: `new WebSocketServer({ port })` binds EVERY interface — that is the `ws`
 * default, and it is what this did, on port 42000, for an UNAUTHENTICATED CRDT relay. Any
 * peer that could route here could read the whole document and write into it. The Rust
 * daemon closed exactly this port on exactly this reasoning; this is the same close for the
 * Node relay.
 *
 * WHICH SURFACE THIS IS: `daemon-ws`. Surfaces are named for LISTENERS, and this listener is
 * the daemon's CRDT WebSocket — same port 42000, same binary Loro relay, same clients.
 * `packages/tractor/src/daemon/ws_server.rs` opens with "WebSocket daemon — replaces farmhand
 * on port 42000": these are two implementations of ONE listener, not two listeners, and only
 * one of them can hold the port.
 *
 * WHERE THE BIND COMES FROM (O5,
 * docs/superpowers/specs/2026-07-30-open-by-declaration-surfaces-design.md): the
 * `surfaces.daemon-ws` declaration in the FILESYSTEM `.refarm/config.json`. It used to come
 * from `authPolicyPresent()` — "does REFARM_AUTH_POLICY name a file that exists" — which for
 * THIS relay was the wrong question twice over: the policy belongs to the sidecar and to the
 * Rust WS handshake, and this relay reads neither. It never verified anything, so a policy
 * file lying somewhere on the machine was opening an ungated CRDT relay to the network.
 *
 * WHAT THAT MEANS IN PRACTICE, and it is deliberately strict: `daemon-ws` CAN be declared
 * beyond loopback — the Rust daemon enforces it with ADR-093's `Sec-WebSocket-Protocol`
 * credential handshake, so `surfaceEnforceableGate("daemon-ws")` is `"device-token"`. This
 * relay implements no such handshake. The capability table is true of the SURFACE and false
 * of THIS listener, so `refuseGateThisListenerCannotEnforce` refuses the bind here while the
 * same declaration stays perfectly valid for the daemon. And O2's read-only clause already
 * bars `"gate": "none"` for `daemon-ws` at parse time, because it accepts mutations. Net:
 * this relay binds loopback, or it refuses and says which runtime would have honoured the
 * declaration — instead of quietly binding loopback and leaving the operator to believe their
 * declaration took effect.
 */
export class WebSocketSyncTransport {
	private readonly wss: WebSocketServer;
	private readonly clients = new Set<WebSocket>();
	private _msgHandler: ((bytes: Uint8Array) => void) | null = null;
	/** The host actually bound — so callers log the truth instead of guessing "localhost". */
	readonly host: string;

	/**
	 * @param host The host the operator explicitly asked for (`FARMHAND_WS_HOST`), or
	 *   `undefined` when they asked for none. The absence is LOAD-BEARING: it is what lets the
	 *   declaration decide (S1/S5). A caller that substitutes a loopback default here would
	 *   make `surfaces.daemon-ws` permanently inert and silent.
	 * @param options.surfaces The declaration this bind obeys. Injected by tests; production
	 *   reads the FILESYSTEM `.refarm/config.json` under `configRoot`, never the replicated
	 *   config node — exposure decides how THIS machine is reachable, so a declaration
	 *   replicated from another device must never decide it.
	 */
	constructor(
		port: number,
		host?: string,
		options: { surfaces?: SurfaceCatalog; configRoot?: string } = {},
	) {
		// Throws before the socket exists when the bind is not allowed. A relay with no
		// credential check must not be reachable from off-box just because nobody passed a
		// host — nor because some other surface has credentials.
		const surfaces = options.surfaces ?? readDeclaredSurfaces(options.configRoot);
		this.host = resolveDeclaredSurfaceBind({
			surface: SURFACE_DAEMON_WS,
			surfaces,
			flagHost: host,
			label: "the farmhand CRDT sync relay",
			// This listener verifies NOTHING. Stated explicitly rather than taken from
			// `surfaceEnforceableGate`, whose answer for `daemon-ws` describes the Rust daemon.
			verifies: null,
		}).host;
		this.wss = new WebSocketServer({ port, host: this.host });

		this.wss.on("connection", (ws: WebSocket) => {
			this.clients.add(ws);

			ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
				const bytes = toUint8Array(data);
				// Relay to all other peers
				this.broadcast(bytes, ws);
				// Notify local CRDT storage
				this._msgHandler?.(bytes);
			});

			ws.on("close", () => {
				this.clients.delete(ws);
			});

			ws.on("error", (err: Error) => {
				console.error("[farmhand] WebSocket error:", err);
				this.clients.delete(ws);
			});
		});
	}

	/**
	 * Broadcast binary bytes to all connected peers.
	 * @param except - Optionally skip one client (the sender).
	 */
	broadcast(bytes: Uint8Array, except?: WebSocket): void {
		for (const client of this.clients) {
			if (client !== except && client.readyState === WebSocket.OPEN) {
				client.send(bytes);
			}
		}
	}

	/**
	 * Register a handler for incoming binary messages from remote peers.
	 * Wire this to LoroCRDTStorage.applyUpdate.
	 */
	onMessage(handler: (bytes: Uint8Array) => void): void {
		this._msgHandler = handler;
	}

	async disconnect(): Promise<void> {
		for (const client of this.clients) {
			client.close();
		}
		await new Promise<void>((resolve) => this.wss.close(() => resolve()));
	}

	get port(): number {
		const addr = this.wss.address();
		return typeof addr === "object" && addr !== null ? (addr as { port: number }).port : 0;
	}
}

/**
 * The `surfaces` catalog from the FILESYSTEM `.refarm/config.json` under `root`.
 *
 * A malformed declaration THROWS (fail-shut, exactly like `parse_surfaces`). What is caught is
 * narrower and different in kind: `loadRawSovereignConfig` raises when no `SOVEREIGN_DIR` is
 * selected in this process, i.e. there is no config FILE to have a declaration in. That is S1's
 * silence, and S1's silence is loopback — the closed answer, not a fallback to a wider one.
 */
function readDeclaredSurfaces(root?: string): SurfaceCatalog {
	let raw: unknown;
	try {
		raw = loadRawSovereignConfig(root);
	} catch {
		return new Map();
	}
	return parseSurfaces(raw);
}

function toUint8Array(data: Buffer | ArrayBuffer | Buffer[]): Uint8Array {
	if (Array.isArray(data)) {
		return Buffer.concat(data);
	}
	if (data instanceof ArrayBuffer) {
		return new Uint8Array(data);
	}
	// Node.js Buffer
	return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}
