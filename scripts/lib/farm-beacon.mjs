/**
 * farm-beacon — LAN auto-discovery primitive (proving ground; promotes to a
 * package block when a second consumer needs it, per the composition rule).
 *
 * A device that wants a farm should not need an IP typed by hand: it sends a
 * tiny UDP probe to the LAN broadcast address on a well-known port, and any
 * OPT-IN announcer replies with where the farm listens. Zero dependencies —
 * `node:dgram` + JSON — so the same file serves Termux, a Raspberry, or a
 * laptop straight from `git pull`.
 *
 * Security posture, deliberate and small:
 *   - announcing is OPT-IN (an operator starts it; nothing announces by default);
 *   - the reply carries only what the LAN can already observe by scanning
 *     (hostname + ports) — no secrets, nothing executable;
 *   - both sides parse with strict shape checks and drop anything malformed,
 *     oversized, or with a version they don't speak;
 *   - discovery only DISCOVERS: reaching the farm still crosses the same
 *     bind/TLS/auth posture every other path crosses.
 */
import dgram from "node:dgram";
import { hostname } from "node:os";
import { networkInterfaces } from "node:os";

export const FARM_BEACON_PORT = 42002;
/** Organization-local multicast group (RFC 2365 space) — the SECOND discovery
 *  dialect: routers that filter subnet broadcast often pass multicast (it is
 *  how casting devices are found), so probes go out on BOTH. */
export const FARM_BEACON_MULTICAST_GROUP = "239.255.42.42";
const MAGIC_PROBE = "discover";
const MAGIC_ANNOUNCE = "announce";
const VERSION = 1;
const MAX_DATAGRAM_BYTES = 512;
const MAX_NAME_LENGTH = 128;

export function encodeFarmProbe() {
	return Buffer.from(JSON.stringify({ refarm: MAGIC_PROBE, v: VERSION }));
}

export function decodeFarmProbe(buffer) {
	const parsed = safeParse(buffer);
	if (!parsed || parsed.refarm !== MAGIC_PROBE || parsed.v !== VERSION) return null;
	return { v: VERSION };
}

export function encodeFarmAnnounce({ name, wsPort, httpPort }) {
	return Buffer.from(
		JSON.stringify({ refarm: MAGIC_ANNOUNCE, v: VERSION, name, wsPort, httpPort }),
	);
}

export function decodeFarmAnnounce(buffer) {
	const parsed = safeParse(buffer);
	if (!parsed || parsed.refarm !== MAGIC_ANNOUNCE || parsed.v !== VERSION) return null;
	const { name, wsPort, httpPort } = parsed;
	if (typeof name !== "string" || name.length === 0 || name.length > MAX_NAME_LENGTH) return null;
	if (!isPort(wsPort) || !isPort(httpPort)) return null;
	return { name, wsPort, httpPort };
}

function isPort(value) {
	return Number.isInteger(value) && value > 0 && value <= 65535;
}

function safeParse(buffer) {
	if (!buffer || buffer.length === 0 || buffer.length > MAX_DATAGRAM_BYTES) return null;
	try {
		const parsed = JSON.parse(buffer.toString("utf8"));
		return typeof parsed === "object" && parsed !== null ? parsed : null;
	} catch {
		return null;
	}
}

/** Start the opt-in announcer: answers well-formed probes with this farm's
 *  coordinates, stays silent for everything else. */
