import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamChunk } from "@refarm.dev/stream-contract-v1";
import type { AskDeps } from "../../src/commands/ask.js";
import { createAskCommand } from "../../src/commands/ask.js";

function makeChunk(
	content: string,
	sequence: number,
	is_final: boolean,
	metadata?: unknown,
): StreamChunk {
	return { stream_ref: "eff-1", content, sequence, is_final, metadata };
}

function makeDeps(overrides: Partial<AskDeps> = {}): AskDeps {
	return {
		submitEffort: vi.fn().mockResolvedValue("eff-1"),
		followStream: vi.fn().mockImplementation(
			async (_effortId: string, onChunk: (chunk: StreamChunk) => void) => {
				onChunk(makeChunk("hello ", 0, false));
				onChunk(
					makeChunk("world", 1, true, {
						model: "claude-sonnet-4-6",
						tokens_in: 50,
						tokens_out: 100,
						estimated_usd: 0.0005,
					}),
				);
			},
		),
		...overrides,
	};
}

describe("refarm ask", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
	});

	it("submits effort with pi-agent respond payload", async () => {
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		await command.parseAsync(["what is CRDT?"], { from: "user" });

		expect(deps.submitEffort).toHaveBeenCalledWith(
			expect.objectContaining({
				direction: "ask",
				source: "refarm-ask",
				tasks: [
					expect.objectContaining({
						pluginId: "pi-agent",
						fn: "respond",
						args: expect.objectContaining({ prompt: "what is CRDT?" }),
					}),
				],
			}),
		);
		expect(deps.followStream).toHaveBeenCalledWith("eff-1", expect.any(Function));
		expect(outSpy).toHaveBeenCalled();

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("prints usage footer when final metadata is present", async () => {
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		await command.parseAsync(["hello"], { from: "user" });

		const allLogs = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(allLogs).toContain("model:");
		expect(allLogs).toContain("claude-sonnet-4-6");
		expect(allLogs).toContain("50 in / 100 out");

		logSpy.mockRestore();
		outSpy.mockRestore();
	});

	it("handles --files without failing", async () => {
		const deps = makeDeps();
		const command = createAskCommand(deps);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const outSpy = vi
			.spyOn(process.stdout, "write")
			.mockImplementation(() => true);

		await command.parseAsync(["explain", "--files", "README.md,package.json"], {
			from: "user",
		});

		expect(deps.submitEffort).toHaveBeenCalledOnce();
		logSpy.mockRestore();
		outSpy.mockRestore();
	});
});
