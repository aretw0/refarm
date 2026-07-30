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

/** Extract online tailnet peers from `tailscale status --json` as FULL records —
 *  the OS hostname, the IPv4, the MagicDNS name in both its raw and short forms,
 *  and whether the peer is online (plus, when Tailscale reports it, when it was
 *  last seen). Pure. Self is excluded — discovery looks for OTHER devices.
 *
 *  This is the single parse; `parseTailnetPeers` is a projection of it down to
 *  the `{name, ip}` pair its four zero-dependency callers have always received. */
export function parseTailnetPeerRecords(status, { includeOffline = false } = {}) {
	const peers = status?.Peer;
	if (!peers || typeof peers !== "object") return [];
	const result = [];
	for (const peer of Object.values(peers)) {
		if (!includeOffline && !peer?.Online) continue;
		const ipv4 = (peer?.TailscaleIPs ?? []).find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip));
		if (!ipv4) continue;
		result.push({
			name: peer.HostName ?? ipv4,
			ip: ipv4,
			dnsName: typeof peer.DNSName === "string" ? peer.DNSName : null,
			shortName: tailnetShortName(peer.DNSName),
			online: Boolean(peer?.Online),
			lastSeen: typeof peer?.LastSeen === "string" ? peer.LastSeen : null,
		});
	}
	return result;
}

/** Extract online tailnet peers (name + IPv4) from `tailscale status --json`.
 *  Pure. Self is excluded — discovery looks for OTHER devices.
 *  UNCHANGED SHAPE: a `{name, ip}` projection of `parseTailnetPeerRecords`. */
export function parseTailnetPeers(status, options) {
	return parseTailnetPeerRecords(status, options).map(({ name, ip }) => ({ name, ip }));
}

/** The short MagicDNS handle: `host.tailXXXX.ts.net.` → `host`. */
export function tailnetShortName(dnsName) {
	if (!dnsName || typeof dnsName !== "string") return null;
	const first = dnsName.replace(/\.$/, "").split(".")[0];
	return first && first.length > 0 ? first : null;
}

/**
 * Classify the OUTPUT of a successful `tailscale status --json` run. Pure — no
 * spawn, no I/O — so every branch is unit-testable without a tailnet.
 *
 * Separates the two answers an empty peer list can stand for:
 *   - `no-peers`  — Tailscale answered, in its own shape, and there is nobody
 *                   else on the tailnet. A complete, trustworthy "no".
 *   - `bad-output`— it printed something that is not a `tailscale status`
 *                   document at all. That is "I could not ask", not "no".
 */
export function tailnetStatusReport(stdout, { includeOffline = false } = {}) {
	let parsed;
	try {
		parsed = JSON.parse(stdout);
	} catch (error) {
		return failure("bad-output", `\`tailscale status --json\` did not print JSON (${text(error)})`);
	}
	// A real status document always carries `Self` (and `BackendState`). Anything
	// else parsed fine but is not the thing we asked for — refuse to read its
	// silence as "you have no devices".
	const shaped =
		parsed != null &&
		typeof parsed === "object" &&
		!Array.isArray(parsed) &&
		("Self" in parsed || "BackendState" in parsed);
	if (!shaped) {
		return failure(
			"bad-output",
			"`tailscale status --json` printed JSON that is not a status document",
		);
	}
	const peers = parseTailnetPeerRecords(parsed, { includeOffline });
	return { ok: true, reason: peers.length > 0 ? "peers" : "no-peers", peers, detail: null };
}

/**
 * Run `tailscale status --json` and report its peers AND, when there are none,
 * WHY there are none. The additive sibling of `tailnetPeers`: same query, same
 * injectable `run`, but it never collapses "the tailnet says nobody is here"
 * into "I could not ask the tailnet".
 *
 * Never rejects. Returns `{ ok, reason, peers, detail }` where `reason` is one of:
 *   - `"peers"`       — ok, at least one peer (`peers` is non-empty)
 *   - `"no-peers"`    — ok, the tailnet answered and there are none
 *   - `"cli-missing"` — the `tailscale` binary is not on PATH
 *   - `"query-failed"`— it spawned but failed (non-zero exit, timeout, signal)
 *   - `"bad-output"`  — it ran but did not print a status document
 *
 * This is the same "the answer is no" vs "I could not ask" split the connection
 * probe (`down` vs `unknown`) and the Rust `sidecar::tailnet_resolve` already
 * make — the shape of any answer obtained by asking the world.
 */
export function tailnetPeersReport({ run = defaultRun, includeOffline = false } = {}) {
	let ran;
	try {
		ran = run(["status", "--json"]);
	} catch (error) {
		// A runner that throws synchronously must not escape as a rejection.
		return Promise.resolve(runFailure(error));
	}
	return Promise.resolve(ran).then(
		(stdout) => tailnetStatusReport(String(stdout ?? ""), { includeOffline }),
		(error) => runFailure(error),
	);
}

/** Run `tailscale status --json` and return its parsed peers. Best-effort:
 *  no CLI, non-zero exit, or bad JSON → []. `run` is injectable for tests.
 *  A thin projection of `tailnetPeersReport` — one query path, not two. */
export function tailnetPeers(options) {
	return tailnetPeersReport(options).then((report) =>
		report.peers.map(({ name, ip }) => ({ name, ip })),
	);
}

/** ENOENT from `execFile` means the binary itself is absent — a different
 *  operator action from "it ran and failed", so it gets its own reason. */
function runFailure(error) {
	if (error?.code === "ENOENT") {
		return failure("cli-missing", "the `tailscale` CLI is not on PATH");
	}
	return failure("query-failed", text(error));
}

function failure(reason, detail) {
	return { ok: false, reason, peers: [], detail };
}

/** A one-line "why" an operator can act on. `execFile`'s own message says only
 *  "Command failed: …"; the CLI's stderr is the part that names the cause (e.g.
 *  "failed to connect to local tailscaled"), so keep both when they differ. */
function text(error) {
	const message = firstLine(error?.message ?? String(error));
	const stderr = firstLine(error?.stderr ?? "");
	if (stderr && !message.includes(stderr)) return `${message}: ${stderr}`;
	return message;
}

function firstLine(value) {
	for (const line of String(value ?? "").split("\n")) {
		const trimmed = line.trim();
		if (trimmed) return trimmed;
	}
	return "";
}

function defaultRun(args) {
	return new Promise((resolve, reject) => {
		execFile("tailscale", args, { timeout: 4000 }, (error, stdout) => {
			if (error) reject(error);
			else resolve(stdout);
		});
	});
}
