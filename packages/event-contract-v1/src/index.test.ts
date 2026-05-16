import { describe, expect, it, vi } from "vitest";
import { createEventBus } from "./index.js";

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
});
