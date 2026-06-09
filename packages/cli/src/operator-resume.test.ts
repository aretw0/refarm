import { describe, expect, it } from "vitest";
import {
	buildOperatorResumeEnvelope,
	buildOperatorResumeSummary,
	formatOperatorResumeSessionId,
	formatOperatorResumeSummary,
	operatorResumeNextCommands,
	operatorResumeNextProcesses,
} from "./operator-resume.js";
import type { RefarmStatusJson } from "./status.js";

const status: RefarmStatusJson = {
	schemaVersion: 1,
	host: { app: "apps/refarm", command: "refarm", profile: "dev", mode: "headless" },
	renderer: { id: "refarm-headless", kind: "headless", capabilities: [] },
	runtime: {
		ready: false,
		namespace: "refarm-main",
		databaseName: "refarm-main",
		engine: { configuredEngine: "auto", activeEngine: "ts" },
	},
	plugins: { installed: 0, active: 0, rejectedSurfaces: 0, surfaceActions: 0 },
	trust: { profile: "strict", warnings: 0, critical: 0 },
	streams: { active: 0, terminal: 0 },
	diagnostics: ["runtime:not-ready"],
};

describe("operator resume", () => {
	it("summarizes runtime and task checkpoint state", () => {
		const summary = buildOperatorResumeSummary({
			status,
			model: {
				current: {
					scope: "default",
					provider: "openai",
					modelId: "gpt-5.5",
					ref: "openai/gpt-5.5",
				},
				credential: { state: "env", status: "OPENAI_API_KEY env" },
				source: "identity",
				inspectCommand: "refarm model current --json",
				doctorCommand: "refarm model doctor --json",
			},
			activeSessionId: "urn:refarm:session:v1:abcdef1234567890",
			recentSessions: [
				{
					sessionId: "urn:refarm:session:v1:abcdef1234567890",
					shortId: "ef1234567890",
					name: "planning",
					hasHistory: true,
					canonicalParticipants: ["urn:refarm:agent:runtime-agent"],
					participantAliases: [
						{
							participantId: "urn:refarm:agent:pi-agent",
							canonicalParticipantId: "urn:refarm:agent:runtime-agent",
						},
					],
					showCommand: "refarm sessions show ef1234567890 --json",
					useCommand: "refarm sessions use ef1234567890 --json",
				},
			],
			recentPrompts: ["new prompt", "older prompt"],
			finish: {
				updatedAt: "2026-05-27T12:05:00.000Z",
				status: "failed",
				command: "refarm agent finish --run --json",
				profile: "quick",
				lane: null,
				validationScope: "quick",
				failedStepId: "health",
				failedCommand: "refarm health --next-action --json",
				nextCommands: ["refarm runtime start --wait"],
				remainingCommands: ["refarm check --next-action --json"],
			},
			taskCheckpoint: {
				updatedAt: "2026-05-27T12:00:00.000Z",
				activeEffortId: "effort-1",
				efforts: [
					{
						effortId: "effort-1",
						transport: "http",
						lastStatus: "in-progress",
						lastModelRoute: {
							scope: "worker",
							provider: "openai",
							modelId: "gpt-5.3-codex-spark",
						},
						statusCommand: "refarm task status effort-1 --transport http",
						logsCommand: "refarm task logs effort-1 --transport http",
					},
				],
			},
		});

		expect(summary).toMatchObject({
			status: "ok",
			runtime: { ready: false, namespace: "refarm-main" },
			model: {
				current: { ref: "openai/gpt-5.5" },
				inspectCommand: "refarm model current --json",
				doctorCommand: "refarm model doctor --json",
			},
			session: {
				status: "active",
				shortId: "ef1234567890",
				showCommand: "refarm sessions show ef1234567890 --json",
				canonicalParticipants: ["urn:refarm:agent:runtime-agent"],
				participantAliases: [
					{
						participantId: "urn:refarm:agent:pi-agent",
						canonicalParticipantId: "urn:refarm:agent:runtime-agent",
					},
				],
				recentSessions: [
					{
						sessionId: "urn:refarm:session:v1:abcdef1234567890",
						shortId: "ef1234567890",
						name: "planning",
						hasHistory: true,
						canonicalParticipants: ["urn:refarm:agent:runtime-agent"],
						participantAliases: [
							{
								participantId: "urn:refarm:agent:pi-agent",
								canonicalParticipantId: "urn:refarm:agent:runtime-agent",
							},
						],
						showCommand: "refarm sessions show ef1234567890 --json",
						useCommand: "refarm sessions use ef1234567890 --json",
					},
				],
			},
			recentPrompts: ["new prompt", "older prompt"],
			finish: {
				status: "failed",
				failedStepId: "health",
				nextCommands: ["refarm runtime start --wait"],
			},
			tasks: {
				totalEfforts: 1,
				activeEffort: { effortId: "effort-1" },
			},
		});
		// Emergency mode: runtime not ready → only runtime recovery, no noise.
		expect(operatorResumeNextCommands(summary)).toEqual([
			"refarm doctor --next-command",
			"refarm runtime start --wait",
		]);
		const formatted = formatOperatorResumeSummary(summary);
		expect(formatted).toContain(
			"participants: urn:refarm:agent:runtime-agent",
		);
		expect(formatted).not.toContain("urn:refarm:agent:pi-agent ->");
	});

	it("builds a JSON handoff envelope with task list fallback", () => {
		expect(buildOperatorResumeEnvelope({ status: { ...status, runtime: { ...status.runtime, ready: true }, diagnostics: [] } })).toMatchObject({
			command: "resume",
			operation: "operator",
			ok: true,
			nextCommand: "refarm task list --json",
			nextCommands: ["refarm task list --json"],
			nextProcesses: [
				{
					command: "refarm",
					args: ["task", "list", "--json"],
					display: "refarm task list --json",
				},
			],
			status: "ok",
			session: { status: "none" },
			recentPrompts: [],
			finish: { status: "none" },
		});
	});

	it("uses task resume when a checkpoint has resumable work without an active effort", () => {
		const readyStatus = { ...status, runtime: { ...status.runtime, ready: true }, diagnostics: [] };
		const summary = buildOperatorResumeSummary({
			status: readyStatus,
			taskCheckpoint: {
				updatedAt: "2026-05-27T12:00:00.000Z",
				efforts: [
					{
						effortId: "effort-1",
						transport: "file",
						lastStatus: "pending",
						statusCommand: "refarm task status effort-1 --transport file",
						logsCommand: "refarm task logs effort-1 --transport file",
					},
				],
			},
		});
		expect(operatorResumeNextCommands(summary)).toEqual([
			"refarm task resume --json",
		]);
	});

	it("does not suggest task resume when checkpoint efforts are terminal", () => {
		const readyStatus = { ...status, runtime: { ...status.runtime, ready: true }, diagnostics: [] };
		const summary = buildOperatorResumeSummary({
			status: readyStatus,
			taskCheckpoint: {
				updatedAt: "2026-05-27T12:00:00.000Z",
				efforts: [
					{
						effortId: "effort-1",
						transport: "file",
						lastStatus: "failed",
						statusCommand: "refarm task status effort-1 --transport file",
						logsCommand: "refarm task logs effort-1 --transport file",
					},
				],
			},
		});
		expect(operatorResumeNextCommands(summary)).toEqual([]);
	});

	it("falls back to the latest recent session when the active session is stale", () => {
		const readyStatus = { ...status, runtime: { ...status.runtime, ready: true }, diagnostics: [] };
		const summary = buildOperatorResumeSummary({
			status: readyStatus,
			activeSessionId: "urn:refarm:session:v1:stale1234567890",
			recentSessions: [
				{
					sessionId: "urn:refarm:session:v1:abcdef1234567890",
					shortId: "ef1234567890",
					showCommand: "refarm sessions show ef1234567890 --json",
				},
			],
		});

		expect(summary.session.showCommand).toBeUndefined();
		expect(operatorResumeNextCommands(summary)).toEqual([
			"refarm sessions show ef1234567890 --json",
			"refarm task list --json",
		]);
	});

	it("keeps active effort resume handoffs in JSON mode", () => {
		const readyStatus = { ...status, runtime: { ...status.runtime, ready: true }, diagnostics: [] };
		const summary = buildOperatorResumeSummary({
			status: readyStatus,
			taskCheckpoint: {
				updatedAt: "2026-05-27T12:00:00.000Z",
				activeEffortId: "effort-1",
				efforts: [
					{
						effortId: "effort-1",
						transport: "file",
						lastStatus: "in-progress",
						statusCommand: "refarm task status effort-1 --transport file",
						logsCommand: "refarm task logs effort-1 --transport file",
					},
				],
			},
		});

		expect(operatorResumeNextCommands(summary)).toEqual([
			"refarm task status effort-1 --transport file --watch --json",
			"refarm task logs effort-1 --transport file --json",
		]);
		expect(operatorResumeNextProcesses(summary)).toEqual([
			{
				command: "refarm",
				args: [
					"task",
					"status",
					"effort-1",
					"--transport",
					"file",
					"--watch",
					"--json",
				],
				display: "refarm task status effort-1 --transport file --watch --json",
			},
			{
				command: "refarm",
				args: ["task", "logs", "effort-1", "--transport", "file", "--json"],
				display: "refarm task logs effort-1 --transport file --json",
			},
		]);
	});

	it("keeps task command fields JSON-readable in resume envelopes", () => {
		const readyStatus = { ...status, runtime: { ...status.runtime, ready: true }, diagnostics: [] };

		expect(buildOperatorResumeEnvelope({
			status: readyStatus,
			taskCheckpoint: {
				updatedAt: "2026-05-27T12:00:00.000Z",
				activeEffortId: "effort-1",
				efforts: [
					{
						effortId: "effort-1",
						transport: "file",
						lastStatus: "in-progress",
						statusCommand: "refarm task status effort-1 --transport file",
						logsCommand: "refarm task logs effort-1 --transport file",
					},
				],
			},
		})).toMatchObject({
			nextCommand: "refarm task status effort-1 --transport file --watch --json",
			tasks: {
				activeEffort: {
					statusCommand: "refarm task status effort-1 --transport file --json",
					logsCommand: "refarm task logs effort-1 --transport file --json",
				},
				recentEfforts: [
					{
						statusCommand: "refarm task status effort-1 --transport file --json",
						logsCommand: "refarm task logs effort-1 --transport file --json",
					},
				],
			},
		});
	});

	it("prioritizes finish recovery when runtime is ready", () => {
		const readyStatus = { ...status, runtime: { ...status.runtime, ready: true }, diagnostics: [] };
		const summary = buildOperatorResumeSummary({
			status: readyStatus,
			activeSessionId: "urn:refarm:session:v1:abcdef1234567890",
			finish: {
				updatedAt: "2026-05-27T12:05:00.000Z",
				status: "failed",
				command: "refarm agent finish --run --json",
				profile: "quick",
				lane: null,
				validationScope: "quick",
				failedStepId: "health",
				failedCommand: "refarm health --next-action --json",
				nextCommands: ["refarm runtime ensure --wait --next-command"],
				remainingCommands: ["refarm check --next-action --json"],
			},
			taskCheckpoint: {
				updatedAt: "2026-05-27T12:00:00.000Z",
				activeEffortId: undefined,
				efforts: [],
			},
		});
		expect(operatorResumeNextCommands(summary)).toEqual([
			"refarm runtime ensure --wait --next-command",
			"refarm sessions show ef1234567890 --json",
			"refarm task list --json",
		]);
	});

	it("surfaces missing model credentials when runtime is ready", () => {
		const readyStatus = { ...status, runtime: { ...status.runtime, ready: true }, diagnostics: [] };
		const summary = buildOperatorResumeSummary({
			status: readyStatus,
			model: {
				current: { scope: "default", provider: "openai" },
				credential: { state: "missing" },
				inspectCommand: "refarm model current --json",
			},
		});
		expect(operatorResumeNextCommands(summary)).toEqual([
			"refarm model current --json",
			"refarm task list --json",
		]);
	});

	it("omits model inspect when credentials are healthy", () => {
		const readyStatus = { ...status, runtime: { ...status.runtime, ready: true }, diagnostics: [] };
		const summary = buildOperatorResumeSummary({
			status: readyStatus,
			model: {
				current: { scope: "default", provider: "openai", modelId: "gpt-5.5" },
				credential: { state: "env", status: "OPENAI_API_KEY env" },
				inspectCommand: "refarm model current --json",
			},
		});
		expect(operatorResumeNextCommands(summary)).toEqual([
			"refarm task list --json",
		]);
	});

	it("formats active session ids for session handoff commands", () => {
		expect(formatOperatorResumeSessionId("urn:refarm:session:v1:abcdef1234567890")).toBe(
			"ef1234567890",
		);
		expect(formatOperatorResumeSessionId("short")).toBe("short");
	});

	it("formats a concise operator view", () => {
		const formatted = formatOperatorResumeSummary(
			buildOperatorResumeSummary({
				taskCheckpoint: {
					updatedAt: "2026-05-27T12:00:00.000Z",
					efforts: [
						{
							effortId: "effort-1",
							transport: "file",
							lastStatus: "done",
							lastLogAt: "2026-05-27T12:01:00.000Z",
							lastModelRoute: { scope: "worker", ref: "openai/gpt-5.3-codex-spark" },
							statusCommand: "refarm task status effort-1 --transport file",
							logsCommand: "refarm task logs effort-1 --transport file",
						},
					],
				},
				model: {
					current: { ref: "openai/gpt-5.5" },
					credential: { status: "OPENAI_API_KEY env" },
					source: "identity",
					inspectCommand: "refarm model current --json",
					doctorCommand: "refarm model doctor --json",
				},
				activeSessionId: "urn:refarm:session:v1:abcdef1234567890",
				recentSessions: [
					{
						sessionId: "urn:refarm:session:v1:abcdef1234567890",
						shortId: "ef1234567890",
						name: "shipping",
						hasHistory: true,
						showCommand: "refarm sessions show ef1234567890 --json",
						useCommand: "refarm sessions use ef1234567890 --json",
					},
				],
				recentPrompts: ["ship it"],
				finish: {
					updatedAt: "2026-05-27T12:05:00.000Z",
					status: "failed",
					command: "refarm agent finish --run --json",
					failedStepId: "health",
					failedCommand: "refarm health --next-action --json",
					nextCommands: ["refarm runtime start --wait"],
					remainingCommands: ["refarm check --next-action --json"],
				},
			}),
		);
		expect(formatted).toContain("Finish: failed");
		expect(formatted).toContain("failedStep: health");
		expect(formatted).toContain("failedCommand: refarm health --next-action --json");
		expect(formatted).toContain("next: refarm runtime start --wait");
		expect(formatted).toContain("remaining: 1 command");
		expect(formatted).toContain("Model: openai/gpt-5.5");
		expect(formatted).toContain("doctor:  refarm model doctor --json");
		expect(formatted).toContain("Recent sessions:");
	});
});
