import type { RefarmStatusOptions } from "@refarm.dev/cli/status";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	HOMESTEAD_HOST_RENDERER_KINDS,
	requiredHomesteadHostRendererCapabilities,
} from "@refarm.dev/homestead/sdk/host-renderer";

const {
	mockAssertRefarmStatusJson,
	mockBuildRefarmStatusJson,
	mockFormatRefarmStatusJson,
	mockFormatRefarmStatusMarkdown,
	mockParseRefarmStatusJson,
	mockProbeRuntimeReady,
} = vi.hoisted(() => ({
	mockAssertRefarmStatusJson: vi.fn(),
	mockBuildRefarmStatusJson: vi.fn(),
	mockFormatRefarmStatusJson: vi.fn(),
	mockFormatRefarmStatusMarkdown: vi.fn(),
	mockParseRefarmStatusJson: vi.fn(),
	mockProbeRuntimeReady: vi.fn(),
}));

vi.mock("@refarm.dev/cli/status", () => ({
	assertRefarmStatusJson: mockAssertRefarmStatusJson,
	buildRefarmStatusJson: mockBuildRefarmStatusJson,
	formatRefarmStatusJson: mockFormatRefarmStatusJson,
	formatRefarmStatusMarkdown: mockFormatRefarmStatusMarkdown,
	parseRefarmStatusJson: mockParseRefarmStatusJson,
}));

vi.mock("../../src/commands/runtime-readiness.js", () => ({
	probeRuntimeReady: mockProbeRuntimeReady,
}));

import { statusCommand } from "../../src/commands/status.js";
import {
	REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
	REFARM_STATUS_OPEN_REPORT_ACTION_ID,
} from "../../src/commands/status-surfaces.js";

