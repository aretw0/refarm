import { describe, expect, it } from "vitest";
import {
	operationCancelPath,
	operationRunPath,
	readOperationCatalog,
	readOperationRun,
	readStartedRun,
} from "./wire.js";

describe("operation web wire", () => {
	it("reads the node-owned catalog without inventing missing ids", () => {
		expect(
			readOperationCatalog({
				catalog: {
					operations: [
						{ id: "delivery add", command: "refarm delivery add", why: "guided" },
						{ command: "ignored" },
						{ id: "workspace:home:refresh" },
					],
				},
			}),
		).toEqual([
			{ id: "delivery add", command: "refarm delivery add", why: "guided" },
			// The ID ALONE, not an invented `<brand> <id>` — which is what this test's own name asks
			// for. The node sends `command` when it has one (the row above); when it does not, this
			// module does not know how the node spells its verbs and must not guess (ADR-087,
			// ISS-114).
			{ id: "workspace:home:refresh", command: "workspace:home:refresh", why: "" },
		]);
		expect(readOperationCatalog({})).toBeNull();
	});

	it("keeps start and lifecycle bounded to declared states", () => {
		expect(readStartedRun({ started: true, runId: "r-1", operation: "delivery add" })).toEqual({
			runId: "r-1",
			operation: "delivery add",
			state: "running",
			exitCode: null,
			result: null,
			resultError: null,
		});
		expect(
			readOperationRun({ runId: "r-1", operation: "delivery add", state: "failed", exitCode: 7 }),
		).toMatchObject({ state: "failed", exitCode: 7 });
		expect(readOperationRun({ runId: "r-1", operation: "x", state: "paused" })).toBeNull();
		const result = {
			wire: "operation-result.v1",
			status: "issues",
			summary: "One issue.",
			metrics: [{ name: "issueCount", value: 1 }],
			findings: [{ code: "missing", summary: "Rule missing." }],
			truncated: false,
			redactionCount: 0,
		};
		expect(readOperationRun({ runId: "r-2", operation: "check", state: "failed", result }))
			.toMatchObject({ result });
		expect(readOperationRun({ runId: "r-2", operation: "check", state: "failed", result: { ...result, stdout: "secret" } }))
			.toMatchObject({ result: null });
	});

	it("encodes a run id as one path segment", () => {
		expect(operationRunPath("r/a b")).toBe("/operations/r%2Fa%20b");
		expect(operationCancelPath("r/a b")).toBe("/operations/r%2Fa%20b/cancel");
	});
});
