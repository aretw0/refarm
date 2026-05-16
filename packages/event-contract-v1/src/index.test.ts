import { describe, expect, it, vi } from "vitest";
import { EVENT_CAPABILITY, createEventBus, runEventBusConformance } from "./index.js";

describe("EVENT_CAPABILITY", () => {
	it("is event:v1", () => {
		expect(EVENT_CAPABILITY).toBe("event:v1");
	});
});

describe("createEventBus", () => {
	it("delivers emitted data to subscriber", () => {
		const bus = createEventBus();
		const handler = vi.fn();
		bus.on("greet", handler);
		bus.emit("greet", { name: "world" });
		expect(handler).toHaveBeenCalledWith({ name: "world" });
	});

	it("does not deliver to other channels", () => {
		const bus = createEventBus();
		const handler = vi.fn();
		bus.on("a", handler);
		bus.emit("b", 42);
		expect(handler).not.toHaveBeenCalled();
	});

	it("unsubscribe stops future deliveries", () => {
		const bus = createEventBus();
		const handler = vi.fn();
		const unsub = bus.on("tick", handler);
		bus.emit("tick");
		unsub();
		bus.emit("tick");
		expect(handler).toHaveBeenCalledTimes(1);
	});

	it("supports multiple subscribers on the same channel", () => {
		const bus = createEventBus();
		const a = vi.fn();
		const b = vi.fn();
		bus.on("ping", a);
		bus.on("ping", b);
		bus.emit("ping", true);
		expect(a).toHaveBeenCalledWith(true);
		expect(b).toHaveBeenCalledWith(true);
	});

	it("clear() removes all subscriptions", () => {
		const bus = createEventBus();
		const handler = vi.fn();
		bus.on("x", handler);
		bus.clear();
		bus.emit("x", 1);
		expect(handler).not.toHaveBeenCalled();
	});

	it("emit with no data passes undefined", () => {
		const bus = createEventBus();
		const handler = vi.fn();
		bus.on("noop", handler);
		bus.emit("noop");
		expect(handler).toHaveBeenCalledWith(undefined);
	});

	it("once() fires exactly once", () => {
		const bus = createEventBus();
		const handler = vi.fn();
		bus.once("shot", handler);
		bus.emit("shot", 1);
		bus.emit("shot", 2);
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith(1);
	});

	it("once() unsubscribe before firing prevents delivery", () => {
		const bus = createEventBus();
		const handler = vi.fn();
		const unsub = bus.once("shot2", handler);
		unsub();
		bus.emit("shot2");
		expect(handler).not.toHaveBeenCalled();
	});
});

describe("runEventBusConformance", () => {
	it("passes for createEventBus()", () => {
		const result = runEventBusConformance(createEventBus());
		expect(result.pass).toBe(true);
		expect(result.failures).toEqual([]);
	});
});
