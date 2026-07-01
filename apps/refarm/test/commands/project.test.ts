import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectCommand } from "../../src/commands/project.js";

function makeTempDir(): string {
	return fs.mkdtempSync(path.join(os.tmpdir(), "refarm-project-"));
}

function readJson(filePath: string): Record<string, unknown> {
	return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
}

describe("project command", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = undefined;
	});

	it("validates project handoff JSON", async () => {
		const cwd = makeTempDir();
		const handoffPath = path.join(cwd, ".project", "handoff.json");
		fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
		fs.writeFileSync(
			handoffPath,
			JSON.stringify({
				context: "validate governed handoff",
				timestamp: "2026-06-27T06:00:00.000Z",
				current_phase: 12,
				next_actions: ["continue daily driver"],
			}),
			"utf-8",
		);
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});

		await createProjectCommand({
			cwd: () => cwd,
			now: () => new Date("2026-06-27T06:30:00.000Z"),
		}).parseAsync(["handoff", "validate", "--json"], { from: "user" });

		expect(JSON.parse(logs.join("\n"))).toMatchObject({
			command: "project",
			operation: "handoff.validate",
			ok: true,
			path: ".project/handoff.json",
			nextCommand: "refarm resume --json",
			summary: {
				context: "validate governed handoff",
				currentPhase: 12,
				nextActions: ["continue daily driver"],
			},
		});
		logSpy.mockRestore();
		fs.rmSync(cwd, { recursive: true, force: true });
	});

	it("writes explicit handoff updates and preserves unknown fields", async () => {
		const cwd = makeTempDir();
		const handoffPath = path.join(cwd, ".project", "handoff.json");
		fs.mkdirSync(path.dirname(handoffPath), { recursive: true });
		fs.writeFileSync(
			handoffPath,
			JSON.stringify({
				context: "before",
				timestamp: "2026-06-01T00:00:00.000Z",
				key_decisions_active: ["DEC-1"],
			}),
			"utf-8",
		);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createProjectCommand({
			cwd: () => cwd,
			now: () => new Date("2026-06-27T06:00:00.000Z"),
		}).parseAsync([
			"handoff",
			"write",
			"--context",
			"after",
			"--phase",
			"12",
			"--current-task",
			"finish project handoff command",
			"--next-action",
			"run resume gate",
			"--json",
		], { from: "user" });

		expect(readJson(handoffPath)).toMatchObject({
			context: "after",
			timestamp: "2026-06-27T06:00:00.000Z",
			current_phase: "12",
			current_tasks: ["finish project handoff command"],
			next_actions: ["run resume gate"],
			key_decisions_active: ["DEC-1"],
		});
		expect(JSON.parse(String(logSpy.mock.calls[0]?.[0]))).toMatchObject({
			command: "project",
			operation: "handoff.write",
			ok: true,
			nextCommands: [
				"refarm resume --json",
				"refarm check --next-action --json",
			],
			summary: {
				context: "after",
				currentTasks: ["finish project handoff command"],
			},
		});
		logSpy.mockRestore();
		fs.rmSync(cwd, { recursive: true, force: true });
	});

	it("rejects writes that would produce an invalid handoff", async () => {
		const cwd = makeTempDir();
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await createProjectCommand({
			cwd: () => cwd,
			now: () => new Date("2026-06-27T06:00:00.000Z"),
		}).parseAsync(["handoff", "write"], { from: "user" });

		expect(process.exitCode).toBe(1);
		expect(fs.existsSync(path.join(cwd, ".project", "handoff.json"))).toBe(false);
		expect(errorSpy).not.toHaveBeenCalled();
		fs.rmSync(cwd, { recursive: true, force: true });
	});

	it("writes governed project automations", async () => {
		const cwd = makeTempDir();
		const automationsPath = path.join(cwd, ".project", "automations.json");
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});

		await createProjectCommand({
			cwd: () => cwd,
			now: () => new Date("2026-06-27T06:00:00.000Z"),
		}).parseAsync([
			"automations",
			"add",
			"--id",
			"daily-handoff",
			"--name",
			"Daily handoff",
			"--status",
			"active",
			"--trigger",
			"once",
			"--at",
			"2026-06-27T09:00:00.000Z",
			"--json",
		], { from: "user" });

		expect(readJson(automationsPath)).toMatchObject({
			automations: [
				{
					id: "daily-handoff",
					name: "Daily handoff",
					status: "active",
					triggers: [{ type: "once", at: "2026-06-27T09:00:00.000Z" }],
				},
			],
		});
		expect(JSON.parse(logs.join("\n"))).toMatchObject({
			command: "project",
			operation: "automations.add",
			ok: true,
			path: ".project/automations.json",
			automation: {
				id: "daily-handoff",
				status: "active",
			},
			validation: {
				ok: true,
				count: 1,
			},
			nextCommands: [
				"refarm project automations validate --json",
				"refarm resume --json",
				"refarm check --next-action --json",
			],
		});
		logSpy.mockRestore();
		fs.rmSync(cwd, { recursive: true, force: true });
	});

	it("validates governed project automations", async () => {
		const cwd = makeTempDir();
		const automationsPath = path.join(cwd, ".project", "automations.json");
		fs.mkdirSync(path.dirname(automationsPath), { recursive: true });
		fs.writeFileSync(
			automationsPath,
			JSON.stringify({
				automations: [
					{
						id: "hourly-cache",
						name: "Hourly cache",
						status: "active",
						triggers: [{ type: "cron", schedule: "@hourly" }],
					},
				],
			}),
			"utf-8",
		);
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});

		await createProjectCommand({
			cwd: () => cwd,
			now: () => new Date("2026-06-27T06:00:00.000Z"),
		}).parseAsync(["automations", "validate", "--json"], { from: "user" });

		expect(JSON.parse(logs.join("\n"))).toMatchObject({
			command: "project",
			operation: "automations.validate",
			ok: true,
			path: ".project/automations.json",
			count: 1,
		});
		logSpy.mockRestore();
		fs.rmSync(cwd, { recursive: true, force: true });
	});

	it("lists governed project automations by status", async () => {
		const cwd = makeTempDir();
		const automationsPath = path.join(cwd, ".project", "automations.json");
		fs.mkdirSync(path.dirname(automationsPath), { recursive: true });
		fs.writeFileSync(
			automationsPath,
			JSON.stringify({
				automations: [
					{
						id: "daily-handoff",
						name: "Daily handoff",
						status: "active",
						triggers: [{ type: "cron", schedule: "@daily" }],
					},
					{
						id: "old-handoff",
						name: "Old handoff",
						status: "archived",
						triggers: [{ type: "manual" }],
					},
				],
			}),
			"utf-8",
		);
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});

		await createProjectCommand({
			cwd: () => cwd,
			now: () => new Date("2026-06-27T06:00:00.000Z"),
		}).parseAsync(["automations", "list", "--status", "active", "--json"], {
			from: "user",
		});

		expect(JSON.parse(logs.join("\n"))).toMatchObject({
			command: "project",
			operation: "automations.list",
			ok: true,
			path: ".project/automations.json",
			status: "active",
			count: 1,
			automations: [
				{
					id: "daily-handoff",
					status: "active",
				},
			],
			validation: {
				ok: true,
				count: 2,
			},
		});
		logSpy.mockRestore();
		fs.rmSync(cwd, { recursive: true, force: true });
	});

	it("updates governed project automation status", async () => {
		const cwd = makeTempDir();
		const automationsPath = path.join(cwd, ".project", "automations.json");
		fs.mkdirSync(path.dirname(automationsPath), { recursive: true });
		fs.writeFileSync(
			automationsPath,
			JSON.stringify({
				automations: [
					{
						id: "daily-handoff",
						name: "Daily handoff",
						status: "active",
						triggers: [{ type: "cron", schedule: "@daily" }],
					},
				],
			}),
			"utf-8",
		);
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});

		await createProjectCommand({
			cwd: () => cwd,
			now: () => new Date("2026-06-27T06:00:00.000Z"),
		}).parseAsync([
			"automations",
			"set-status",
			"--id",
			"daily-handoff",
			"--status",
			"archived",
			"--json",
		], { from: "user" });

		expect(readJson(automationsPath)).toMatchObject({
			automations: [
				{
					id: "daily-handoff",
					status: "archived",
				},
			],
		});
		expect(JSON.parse(logs.join("\n"))).toMatchObject({
			command: "project",
			operation: "automations.set-status",
			ok: true,
			automation: {
				id: "daily-handoff",
				status: "archived",
			},
		});
		logSpy.mockRestore();
		fs.rmSync(cwd, { recursive: true, force: true });
	});

	it("dry-runs governed project automation status updates", async () => {
		const cwd = makeTempDir();
		const automationsPath = path.join(cwd, ".project", "automations.json");
		fs.mkdirSync(path.dirname(automationsPath), { recursive: true });
		fs.writeFileSync(
			automationsPath,
			JSON.stringify({
				automations: [
					{
						id: "daily-handoff",
						name: "Daily handoff",
						status: "active",
						triggers: [{ type: "cron", schedule: "@daily" }],
					},
				],
			}),
			"utf-8",
		);
		const before = readJson(automationsPath);
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

		await createProjectCommand({
			cwd: () => cwd,
			now: () => new Date("2026-06-27T06:00:00.000Z"),
		}).parseAsync([
			"automations",
			"set-status",
			"--id",
			"daily-handoff",
			"--status",
			"archived",
			"--dry-run",
			"--json",
		], { from: "user" });

		expect(readJson(automationsPath)).toEqual(before);
		logSpy.mockRestore();
		fs.rmSync(cwd, { recursive: true, force: true });
	});

	it("rejects duplicate project automation ids", async () => {
		const cwd = makeTempDir();
		const automationsPath = path.join(cwd, ".project", "automations.json");
		fs.mkdirSync(path.dirname(automationsPath), { recursive: true });
		fs.writeFileSync(
			automationsPath,
			JSON.stringify({
				automations: [
					{
						id: "daily-handoff",
						name: "Daily handoff",
						status: "draft",
						triggers: [{ type: "manual" }],
					},
				],
			}),
			"utf-8",
		);
		const logs: string[] = [];
		const logSpy = vi.spyOn(console, "log").mockImplementation((value) => {
			logs.push(String(value));
		});

		await createProjectCommand({
			cwd: () => cwd,
			now: () => new Date("2026-06-27T06:00:00.000Z"),
		}).parseAsync([
			"automations",
			"add",
			"--id",
			"daily-handoff",
			"--name",
			"Duplicate",
			"--json",
		], { from: "user" });

		expect(process.exitCode).toBe(1);
		expect(JSON.parse(logs.join("\n"))).toMatchObject({
			command: "project",
			operation: "automations.add",
			ok: false,
			error: "project_automation_write_failed",
			message: "Automation id already exists: daily-handoff",
		});
		logSpy.mockRestore();
		fs.rmSync(cwd, { recursive: true, force: true });
	});
});
