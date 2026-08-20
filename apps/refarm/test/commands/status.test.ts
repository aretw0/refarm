import type { StatusOptions } from "@refarm.dev/cli/status";
import {
	HOMESTEAD_HOST_RENDERER_KINDS,
	requiredHomesteadHostRendererCapabilities,
} from "@refarm.dev/homestead/sdk/host-renderer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	mockAssertStatusJson,
	mockBuildStatusJson,
	mockFormatStatusJson,
	mockFormatStatusMarkdown,
	mockParseStatusJson,
	mockProbeRuntimeLiveness,
	mockWaitForRuntimeReady,
} = vi.hoisted(() => ({
	mockAssertStatusJson: vi.fn(),
	mockBuildStatusJson: vi.fn(),
	mockFormatStatusJson: vi.fn(),
	mockFormatStatusMarkdown: vi.fn(),
	mockParseStatusJson: vi.fn(),
	mockProbeRuntimeLiveness: vi.fn(),
	mockWaitForRuntimeReady: vi.fn(),
}));

vi.mock("@refarm.dev/cli/status", () => ({
	assertStatusJson: mockAssertStatusJson,
	buildStatusJson: mockBuildStatusJson,
	formatStatusJson: mockFormatStatusJson,
	formatStatusMarkdown: mockFormatStatusMarkdown,
	parseStatusJson: mockParseStatusJson,
}));

vi.mock("../../src/commands/runtime-readiness.js", () => ({
	probeRuntimeLiveness: mockProbeRuntimeLiveness,
	waitForRuntimeReady: mockWaitForRuntimeReady,
}));

import {
	STATUS_INSPECT_TRUST_ACTION_ID,
	STATUS_OPEN_REPORT_ACTION_ID,
} from "../../src/commands/status-surfaces.js";
import { createStatusCommand, statusCommand } from "../../src/commands/status.js";

