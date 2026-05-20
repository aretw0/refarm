import { describe, expect, it, vi } from "vitest";
import { createRuntimeCommand } from "../../src/commands/runtime.js";
import type { LaunchRuntimeSelection } from "../../src/commands/session-launch.js";

describe("runtime command", () => {
	it("prints runtime engine selection", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "auto",
			resolveRuntime: () => ({
				configuredEngine: "auto",
				activeEngine: "rust",
				reason: "auto-rust-available",
			}),
		});

		await command.parseAsync([], { from: "user" });

		const output = logSpy.mock.calls.map((call) => String(call[0])).join("\n");
		expect(output).toContain("Refarm runtime");
		expect(output).toContain("configured: auto");
		expect(output).toContain("active:     rust");
		expect(output).toContain("refarm config set tractor.engine auto");
		logSpy.mockRestore();
	});

	it("outputs JSON payload", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const selection: LaunchRuntimeSelection = {
			configuredEngine: "ts",
			activeEngine: "ts",
			reason: "configured-ts",
		};
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "ts",
			resolveRuntime: () => selection,
		});

		await command.parseAsync(["--json"], { from: "user" });

		expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toEqual({
			configuredEngine: "ts",
			activeEngine: "ts",
			reason: "configured-ts",
		});
		logSpy.mockRestore();
	});

	it("reports explicit Rust configuration when the binary is missing", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const command = createRuntimeCommand({
			repoRoot: () => "/repo",
			readEngine: () => "rust",
			resolveRuntime: () => {
				throw new Error("tractor.engine=rust but the Rust tractor binary is not built");
			},
		});

		await command.parseAsync(["--json"], { from: "user" });

		expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({
			configuredEngine: "rust",
			activeEngine: "unknown",
			reason: "configured-rust-missing-binary",
			issue: expect.stringContaining("Rust tractor binary is not built"),
		});
		logSpy.mockRestore();
	});
});
