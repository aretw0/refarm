import { describe, expect, it } from "vitest";
import {
	createLocalScheduledWork,
	executeDueLocalScheduledWork,
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
		async trigger(id, input) {
			const automation = store.get(id);
			if (!automation || automation.status !== "active") return null;
			if (automation.body.type === "static") {
				return {
					id: `${automation.id}:effort`,
					submittedAt: input?.firedAt ?? "2026-06-27T00:00:00.000Z",
					...automation.body.effort,
				};
			}
			return null;
		},
	};
}

function createFiredLedger() {
	const fired = new Map();
	return {
		async hasFired(key) {
			return fired.has(key);
		},
		async recordFired(key, receipt) {
			fired.set(key, receipt);
		},
		size() {
			return fired.size;
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

		await expect(listLocalScheduledJobs(adapter)).rejects.toThrow("non-empty owner");
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

	it("triggers and submits due scheduled work without owning daemon timing", async () => {
		const automationAdapter = createAutomationAdapter();
		const submitted = [];
		const effortAdapter = {
			async submit(effort) {
				submitted.push(effort);
				return effort.id;
			},
		};
		await createActiveAutomation(automationAdapter, {
			name: "one-shot proof",
			triggers: [{ type: "once", at: "2026-06-27T08:00:00.000Z" }],
		});
		await createActiveAutomation(automationAdapter, {
			name: "future proof",
			triggers: [{ type: "once", at: "2026-06-28T08:00:00.000Z" }],
		});

		await expect(
			executeDueLocalScheduledWork(automationAdapter, effortAdapter, {
				owner: "refarm-main",
				now: "2026-06-27T09:00:00.000Z",
			}),
		).resolves.toMatchObject({
			owner: "refarm-main",
			summary: { due: 1, submitted: 1, skipped: 0, failed: 0 },
			results: [
				{
					status: "submitted",
					job: expect.objectContaining({ name: "one-shot proof" }),
				},
			],
		});
		expect(submitted).toHaveLength(1);
		expect(submitted[0]).toEqual(expect.objectContaining({ direction: "scheduled local work" }));
	});

	it("reports skipped and failed due work without aborting the tick", async () => {
		const automationAdapter = createAutomationAdapter();
		const failing = await createActiveAutomation(automationAdapter, {
			name: "failing proof",
			triggers: [{ type: "once", at: "2026-06-27T08:00:00.000Z" }],
		});
		const skipped = await createActiveAutomation(automationAdapter, {
			name: "skipped proof",
			triggers: [{ type: "once", at: "2026-06-27T08:00:00.000Z" }],
		});
		const originalTrigger = automationAdapter.trigger;
		automationAdapter.trigger = async (id, input) => {
			if (id === skipped.id) return null;
			return originalTrigger(id, input);
		};
		const effortAdapter = {
			async submit(effort) {
				if (effort.id === `${failing.id}:effort`) {
					throw new Error("transport unavailable");
				}
				return effort.id;
			},
		};

		await expect(
			executeDueLocalScheduledWork(automationAdapter, effortAdapter, {
				owner: "refarm-main",
				now: "2026-06-27T09:00:00.000Z",
			}),
		).resolves.toMatchObject({
			summary: { due: 2, submitted: 0, skipped: 1, failed: 1 },
			results: expect.arrayContaining([
				expect.objectContaining({
					status: "failed",
					error: "transport unavailable",
				}),
				expect.objectContaining({
					status: "skipped",
					error: "automation returned no effort",
				}),
			]),
		});
	});

	it("requires trigger and submit support before executing due work", async () => {
		const adapter = createAutomationAdapter();

		await expect(
			executeDueLocalScheduledWork(
				{ query: adapter.query },
				{ submit: async () => "effort-1" },
				{ owner: "refarm-main" },
			),
		).rejects.toThrow("trigger() support");

		await expect(
			executeDueLocalScheduledWork(adapter, {}, { owner: "refarm-main" }),
		).rejects.toThrow("submit() support");
	});

	it("fires a due one-shot only once across repeated ticks when given a ledger", async () => {
		const automationAdapter = createAutomationAdapter();
		const submitted = [];
		const effortAdapter = {
			async submit(effort) {
				submitted.push(effort);
				return `${submitted.length}:${effort.id}`;
			},
		};
		const ledger = createFiredLedger();
		await createActiveAutomation(automationAdapter, {
			name: "one-shot proof",
			triggers: [{ type: "once", at: "2026-06-27T08:00:00.000Z" }],
		});

		const first = await executeDueLocalScheduledWork(automationAdapter, effortAdapter, {
			owner: "refarm-main",
			now: "2026-06-27T09:00:00.000Z",
			ledger,
		});
		expect(first.summary).toMatchObject({ due: 1, submitted: 1, alreadyFired: 0 });
		expect(first.results[0]).toMatchObject({
			status: "submitted",
			firedAt: "2026-06-27T09:00:00.000Z",
		});

		// A later tick still sees the one-shot as due (at <= now), but the ledger
		// suppresses the re-fire.
		const second = await executeDueLocalScheduledWork(automationAdapter, effortAdapter, {
			owner: "refarm-main",
			now: "2026-06-27T09:05:00.000Z",
			ledger,
		});
		expect(second.summary).toMatchObject({ due: 1, submitted: 0, alreadyFired: 1 });
		expect(second.results[0]).toMatchObject({ status: "already-fired" });
		expect(submitted).toHaveLength(1);
	});

	it("re-fires every due tick when no ledger is supplied (legacy behavior)", async () => {
		const automationAdapter = createAutomationAdapter();
		const submitted = [];
		const effortAdapter = {
			async submit(effort) {
				submitted.push(effort);
				return effort.id;
			},
		};
		await createActiveAutomation(automationAdapter, {
			name: "one-shot proof",
			triggers: [{ type: "once", at: "2026-06-27T08:00:00.000Z" }],
		});

		await executeDueLocalScheduledWork(automationAdapter, effortAdapter, {
			owner: "refarm-main",
			now: "2026-06-27T09:00:00.000Z",
		});
		await executeDueLocalScheduledWork(automationAdapter, effortAdapter, {
			owner: "refarm-main",
			now: "2026-06-27T09:05:00.000Z",
		});
		expect(submitted).toHaveLength(2);
	});

	it("fires a recurring cron job once per window but again in a new window", async () => {
		const automationAdapter = createAutomationAdapter();
		const submitted = [];
		const effortAdapter = {
			async submit(effort) {
				submitted.push(effort);
				return `${submitted.length}:${effort.id}`;
			},
		};
		const ledger = createFiredLedger();
		await createActiveAutomation(automationAdapter, {
			name: "every-five",
			triggers: [{ type: "cron", schedule: "*/5 * * * *" }],
		});

		// Two ticks inside the same due minute-window: one fire.
		await executeDueLocalScheduledWork(automationAdapter, effortAdapter, {
			owner: "refarm-main",
			now: "2026-06-27T09:05:00.000Z",
			ledger,
		});
		const sameWindow = await executeDueLocalScheduledWork(automationAdapter, effortAdapter, {
			owner: "refarm-main",
			now: "2026-06-27T09:05:30.000Z",
			ledger,
		});
		expect(sameWindow.summary).toMatchObject({ submitted: 0, alreadyFired: 1 });
		expect(submitted).toHaveLength(1);

		// A later due window is a fresh fire key: fires again.
		const nextWindow = await executeDueLocalScheduledWork(automationAdapter, effortAdapter, {
			owner: "refarm-main",
			now: "2026-06-27T09:10:00.000Z",
			ledger,
		});
		expect(nextWindow.summary).toMatchObject({ submitted: 1, alreadyFired: 0 });
		expect(submitted).toHaveLength(2);
	});

	it("does not collapse distinct automations that share the same due window", async () => {
		const automationAdapter = createAutomationAdapter();
		const submitted = [];
		const effortAdapter = {
			async submit(effort) {
				submitted.push(effort);
				return `${submitted.length}:${effort.id}`;
			},
		};
		const ledger = createFiredLedger();
		await createActiveAutomation(automationAdapter, {
			name: "first every-five",
			triggers: [{ type: "cron", schedule: "*/5 * * * *" }],
		});
		await createActiveAutomation(automationAdapter, {
			name: "second every-five",
			triggers: [{ type: "cron", schedule: "*/5 * * * *" }],
		});

		const firstTick = await executeDueLocalScheduledWork(automationAdapter, effortAdapter, {
			owner: "refarm-main",
			now: "2026-06-27T09:05:00.000Z",
			ledger,
		});
		expect(firstTick.summary).toMatchObject({ due: 2, submitted: 2, alreadyFired: 0 });
		expect(submitted).toHaveLength(2);

		const secondTick = await executeDueLocalScheduledWork(automationAdapter, effortAdapter, {
			owner: "refarm-main",
			now: "2026-06-27T09:05:30.000Z",
			ledger,
		});
		expect(secondTick.summary).toMatchObject({ due: 2, submitted: 0, alreadyFired: 2 });
		expect(new Set(secondTick.results.map((result) => result.job.fireKey)).size).toBe(2);
		expect(submitted).toHaveLength(2);
	});

	it("does not record a failed submit, so it retries on the next tick", async () => {
		const automationAdapter = createAutomationAdapter();
		let attempts = 0;
		const effortAdapter = {
			async submit(effort) {
				attempts += 1;
				if (attempts === 1) throw new Error("transport unavailable");
				return effort.id;
			},
		};
		const ledger = createFiredLedger();
		await createActiveAutomation(automationAdapter, {
			name: "flaky one-shot",
			triggers: [{ type: "once", at: "2026-06-27T08:00:00.000Z" }],
		});

		const first = await executeDueLocalScheduledWork(automationAdapter, effortAdapter, {
			owner: "refarm-main",
			now: "2026-06-27T09:00:00.000Z",
			ledger,
		});
		expect(first.summary).toMatchObject({ failed: 1, submitted: 0 });
		expect(ledger.size()).toBe(0);

		const second = await executeDueLocalScheduledWork(automationAdapter, effortAdapter, {
			owner: "refarm-main",
			now: "2026-06-27T09:05:00.000Z",
			ledger,
		});
		expect(second.summary).toMatchObject({ submitted: 1, alreadyFired: 0 });
		expect(attempts).toBe(2);
	});

	it("reports submitted with a ledger-write error without re-classifying as failed", async () => {
		const automationAdapter = createAutomationAdapter();
		const submitted = [];
		const effortAdapter = {
			async submit(effort) {
				submitted.push(effort);
				return effort.id;
			},
		};
		const ledger = {
			async hasFired() {
				return false;
			},
			async recordFired() {
				throw new Error("disk full");
			},
		};
		await createActiveAutomation(automationAdapter, {
			name: "one-shot proof",
			triggers: [{ type: "once", at: "2026-06-27T08:00:00.000Z" }],
		});

		const report = await executeDueLocalScheduledWork(automationAdapter, effortAdapter, {
			owner: "refarm-main",
			now: "2026-06-27T09:00:00.000Z",
			ledger,
		});
		expect(report.summary).toMatchObject({ submitted: 1, failed: 0 });
		expect(report.results[0]).toMatchObject({
			status: "submitted",
			error: expect.stringContaining("ledger write failed"),
		});
		expect(submitted).toHaveLength(1);
	});

	it("rejects a malformed ledger before executing due work", async () => {
		const adapter = createAutomationAdapter();

		await expect(
			executeDueLocalScheduledWork(
				adapter,
				{ submit: async () => "effort-1" },
				{ owner: "refarm-main", ledger: { hasFired: () => false } },
			),
		).rejects.toThrow("hasFired() and recordFired()");
	});
});
