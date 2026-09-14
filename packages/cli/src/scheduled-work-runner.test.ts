import { readLocalSchedulerLedger } from "@refarm.dev/windmill/local-scheduler-ledger";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDueScheduledWork } from "./scheduled-work-runner.js";

const tempRoots: string[] = [];

function createProjectRoot(automations: unknown[]): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-runner-"));
	tempRoots.push(root);
	fs.mkdirSync(path.join(root, ".project"), { recursive: true });
	fs.writeFileSync(
		path.join(root, ".project", "automations.json"),
		JSON.stringify({ automations }),
	);
	return root;
}

function createCollectingEffortAdapter() {
	const submitted: Array<{ id?: string; direction?: string }> = [];
	return {
		submitted,
		async submit(effort: { id?: string; direction?: string }) {
			submitted.push(effort);
			return `effort-${submitted.length}`;
		},
	};
}

afterEach(() => {
	for (const root of tempRoots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

describe("runDueScheduledWork", () => {
	it("requires an effort adapter", async () => {
		await expect(
			// @ts-expect-error deliberately omitting effortAdapter
			runDueScheduledWork({ cwd: process.cwd() }),
		).rejects.toThrow("requires an effortAdapter");
	});

	it("fires a due one-shot once and persists it to the .refarm ledger", async () => {
		const root = createProjectRoot([
			{
				id: "daily-handoff",
				name: "Daily handoff",
				status: "active",
				triggers: [{ type: "once", at: "2026-06-27T08:00:00.000Z" }],
			},
		]);
		const effortAdapter = createCollectingEffortAdapter();

		const report = await runDueScheduledWork({
			cwd: root,
			// ISS-075: the fire-once ledger is the NODE's, so a test that wants it inside its own
			// temp tree says which node it is rather than inferring one from the working directory.
			base: root,
			now: "2026-06-27T09:00:00.000Z",
			effortAdapter,
		});

		expect(report.summary).toMatchObject({ due: 1, submitted: 1, alreadyFired: 0 });
		expect(effortAdapter.submitted).toHaveLength(1);
		expect(effortAdapter.submitted[0]).toMatchObject({
			direction: "project automation: Daily handoff",
		});

		// The default ledger landed under .refarm/ in the project root.
		const ledger = await readLocalSchedulerLedger({ cwd: root });
		expect(Object.keys(ledger.entries)).toHaveLength(1);
	});

	it("does not re-fire across a simulated restart (fresh call, same .refarm store)", async () => {
		const root = createProjectRoot([
			{
				id: "daily-handoff",
				name: "Daily handoff",
				status: "active",
				triggers: [{ type: "once", at: "2026-06-27T08:00:00.000Z" }],
			},
		]);
		const effortAdapter = createCollectingEffortAdapter();

		await runDueScheduledWork({
			cwd: root,
			// ISS-075: the fire-once ledger is the NODE's, so a test that wants it inside its own
			// temp tree says which node it is rather than inferring one from the working directory.
			base: root,
			now: "2026-06-27T09:00:00.000Z",
			effortAdapter,
		});
		// A separate call with no shared in-memory state — only the persisted
		// .refarm ledger connects them, exactly like a daemon restart.
		const second = await runDueScheduledWork({
			cwd: root,
			// ISS-075: the fire-once ledger is the NODE's, so a test that wants it inside its own
			// temp tree says which node it is rather than inferring one from the working directory.
			base: root,
			now: "2026-06-27T09:05:00.000Z",
			effortAdapter,
		});

		expect(second.summary).toMatchObject({ due: 1, submitted: 0, alreadyFired: 1 });
		expect(effortAdapter.submitted).toHaveLength(1);
	});

	it("honors an injected ledger instead of the .refarm default", async () => {
		const root = createProjectRoot([
			{
				id: "daily-handoff",
				name: "Daily handoff",
				status: "active",
				triggers: [{ type: "once", at: "2026-06-27T08:00:00.000Z" }],
			},
		]);
		const effortAdapter = createCollectingEffortAdapter();
		const fired = new Set<string>();
		const ledger = {
			async hasFired(key: string) {
				return fired.has(key);
			},
			async recordFired(key: string) {
				fired.add(key);
			},
		};

		await runDueScheduledWork({
			cwd: root,
			// ISS-075: the fire-once ledger is the NODE's, so a test that wants it inside its own
			// temp tree says which node it is rather than inferring one from the working directory.
			base: root,
			now: "2026-06-27T09:00:00.000Z",
			effortAdapter,
			ledger,
		});

		expect(fired.size).toBe(1);
		// No .refarm ledger file was written, because the injected ledger was used.
		expect(fs.existsSync(path.join(root, ".refarm", "scheduler", "ledger.json"))).toBe(false);
	});

	it("submits nothing when no automation is due", async () => {
		const root = createProjectRoot([
			{
				id: "future",
				name: "Future",
				status: "active",
				triggers: [{ type: "once", at: "2026-06-28T08:00:00.000Z" }],
			},
		]);
		const effortAdapter = createCollectingEffortAdapter();

		const report = await runDueScheduledWork({
			cwd: root,
			// ISS-075: the fire-once ledger is the NODE's, so a test that wants it inside its own
			// temp tree says which node it is rather than inferring one from the working directory.
			base: root,
			now: "2026-06-27T09:00:00.000Z",
			effortAdapter,
		});

		expect(report.summary).toMatchObject({ due: 0, submitted: 0 });
		expect(effortAdapter.submitted).toHaveLength(0);
	});
});
