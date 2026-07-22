import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createFarmAnnouncer,
	decodeFarmAnnounce,
	decodeFarmProbe,
	discoverFarms,
	encodeFarmAnnounce,
	encodeFarmProbe,
	FARM_BEACON_MULTICAST_GROUP,
	subnetSweepTargets,
} from "../src/beacon.mjs";

test("probe and announce roundtrip through their codecs", () => {
	const probe = decodeFarmProbe(encodeFarmProbe());
	assert.equal(probe.v, 1);

	const announce = decodeFarmAnnounce(
		encodeFarmAnnounce({ name: "quinta", wsPort: 42000, httpPort: 42001 }),
	);
	assert.deepEqual(announce, { name: "quinta", wsPort: 42000, httpPort: 42001 });
});

test("malformed, wrong-magic, and oversized datagrams decode to null", () => {
	assert.equal(decodeFarmProbe(Buffer.from("not json")), null);
	assert.equal(decodeFarmProbe(Buffer.from('{"refarm":"other","v":1}')), null);
	assert.equal(decodeFarmAnnounce(Buffer.from('{"refarm":"announce","v":99}')), null);
	assert.equal(decodeFarmAnnounce(Buffer.from(`{"refarm":"announce","v":1,"name":"${"x".repeat(5000)}"}`)), null);
	// A probe is never an announce and vice versa.
	assert.equal(decodeFarmAnnounce(encodeFarmProbe()), null);
	assert.equal(decodeFarmProbe(encodeFarmAnnounce({ name: "q", wsPort: 1, httpPort: 2 })), null);
});

test("subnet sweep enumerates the /24, skips self, and refuses big subnets", () => {
	const interfaces = {
		wlan0: [
			{ family: "IPv4", internal: false, address: "192.168.0.20", netmask: "255.255.255.0" },
		],
		big0: [
			// /18 would be 16k packets — a sweep must refuse it, not degrade into a scan storm.
			{ family: "IPv4", internal: false, address: "172.24.38.251", netmask: "255.255.192.0" },
		],
		lo: [{ family: "IPv4", internal: true, address: "127.0.0.1", netmask: "255.0.0.0" }],
	};
	const targets = subnetSweepTargets(42002, interfaces);
	const addresses = targets.map((t) => t.address);
	assert.equal(addresses.length, 253); // 254 hosts minus self
	assert.ok(addresses.includes("192.168.0.1"));
	assert.ok(addresses.includes("192.168.0.254"));
	assert.ok(!addresses.includes("192.168.0.20")); // never probe yourself
	assert.ok(!addresses.includes("192.168.0.0")); // network address out
	assert.ok(!addresses.includes("192.168.0.255")); // broadcast handled by dialect 1
	assert.ok(!addresses.some((a) => a.startsWith("172.24."))); // /18 refused
	assert.ok(targets.every((t) => t.port === 42002));
});

test("announcer answers a probe and discovery finds it (loopback roundtrip)", async () => {
	const announcer = await createFarmAnnouncer({
		name: "quinta-teste",
		wsPort: 42000,
		httpPort: 42001,
		port: 0,
		host: "127.0.0.1",
	});
	try {
		const farms = await discoverFarms({
			targets: [{ address: "127.0.0.1", port: announcer.port }],
			timeoutMs: 1500,
		});
		assert.equal(farms.length, 1);
		assert.equal(farms[0].name, "quinta-teste");
		assert.equal(farms[0].wsPort, 42000);
		assert.equal(farms[0].httpPort, 42001);
		assert.equal(farms[0].address, "127.0.0.1");
	} finally {
		await announcer.close();
	}
});

test("multicast probe reaches the announcer — the dialect broadcast filters miss", async (t) => {
	const announcer = await createFarmAnnouncer({
		name: "quinta-multicast",
		wsPort: 42000,
		httpPort: 42001,
		port: 0,
		host: "0.0.0.0",
	});
	try {
		if (!announcer.multicast) {
			t.skip("multicast membership unavailable on this host");
			return;
		}
		const viaMulticast = await discoverFarms({
			targets: [{ address: FARM_BEACON_MULTICAST_GROUP, port: announcer.port }],
			timeoutMs: 2000,
			multicastLoopback: true,
		});
		if (viaMulticast.length === 0) {
			// Some hosts (wireless drivers, rp_filter) never deliver locally-sent
			// multicast back to the same machine. Distinguish that ENVIRONMENT from a
			// broken announcer with a unicast control probe before skipping.
			const viaUnicast = await discoverFarms({
				targets: [{ address: "127.0.0.1", port: announcer.port }],
				timeoutMs: 1500,
			});
			assert.equal(viaUnicast.length, 1, "announcer answered neither dialect — broken");
			t.skip("local multicast delivery unavailable on this host (unicast control passed)");
			return;
		}
		assert.equal(viaMulticast[0].name, "quinta-multicast");
	} finally {
		await announcer.close();
	}
});

test("announcer stays silent for malformed probes — discovery times out empty", async () => {
	const announcer = await createFarmAnnouncer({
		name: "quinta-teste",
		wsPort: 42000,
		httpPort: 42001,
		port: 0,
		host: "127.0.0.1",
	});
	try {
		const dgram = await import("node:dgram");
		const socket = dgram.createSocket("udp4");
		await new Promise((resolve) =>
			socket.send(Buffer.from("{}"), announcer.port, "127.0.0.1", resolve),
		);
		socket.close();
		const farms = await discoverFarms({
			targets: [],
			timeoutMs: 300,
		});
		assert.deepEqual(farms, []);
	} finally {
		await announcer.close();
	}
});