export function createFarmAnnouncer({
	name = hostname(),
	wsPort = 42000,
	httpPort = 42001,
	port = FARM_BEACON_PORT,
	host = "0.0.0.0",
} = {}) {
	const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
	socket.on("message", (message, rinfo) => {
		if (!decodeFarmProbe(message)) return;
		socket.send(encodeFarmAnnounce({ name, wsPort, httpPort }), rinfo.port, rinfo.address);
	});
	return new Promise((resolve, reject) => {
		socket.once("error", reject);
		socket.bind(port, host, () => {
			// Join the multicast group ON EVERY IPv4 INTERFACE — with several
			// interfaces (Wi-Fi + a VPN tunnel), a single default membership can
			// land on the wrong one and probes silently miss. Best-effort per
			// interface: a host without multicast still answers broadcast/unicast.
			let multicast = false;
			for (const address of multicastInterfaceAddresses()) {
				try {
					socket.addMembership(FARM_BEACON_MULTICAST_GROUP, address);
					multicast = true;
				} catch {
					// this interface refused membership — try the others
				}
			}
			try {
				socket.setMulticastLoopback(true);
			} catch {
				// loopback delivery unavailable — cross-host multicast may still work
			}
			resolve({
				port: socket.address().port,
				multicast,
				close: () =>
					new Promise((resolveClose) => {
						socket.close(resolveClose);
					}),
			});
		});
	});
}

/** The LAN broadcast targets a probe should reach: the global broadcast plus
 *  each interface's directed broadcast (ip | ~netmask) — some networks pass one
 *  but not the other. */
export function defaultProbeTargets(port = FARM_BEACON_PORT) {
	const targets = [
		{ address: "255.255.255.255", port },
		{ address: FARM_BEACON_MULTICAST_GROUP, port },
	];
	for (const entries of Object.values(networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.family !== "IPv4" || entry.internal) continue;
			const directed = directedBroadcast(entry.address, entry.netmask);
			if (directed) targets.push({ address: directed, port });
		}
	}
	return targets;
}

/** Every local IPv4 address a multicast membership/egress can anchor to —
 *  loopback included, so same-host discovery works with loopback delivery on. */
function multicastInterfaceAddresses() {
	const addresses = ["127.0.0.1"];
	for (const entries of Object.values(networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.family !== "IPv4" || entry.internal) continue;
			addresses.push(entry.address);
		}
	}
	return addresses;
}

function directedBroadcast(address, netmask) {
	const ip = address.split(".").map(Number);
	const mask = (netmask ?? "").split(".").map(Number);
	if (ip.length !== 4 || mask.length !== 4 || mask.some(Number.isNaN)) return null;
	return ip.map((octet, i) => (octet & mask[i]) | (~mask[i] & 0xff)).join(".");
}

/** Broadcast a probe and collect every distinct farm that answers within the
 *  window. Returns [{ name, wsPort, httpPort, address }]. */
export function discoverFarms({
	targets = defaultProbeTargets(),
	timeoutMs = 1500,
	multicastLoopback = false,
} = {}) {
	return new Promise((resolve) => {
		const socket = dgram.createSocket("udp4");
		const farms = new Map();
		const finish = () => {
			socket.close();
			resolve([...farms.values()]);
		};
		const timer = setTimeout(finish, timeoutMs);
		socket.on("message", (message, rinfo) => {
			const announce = decodeFarmAnnounce(message);
			if (!announce) return;
			farms.set(rinfo.address, { ...announce, address: rinfo.address });
		});
		socket.on("error", () => {
			clearTimeout(timer);
			finish();
		});
		socket.bind(0, async () => {
			try {
				socket.setBroadcast(true);
			} catch {
				// Broadcast permission can fail on constrained hosts; directed sends may still work.
			}
			try {
				socket.setMulticastTTL(4);
				if (multicastLoopback) socket.setMulticastLoopback(true);
			} catch {
				// No multicast on this host — the broadcast dialects still go out.
			}
			const probe = encodeFarmProbe();
			const sendOnce = (target) =>
				new Promise((resolveSend) =>
					socket.send(probe, target.port, target.address, () => resolveSend()),
				);
			for (const target of targets) {
				if (target.address === FARM_BEACON_MULTICAST_GROUP) {
					// A multicast probe leaves through ONE interface; with several
					// (Wi-Fi + VPN) the default may be the wrong one — send once per
					// interface, serialized because egress selection is socket state.
					for (const address of multicastInterfaceAddresses()) {
						try {
							socket.setMulticastInterface(address);
						} catch {
							continue;
						}
						await sendOnce(target);
					}
					continue;
				}
				await sendOnce(target);
			}
		});
	});
}
