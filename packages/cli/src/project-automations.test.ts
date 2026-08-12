import { executeDueLocalScheduledWork } from "@refarm.dev/windmill/local-scheduler";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	addProjectAutomationRecord,
	buildProjectAutomationRecord,
	createProjectAutomationAdapter,
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
		const document = addProjectAutomationRecord(
			{
				automations: [
					{
						id: "existing",
						name: "Existing",
						status: "active",
						triggers: [{ type: "manual" }],
					},
				],
				source: "project",
			},
			{
				id: "daily-handoff",
				name: "Daily handoff",
				status: "active",
				trigger: { type: "once", at: "2026-06-27T09:00:00.000Z" },
			},
		);

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
		const document = updateProjectAutomationStatus(
			{
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
			},
			{
				id: "daily-handoff",
				status: "archived",
			},
		);

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
				declared: 1,
				unsupported: 0,
			},
			jobs: [
				{
					id: "daily-handoff:0",
					automationId: "daily-handoff",
					status: "declared",
					modelRoute: "none",
					tokenUse: "none",
				},
			],
		});
	});

	it("creates a project automation adapter that triggers default local efforts", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-project-"));
		tempRoots.push(root);
		fs.mkdirSync(path.join(root, ".project"), { recursive: true });
		fs.writeFileSync(
			path.join(root, ".project", "automations.json"),
			JSON.stringify({
				automations: [
					{
						id: "daily-handoff",
						name: "Daily handoff",
						status: "active",
						triggers: [{ type: "once", at: "2026-06-27T09:00:00.000Z" }],
					},
				],
			}),
		);

		const adapter = createProjectAutomationAdapter({
			cwd: root,
			now: () => new Date("2026-06-27T10:00:00.000Z"),
		});

		await expect(adapter.query({ status: "active" })).resolves.toMatchObject([
			{ id: "daily-handoff", name: "Daily handoff" },
		]);
		await expect(
			adapter.trigger("daily-handoff", {
				firedAt: "2026-06-27T09:30:00.000Z",
				owner: "refarm-main",
			}),
		).resolves.toMatchObject({
			direction: "project automation: Daily handoff",
			source: "project-automations",
			submittedAt: "2026-06-27T09:30:00.000Z",
			tasks: [],
			tags: ["project-automation", "daily-handoff"],
			context: {
				projectAutomation: {
					id: "daily-handoff",
					path: ".project/automations.json",
				},
				trigger: {
					owner: "refarm-main",
				},
			},
		});
	});

	it("supports static and template bodies from project automations", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-project-"));
		tempRoots.push(root);
		fs.mkdirSync(path.join(root, ".project"), { recursive: true });
		fs.writeFileSync(
			path.join(root, ".project", "automations.json"),
			JSON.stringify({
				automations: [
					{
						id: "static-proof",
						name: "Static proof",
						status: "active",
						triggers: [{ type: "manual" }],
						body: {
							type: "static",
							effort: {
								direction: "static direction",
								tasks: [{ id: "notify", pluginId: "@refarm/pi-agent", fn: "notify" }],
								context: { channel: "local" },
							},
						},
					},
					{
						id: "template-proof",
						name: "Template proof",
						status: "active",
						triggers: [{ type: "manual" }],
						body: {
							type: "template",
							effort: {
								direction: "hello {{owner}}",
								tasks: [],
							},
						},
					},
				],
			}),
		);
		const adapter = createProjectAutomationAdapter({ cwd: root });

		await expect(adapter.trigger("static-proof")).resolves.toMatchObject({
			direction: "static direction",
			tasks: [{ id: "notify", pluginId: "@refarm/pi-agent", fn: "notify" }],
			context: {
				templateContext: { channel: "local" },
			},
		});
		await expect(
			adapter.trigger("template-proof", { owner: "refarm-main" }),
		).resolves.toMatchObject({
			direction: "hello refarm-main",
		});
	});

	it("executes due project automations through the windmill scheduler helper", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-project-"));
		tempRoots.push(root);
		fs.mkdirSync(path.join(root, ".project"), { recursive: true });
		fs.writeFileSync(
			path.join(root, ".project", "automations.json"),
			JSON.stringify({
				automations: [
					{
						id: "one-shot-proof",
						name: "One shot proof",
						status: "active",
						triggers: [{ type: "once", at: "2026-06-27T09:00:00.000Z" }],
						body: {
							type: "template",
							effort: {
								direction: "remind {{owner}}",
								tasks: [],
							},
						},
					},
				],
			}),
		);
		const submitted: unknown[] = [];
		const effortAdapter = {
			async submit(effort: unknown) {
				submitted.push(effort);
				return "effort-1";
			},
		};

		await expect(
			executeDueLocalScheduledWork(createProjectAutomationAdapter({ cwd: root }), effortAdapter, {
				owner: "refarm-main",
				now: "2026-06-27T10:00:00.000Z",
			}),
		).resolves.toMatchObject({
			summary: { due: 1, submitted: 1 },
			results: [{ status: "submitted", effortId: "effort-1" }],
		});
		expect(submitted).toEqual([
			expect.objectContaining({
				direction: "remind refarm-main",
				submittedAt: "2026-06-27T10:00:00.000Z",
			}),
		]);
	});

	it("fails explicitly for plugin bodies until a host plugin adapter is wired", async () => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-project-"));
		tempRoots.push(root);
		fs.mkdirSync(path.join(root, ".project"), { recursive: true });
		fs.writeFileSync(
			path.join(root, ".project", "automations.json"),
			JSON.stringify({
				automations: [
					{
						id: "plugin-proof",
						name: "Plugin proof",
						status: "active",
						triggers: [{ type: "manual" }],
						body: {
							type: "plugin",
							pluginId: "@refarm/plugin",
							fn: "buildEffort",
						},
					},
				],
			}),
		);

		await expect(
			createProjectAutomationAdapter({ cwd: root }).trigger("plugin-proof"),
		).rejects.toThrow("host plugin adapter");
	});
});

