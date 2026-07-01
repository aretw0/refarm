import { describe, expect, it } from "vitest";
import {
	createLocalScheduledWork,
	inspectLocalScheduledWork,
	listLocalScheduledJobs,
} from "./local-scheduler.js";

const BODY = {
	type: "static",
	effort: { direction: "scheduled local work", tasks: [] },
};

function createAutomationAdapter() {
	const store = new Map();
	return {
		async create(input) {
			const now = "2026-06-27T00:00:00.000Z";
			const automation = {
				id: crypto.randomUUID(),
				status: "draft",
				createdAt: now,
				updatedAt: now,
				...input,
			};
			store.set(automation.id, automation);
			return automation;
		},
		async validate(id) {
			const automation = store.get(id);
			const updated = { ...automation, status: "ready" };
			store.set(id, updated);
			return updated;
		},
		async activate(id) {
			const automation = store.get(id);
			const updated = { ...automation, status: "active" };
			store.set(id, updated);
			return updated;
		},
		async query(filter = {}) {
			const automations = [...store.values()];
			if (!filter.status) return automations;
			return automations.filter((automation) => automation.status === filter.status);
		},
	};
}

async function createActiveAutomation(adapter, input) {
	const automation = await adapter.create({
		name: input.name,
		body: BODY,
		triggers: input.triggers,
	});
	await adapter.validate(automation.id);
	return adapter.activate(automation.id);
}

describe("local scheduled work", () => {
	it("lists active one-shot jobs with durable owner and due status", async () => {
		const adapter = createAutomationAdapter();
		await createActiveAutomation(adapter, {
			name: "daily handoff",
			triggers: [{ type: "once", at: "2026-06-27T08:00:00.000Z" }],
		});

		const jobs = await listLocalScheduledJobs(adapter, {
			owner: "refarm-main",
			now: "2026-06-27T09:00:00.000Z",
		});

		expect(jobs).toEqual([
			expect.objectContaining({
				name: "daily handoff",
				owner: "refarm-main",
				kind: "one-shot",
				status: "due",
				modelRoute: "none",
				tokenUse: "none",
				resume: expect.objectContaining({ visible: true }),
			}),
		]);
	});

	it("surfaces recurring cron jobs without executing them", async () => {
		const adapter = createAutomationAdapter();
		await createActiveAutomation(adapter, {
			name: "hourly cache refresh",
			triggers: [{ type: "cron", schedule: "@hourly" }],
		});

		const scheduler = createLocalScheduledWork(adapter, {
			owner: "refarm-main",
			now: "2026-06-27T10:00:00.000Z",
		});

		await expect(scheduler.due()).resolves.toEqual([
			expect.objectContaining({
				name: "hourly cache refresh",
				kind: "recurring",
				status: "due",
				schedule: { type: "cron", schedule: "@hourly", timezone: "UTC" },
			}),
		]);
	});

	it("ignores inactive automations and unsupported trigger types", async () => {
		const adapter = createAutomationAdapter();
		await adapter.create({
			name: "draft once",
			body: BODY,
			triggers: [{ type: "once", at: "2026-06-27T08:00:00.000Z" }],
		});
		await createActiveAutomation(adapter, {
			name: "event only",
			triggers: [{ type: "event", eventType: "effort.completed" }],
		});

		await expect(
			inspectLocalScheduledWork(adapter, {
				owner: "refarm-main",
				now: "2026-06-27T09:00:00.000Z",
			}),
		).resolves.toMatchObject({
			summary: { total: 0, due: 0, scheduled: 0, unsupported: 0 },
			jobs: [],
		});
	});

	it("requires an explicit owner", async () => {
		const adapter = createAutomationAdapter();

		await expect(listLocalScheduledJobs(adapter)).rejects.toThrow(
			"non-empty owner",
		);
	});

	it("requires a valid clock override", async () => {
		const adapter = createAutomationAdapter();

		await expect(
			listLocalScheduledJobs(adapter, {
				owner: "refarm-main",
				now: "not-a-date",
			}),
		).rejects.toThrow("valid date");
	});
});
