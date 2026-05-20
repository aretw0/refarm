import { describe, it, expect, vi, afterEach } from "vitest";
import * as childProcess from "node:child_process";

vi.mock("node:child_process", () => ({
	execFile: vi.fn(),
}));

vi.mock("@refarm.dev/root", () => ({
	isWsl: vi.fn().mockReturnValue(false),
}));

import { isWsl } from "@refarm.dev/root";

const mockExecFile = vi.mocked(childProcess.execFile);
const mockIsWsl = vi.mocked(isWsl);

function mockChild(unref = vi.fn()) {
	return { unref } as unknown as ReturnType<typeof childProcess.execFile>;
}

describe("tryOpenUrl", () => {
	afterEach(() => vi.clearAllMocks());

	it("never throws even if execFile throws", async () => {
		mockExecFile.mockImplementation(() => { throw new Error("no such file"); });
		const { tryOpenUrl } = await import("./open-url.js");
		expect(() => tryOpenUrl("https://example.com")).not.toThrow();
	});

	it("calls execFile with a timeout so a hanging child process cannot block the flow", async () => {
		const child = mockChild();
		mockExecFile.mockReturnValue(child);
		const { tryOpenUrl } = await import("./open-url.js");
		tryOpenUrl("https://example.com");
		const opts = mockExecFile.mock.calls[0]?.[2] as { timeout?: number } | undefined;
		expect(opts?.timeout).toBeGreaterThan(0);
	});

	it("calls unref() so Node can exit even while browser is opening", async () => {
		const unref = vi.fn();
		mockExecFile.mockReturnValue(mockChild(unref));
		const { tryOpenUrl } = await import("./open-url.js");
		tryOpenUrl("https://example.com");
		expect(unref).toHaveBeenCalled();
	});

	it("uses wslview when isWsl() returns true", async () => {
		mockIsWsl.mockReturnValue(true);
		const child = mockChild();
		mockExecFile.mockReturnValue(child);
		const { tryOpenUrl } = await import("./open-url.js");
		tryOpenUrl("https://example.com");
		const bin = mockExecFile.mock.calls[0]?.[0] as string;
		expect(bin).toBe("wslview");
	});
});
