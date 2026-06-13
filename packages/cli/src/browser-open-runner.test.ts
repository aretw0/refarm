import { execFile } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runBestEffortBrowserOpenCandidate } from "./browser-open.js";

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
	spawn: vi.fn(),
}));

type ExecFileCallback = (error: Error | null) => void;
type ExecFileTestMock = {
	mockReset(): void;
	mockImplementationOnce(
		implementation: (
			command: string,
			args: string[],
			options: { timeout: number },
			callback: ExecFileCallback,
		) => { unref(): void },
	): void;
};

const execFileMock = vi.mocked(execFile) as unknown as ExecFileTestMock;

describe("runBestEffortBrowserOpenCandidate", () => {
	beforeEach(() => {
		execFileMock.mockReset();
	});

	it("opens with execFile and unrefs the child process", async () => {
		const unref = vi.fn();
		execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
			callback(null);
			return { unref };
		});

		await runBestEffortBrowserOpenCandidate({
			command: "xdg-open",
			args: ["https://example.test/auth"],
			display: "xdg-open https://example.test/auth",
		});

		expect(execFileMock).toHaveBeenCalledWith(
			"xdg-open",
			["https://example.test/auth"],
			{ timeout: 5000 },
			expect.any(Function),
		);
		expect(unref).toHaveBeenCalledOnce();
	});

	it("rejects when the opener callback reports an error", async () => {
		execFileMock.mockImplementationOnce((_command, _args, _options, callback) => {
			callback(new Error("not found"));
			return { unref: vi.fn() };
		});

		await expect(
			runBestEffortBrowserOpenCandidate({
				command: "xdg-open",
				args: ["https://example.test/auth"],
				display: "xdg-open https://example.test/auth",
			}),
		).rejects.toThrow("not found");
	});
});
