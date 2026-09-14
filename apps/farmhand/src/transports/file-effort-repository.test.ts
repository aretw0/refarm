import type { Effort, EffortResult } from "@refarm.dev/effort-contract-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileEffortRepository } from "./file-effort-repository.js";

describe("FileEffortRepository", () => {
	let baseDir: string;
	let repository: FileEffortRepository;

	beforeEach(() => {
		baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-effort-repository-"));
		repository = new FileEffortRepository(baseDir);
	});

	afterEach(() => {
		fs.rmSync(baseDir, { recursive: true, force: true });
	});

	it("round-trips effort definitions and results", () => {
		const effort: Effort = {
			id: "effort-1",
			direction: "verify persistence",
			tasks: [],
			submittedAt: "2026-08-06T10:00:00.000Z",
		};
		const result: EffortResult = {
			effortId: effort.id,
			status: "pending",
			results: [],
			submittedAt: effort.submittedAt,
			lastUpdatedAt: effort.submittedAt,
		};

		repository.writeEffort(effort);
		repository.writeResult(result);

		expect(repository.hasEffort(effort.id)).toBe(true);
		expect(repository.readEffort(effort.id)).toEqual(effort);
		expect(repository.readResult(effort.id)).toEqual(result);
	});

	it("lists the latest lifecycle timestamp first", () => {
		const older: EffortResult = {
			effortId: "older",
			status: "done",
			results: [],
			completedAt: "2026-08-06T10:00:00.000Z",
			lastUpdatedAt: "2026-08-06T10:00:00.000Z",
		};
		const newer: EffortResult = {
			effortId: "newer",
			status: "done",
			results: [],
			completedAt: "2026-08-06T11:00:00.000Z",
			lastUpdatedAt: "2026-08-06T11:00:00.000Z",
		};

		repository.writeResult(older);
		repository.writeResult(newer);

		expect(repository.listResults().map((result) => result.effortId)).toEqual([
			"newer",
			"older",
		]);
	});

	it("keeps readable log entries when one NDJSON line is malformed", () => {
		repository.appendLog("effort-1", {
			effortId: "effort-1",
			timestamp: "2026-08-06T10:00:00.000Z",
			level: "info",
			event: "submitted",
			message: "submitted",
		});
		fs.appendFileSync(path.join(repository.logsDir, "effort-1.ndjson"), "not-json\n", "utf-8");
		repository.appendLog("effort-1", {
			effortId: "effort-1",
			timestamp: "2026-08-06T10:01:00.000Z",
			level: "info",
			event: "processing_started",
			message: "started",
		});

		expect(repository.readLogs("effort-1")?.map((entry) => entry.event)).toEqual([
			"submitted",
			"processing_started",
		]);
	});
});
