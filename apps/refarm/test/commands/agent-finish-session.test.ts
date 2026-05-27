import type { CommandPlanRunResult } from "@refarm.dev/cli/command-plan";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildAgentFinishRecord,
	FileAgentFinishSessionRecorder,
} from "../../src/commands/agent-finish-session.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-finish-session-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("agent finish session", () => {
	it("builds a resume finish record from a failed finish run", () => {
		const result: CommandPlanRunResult = {
			ok: false,
			status: "failed",
			steps: [],
			remainingSteps: [],
			remainingCommands: ["refarm check --next-action --json"],
			failedStepId: "health",
			failedCommand: "refarm health --next-action --json",
			nextActions: ["Start the runtime"],
			nextCommands: ["refarm runtime start --wait"],
			recommendations: [],
		};

		expect(
			buildAgentFinishRecord({
				result,
				selection: {
					profile: "quick",
					lane: null,
					validationScope: "quick",
				},
				command: "refarm agent finish --run --json",
				now: () => "2026-05-27T12:05:00.000Z",
			}),
		).toEqual({
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
		});
	});

	it("persists and reloads the latest finish run", () => {
		const baseDir = makeTempDir();
		const recorder = new FileAgentFinishSessionRecorder(baseDir);

		recorder.rememberRun({
			updatedAt: "2026-05-27T12:05:00.000Z",
			status: "passed",
			command: "refarm agent finish --lane after-commit --run --json",
			profile: "quick",
			lane: "after-commit",
			validationScope: "quick",
			failedStepId: null,
			failedCommand: null,
			nextCommands: [],
			remainingCommands: [],
		});

		expect(new FileAgentFinishSessionRecorder(baseDir).getLatest()).toEqual({
			updatedAt: "2026-05-27T12:05:00.000Z",
			status: "passed",
			command: "refarm agent finish --lane after-commit --run --json",
			profile: "quick",
			lane: "after-commit",
			validationScope: "quick",
			failedStepId: null,
			failedCommand: null,
			nextCommands: [],
			remainingCommands: [],
		});
	});
});
