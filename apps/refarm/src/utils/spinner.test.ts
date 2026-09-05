import { describe, expect, it, vi } from "vitest";

import { startProgressIndicator } from "./spinner.js";

function fakeTty(): NodeJS.WriteStream & { written: string[] } {
	const written: string[] = [];
	return {
		isTTY: true,
		write: (chunk: string) => {
			written.push(String(chunk));
			return true;
		},
		written,
	} as unknown as NodeJS.WriteStream & { written: string[] };
}

/**
 * TWO STREAMS, ONE CURSOR. The spinner writes to stderr and commands report through stdout; a
 * terminal gives both one cursor, so a success line landed ON the spinner's line:
 *
 *   ⠼ Signing in to GitHub Copilot — Exchanging the token…  ✓ GitHub Copilot — authenticated
 *
 * Reported by the operator 2026-08-15. Fixed in the block rather than at each call site, so every
 * command that uses the spinner gets correct interleaving without a rule to remember.
 */
describe("startProgressIndicator — stdout while spinning", () => {
	it("clears the spinner line BEFORE a stdout write, and redraws after", () => {
		const stream = fakeTty();
		const stdout = process.stdout;
		const originalWrite = stdout.write.bind(stdout);
		const originalIsTty = stdout.isTTY;
		Object.defineProperty(stdout, "isTTY", { value: true, configurable: true });
		const captured: string[] = [];
		stdout.write = ((chunk: string) => {
			captured.push(String(chunk));
			return true;
		}) as typeof stdout.write;

		const indicator = startProgressIndicator("working", { stream, intervalMs: 10_000 });
		const before = stream.written.length;
		process.stdout.write("✓ done\n");
		indicator.stop();

		stdout.write = originalWrite;
		Object.defineProperty(stdout, "isTTY", { value: originalIsTty, configurable: true });

		// The write reached stdout untouched…
		expect(captured).toContain("✓ done\n");
		// …and the spinner cleared its line first, then redrew: two more stderr writes around it.
		const after = stream.written.slice(before);
		expect(after[0]).toBe("\r\x1b[2K");
		expect(after.some((line) => line.includes("working"))).toBe(true);
	});

	it("restores stdout when it stops, so nothing is patched after the work ends", () => {
		const stream = fakeTty();
		const stdout = process.stdout;
		Object.defineProperty(stdout, "isTTY", { value: true, configurable: true });
		const before = stdout.write;
		const indicator = startProgressIndicator("working", { stream, intervalMs: 10_000 });
		expect(stdout.write).not.toBe(before);
		indicator.stop();
		expect(stdout.write).toBe(before);
		Object.defineProperty(stdout, "isTTY", { value: false, configurable: true });
	});

	it("does not patch anything when the stream is not a terminal", () => {
		// Piped output has no shared cursor to corrupt, and patching there would reorder a log file.
		const stream = { isTTY: false, write: vi.fn() } as unknown as NodeJS.WriteStream;
		const before = process.stdout.write;
		const indicator = startProgressIndicator("working", { stream });
		expect(process.stdout.write).toBe(before);
		indicator.stop();
	});
});
