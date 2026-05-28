import { describe, expect, it } from "vitest";
import {
	buildOperatorResumeEnvelope,
	buildOperatorResumeSummary,
	formatOperatorResumeSessionId,
	formatOperatorResumeSummary,
	operatorResumeNextCommands,
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
			},
			activeSessionId: "urn:refarm:session:v1:abcdef1234567890",
			recentSessions: [
				{
					sessionId: "urn:refarm:session:v1:abcdef1234567890",
					shortId: "ef1234567890",
					name: "planning",
					hasHistory: true,
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
			},
			session: {
				status: "active",
				shortId: "ef1234567890",
				showCommand: "refarm tree show ef1234567890 --json",
				recentSessions: [
					{
						sessionId: "urn:refarm:session:v1:abcdef1234567890",
						shortId: "ef1234567890",
						name: "planning",
						hasHistory: true,
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
		expect(operatorResumeNextCommands(summary)).toEqual([
			"refarm runtime doctor --next-command",
			"refarm model current --json",
			"refarm tree show ef1234567890 --json",
			"refarm runtime start --wait",
			"refarm task status effort-1 --transport http --watch",
			"refarm task logs effort-1 --transport http",
		]);
	});

	it("builds a JSON handoff envelope with task list fallback", () => {
		expect(buildOperatorResumeEnvelope({ status: { ...status, runtime: { ...status.runtime, ready: true }, diagnostics: [] } })).toMatchObject({
			command: "resume",
			operation: "operator",
			ok: true,
			nextCommand: "refarm task list --json",
			nextCommands: ["refarm task list --json"],
			status: "ok",
			session: { status: "none" },
			recentPrompts: [],
			finish: { status: "none" },
		});
	});

	it("formats active session ids for tree commands", () => {
		expect(formatOperatorResumeSessionId("urn:refarm:session:v1:abcdef1234567890")).toBe(
			"ef1234567890",
		);
		expect(formatOperatorResumeSessionId("short")).toBe("short");
	});

	it("formats a concise operator view", () => {
		expect(
			formatOperatorResumeSummary(
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
						nextCommands: ["refarm runtime start --wait"],
						remainingCommands: [],
					},
				}),
			),
		).toContain("Finish: failed");
		expect(
			formatOperatorResumeSummary(
				buildOperatorResumeSummary({
					model: {
						current: { ref: "openai/gpt-5.5" },
						inspectCommand: "refarm model current --json",
					},
				}),
			),
		).toContain("Model: openai/gpt-5.5");
		expect(
			formatOperatorResumeSummary(
				buildOperatorResumeSummary({
					recentSessions: [
						{
							sessionId: "urn:refarm:session:v1:abcdef1234567890",
							name: "shipping",
							hasHistory: true,
							showCommand: "refarm sessions show ef1234567890 --json",
						},
					],
				}),
			),
		).toContain("Recent sessions:");
	});
});
