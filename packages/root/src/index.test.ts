import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { isContainer, isWsl, isCI } from "./index.js";

vi.mock("node:fs", () => ({ existsSync: vi.fn() }));

const mockExists = vi.mocked(existsSync);

afterEach(() => {
	vi.clearAllMocks();
	for (const k of ["WSL_DISTRO_NAME", "WSL_INTEROP", "REMOTE_CONTAINERS",
		"VSCODE_REMOTE_CONTAINERS_SESSION", "CODESPACES", "CI", "GITHUB_ACTIONS", "CIRCLECI"]) {
		delete process.env[k];
	}
});

describe("isContainer", () => {
	it("returns true when /.dockerenv exists", () => {
		mockExists.mockReturnValue(true);
		expect(isContainer()).toBe(true);
	});

	it("returns true when REMOTE_CONTAINERS is set", () => {
		mockExists.mockReturnValue(false);
		process.env["REMOTE_CONTAINERS"] = "true";
		expect(isContainer()).toBe(true);
	});

	it("returns true when CODESPACES is set", () => {
		mockExists.mockReturnValue(false);
		process.env["CODESPACES"] = "true";
		expect(isContainer()).toBe(true);
	});

	it("returns false when no container signals are present", () => {
		mockExists.mockReturnValue(false);
		expect(isContainer()).toBe(false);
	});
});

describe("isWsl", () => {
	it("returns true when WSL_DISTRO_NAME is set on linux", () => {
		Object.defineProperty(process, "platform", { value: "linux", configurable: true });
		process.env["WSL_DISTRO_NAME"] = "Ubuntu";
		expect(isWsl()).toBe(true);
	});

	it("returns false when not linux platform", () => {
		Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
		process.env["WSL_DISTRO_NAME"] = "Ubuntu";
		expect(isWsl()).toBe(false);
	});

	it("returns true when WSL_INTEROP is set on linux", () => {
		Object.defineProperty(process, "platform", { value: "linux", configurable: true });
		process.env["WSL_INTEROP"] = "/run/WSL/12345_interop";
		expect(isWsl()).toBe(true);
	});
});

describe("isCI", () => {
	it("returns true when CI env var is set", () => {
		process.env["CI"] = "true";
		expect(isCI()).toBe(true);
	});

	it("returns true when GITHUB_ACTIONS is set", () => {
		process.env["GITHUB_ACTIONS"] = "true";
		expect(isCI()).toBe(true);
	});

	it("returns false with no CI signals", () => {
		expect(isCI()).toBe(false);
	});
});
