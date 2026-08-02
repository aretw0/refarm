import { describe, expect, it } from "vitest";
import {
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
			{ id: "workspace:home:refresh", command: "refarm workspace:home:refresh", why: "" },
		]);
		expect(readOperationCatalog({})).toBeNull();
	});

	it("keeps start and lifecycle bounded to declared states", () => {
		expect(readStartedRun({ started: true, runId: "r-1", operation: "delivery add" })).toEqual({
			runId: "r-1",
			operation: "delivery add",
			state: "running",
			exitCode: null,
		});
		expect(
			readOperationRun({ runId: "r-1", operation: "delivery add", state: "failed", exitCode: 7 }),
		).toMatchObject({ state: "failed", exitCode: 7 });
		expect(readOperationRun({ runId: "r-1", operation: "x", state: "paused" })).toBeNull();
	});

	it("encodes a run id as one path segment", () => {
		expect(operationRunPath("r/a b")).toBe("/operations/r%2Fa%20b");
	});
});
