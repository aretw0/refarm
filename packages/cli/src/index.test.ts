import { describe, expect, it } from "vitest";
import {
	createWorkerProfile,
	createWorkerToolDescriptor,
	createWorkerToolResult,
	validateWorkerToolResult,
	WORKER_TOOL_RESULT_SCHEMA_VERSION,
} from "./index.js";

describe("cli sdk barrel", () => {
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
			name: "agent.planReview",
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
