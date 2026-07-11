import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { executeDueLocalScheduledWork } from "./local-scheduler.js";
import {
	DEFAULT_LOCAL_SCHEDULER_LEDGER_PATH,
	createLocalSchedulerLedger,
	readLocalSchedulerLedger,
	resolveLocalSchedulerLedgerPath,
} from "./local-scheduler-ledger.js";

const BODY = {
	type: "static",
	effort: { direction: "scheduled local work", tasks: [] },
};

const tempDirs = [];

async function createTempDir() {
	const dir = await mkdtemp(join(tmpdir(), "refarm-windmill-ledger-"));
	tempDirs.push(dir);
	return dir;
}

function createAutomationAdapter() {
	const store = new Map();
	return {
		async create(input) {
			const now = "2026-06-27T00:00:00.000Z";
			const automation = {
				id: crypto.randomUUID(),
				status: "active",
				createdAt: now,
				updatedAt: now,
				...input,
			};
			store.set(automation.id, automation);
			return automation;
		},
		async query(filter = {}) {
			const automations = [...store.values()];
			if (!filter.status) return automations;
			return automations.filter((automation) => automation.status === filter.status);
		},
		async trigger(id, input) {
			const automation = store.get(id);
			if (!automation || automation.status !== "active") return null;
			return {
				id: `${automation.id}:effort`,
				submittedAt: input?.firedAt ?? "2026-06-27T00:00:00.000Z",
				...automation.body.effort,
			};
		},
	};
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("local scheduler ledger", () => {
	it("resolves the default .refarm ledger path under the supplied cwd", async () => {
		const cwd = await createTempDir();

		expect(resolveLocalSchedulerLedgerPath({ cwd })).toBe(
			join(cwd, DEFAULT_LOCAL_SCHEDULER_LEDGER_PATH),
		);
	});

	it("persists fired keys across adapter instances", async () => {
		const cwd = await createTempDir();
		const ledger = createLocalSchedulerLedger({ cwd });

		await expect(ledger.hasFired("job:1")).resolves.toBe(false);
		await ledger.recordFired("job:1", {
			firedAt: "2026-06-27T09:00:00.000Z",
			effortId: "effort-1",
		});

		const nextLedger = createLocalSchedulerLedger({ cwd });
		await expect(nextLedger.hasFired("job:1")).resolves.toBe(true);

		const snapshot = await readLocalSchedulerLedger({ cwd });
		expect(snapshot).toMatchObject({
			schema: "sovereign.local-scheduler-ledger.v1",
			schemaVersion: 1,
			entries: {
				"job:1": {
					firedAt: "2026-06-27T09:00:00.000Z",
					effortId: "effort-1",
				},
			},
		});
		// The entry carries only recordedAt + the caller's receipt — the node
		// envelope (@id/@type/@context, createdAt/updatedAt) must not leak.
		const entry = snapshot.entries["job:1"];
		expect(Object.keys(entry).sort()).toEqual(["effortId", "firedAt", "recordedAt"]);
	});

	it.skipIf(platform() === "win32")("writes the ledger tree with owner-only modes", async () => {
		const cwd = await createTempDir();
		const ledger = createLocalSchedulerLedger({ cwd });
		await ledger.recordFired("job:1", { effortId: "effort-1" });

		const filePath = resolveLocalSchedulerLedgerPath({ cwd });
		const fileStat = await stat(filePath);
		const dirStat = await stat(dirname(filePath));

		// group/other must have no write bit on either the dir or the file.
		expect(dirStat.mode & 0o077).toBe(0);
		expect(fileStat.mode & 0o077).toBe(0);
	});

	it("preserves existing entries when recording a new fired key", async () => {
		const cwd = await createTempDir();
		const ledger = createLocalSchedulerLedger({ cwd });

		await ledger.recordFired("job:1", { effortId: "effort-1" });
		await ledger.recordFired("job:2", { effortId: "effort-2" });

		const snapshot = await ledger.read();
		expect(Object.keys(snapshot.entries).sort()).toEqual(["job:1", "job:2"]);
	});

	it("rejects malformed ledger files instead of silently re-firing", async () => {
		const cwd = await createTempDir();
		// Seed a valid ledger (creates the .refarm/scheduler dir), then corrupt the
		// backing store file so a re-read must throw rather than read as empty.
		const seed = createLocalSchedulerLedger({ cwd });
		await seed.recordFired("bootstrap", { effortId: "bootstrap" });
		const filePath = resolveLocalSchedulerLedgerPath({ cwd });
		await writeFile(filePath, '{"records":', "utf8");

		const ledger = createLocalSchedulerLedger({ cwd });
		await expect(ledger.hasFired("job:1")).rejects.toThrow("Invalid local scheduler ledger");
	});

	it("plugs into due-work execution and suppresses duplicate persisted ticks", async () => {
		const cwd = await createTempDir();
		const automationAdapter = createAutomationAdapter();
		const submitted = [];
		const effortAdapter = {
			async submit(effort) {
				submitted.push(effort);
				return `${submitted.length}:${effort.id}`;
			},
		};
		await automationAdapter.create({
			name: "one-shot proof",
			body: BODY,
			triggers: [{ type: "once", at: "2026-06-27T08:00:00.000Z" }],
		});

		const first = await executeDueLocalScheduledWork(automationAdapter, effortAdapter, {
			owner: "refarm-main",
			now: "2026-06-27T09:00:00.000Z",
			ledger: createLocalSchedulerLedger({ cwd }),
		});
		const second = await executeDueLocalScheduledWork(automationAdapter, effortAdapter, {
			owner: "refarm-main",
			now: "2026-06-27T09:05:00.000Z",
			ledger: createLocalSchedulerLedger({ cwd }),
		});

		expect(first.summary).toMatchObject({ due: 1, submitted: 1, alreadyFired: 0 });
		expect(second.summary).toMatchObject({ due: 1, submitted: 0, alreadyFired: 1 });
		expect(submitted).toHaveLength(1);
	});
});
