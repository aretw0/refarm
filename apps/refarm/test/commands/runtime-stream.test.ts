import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	readEffortAndSessionFallback,
	readEffortResultFile,
	reconcileStreamMetadata,
} from "../../src/commands/runtime-stream.js";

describe("runtime-stream", () => {
	it("replaces zero stream placeholders with the terminal effort usage", async () => {
		const metadata = await reconcileStreamMetadata(
			"eff-1",
			{ model: "gpt-5.5", tokens_in: 0, tokens_out: 0 },
			vi.fn().mockResolvedValue({
				status: "ok",
				content: "answer",
				metadata: {
					model: "gpt-5.5",
					tokens_in: 1400,
					tokens_out: 12,
					tokens_cached: 900,
					pricing_mode: "subscription",
				},
			}),
		);

		expect(metadata).toMatchObject({
			tokens_in: 1400,
			tokens_out: 12,
			tokens_cached: 900,
			pricing_mode: "subscription",
		});
	});

	it("does not query the effort result when the stream already carries metering", async () => {
		const readEffortResult = vi.fn();
		const streamMetadata = { model: "mock", tokens_in: 3, tokens_out: 2 };
		expect(await reconcileStreamMetadata("eff-1", streamMetadata, readEffortResult)).toBe(
			streamMetadata,
		);
		expect(readEffortResult).not.toHaveBeenCalled();
	});

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

	it("returns effort error even when session fallback is available", async () => {
		const readEffortResult = vi.fn().mockResolvedValue({
			status: "error",
			error: "effort failed hard",
		});
		const readSessionFallback = vi.fn().mockResolvedValue({
			status: "ok",
			content: "from session",
		});

		const fallback = await readEffortAndSessionFallback("eff-1", "session-1", {
			readEffortResult,
			readSessionFallback,
		});

		expect(fallback).toEqual({ status: "error", error: "effort failed hard" });
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

describe("readEffortResultFile: effort state machine terminality", () => {
	let resultsDir: string;

	beforeEach(() => {
		resultsDir = fs.mkdtempSync(path.join(os.tmpdir(), "effort-results-"));
	});
	afterEach(() => {
		fs.rmSync(resultsDir, { recursive: true, force: true });
	});

	const write = (effortId: string, payload: unknown): void => {
		fs.writeFileSync(
			path.join(resultsDir, `${effortId}.json`),
			JSON.stringify(payload),
		);
	};

	it("resolves a `delivered` dispatch effort as ok with the delivery receipt", async () => {
		// A dispatch effort's task result is the delivery receipt, not the verb
		// result (which lives out of band). `delivered` is terminal, so it must
		// resolve — not return null (which reads as "keep polling").
		write("eff-delivered", {
			status: "delivered",
			results: [
				{
					status: "ok",
					result: JSON.stringify({ content: "dispatched:vault:dispatch" }),
				},
			],
		});

		const result = await readEffortResultFile(resultsDir, "eff-delivered");
		expect(result).not.toBeNull();
		expect(result?.status).toBe("ok");
		expect(result?.content).toBe("dispatched:vault:dispatch");
	});

	it("returns null for a non-terminal `in-progress` effort (keep polling)", async () => {
		// A respond effort stays in-progress until its result lands; the fallback
		// must NOT resolve it — the caller keeps waiting on the stream.
		write("eff-inprogress", {
			status: "in-progress",
			results: [],
		});

		expect(await readEffortResultFile(resultsDir, "eff-inprogress")).toBeNull();
	});

	it("returns null for a non-terminal `pending` effort", async () => {
		write("eff-pending", { status: "pending", results: [] });
		expect(await readEffortResultFile(resultsDir, "eff-pending")).toBeNull();
	});

	it("resolves a `cancelled` effort as an error, not null", async () => {
		// A cancelled effort is terminal — it must resolve (as an error naming the
		// outcome), never poll forever.
		write("eff-cancelled", {
			status: "cancelled",
			results: [{ status: "cancelled" }],
		});

		const result = await readEffortResultFile(resultsDir, "eff-cancelled");
		expect(result?.status).toBe("error");
		expect(result?.error).toContain("cancelled");
	});

	it("resolves a `timed-out` effort with no task rows as an error", async () => {
		write("eff-timeout", { status: "timed-out", results: [] });
		const result = await readEffortResultFile(resultsDir, "eff-timeout");
		expect(result?.status).toBe("error");
		expect(result?.error).toContain("timed-out");
	});

	it("still resolves a `done` respond effort as ok content", async () => {
		write("eff-done", {
			status: "done",
			results: [{ status: "ok", result: JSON.stringify({ content: "hi" }) }],
		});
		const result = await readEffortResultFile(resultsDir, "eff-done");
		expect(result?.status).toBe("ok");
		expect(result?.content).toBe("hi");
	});

	it("projects the complete normalized usage block from a terminal respond result", async () => {
		write("eff-usage", {
			status: "done",
			results: [
				{
					status: "ok",
					result: {
						content: "hi",
						model: "gpt-5.5",
						provider: "openai-codex",
						usage: {
							tokens_in: 1400,
							tokens_out: 12,
							tokens_cached: 900,
							tokens_reasoning: 7,
							pricing_mode: "subscription",
							estimated_usd: 0,
						},
					},
				},
			],
		});

		expect((await readEffortResultFile(resultsDir, "eff-usage"))?.metadata).toEqual({
			model: "gpt-5.5",
			provider: "openai-codex",
			tokens_in: 1400,
			tokens_out: 12,
			tokens_cached: 900,
			tokens_reasoning: 7,
			pricing_mode: "subscription",
			estimated_usd: 0,
		});
	});
});
