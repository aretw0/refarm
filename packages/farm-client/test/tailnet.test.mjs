import assert from "node:assert/strict";
import { test } from "node:test";
import {
	parseTailnetPeerRecords,
	parseTailnetPeers,
	tailnetPeers,
	tailnetPeersReport,
	tailnetShortName,
	tailnetStatusReport,
} from "../src/tailnet.mjs";

const STATUS = {
	Self: {
		HostName: "serpro-1577853",
		DNSName: "serpro-1577853.tail894688.ts.net.",
		TailscaleIPs: ["100.105.71.127", "fd7a:115c:a1e0::9d3a:4780"],
		Online: true,
	},
	Peer: {
		key1: {
			HostName: "meu-android",
			DNSName: "meu-android.tail894688.ts.net.",
			TailscaleIPs: ["100.88.1.2", "fd7a:115c::2"],
			Online: true,
		},
		key2: {
			HostName: "raspberry",
			DNSName: "raspberry.tail894688.ts.net.",
			TailscaleIPs: ["100.88.3.4"],
			Online: false,
			LastSeen: "2026-07-27T10:00:00Z",
		},
	},
};

test("parseTailnetPeers returns online peers with their IPv4 and name, excluding self", () => {
	const peers = parseTailnetPeers(STATUS);
	assert.deepEqual(peers, [{ name: "meu-android", ip: "100.88.1.2" }]);
});

test("parseTailnetPeers can include the offline peers when asked", () => {
	const peers = parseTailnetPeers(STATUS, { includeOffline: true });
	assert.deepEqual(peers.map((p) => p.name).sort(), ["meu-android", "raspberry"]);
});

test("parseTailnetPeers tolerates missing/empty structures", () => {
	assert.deepEqual(parseTailnetPeers({}), []);
	assert.deepEqual(parseTailnetPeers({ Peer: {} }), []);
	assert.deepEqual(parseTailnetPeers(null), []);
	// A peer with no IPv4 (IPv6-only) is skipped — the beacon/sync path is v4.
	assert.deepEqual(
		parseTailnetPeers({ Peer: { k: { HostName: "x", TailscaleIPs: ["fd7a::1"], Online: true } } }),
		[],
	);
});

test("tailnetShortName strips the tailnet suffix and trailing dot", () => {
	assert.equal(tailnetShortName("serpro-1577853.tail894688.ts.net."), "serpro-1577853");
	assert.equal(tailnetShortName("phone.tail894688.ts.net"), "phone");
	assert.equal(tailnetShortName(""), null);
	assert.equal(tailnetShortName(undefined), null);
});

test("parseTailnetPeerRecords carries the MagicDNS name alongside the hostname", () => {
	assert.deepEqual(parseTailnetPeerRecords(STATUS), [
		{
			name: "meu-android",
			ip: "100.88.1.2",
			dnsName: "meu-android.tail894688.ts.net.",
			shortName: "meu-android",
			online: true,
			lastSeen: null,
		},
	]);
	// A peer with no DNSName still parses — shortName is simply absent.
	const noDns = parseTailnetPeerRecords({
		Peer: { k: { HostName: "x", TailscaleIPs: ["100.1.2.3"], Online: true } },
	});
	assert.equal(noDns[0].shortName, null);
	assert.equal(noDns[0].dnsName, null);
	assert.equal(noDns[0].lastSeen, null);
});

test("parseTailnetPeerRecords carries LastSeen when the status document has it, additively", () => {
	const records = parseTailnetPeerRecords(STATUS, { includeOffline: true });
	const raspberry = records.find((p) => p.name === "raspberry");
	assert.equal(raspberry.online, false);
	assert.equal(raspberry.lastSeen, "2026-07-27T10:00:00Z");
	// The online peer in this fixture carries no LastSeen — null, never invented.
	const android = records.find((p) => p.name === "meu-android");
	assert.equal(android.lastSeen, null);
});

test("parseTailnetPeers stays the exact {name, ip} projection of the records", () => {
	assert.deepEqual(parseTailnetPeers(STATUS), [{ name: "meu-android", ip: "100.88.1.2" }]);
	assert.deepEqual(Object.keys(parseTailnetPeers(STATUS)[0]), ["name", "ip"]);
});