describe("a cron timezone nobody can resolve is refused at write time", () => {
	/** The automation vocabulary has carried `CronTrigger.timezone` since it was written, and until
	 *  2026-08-11 every evaluator matched against UTC while every reporter echoed the declared zone
	 *  back. The executor now says `unsupported` for a zone it cannot resolve — this refuses it one
	 *  step earlier, so an operator finds out when they type it rather than at the hour the job was
	 *  supposed to run and did not. */
	function validateWithTimezone(timezone: unknown) {
		return validateProjectAutomationsDocument({
			schemaVersion: 1,
			automations: [
				{
					id: "a1",
					name: "nightly",
					status: "active",
					body: { type: "static", effort: { direction: "d", tasks: [] } },
					triggers: [{ type: "cron", schedule: "0 0 * * *", timezone }],
				},
			],
		});
	}

	it("accepts a real IANA zone", () => {
		expect(validateWithTimezone("America/Sao_Paulo").ok).toBe(true);
	});

	it("accepts an absent timezone — absent means UTC, which is a decision, not a gap", () => {
		const result = validateProjectAutomationsDocument({
			schemaVersion: 1,
			automations: [
				{
					id: "a1",
					name: "nightly",
					status: "active",
					body: { type: "static", effort: { direction: "d", tasks: [] } },
					triggers: [{ type: "cron", schedule: "0 0 * * *" }],
				},
			],
		});
		expect(result.ok).toBe(true);
	});

	it("refuses a zone this runtime cannot resolve, naming the value", () => {
		const result = validateWithTimezone("Mars/Olympus");
		expect(result.ok).toBe(false);
		expect(result.issues.map((issue) => issue.code)).toContain(
			"invalid_project_automation_cron_timezone",
		);
		expect(result.issues[0]?.message).toContain("Mars/Olympus");
	});

	it("refuses a non-string timezone rather than coercing it", () => {
		expect(validateWithTimezone(42).ok).toBe(false);
		expect(validateWithTimezone("").ok).toBe(false);
	});
});