describe("statusCommand", () => {
	let cwd: string;
	let home: string;
	let cargoTargetDir: string;
	let originalCargoTargetDir: string | undefined;

	beforeEach(() => {
		cwd = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-status-cwd-"));
		home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-status-home-"));
		cargoTargetDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-status-cargo-"));
		originalCargoTargetDir = process.env.CARGO_TARGET_DIR;
		process.env.CARGO_TARGET_DIR = cargoTargetDir;
		vi.spyOn(process, "cwd").mockReturnValue(cwd);
		vi.spyOn(os, "homedir").mockReturnValue(home);
		vi.clearAllMocks();
		mockProbeRuntimeReady.mockResolvedValue(true);
		mockBuildRefarmStatusJson.mockImplementation((input: RefarmStatusOptions) => ({
			schemaVersion: 1,
			host: input.host,
			renderer: input.renderer,
			runtime: input.runtime,
			plugins: {
				installed: 0,
				active: 0,
				rejectedSurfaces: 0,
				surfaceActions: 0,
			},
			trust: input.trust,
			streams: { active: 0, terminal: 0 },
			diagnostics: [],
		}));
		mockFormatRefarmStatusJson.mockImplementation(() =>
			JSON.stringify({ schemaVersion: 1 }, null, 2),
		);
		mockFormatRefarmStatusMarkdown.mockImplementation(
			() => "# Refarm Status\n",
		);
		mockParseRefarmStatusJson.mockReturnValue({
			schemaVersion: 1,
			host: {
				app: "apps/refarm",
				command: "refarm",
				profile: "dev",
				mode: "headless",
			},
			renderer: {
				id: "refarm-headless",
				kind: "headless",
				capabilities: ["diagnostics"],
			},
			runtime: {
				ready: true,
				databaseName: "refarm-main",
				namespace: "refarm-main",
			},
			plugins: {
				installed: 0,
				active: 0,
				rejectedSurfaces: 0,
				surfaceActions: 0,
			},
			trust: { profile: "strict", warnings: 0, critical: 0 },
			streams: { active: 0, terminal: 0 },
			diagnostics: [],
		});
	});

	afterEach(() => {
		if (originalCargoTargetDir === undefined) {
			delete process.env.CARGO_TARGET_DIR;
		} else {
			process.env.CARGO_TARGET_DIR = originalCargoTargetDir;
		}
		vi.restoreAllMocks();
	});

	it("documents status rendering and diagnostic next steps in help", () => {
		let help = "";
		statusCommand.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		statusCommand.outputHelp();

		expect(help).toContain("refarm status --json");
		expect(help).toContain("refarm status --input status.json --markdown");
		expect(help).toContain("refarm runtime status");
		expect(help).toContain("Use refarm doctor");
	});

	it("builds status from a local runtime snapshot without booting tractor-ts", async () => {
		await statusCommand.parseAsync(["--json"], { from: "user" });
		expect(mockBuildRefarmStatusJson).toHaveBeenCalledWith(
			expect.objectContaining({
				runtime: {
					ready: true,
					namespace: "refarm-main",
					databaseName: "refarm-main",
					engine: {
						configuredEngine: "auto",
						activeEngine: "ts",
					},
				},
				trust: { profile: "strict", warnings: 0, critical: 0 },
			}),
		);
	});

	it("reports project tractor engine preference in live status", async () => {
		fs.mkdirSync(path.join(cwd, ".refarm"), { recursive: true });
		fs.writeFileSync(
			path.join(cwd, ".refarm", "config.json"),
			JSON.stringify({ tractor: { engine: "rust" } }),
			"utf-8",
		);

		await statusCommand.parseAsync(["--json"], { from: "user" });

		expect(mockBuildRefarmStatusJson).toHaveBeenCalledWith(
			expect.objectContaining({
				runtime: expect.objectContaining({
					engine: {
						configuredEngine: "rust",
						activeEngine: "unknown",
					},
				}),
			}),
		);
	});

	it("reports runtime as not ready when the sidecar probe fails", async () => {
		mockProbeRuntimeReady.mockResolvedValue(false);

		await statusCommand.parseAsync(["--json"], { from: "user" });

		expect(mockProbeRuntimeReady).toHaveBeenCalledWith(300);
		expect(mockBuildRefarmStatusJson).toHaveBeenCalledWith(
			expect.objectContaining({
				runtime: expect.objectContaining({
					ready: false,
				}),
			}),
		);
	});

	it("outputs valid JSON with schemaVersion:1 when --json is passed", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await statusCommand.parseAsync(["--json"], { from: "user" });
		const output = spy.mock.calls.find(
			([line]) => typeof line === "string" && line.includes("schemaVersion"),
		);
		expect(output).toBeDefined();
		const parsed = JSON.parse(output![0] as string);
		expect(parsed.schemaVersion).toBe(1);
		expect(mockAssertRefarmStatusJson).toHaveBeenCalled();
		expect(mockFormatRefarmStatusJson).toHaveBeenCalledWith(
			expect.objectContaining({ schemaVersion: 1 }),
		);
		spy.mockRestore();
	});

	it("forwards each requested renderer descriptor to status builder", async () => {
		for (const kind of HOMESTEAD_HOST_RENDERER_KINDS) {
			mockBuildRefarmStatusJson.mockClear();

			await statusCommand.parseAsync(["--json", "--renderer", kind], {
				from: "user",
			});

			expect(mockBuildRefarmStatusJson).toHaveBeenCalledWith(
				expect.objectContaining({
					host: expect.objectContaining({ mode: kind }),
					renderer: expect.objectContaining({
						id: `refarm-${kind}`,
						kind,
						capabilities: requiredHomesteadHostRendererCapabilities(kind),
					}),
				}),
			);
		}
	});

	it("forwards app-owned status action affordances to status builder", async () => {
		await statusCommand.parseAsync(["--json"], { from: "user" });

		expect(mockBuildRefarmStatusJson).toHaveBeenCalledWith(
			expect.objectContaining({
				plugins: {
					surfaces: expect.objectContaining({
						context: expect.objectContaining({ hostId: "apps/refarm" }),
						availableActions: [
							expect.objectContaining({
								id: REFARM_STATUS_OPEN_REPORT_ACTION_ID,
								intent: "refarm:status-open",
							}),
							expect.objectContaining({
								id: REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
								intent: "trust:inspect",
							}),
						],
					}),
				},
			}),
		);
	});

	it("invokes a live status action by ID", async () => {
		mockBuildRefarmStatusJson.mockImplementation((input: RefarmStatusOptions) => ({
			schemaVersion: 1,
			host: input.host,
			renderer: input.renderer,
			runtime: input.runtime,
			plugins: {
				installed: 0,
				active: 0,
				rejectedSurfaces: 0,
				surfaceActions: 2,
				availableActions: [
					{
						id: REFARM_STATUS_OPEN_REPORT_ACTION_ID,
						label: "Open status report",
						intent: "refarm:status-open",
					},
					{
						id: REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
						label: "Inspect trust",
						intent: "trust:inspect",
					},
				],
			},
			trust: input.trust,
			streams: { active: 0, terminal: 0 },
			diagnostics: [],
		}));
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		await statusCommand.parseAsync(
			["--action", REFARM_STATUS_INSPECT_TRUST_ACTION_ID],
			{ from: "user" },
		);

		const envelope = JSON.parse(spy.mock.calls.at(-1)?.[0] as string);
		expect(envelope).toMatchObject({
			schemaVersion: 1,
			statusSchemaVersion: 1,
			reason: "executed",
			renderer: "status",
			statusSource: "live",
			handled: true,
			selection: {
				requested: REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
				source: "id",
				resolvedId: REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
				index: 2,
			},
			actionRequest: {
				pluginId: "apps/refarm",
				action: {
					id: REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
					intent: "trust:inspect",
				},
			},
		});
		spy.mockRestore();
	});

	it("invokes a live status action by row index", async () => {
		mockBuildRefarmStatusJson.mockImplementation((input: RefarmStatusOptions) => ({
			schemaVersion: 1,
			host: input.host,
			renderer: input.renderer,
			runtime: input.runtime,
			plugins: {
				installed: 0,
				active: 0,
				rejectedSurfaces: 0,
				surfaceActions: 2,
				availableActions: [
					{
						id: REFARM_STATUS_OPEN_REPORT_ACTION_ID,
						label: "Open status report",
						intent: "refarm:status-open",
					},
					{
						id: REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
						label: "Inspect trust",
						intent: "trust:inspect",
					},
				],
			},
			trust: input.trust,
			streams: { active: 0, terminal: 0 },
			diagnostics: [],
		}));
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		await statusCommand.parseAsync(["--action", "2"], { from: "user" });

		const envelope = JSON.parse(spy.mock.calls.at(-1)?.[0] as string);
		expect(envelope.selection).toEqual({
			requested: "2",
			source: "index",
			resolvedId: REFARM_STATUS_INSPECT_TRUST_ACTION_ID,
			index: 2,
		});
		expect(envelope.statusSource).toBe("live");
		expect(envelope.handled).toBe(true);
		spy.mockRestore();
	});

	it("rejects unavailable status actions", async () => {
		await expect(
			statusCommand.parseAsync(["--action", "missing-action"], {
				from: "user",
			}),
		).rejects.toThrow(/Status action "missing-action" is not available/);
	});

	it("rejects status action invocation combined with other output modes", async () => {
		await expect(
			statusCommand.parseAsync(["--action", "1", "--json"], {
				from: "user",
			}),
		).rejects.toThrow(/--action cannot be combined with --json or --markdown/);
	});

	it("rejects live status action invocation from input artifacts", async () => {
		await expect(
			statusCommand.parseAsync(["--action", "1", "--input", "status.json"], {
				from: "user",
			}),
		).rejects.toThrow(/--action cannot be combined with --input/);
		expect(mockParseRefarmStatusJson).not.toHaveBeenCalled();
	});

	it("fails fast for unknown renderer kinds", async () => {
		await expect(
			statusCommand.parseAsync(["--json", "--renderer", "matrix"], {
				from: "user",
			}),
		).rejects.toThrow(/Invalid renderer kind/);
	});

	it("outputs markdown when --markdown is requested", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await statusCommand.parseAsync(["--markdown"], { from: "user" });
		expect(mockFormatRefarmStatusMarkdown).toHaveBeenCalled();
		expect(spy).toHaveBeenCalledWith("# Refarm Status\n");
		spy.mockRestore();
	});

	it("rejects combining --json and --markdown", async () => {
		await expect(
			statusCommand.parseAsync(["--json", "--markdown"], { from: "user" }),
		).rejects.toThrow(/Choose only one output format/);
	});

	it("reads status payload from --input without building a live snapshot", async () => {
		const readSpy = vi
			.spyOn(fs, "readFileSync")
			.mockImplementation((filePath: fs.PathOrFileDescriptor) => {
				const file = String(filePath);
				if (file.endsWith("status.json")) return '{"schemaVersion":1}';
				throw new Error(`unexpected read: ${file}`);
			});

		await statusCommand.parseAsync(["--json", "--input", "status.json"], {
			from: "user",
		});

		expect(mockBuildRefarmStatusJson).not.toHaveBeenCalled();
		expect(mockParseRefarmStatusJson).toHaveBeenCalledWith(
			'{"schemaVersion":1}',
		);
		readSpy.mockRestore();
	});

	it("wraps parse errors with input path context", async () => {
		const readSpy = vi
			.spyOn(fs, "readFileSync")
			.mockImplementation((filePath: fs.PathOrFileDescriptor) => {
				const file = String(filePath);
				if (file.endsWith("bad.json")) return "{}";
				throw new Error(`unexpected read: ${file}`);
			});
		mockParseRefarmStatusJson.mockImplementation(() => {
			throw new Error("Unsupported Refarm status schemaVersion=2.");
		});

		await expect(
			statusCommand.parseAsync(["--json", "--input", "bad.json"], {
				from: "user",
			}),
		).rejects.toThrow(/Failed to parse status input "bad.json"/);

		readSpy.mockRestore();
	});

	it("reads status payload from stdin when --input - is used", async () => {
		const readSpy = vi
			.spyOn(fs, "readFileSync")
			.mockImplementation((filePath: fs.PathOrFileDescriptor) => {
				if (filePath === 0) return '{"schemaVersion":1}';
				throw new Error(`unexpected read: ${String(filePath)}`);
			});

		await statusCommand.parseAsync(["--json", "--input", "-"], {
			from: "user",
		});

		expect(mockParseRefarmStatusJson).toHaveBeenCalledWith(
			'{"schemaVersion":1}',
		);
		expect(readSpy).toHaveBeenCalledWith(0, "utf-8");
		readSpy.mockRestore();
	});
});
