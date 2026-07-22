/**
 * tailnet — discover the farm over a Tailscale overlay (rail 2).
 *
 * The LAN beacon (broadcast/multicast) does NOT cross a tailnet — Tailscale is a
 * point-to-point WireGuard mesh, not a broadcast domain. But it carries unicast
 * (TCP + UDP) between peers and gives every device a stable name via MagicDNS.
 * So overlay discovery has two honest shapes:
 *   - by NAME: `farm-hello <hostname>` — MagicDNS resolves it from any network,
 *     no IP typed. This is the phone's zero-config handle when it lacks the CLI.
 *   - by PEER LIST: where the `tailscale` CLI exists, enumerate peers and probe
 *     each — precise auto-discovery, no announcer needed (it hits sync directly).
 *
 * Zero runtime dependency: shells the `tailscale` CLI through an injected runner
 * (so tests stay pure) and parses its JSON. Absent CLI → empty, never throws.
 */
import { execFile } from "node:child_process";

/** Extract online tailnet peers (name + IPv4) from `tailscale status --json`.
 *  Pure. Self is excluded — discovery looks for OTHER devices. */
export function parseTailnetPeers(status, { includeOffline = false } = {}) {
	const peers = status?.Peer;
	if (!peers || typeof peers !== "object") return [];
	const result = [];
	for (const peer of Object.values(peers)) {
		if (!includeOffline && !peer?.Online) continue;
		const ipv4 = (peer?.TailscaleIPs ?? []).find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
		if (!ipv4) continue;
		result.push({ name: peer.HostName ?? ipv4, ip: ipv4 });
	}
	return result;
}

/** The short MagicDNS handle: `host.tailXXXX.ts.net.` → `host`. */
export function tailnetShortName(dnsName) {
	if (!dnsName || typeof dnsName !== "string") return null;
	const first = dnsName.replace(/\.$/, "").split(".")[0];
	return first && first.length > 0 ? first : null;
}

/** Run `tailscale status --json` and return its parsed peers. Best-effort:
 *  no CLI, non-zero exit, or bad JSON → []. `run` is injectable for tests. */
export function tailnetPeers({ run = defaultRun, includeOffline = false } = {}) {
	return run(["status", "--json"])
		.then((stdout) => {
			try {
				return parseTailnetPeers(JSON.parse(stdout), { includeOffline });
			} catch {
				return [];
			}
		})
		.catch(() => []);
}

function defaultRun(args) {
	return new Promise((resolve, reject) => {
		execFile("tailscale", args, { timeout: 4000 }, (error, stdout) => {
			if (error) reject(error);
			else resolve(stdout);
		});
	});
}
