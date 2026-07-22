import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createFarmAnnouncer,
	decodeFarmAnnounce,
	decodeFarmProbe,
	discoverFarms,
	encodeFarmAnnounce,
	encodeFarmProbe,
} from "../lib/farm-beacon.mjs";

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
