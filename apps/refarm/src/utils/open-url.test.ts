import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mockOpenHostBrowserUrl = vi.hoisted(() => vi.fn());
const mockLoadConfig = vi.hoisted(() => vi.fn());
const mockHasTty = vi.hoisted(() => vi.fn());
const mockIsCI = vi.hoisted(() => vi.fn());

vi.mock("@refarm.dev/cli/browser-open", () => ({
	openHostBrowserUrl: mockOpenHostBrowserUrl,
}));

vi.mock("@refarm.dev/config", () => ({
	loadConfig: mockLoadConfig,
}));

vi.mock("@refarm.dev/root", () => ({
	hasTty: mockHasTty,
	isCI: mockIsCI,
}));

describe("tryOpenUrl", () => {
	const originalEnv = process.env;
	let tempDir: string;

	afterEach(() => {
		process.env = originalEnv;
		if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
		vi.restoreAllMocks();
		vi.clearAllMocks();
	});

	beforeEach(() => {
		vi.clearAllMocks();
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-open-url-"));
		vi.spyOn(process, "cwd").mockReturnValue(tempDir);
		vi.spyOn(os, "homedir").mockReturnValue(path.join(tempDir, "home"));
		process.env = { ...originalEnv };
		mockLoadConfig.mockReturnValue({});
		mockHasTty.mockReturnValue(true);
		mockIsCI.mockReturnValue(false);
	});

	it("uses the shared host-browser opener", async () => {
		mockOpenHostBrowserUrl.mockResolvedValueOnce({});
		const { tryOpenUrl } = await import("./open-url.js");
		tryOpenUrl("https://example.com");
		expect(mockOpenHostBrowserUrl).toHaveBeenCalledWith(
			"https://example.com",
			expect.objectContaining({ run: expect.any(Function) }),
		);
	});

	it("never throws when opening fails", async () => {
		mockOpenHostBrowserUrl.mockRejectedValueOnce(new Error("not found"));
		const { tryOpenUrl } = await import("./open-url.js");
		expect(() => tryOpenUrl("https://example.com")).not.toThrow();
	});

	it("does not open external links without an interactive TTY", async () => {
		mockHasTty.mockReturnValue(false);
		const { tryOpenUrl } = await import("./open-url.js");
		tryOpenUrl("https://example.com");
		expect(mockOpenHostBrowserUrl).not.toHaveBeenCalled();
	});

	it("does not open external links in CI", async () => {
		mockIsCI.mockReturnValue(true);
		const { tryOpenUrl } = await import("./open-url.js");
		tryOpenUrl("https://example.com");
		expect(mockOpenHostBrowserUrl).not.toHaveBeenCalled();
	});

	it("respects REFARM_OPEN_EXTERNAL_LINKS=never", async () => {
		process.env["REFARM_OPEN_EXTERNAL_LINKS"] = "never";
		const { tryOpenUrl } = await import("./open-url.js");
		tryOpenUrl("https://example.com");
		expect(mockOpenHostBrowserUrl).not.toHaveBeenCalled();
	});

	it("respects operator.openExternalLinks=false from refarm config", async () => {
		mockLoadConfig.mockReturnValue({ operator: { openExternalLinks: false } });
		const { tryOpenUrl } = await import("./open-url.js");
		tryOpenUrl("https://example.com");
		expect(mockOpenHostBrowserUrl).not.toHaveBeenCalled();
	});

	it("respects operator.openExternalLinks=never from .refarm config", async () => {
		fs.mkdirSync(path.join(tempDir, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(tempDir, ".refarm", "config.json"),
			JSON.stringify({ operator: { openExternalLinks: "never" } }),
			"utf-8",
		);
		const { tryOpenUrl } = await import("./open-url.js");
		tryOpenUrl("https://example.com");
		expect(mockOpenHostBrowserUrl).not.toHaveBeenCalled();
	});
});
