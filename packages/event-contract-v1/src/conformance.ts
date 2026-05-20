import type { EventBus, EventBusConformanceResult } from "./types.js";

export function runEventBusConformance(bus: EventBus): EventBusConformanceResult {
	const failures: string[] = [];
	const total = 5;

	// 1 — emit reaches subscriber
	try {
		let received: unknown;
		bus.on("_conformance_1", (data) => { received = data; });
		bus.emit("_conformance_1", 42);
		if (received !== 42) failures.push("on/emit: handler did not receive emitted data");
	} catch (e) {
		failures.push(`on/emit threw: ${String(e)}`);
	}

	// 2 — unsubscribe stops delivery
	try {
		let count = 0;
		const unsub = bus.on("_conformance_2", () => { count++; });
		bus.emit("_conformance_2");
		unsub();
		bus.emit("_conformance_2");
		if (count !== 1) failures.push("unsubscribe: handler called after unsubscribe");
	} catch (e) {
		failures.push(`unsubscribe threw: ${String(e)}`);
	}

	// 3 — once fires exactly once
	try {
		let count = 0;
		bus.once("_conformance_3", () => { count++; });
		bus.emit("_conformance_3");
		bus.emit("_conformance_3");
		if (count !== 1) failures.push(`once: handler called ${count} times, expected 1`);
	} catch (e) {
		failures.push(`once threw: ${String(e)}`);
	}

	// 4 — multiple subscribers on same channel all receive
	try {
		let a = 0, b = 0;
		bus.on("_conformance_4", () => { a++; });
		bus.on("_conformance_4", () => { b++; });
		bus.emit("_conformance_4");
		if (a !== 1 || b !== 1) failures.push("multiple subscribers: not all received");
	} catch (e) {
		failures.push(`multiple subscribers threw: ${String(e)}`);
	}

	// 5 — emit on unknown channel does not throw
	try {
		bus.emit("_conformance_unknown_channel");
	} catch (e) {
		failures.push(`emit on unknown channel threw: ${String(e)}`);
	}

	const failed = failures.length;
	return { pass: failed === 0, total, failed, failures };
}
