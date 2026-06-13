import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startThinkingSpinner } from "../../src/commands/chat.js";

describe("chat spinner", () => {
	const originalIsTty = process.stdout.isTTY;
	let writeSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.useFakeTimers();
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: true,
		});
		writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
	});

	afterEach(() => {
		writeSpy.mockRestore();
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: originalIsTty,
		});
		vi.useRealTimers();
	});

	it("clears the terminal line when the first stream chunk arrives", () => {
		const stop = startThinkingSpinner(() => "Waiting for first token");

		vi.advanceTimersByTime(80);
		stop();

		expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining("Waiting for first token"));
		expect(writeSpy).toHaveBeenLastCalledWith("\r\x1b[2K");
	});

	it("does not write spinner frames when stdout is not a TTY", () => {
		Object.defineProperty(process.stdout, "isTTY", {
			configurable: true,
			value: false,
		});

		const stop = startThinkingSpinner();
		vi.advanceTimersByTime(160);
		stop();

		expect(writeSpy).not.toHaveBeenCalled();
	});
});
