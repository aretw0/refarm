import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Effort, EffortResult } from "@refarm.dev/effort-contract-v1";
import { afterEach, describe, expect, it } from "vitest";
import { FileTaskSessionRecorder } from "../../src/commands/task-session.js";

const tempDirs: string[] = [];

function createTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-task-session-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0, tempDirs.length)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("FileTaskSessionRecorder", () => {
	it("records dispatched efforts with resume links", () => {
		const baseDir = createTempDir();
		const recorder = new FileTaskSessionRecorder(baseDir);
		const effort: Effort = {
			id: "effort-1",
			direction: "Test",
			tasks: [{ id: "t1", pluginId: "p", fn: "f" }],
			source: "refarm-cli",
			submittedAt: new Date().toISOString(),
		};

		recorder.rememberRun({ effort, transport: "http" });
		const checkpoint = recorder.getCheckpoint();

		expect(checkpoint).not.toBeNull();
		expect(checkpoint!.activeEffortId).toBe("effort-1");
		expect(checkpoint!.efforts[0].statusCommand).toContain(
			"refarm task status effort-1 --transport http",
		);
		expect(checkpoint!.efforts[0].logsCommand).toContain(
			"refarm task logs effort-1 --transport http",
		);
	});

	it("clears active effort when terminal status is observed", () => {
		const baseDir = createTempDir();
		const recorder = new FileTaskSessionRecorder(baseDir);
		const effort: Effort = {
			id: "effort-2",
			direction: "Test",
			tasks: [{ id: "t1", pluginId: "p", fn: "f" }],
			source: "refarm-cli",
			submittedAt: new Date().toISOString(),
		};
		recorder.rememberRun({ effort, transport: "file" });

		const result: EffortResult = {
			effortId: "effort-2",
			status: "done",
			results: [],
			submittedAt: effort.submittedAt,
			completedAt: new Date().toISOString(),
		};
		recorder.rememberStatus({
			effortId: "effort-2",
			transport: "file",
			result,
		});

		const checkpoint = recorder.getCheckpoint();
		expect(checkpoint?.activeEffortId).toBeUndefined();
		expect(checkpoint?.efforts[0].lastStatus).toBe("done");
	});

	it("marks first non-terminal effort as active when listing", () => {
		const baseDir = createTempDir();
		const recorder = new FileTaskSessionRecorder(baseDir);
		recorder.rememberList({
			transport: "file",
			efforts: [
				{ effortId: "done-1", status: "done", results: [] },
				{ effortId: "pending-1", status: "pending", results: [] },
			],
		});

		const checkpoint = recorder.getCheckpoint();
		expect(checkpoint?.activeEffortId).toBe("pending-1");
	});
});
