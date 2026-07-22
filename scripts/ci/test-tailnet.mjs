import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTailnetPeers, tailnetShortName } from "../lib/tailnet.mjs";

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