// ── tailnetPeersReport — "the answer is no" vs "I could not ask" ─────────────

test("tailnetStatusReport distinguishes peers from a trustworthy empty tailnet", () => {
	assert.equal(tailnetStatusReport(JSON.stringify(STATUS)).reason, "peers");
	const alone = tailnetStatusReport(JSON.stringify({ Self: STATUS.Self, Peer: {} }));
	assert.equal(alone.ok, true);
	assert.equal(alone.reason, "no-peers");
	assert.deepEqual(alone.peers, []);
});

test("tailnetStatusReport refuses to read non-status output as an empty tailnet", () => {
	for (const stdout of ["not json at all", "{}", "[]", "null", '"a string"']) {
		const report = tailnetStatusReport(stdout);
		assert.equal(report.ok, false, `expected ${stdout} to be unreadable`);
		assert.equal(report.reason, "bad-output");
		assert.match(report.detail, /tailscale status/);
	}
});

test("tailnetPeersReport reports a missing CLI apart from a failed query", async () => {
	const missing = await tailnetPeersReport({
		run: () => Promise.reject(Object.assign(new Error("spawn tailscale ENOENT"), { code: "ENOENT" })),
	});
	assert.equal(missing.ok, false);
	assert.equal(missing.reason, "cli-missing");
	assert.match(missing.detail, /not on PATH/);

	const failed = await tailnetPeersReport({
		run: () => Promise.reject(Object.assign(new Error("Command failed: exit 1"), { code: 1 })),
	});
	assert.equal(failed.ok, false);
	assert.equal(failed.reason, "query-failed");
	assert.match(failed.detail, /Command failed/);
});

test("tailnetPeersReport keeps the CLI's own stderr — that is the actionable part", async () => {
	const report = await tailnetPeersReport({
		run: () =>
			Promise.reject(
				Object.assign(new Error("Command failed: tailscale status --json\n"), {
					code: 1,
					stderr: "failed to connect to local tailscaled\n",
				}),
			),
	});
	assert.equal(report.reason, "query-failed");
	assert.equal(
		report.detail,
		"Command failed: tailscale status --json: failed to connect to local tailscaled",
	);
});

test("tailnetPeersReport never rejects, even for a runner that throws synchronously", async () => {
	const report = await tailnetPeersReport({
		run: () => {
			throw new Error("boom");
		},
	});
	assert.equal(report.ok, false);
	assert.equal(report.reason, "query-failed");
});

test("tailnetPeersReport asks exactly `status --json`, once", async () => {
	const calls = [];
	await tailnetPeersReport({
		run: (args) => {
			calls.push(args);
			return Promise.resolve(JSON.stringify(STATUS));
		},
	});
	assert.deepEqual(calls, [["status", "--json"]]);
});

test("tailnetPeers stays a best-effort [] wrapper over the report", async () => {
	assert.deepEqual(await tailnetPeers({ run: () => Promise.reject(new Error("nope")) }), []);
	assert.deepEqual(await tailnetPeers({ run: () => Promise.resolve("garbage") }), []);
	assert.deepEqual(await tailnetPeers({ run: () => Promise.resolve(JSON.stringify(STATUS)) }), [
		{ name: "meu-android", ip: "100.88.1.2" },
	]);
});

test("tailnetPeers honours includeOffline exactly as before", async () => {
	const peers = await tailnetPeers({
		run: () => Promise.resolve(JSON.stringify(STATUS)),
		includeOffline: true,
	});
	assert.deepEqual(peers.map((p) => p.name).sort(), ["meu-android", "raspberry"]);
});

// PINS the default `tailnetPeers` (and therefore `farm-hello`/`farm-ask`/
// `farm-update`, its four zero-dependency callers) must keep: online-only. A
// caller with a reason to see offline peers too (extended enrolment) passes
// `includeOffline: true` explicitly — this default itself must never move,
// because `farm-hello` needs to reach a peer NOW, not mint a credential for
// one that answers later.
test("tailnetPeers excludes offline peers by default — this is the discovery default, pinned", async () => {
	const peers = await tailnetPeers({ run: () => Promise.resolve(JSON.stringify(STATUS)) });
	assert.deepEqual(peers, [{ name: "meu-android", ip: "100.88.1.2" }]);
});
