import { describe, expect, it } from "vitest";
import {
	assessWorkerToolReadiness,
	createWorkerProfile,
	createWorkerToolDescriptor,
	createWorkerToolResult,
	validateWorkerProfile,
	validateWorkerToolDescriptor,
	validateWorkerToolResult,
	WORKER_PROFILE_MAX_PARALLEL,
	WORKER_TOOL_MAX_TURNS,
} from "./worker-profile.js";

describe("worker profile contract", () => {
	it("creates a bounded runtime-agent worker profile with safe defaults", () => {
		const profile = createWorkerProfile({
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
		expect(validateWorkerProfile(profile)).toEqual({
			ok: true,
			issues: [],
		});
	});

	it("keeps model route, output contract, and lifecycle explicit when provided", () => {
		const profile = createWorkerProfile({
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
		expect(validateWorkerProfile(profile).ok).toBe(true);
	});

	it("rejects unbounded or underspecified worker profiles", () => {
		const profile = createWorkerProfile({
			id: "",
			title: " ",
			description: "Worker with invalid bounds.",
			objective: "",
			allowedTools: [],
			maxParallel: WORKER_PROFILE_MAX_PARALLEL + 1,
			output: { requiredFields: [] },
		});

		expect(validateWorkerProfile(profile)).toEqual({
			ok: false,
			issues: [
				"id is required",
				"title is required",
				"context.objective is required",
				"tools.allowed must list at least one tool",
				`concurrency.maxParallel must be between 1 and ${WORKER_PROFILE_MAX_PARALLEL}`,
				"output.requiredFields must list at least one field",
			],
		});
	});

	it("wraps a worker profile as a plan-only agent tool descriptor", () => {
		const profile = createWorkerProfile({
			id: "worker.plan-review",
			title: "Plan Review Worker",
			description: "Review a plan and return a compact risk summary.",
			objective: "Find plan risks before implementation starts.",
			allowedTools: ["read", "search"],
			maxParallel: 2,
			output: {
				format: "json",
				requiredFields: ["summary", "risks"],
			},
		});
		const descriptor = createWorkerToolDescriptor(profile, {
			name: "agent.planReview",
			maxTurns: 2,
			inputFields: ["task", "scope"],
		});

		expect(descriptor).toMatchObject({
			schemaVersion: 1,
			name: "agent.planReview",
			profile,
			budget: { maxTurns: 2, maxParallel: 2 },
			invocation: {
				mode: "plan-only",
				model: { scope: "worker" },
				tokenUse: "provider",
			},
			inputFields: ["task", "scope"],
			outputFields: ["summary", "risks"],
		});
		expect(validateWorkerToolDescriptor(descriptor)).toEqual({
			ok: true,
			issues: [],
		});
		expect(assessWorkerToolReadiness(descriptor)).toEqual({
			ok: true,
			state: "ready",
			requestedMode: "plan-only",
			supportedMode: "plan-only",
			issues: [],
			blockers: [],
		});
	});

	it("rejects runtime-dispatch worker tools until dispatch is implemented", () => {
		const profile = createWorkerProfile({
			id: "worker.audit",
			title: "Audit Worker",
			description: "Return structured audit findings.",
			objective: "Audit a focused code slice.",
			allowedTools: ["read"],
		});
		const descriptor = createWorkerToolDescriptor(profile, {
			mode: "runtime-dispatch",
			maxTurns: WORKER_TOOL_MAX_TURNS + 1,
			maxParallel: profile.concurrency.maxParallel + 1,
			inputFields: [],
		});

		expect(validateWorkerToolDescriptor(descriptor)).toEqual({
			ok: false,
			issues: [
				"invocation.mode must be plan-only until runtime dispatch is implemented",
				`budget.maxTurns must be between 1 and ${WORKER_TOOL_MAX_TURNS}`,
				"budget.maxParallel must be between 1 and profile.concurrency.maxParallel",
				"inputFields must list at least one field",
			],
		});

		expect(assessWorkerToolReadiness(descriptor)).toEqual({
			ok: false,
			state: "blocked",
			requestedMode: "runtime-dispatch",
			supportedMode: "plan-only",
			issues: [
				"invocation.mode must be plan-only until runtime dispatch is implemented",
				`budget.maxTurns must be between 1 and ${WORKER_TOOL_MAX_TURNS}`,
				"budget.maxParallel must be between 1 and profile.concurrency.maxParallel",
				"inputFields must list at least one field",
			],
			blockers: [
				{
					code: "descriptor.validation-failed",
					requirement: "policy",
					description:
						"Worker tool descriptor must pass validation before it can be offered to another runtime.",
					proofTarget:
						"descriptor contract: valid worker profile, input fields, output fields, budget, and plan-only mode",
				},
				{
					code: "runtime-dispatch.policy-proof-missing",
					requirement: "policy",
					description:
						"Worker dispatch needs an executable policy proof for tool access, filesystem scope, and model route.",
					proofTarget:
						"policy bundle: tool allowlist, filesystem root guard, trusted plugin guard, and model route validation",
				},
				{
					code: "runtime-dispatch.cancellation-proof-missing",
					requirement: "cancellation",
					description:
						"Worker dispatch needs a cancellation and resume proof before work can fan out.",
					proofTarget:
						"worker lifecycle: cancellable task state, resume policy, and fanout stop propagation",
				},
				{
					code: "runtime-dispatch.observability-proof-missing",
					requirement: "observability",
					description:
						"Worker dispatch needs stream, session, and task handoffs for operator inspection.",
					proofTarget:
						"operator visibility: stream chunks, session entries, task status, and resume handoffs",
				},
				{
					code: "runtime-dispatch.cost-control-proof-missing",
					requirement: "cost-control",
					description:
						"Worker dispatch needs budget accounting for provider token use and bounded turns.",
					proofTarget:
						"budget ledger: provider token accounting, max turns, max parallel workers, and stop condition",
				},
			],
		});
	});

	it("validates worker tool results against the descriptor output contract", () => {
		const profile = createWorkerProfile({
			id: "worker.plan-review",
			title: "Plan Review Worker",
			description: "Review a plan and return a compact risk summary.",
			objective: "Find plan risks before implementation starts.",
			allowedTools: ["read", "search"],
			output: {
				format: "json",
				requiredFields: ["summary", "risks"],
			},
		});
		const descriptor = createWorkerToolDescriptor(profile, {
			name: "agent.planReview",
		});

		const result = createWorkerToolResult(descriptor, {
			summary: "Plan is small; main risk is missing rollback evidence.",
			output: {
				summary: "Plan is small.",
				risks: ["Missing rollback evidence."],
			},
			handoffs: [
				"refarm capabilities --tag reference-driver --supply reference-driver --json",
			],
		});

		expect(result).toMatchObject({
			schemaVersion: 1,
			descriptorName: "agent.planReview",
			profileId: "worker.plan-review",
			status: "completed",
			handoffs: [
				"refarm capabilities --tag reference-driver --supply reference-driver --json",
			],
			issues: [],
		});
		expect(validateWorkerToolResult(descriptor, result)).toEqual({
			ok: true,
			issues: [],
		});
	});

	it("rejects incomplete worker results and unexplained non-completed statuses", () => {
		const profile = createWorkerProfile({
			id: "worker.audit",
			title: "Audit Worker",
			description: "Return structured audit findings.",
			objective: "Audit a focused code slice.",
			allowedTools: ["read"],
			output: {
				format: "json",
				requiredFields: ["summary", "findings"],
			},
		});
		const descriptor = createWorkerToolDescriptor(profile, {
			name: "agent.audit",
		});

		expect(
			validateWorkerToolResult(
				descriptor,
				createWorkerToolResult(descriptor, {
					summary: "Findings omitted.",
					output: { summary: "Incomplete." },
				}),
			),
		).toEqual({
			ok: false,
			issues: ["output.findings is required for completed results"],
		});

		expect(
			validateWorkerToolResult(
				descriptor,
				createWorkerToolResult(descriptor, {
					status: "blocked",
					summary: "Cannot run.",
				}),
			),
		).toEqual({
			ok: false,
			issues: ["issues must explain non-completed results"],
		});
	});
});
