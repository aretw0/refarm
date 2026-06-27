import { describe, expect, it } from "vitest";
import {
	createRefarmWorkerProfile,
	REFARM_WORKER_PROFILE_MAX_PARALLEL,
	validateRefarmWorkerProfile,
} from "./worker-profile.js";

describe("worker profile contract", () => {
	it("creates a bounded runtime-agent worker profile with safe defaults", () => {
		const profile = createRefarmWorkerProfile({
			id: "worker.plan-review",
			title: "Plan Review Worker",
			description: "Review a plan and return a compact risk summary.",
			objective: "Find plan risks before implementation starts.",
			allowedTools: ["read", "search"],
			inputs: ["plan.md"],
		});

		expect(profile).toMatchObject({
			schemaVersion: 1,
			id: "worker.plan-review",
			context: {
				objective: "Find plan risks before implementation starts.",
				instructions: [],
				inputs: ["plan.md"],
			},
			tools: { allowed: ["read", "search"] },
			model: { scope: "worker" },
			concurrency: { maxParallel: 1 },
			output: { format: "summary", requiredFields: ["summary"] },
			lifecycle: { resume: "manual", cancellable: true },
		});
		expect(validateRefarmWorkerProfile(profile)).toEqual({
			ok: true,
			issues: [],
		});
	});

	it("keeps model route, output contract, and lifecycle explicit when provided", () => {
		const profile = createRefarmWorkerProfile({
			id: "worker.audit",
			title: "Audit Worker",
			description: "Return structured audit findings.",
			objective: "Audit a focused code slice.",
			allowedTools: ["read", "search", "test"],
			deniedTools: ["shell"],
			model: { scope: "monitor", ref: "openai/gpt-5.5" },
			maxParallel: 2,
			output: {
				format: "json",
				requiredFields: ["findings", "residualRisk"],
			},
			lifecycle: { resume: "continue", cancellable: true },
		});

		expect(profile.tools.denied).toEqual(["shell"]);
		expect(profile.model).toEqual({
			scope: "monitor",
			ref: "openai/gpt-5.5",
		});
		expect(profile.output.requiredFields).toEqual([
			"findings",
			"residualRisk",
		]);
		expect(validateRefarmWorkerProfile(profile).ok).toBe(true);
	});

	it("rejects unbounded or underspecified worker profiles", () => {
		const profile = createRefarmWorkerProfile({
			id: "",
			title: " ",
			description: "Worker with invalid bounds.",
			objective: "",
			allowedTools: [],
			maxParallel: REFARM_WORKER_PROFILE_MAX_PARALLEL + 1,
			output: { requiredFields: [] },
		});

		expect(validateRefarmWorkerProfile(profile)).toEqual({
			ok: false,
			issues: [
				"id is required",
				"title is required",
				"context.objective is required",
				"tools.allowed must list at least one tool",
				`concurrency.maxParallel must be between 1 and ${REFARM_WORKER_PROFILE_MAX_PARALLEL}`,
				"output.requiredFields must list at least one field",
			],
		});
	});
});
