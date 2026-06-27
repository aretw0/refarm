import { describe, expect, it } from "vitest";
import {
	addProjectAutomationRecord,
	buildProjectAutomationRecord,
	updateProjectAutomationStatus,
	validateProjectAutomationsDocument,
} from "./project-automations.js";

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
});
