import { describe, expect, it, vi } from "vitest";
import { readEffortAndSessionFallback } from "../../src/commands/runtime-stream.js";

describe("runtime-stream", () => {
	it("prefers effort fallback when available", async () => {
		const effortResult = {
			status: "ok",
			content: "from effort",
			metadata: { source: "effort" },
		};

		const readEffortResult = vi.fn().mockResolvedValue(effortResult);
		const readSessionFallback = vi.fn().mockResolvedValue({
			status: "ok",
			content: "from session",
			metadata: { source: "session" },
		});

		const fallback = await readEffortAndSessionFallback("eff-1", "session-1", {
			readEffortResult,
			readSessionFallback,
		});

		expect(fallback).toEqual(effortResult);
		expect(readEffortResult).toHaveBeenCalledWith("eff-1");
		expect(readSessionFallback).not.toHaveBeenCalled();
	});

	it("falls back to session only when effort fallback is absent", async () => {
		const sessionFallback = {
			status: "ok",
			content: "from session",
		};

		const readEffortResult = vi.fn().mockResolvedValue(null);
		const readSessionFallback = vi.fn().mockResolvedValue(sessionFallback);

		const fallback = await readEffortAndSessionFallback("eff-1", "session-1", {
			readEffortResult,
			readSessionFallback,
		});

		expect(fallback).toEqual(sessionFallback);
		expect(readEffortResult).toHaveBeenCalledWith("eff-1");
		expect(readSessionFallback).toHaveBeenCalledWith("session-1");
	});

	it("returns null when neither effort nor session fallback exists", async () => {
		const readEffortResult = vi.fn().mockResolvedValue(null);
		const readSessionFallback = vi.fn().mockResolvedValue(null);

		const fallback = await readEffortAndSessionFallback("eff-1", "session-1", {
			readEffortResult,
			readSessionFallback,
		});

		expect(fallback).toBeNull();
		expect(readEffortResult).toHaveBeenCalledWith("eff-1");
		expect(readSessionFallback).toHaveBeenCalledWith("session-1");
	});

	it("returns null when readSessionFallback is not provided", async () => {
		const readEffortResult = vi.fn().mockResolvedValue(null);

		const fallback = await readEffortAndSessionFallback("eff-1", "session-1", {
			readEffortResult,
		});

		expect(fallback).toBeNull();
		expect(readEffortResult).toHaveBeenCalledWith("eff-1");
	});
});
