import { describe, expect, it } from "vitest";
import {
	assessInteractionDriverReadiness,
	buildCapabilityIndex,
	CAPABILITY_INDEX_SCHEMA_VERSION,
	createInteractionDriverDescriptor,
	createWorkerProfile,
	createWorkerToolDescriptor,
	createWorkerToolResult,
	getCapabilityDescriptors,
	INTERACTION_DRIVER_TERMINAL_EVENTS,
	validateWorkerToolResult,
	WORKER_TOOL_RESULT_SCHEMA_VERSION,
} from "./index.js";

describe("cli sdk barrel", () => {
	it("exports interaction driver readiness helpers for downstream SDK consumers", () => {
		const descriptor = createInteractionDriverDescriptor({
			id: "runtime-agent.ask",
			title: "Runtime agent ask loop",
			description: "Submit a prompt, stream output, and preserve handoffs.",
		});

		expect(assessInteractionDriverReadiness(descriptor)).toMatchObject({
			ok: true,
			state: "ready",
			supportedMode: "local-loop",
		});
		expect(INTERACTION_DRIVER_TERMINAL_EVENTS).toEqual([
			"completed",
			"failed",
		]);
	});

	it("exports agnostic capability discovery helpers for downstream SDK consumers", () => {
		const index = buildCapabilityIndex();

		expect(index.schemaVersion).toBe(CAPABILITY_INDEX_SCHEMA_VERSION);
		expect(index.capabilities).toEqual(getCapabilityDescriptors());
		expect(
			index.capabilities.some(
				(capability) => capability.id === "runtime-agent.ask",
			),
		).toBe(true);
	});

	it("exports worker tool result helpers for downstream SDK consumers", () => {
		const profile = createWorkerProfile({
			id: "worker.plan-review",
			title: "Plan Review Worker",
			description: "Review a plan and return a compact risk summary.",
			objective: "Find plan risks before implementation starts.",
			allowedTools: ["read", "search"],
			output: {
				format: "json",
				requiredFields: ["summary"],
			},
		});
		const descriptor = createWorkerToolDescriptor(profile, {
			name: "worker.planReview",
		});

		const result = createWorkerToolResult(descriptor, {
			summary: "Plan is bounded.",
			output: { summary: "Plan is bounded." },
		});

		expect(result.schemaVersion).toBe(WORKER_TOOL_RESULT_SCHEMA_VERSION);
		expect(validateWorkerToolResult(descriptor, result)).toEqual({
			ok: true,
			issues: [],
		});
	});
});