describe("statusCommand", () => {
	let cwd: string;
	let home: string;
	let cargoTargetDir: string;
	let originalCargoTargetDir: string | undefined;
	let originalPath: string | undefined;
	let emptyPathDir: string;

	beforeEach(() => {
		cwd = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-status-cwd-"));
		home = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-status-home-"));
		cargoTargetDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-status-cargo-"));
		emptyPathDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-status-path-"));
		originalCargoTargetDir = process.env.CARGO_TARGET_DIR;
		process.env.CARGO_TARGET_DIR = cargoTargetDir;
		// PATH, for the same reason CARGO_TARGET_DIR is pinned above: the engine now also accepts a
		// `tractor` installed on PATH, so a suite inheriting the developer's PATH asserts about
		// whatever that machine happens to have. Measured 2026-08-19 — installing the binary on a
		// real node turned 12 of these green tests red without a line of their own changing.
		originalPath = process.env.PATH;
		process.env.PATH = emptyPathDir;
		vi.spyOn(process, "cwd").mockReturnValue(cwd);
		vi.spyOn(os, "homedir").mockReturnValue(home);
		vi.clearAllMocks();
		mockProbeRuntimeLiveness.mockResolvedValue({
			url: "http://127.0.0.1:42001/efforts/summary",
			ready: true,
			status: 200,
		});
		mockBuildStatusJson.mockImplementation((input: StatusOptions) => ({
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
		mockFormatStatusJson.mockImplementation(() =>
			JSON.stringify({ schemaVersion: 1 }, null, 2),
		);
		mockFormatStatusMarkdown.mockImplementation(
			() => "# Status\n",
		);
		mockParseStatusJson.mockReturnValue({
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
		if (originalPath === undefined) delete process.env.PATH;
		else process.env.PATH = originalPath;
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
		expect(help).toContain("Use refarm doctor --next-action");
		expect(help).toContain("Use refarm doctor --next-command");
		expect(help).toContain("Use refarm doctor for the full readiness report");
	});

	it("documents the zero-extension base status surface", () => {
		const command = createStatusCommand();
		let help = "";
		command.configureOutput({
			writeOut: (value) => {
				help += value;
			},
		});

		command.outputHelp();

		expect(help).toContain("refarm status --base");
		expect(help).toContain("refarm status --base --json");
		expect(help).toContain("refarm status --base --attention-scope connection-up:ovpn-serpro");
		expect(help).toContain("refarm status --base --attention-profile cross-device-handoff");
	});

	it("prints the base model as JSON", async () => {
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const resolveBaseSurfaceStatus = vi.fn().mockResolvedValue({
			schemaVersion: 1,
			command: "status",
			operation: "base",
			ok: false,
			units: [
				{
					id: "runtime",
					label: "Runtime",
					owner: "apps/refarm",
					state: "blocked",
					severity: "failure",
					summary: "Runtime sidecar is not ready.",
					evidence: [],
					actions: [
						{
							label: "refarm runtime ensure --wait --next-command",
							command: "refarm runtime ensure --wait --next-command",
							primary: true,
						},
					],
				},
			],
			nextAction: "refarm runtime ensure --wait --next-command",
			nextActions: ["refarm runtime ensure --wait --next-command"],
			nextCommand: "refarm runtime ensure --wait --next-command",
			nextCommands: ["refarm runtime ensure --wait --next-command"],
		});
		const command = createStatusCommand({
			resolveBaseSurfaceStatus,
		});

		await command.parseAsync(["--base", "--json"], { from: "user" });

		expect(resolveBaseSurfaceStatus).toHaveBeenCalledWith({
			operatorAttentionScope: undefined,
			operatorAttentionWindowMs: undefined,
			operatorAttentionProfile: undefined,
		});

		expect(JSON.parse(logSpy.mock.calls[0]![0] as string)).toMatchObject({
			command: "status",
			operation: "base",
			ok: false,
			nextCommand: "refarm runtime ensure --wait --next-command",
		});
		expect(process.exitCode).toBe(1);
		logSpy.mockRestore();
		process.exitCode = undefined;
	});

	it("encaminha options explícitas de atenção para status --base", async () => {
		const resolveBaseSurfaceStatus = vi.fn().mockResolvedValue({
			schemaVersion: 1,
			command: "status",
			operation: "base",
			ok: true,
			units: [],
			nextAction: null,
			nextActions: [],
			nextCommand: null,
			nextCommands: [],
		});
		const command = createStatusCommand({ resolveBaseSurfaceStatus });
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			[
				"--base",
				"--json",
				"--attention-scope",
				"connection-up:phone",
				"--attention-window-ms",
				"90000",
			],
			{ from: "user" },
		);

		expect(resolveBaseSurfaceStatus).toHaveBeenCalledWith({
			operatorAttentionScope: "connection-up:phone",
			operatorAttentionWindowMs: 90000,
			operatorAttentionProfile: undefined,
		});
		spy.mockRestore();
	});

	it("encaminha attention-profile para status --base", async () => {
		const resolveBaseSurfaceStatus = vi.fn().mockResolvedValue({
			schemaVersion: 1,
			command: "status",
			operation: "base",
			ok: true,
			units: [],
			nextAction: null,
			nextActions: [],
			nextCommand: null,
			nextCommands: [],
		});
		const command = createStatusCommand({ resolveBaseSurfaceStatus });
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		await command.parseAsync(
			[
				"--base",
				"--json",
				"--attention-profile",
				"cross-device-handoff",
			],
			{ from: "user" },
		);

		expect(resolveBaseSurfaceStatus).toHaveBeenCalledWith({
			operatorAttentionScope: undefined,
			operatorAttentionWindowMs: undefined,
			operatorAttentionProfile: "cross-device-handoff",
		});
		spy.mockRestore();
	});

	it("rejeita options de atenção sem --base", async () => {
		await expect(
			statusCommand.parseAsync(["--attention-scope", "connection-up:phone"], {
				from: "user",
			}),
		).rejects.toThrow(
			/--attention-scope\/--attention-window-ms\/--attention-profile require --base/,
		);

		await expect(
			statusCommand.parseAsync(["--attention-profile", "cross-device-handoff"], {
				from: "user",
			}),
		).rejects.toThrow(
			/--attention-scope\/--attention-window-ms\/--attention-profile require --base/,
		);
	});

	it("builds status from a local runtime snapshot without booting tractor-ts", async () => {
		await statusCommand.parseAsync(["--json"], { from: "user" });
		expect(mockBuildStatusJson).toHaveBeenCalledWith(
			expect.objectContaining({
				runtime: {
					ready: true,
					namespace: "default",
					databaseName: "default",
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

		expect(mockBuildStatusJson).toHaveBeenCalledWith(
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
		mockProbeRuntimeLiveness.mockResolvedValue({
			url: "http://127.0.0.1:42001/efforts/summary",
			ready: false,
			error: "timeout",
			timedOut: true,
		});

		await statusCommand.parseAsync(["--json"], { from: "user" });

		expect(mockProbeRuntimeLiveness).toHaveBeenCalledWith();
		expect(mockBuildStatusJson).toHaveBeenCalledWith(
			expect.objectContaining({
				runtime: expect.objectContaining({
					ready: false,
					error: "timeout",
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
		expect(mockAssertStatusJson).toHaveBeenCalled();
		expect(mockFormatStatusJson).toHaveBeenCalledWith(
			expect.objectContaining({ schemaVersion: 1 }),
		);
		spy.mockRestore();
	});

	it("forwards each requested renderer descriptor to status builder", async () => {
		for (const kind of HOMESTEAD_HOST_RENDERER_KINDS) {
			mockBuildStatusJson.mockClear();

			await statusCommand.parseAsync(["--json", "--renderer", kind], {
				from: "user",
			});

			expect(mockBuildStatusJson).toHaveBeenCalledWith(
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

		expect(mockBuildStatusJson).toHaveBeenCalledWith(
			expect.objectContaining({
				plugins: {
					surfaces: expect.objectContaining({
						context: expect.objectContaining({ hostId: "apps/refarm" }),
						availableActions: [
							expect.objectContaining({
								id: STATUS_OPEN_REPORT_ACTION_ID,
								intent: "status:open-report",
							}),
							expect.objectContaining({
								id: STATUS_INSPECT_TRUST_ACTION_ID,
								intent: "trust:inspect",
							}),
						],
					}),
				},
			}),
		);
	});

	it("invokes a live status action by ID", async () => {
		mockBuildStatusJson.mockImplementation((input: StatusOptions) => ({
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
						id: STATUS_OPEN_REPORT_ACTION_ID,
						label: "Open status report",
						intent: "status:open-report",
					},
					{
						id: STATUS_INSPECT_TRUST_ACTION_ID,
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
			["--action", STATUS_INSPECT_TRUST_ACTION_ID],
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
				requested: STATUS_INSPECT_TRUST_ACTION_ID,
				source: "id",
				resolvedId: STATUS_INSPECT_TRUST_ACTION_ID,
				index: 2,
			},
			actionRequest: {
				pluginId: "apps/refarm",
				action: {
					id: STATUS_INSPECT_TRUST_ACTION_ID,
					intent: "trust:inspect",
				},
			},
		});
		spy.mockRestore();
	});

	it("invokes a live status action by row index", async () => {
		mockBuildStatusJson.mockImplementation((input: StatusOptions) => ({
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
						id: STATUS_OPEN_REPORT_ACTION_ID,
						label: "Open status report",
						intent: "status:open-report",
					},
					{
						id: STATUS_INSPECT_TRUST_ACTION_ID,
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
			resolvedId: STATUS_INSPECT_TRUST_ACTION_ID,
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
		expect(mockParseStatusJson).not.toHaveBeenCalled();
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
		expect(mockFormatStatusMarkdown).toHaveBeenCalled();
		expect(spy).toHaveBeenCalledWith("# Status\n");
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

		expect(mockBuildStatusJson).not.toHaveBeenCalled();
		expect(mockParseStatusJson).toHaveBeenCalledWith(
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
		mockParseStatusJson.mockImplementation(() => {
			throw new Error("Unsupported status schemaVersion=2.");
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

		expect(mockParseStatusJson).toHaveBeenCalledWith(
			'{"schemaVersion":1}',
		);
		expect(readSpy).toHaveBeenCalledWith(0, "utf-8");
		readSpy.mockRestore();
	});
});
