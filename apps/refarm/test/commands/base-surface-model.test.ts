import { describe, expect, it } from "vitest";

import {
	buildBaseSurfaceModel,
	formatBaseSurfaceModel,
} from "../../src/commands/base-surface-model.js";

describe("base surface model", () => {
	it("marks runtime not-ready as the first blocking base unit", () => {
		const model = buildBaseSurfaceModel({
			runtime: {
				command: "runtime",
				operation: "status",
				ok: false,
				configuredEngine: "auto",
				activeEngine: "rust",
				ready: false,
				sidecarUrl: "http://127.0.0.1:42001",
				sidecarProbe: {
					url: "http://127.0.0.1:42001/efforts/summary",
					ready: false,
					error: "connect ECONNREFUSED 127.0.0.1:42001",
				},
				nextAction: "refarm runtime ensure --wait --next-command",
				nextActions: ["refarm runtime ensure --wait --next-command"],
				nextCommand: "refarm runtime ensure --wait --next-command",
				nextCommands: [
					"refarm runtime ensure --wait --next-command",
					"refarm doctor --next-command",
				],
			},
			model: {
				command: "model",
				operation: "current",
				ok: true,
				current: {
					ref: "openai-codex/gpt-5.3-codex-spark",
					provider: "openai-codex",
					modelId: "gpt-5.3-codex-spark",
				},
				credential: {
					state: "silo-oauth",
					status: "Silo OAuth (openai-codex)",
					envKey: "OPENAI_CODEX_ACCESS_TOKEN",
				},
				routes: {},
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			},
			health: {
				command: "health",
				operation: "audit",
				ok: true,
				issueCount: 0,
				recommendations: [],
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			},
		});

		expect(model.ok).toBe(false);
		expect(model.nextCommand).toBe("refarm runtime ensure --wait --next-command");
		expect(model.units.map((unit) => unit.id)).toEqual([
			"runtime",
			"model",
			"health",
		]);
		expect(model.units[0]).toMatchObject({
			id: "runtime",
			state: "blocked",
			severity: "failure",
			summary: "Runtime sidecar is not ready.",
		});
		expect(model.units[0]?.evidence).toContainEqual({
			kind: "probe",
			label: "sidecar probe",
			value: "connect ECONNREFUSED 127.0.0.1:42001",
		});
		expect(model.units[1]).toMatchObject({
			id: "model",
			state: "ready",
			severity: "info",
			summary: "Model route is configured.",
		});
	});

	it("keeps health policy failures actionable without inventing example-specific wording", () => {
		const model = buildBaseSurfaceModel({
			health: {
				command: "health",
				operation: "audit",
				ok: false,
				issueCount: 1,
				recommendations: [
					{
						diagnostic: "git_ignored",
						issueType: "git_ignored",
						target: "packages/quality-checker-plugin/pkg-plugin/quality_plugin.js",
						summary:
							"packages/quality-checker-plugin/pkg-plugin/quality_plugin.js is ignored by Git.",
						action:
							"Track the source file, or add an explicit health policy exclusion if it is generated.",
						command: "refarm health suggest-policy --json",
					},
				],
				nextAction:
					"Track the source file, or add an explicit health policy exclusion if it is generated.",
				nextActions: [
					"Track the source file, or add an explicit health policy exclusion if it is generated.",
				],
				nextCommand: "refarm health suggest-policy --json",
				nextCommands: ["refarm health suggest-policy --json"],
			},
		});

		expect(model.ok).toBe(false);
		expect(model.nextActions).toEqual([
			"Track the source file, or add an explicit health policy exclusion if it is generated.",
		]);
		expect(model.nextCommands).toEqual(["refarm health suggest-policy --json"]);
		expect(model.units[0]).toMatchObject({
			id: "health",
			state: "blocked",
			severity: "failure",
			summary: "Workspace health has 1 blocking issue.",
		});
	});

	it("keeps runtime state coherent when the runtime reports ready with an issue", () => {
		const model = buildBaseSurfaceModel({
			runtime: {
				command: "runtime",
				operation: "status",
				ok: false,
				configuredEngine: "rust",
				activeEngine: "unknown",
				ready: true,
				issue: "tractor.engine=rust but the Rust tractor binary is not built",
				nextCommand: "refarm config set tractor.engine auto",
				nextAction: "Select a usable runtime engine.",
			},
		});

		expect(model.ok).toBe(false);
		expect(model.units[0]).toMatchObject({
			id: "runtime",
			state: "blocked",
			severity: "failure",
			summary: "Runtime sidecar is not ready.",
		});
		expect(model.nextCommand).toBe("refarm config set tractor.engine auto");
		expect(model.nextAction).toBe("Select a usable runtime engine.");
	});

	it("dedupes plural and singular handoffs in runtime, model, health order", () => {
		const model = buildBaseSurfaceModel({
			runtime: {
				command: "runtime",
				operation: "status",
				ok: false,
				ready: false,
				nextCommand: "refarm runtime status --json",
				nextCommands: ["refarm runtime status --json", "refarm resume --json"],
				nextAction: "Inspect runtime.",
				nextActions: ["Inspect runtime.", "Resume after runtime."],
			},
			model: {
				command: "model",
				operation: "current",
				ok: false,
				current: { ref: "openai-codex/gpt-5.3-codex-spark" },
				credential: { state: "missing" },
				nextCommand: "refarm sow --json",
				nextCommands: ["refarm runtime status --json", "refarm sow --json"],
				nextAction: "Configure credentials.",
				nextActions: ["Inspect runtime.", "Configure credentials."],
			},
			health: {
				command: "health",
				operation: "audit",
				ok: false,
				issueCount: 1,
				recommendations: [],
				nextCommand: "refarm health suggest-policy --json",
				nextCommands: ["refarm sow --json", "refarm health suggest-policy --json"],
				nextAction: "Fix health policy.",
				nextActions: ["Configure credentials.", "Fix health policy."],
			},
		});

		expect(model.nextCommands).toEqual([
			"refarm runtime status --json",
			"refarm resume --json",
			"refarm sow --json",
			"refarm health suggest-policy --json",
		]);
		expect(model.nextActions).toEqual([
			"Inspect runtime.",
			"Resume after runtime.",
			"Configure credentials.",
			"Fix health policy.",
		]);
		expect(model.units[1]).toMatchObject({
			id: "model",
			state: "blocked",
			severity: "failure",
			summary: "Model route is missing credentials.",
		});
	});

	it("formats a compact human summary for manual exploration", () => {
		const model = buildBaseSurfaceModel({
			runtime: {
				command: "runtime",
				operation: "status",
				ok: true,
				configuredEngine: "auto",
				activeEngine: "rust",
				ready: true,
				sidecarUrl: "http://127.0.0.1:42001",
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			},
			health: {
				command: "health",
				operation: "audit",
				ok: true,
				issueCount: 0,
				recommendations: [],
				nextAction: null,
				nextActions: [],
				nextCommand: null,
				nextCommands: [],
			},
		});

		expect(formatBaseSurfaceModel(model)).toContain("Refarm base: ready");
		expect(formatBaseSurfaceModel(model)).toContain("runtime  ready");
		expect(formatBaseSurfaceModel(model)).toContain("health   ready");
	});
});
