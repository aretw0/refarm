import { describe, expect, it } from "vitest";
import {
	buildOperatorResumeEnvelope,
	buildOperatorResumeSummary,
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
			tasks: {
				totalEfforts: 1,
				activeEffort: { effortId: "effort-1" },
			},
		});
		expect(operatorResumeNextCommands(summary)).toEqual([
			"refarm runtime doctor --next-command",
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
		});
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
				}),
			),
		).toContain("model:  worker openai/gpt-5.3-codex-spark");
	});
});
