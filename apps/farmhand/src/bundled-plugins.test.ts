import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the modules that touch filesystem or npm resolution
vi.mock("node:module", () => {
	const fakeRequire = (specifier: string): string => {
		throw new Error(`Cannot resolve ${specifier}`);
	};
	fakeRequire.resolve = (specifier: string): string => {
		if (specifier === "@refarm.dev/pi-agent/package.json") {
			return "/fake/pi-agent/package.json";
		}
		throw new Error(`Cannot resolve ${specifier}`);
	};
	return {
		createRequire: vi.fn(() => fakeRequire),
	};
});

vi.mock("node:fs", async () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
	copyFileSync: vi.fn(),
}));

vi.mock("node:fs/promises", async () => ({
	mkdir: vi.fn().mockResolvedValue(undefined),
	readFile: vi.fn(),
	writeFile: vi.fn().mockResolvedValue(undefined),
}));

const mockFs = await import("node:fs");
const mockFsP = await import("node:fs/promises");

describe("bundleInstallPlugin", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		// Re-establish default no-op mocks after reset
		vi.mocked(mockFsP.mkdir).mockResolvedValue(undefined);
		vi.mocked(mockFsP.writeFile).mockResolvedValue(undefined);
	});

	it("returns cached when installed version matches package version", async () => {
		vi.mocked(mockFs.readFileSync)
			.mockReturnValueOnce(JSON.stringify({ version: "0.1.0" })) // package.json
			.mockReturnValueOnce(JSON.stringify({ id: "@refarm/pi-agent", name: "Pi Agent", version: "0.1.0" })); // plugin.json template
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.mocked(mockFsP.readFile).mockResolvedValue("0.1.0" as any);

		const { bundleInstallPlugin } = await import("./bundled-plugins.js");
		const result = await bundleInstallPlugin(
			{ id: "@refarm/pi-agent", package: "@refarm.dev/pi-agent", wasmFile: "dist/pi_agent.wasm" },
			"/fake/plugins",
		);

		expect(result.status).toBe("cached");
	});

	it("returns failed when WASM file does not exist", async () => {
		vi.mocked(mockFs.readFileSync)
			.mockReturnValueOnce(JSON.stringify({ version: "0.1.0" }))
			.mockReturnValueOnce(JSON.stringify({ id: "@refarm/pi-agent", name: "Pi Agent", version: "0.1.0" }));
		vi.mocked(mockFsP.readFile).mockRejectedValue(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
		vi.mocked(mockFs.existsSync).mockReturnValue(false);

		const { bundleInstallPlugin } = await import("./bundled-plugins.js");
		const result = await bundleInstallPlugin(
			{ id: "@refarm/pi-agent", package: "@refarm.dev/pi-agent", wasmFile: "dist/pi_agent.wasm" },
			"/fake/plugins",
		);

		expect(result.status).toBe("failed");
	});

	it("installs when version differs", async () => {
		vi.mocked(mockFs.readFileSync)
			.mockReturnValueOnce(JSON.stringify({ version: "0.2.0" })) // package.json - new version
			.mockReturnValueOnce("fake-wasm-bytes") // wasm bytes (string works for createHash)
			.mockReturnValueOnce(JSON.stringify({ id: "@refarm/pi-agent", name: "Pi Agent", version: "0.1.0" })); // plugin.json template
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		vi.mocked(mockFsP.readFile).mockResolvedValue("0.1.0" as any); // installed version
		vi.mocked(mockFs.existsSync).mockReturnValue(true);

		const { bundleInstallPlugin } = await import("./bundled-plugins.js");
		const result = await bundleInstallPlugin(
			{ id: "@refarm/pi-agent", package: "@refarm.dev/pi-agent", wasmFile: "dist/pi_agent.wasm" },
			"/fake/plugins",
		);

		expect(result.status).toBe("installed");
		expect(mockFsP.writeFile).toHaveBeenCalled();
	});
});
