import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	addProjectAutomationRecord,
	buildProjectAutomationRecord,
	findProjectAutomationsPath,
	loadProjectScheduledWork,
	updateProjectAutomationStatus,
	validateProjectAutomationsDocument,
} from "./project-automations.js";

const tempRoots: string[] = [];

afterEach(() => {
	for (const root of tempRoots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

describe("project automations", () => {
	it("builds governed automation records with draft status by default", () => {
		expect(
			buildProjectAutomationRecord({
				id: "daily-handoff",
				name: "Daily handoff",
				trigger: { type: "cron", schedule: "@daily" },
			}),
		).toEqual({
			id: "daily-handoff",
			name: "Daily handoff",
			status: "draft",
			triggers: [{ type: "cron", schedule: "@daily" }],
		});
	});

	it("appends to object documents and rejects duplicate ids", () => {
		const document = addProjectAutomationRecord({
			automations: [
				{
					id: "existing",
					name: "Existing",
					status: "active",
					triggers: [{ type: "manual" }],
				},
			],
			source: "project",
		}, {
			id: "daily-handoff",
			name: "Daily handoff",
			status: "active",
			trigger: { type: "once", at: "2026-06-27T09:00:00.000Z" },
		});

		expect(document).toMatchObject({
			source: "project",
			automations: [
				{ id: "existing" },
				{
					id: "daily-handoff",
					status: "active",
					triggers: [{ type: "once", at: "2026-06-27T09:00:00.000Z" }],
				},
			],
		});
		expect(() =>
			addProjectAutomationRecord(document, {
				id: "daily-handoff",
				name: "Duplicate",
				trigger: { type: "manual" },
			}),
		).toThrow("Automation id already exists");
	});

	it("validates supported project automation triggers", () => {
		const result = validateProjectAutomationsDocument({
			automations: [
				{
					id: "bad",
					name: "",
					status: "paused",
					triggers: [
						{ type: "once", at: "not-a-date" },
						{ type: "cron", schedule: "" },
						{ type: "event" },
						{ type: "unknown" },
					],
				},
			],
		});

		expect(result.ok).toBe(false);
		expect(result.issues.map((issue) => issue.code)).toEqual([
			"invalid_project_automation_name",
			"invalid_project_automation_status",
			"invalid_project_automation_once_trigger",
			"invalid_project_automation_cron_trigger",
			"invalid_project_automation_event_trigger",
			"invalid_project_automation_trigger_type",
		]);
	});

	it("updates automation status and preserves unknown fields", () => {
		const document = updateProjectAutomationStatus({
			automations: [
				{
					id: "daily-handoff",
					name: "Daily handoff",
					status: "active",
					triggers: [{ type: "cron", schedule: "@daily" }],
					owner: "refarm-main",
				},
			],
			source: "project",
		}, {
			id: "daily-handoff",
			status: "archived",
		});

		expect(document).toMatchObject({
			source: "project",
			automations: [
				{
					id: "daily-handoff",
					status: "archived",
					owner: "refarm-main",
				},
			],
		});
		expect(() =>
			updateProjectAutomationStatus(document, {
				id: "missing",
				status: "active",
			}),
		).toThrow("Automation id not found: missing");
	});

	it("loads scheduled work from a project automation manifest above cwd", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-project-"));
		tempRoots.push(root);
		const nested = path.join(root, "apps", "me");
		fs.mkdirSync(path.join(root, ".project"), { recursive: true });
		fs.mkdirSync(nested, { recursive: true });
		const automationsPath = path.join(root, ".project", "automations.json");
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
						id: "manual-only",
						name: "Manual only",
						status: "active",
						triggers: [{ type: "manual" }],
					},
					{
						id: "draft",
						name: "Draft",
						status: "draft",
						triggers: [{ type: "once", at: "2026-06-27T09:00:00.000Z" }],
					},
				],
			}),
		);

		expect(findProjectAutomationsPath(nested)).toBe(automationsPath);
		await expect(
			loadProjectScheduledWork({
				cwd: nested,
				now: "2026-06-27T10:00:00.000Z",
				owner: "apps/me",
			}),
		).resolves.toMatchObject({
			owner: "apps/me",
			summary: {
				total: 1,
				due: 0,
				scheduled: 1,
				unsupported: 0,
			},
			jobs: [
				{
					id: "daily-handoff:0",
					automationId: "daily-handoff",
					status: "scheduled",
					modelRoute: "none",
					tokenUse: "none",
				},
			],
		});
	});
});
