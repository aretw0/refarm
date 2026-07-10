import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectCommand } from "./project.js";

const tempRoots: string[] = [];

function createProjectRoot(automations: unknown[]): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "refarm-tick-"));
	tempRoots.push(root);
	fs.mkdirSync(path.join(root, ".project"), { recursive: true });
	fs.writeFileSync(
		path.join(root, ".project", "automations.json"),
		JSON.stringify({ automations }),
	);
	return root;
}

function createCollectingEffortAdapter() {
	const submitted: unknown[] = [];
	return {
		submitted,
		submit: async (effort: unknown) => {
			submitted.push(effort);
			return `effort-${submitted.length}`;
		},
	};
}

async function runTick(
	root: string,
	effortAdapter: { submit(effort: unknown): Promise<string> },
	args: string[],
): Promise<Record<string, unknown>> {
	const lines: string[] = [];
	const log = vi.spyOn(console, "log").mockImplementation((line = "") => {
		lines.push(String(line));
	});
	try {
		const command = createProjectCommand({
			cwd: () => root,
			effortSubmitAdapter: () => effortAdapter,
		});
		await command.parseAsync(["automations", "tick", ...args, "--json"], { from: "user" });
		return JSON.parse(lines.join("\n")) as Record<string, unknown>;
	} finally {
		log.mockRestore();
	}
}

const DUE_ONCE = [
	{
		id: "morning-note",
		name: "Morning note",
		status: "active",
		triggers: [{ type: "once", at: "2020-01-01T08:00:00.000Z" }],
	},
];

afterEach(() => {
	for (const root of tempRoots.splice(0)) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

describe("project automations tick", () => {
	it("dry-run reports what would fire without submitting or writing the ledger", async () => {
		const root = createProjectRoot(DUE_ONCE);
		const effortAdapter = createCollectingEffortAdapter();

		const envelope = await runTick(root, effortAdapter, []);

		expect(envelope.ok).toBe(true);
		expect(envelope.submitted).toBe(false);
		expect((envelope.report as { summary: unknown }).summary).toMatchObject({
			due: 1,
			submitted: 1,
		});
		// No effort actually dispatched, no ledger written.
		expect(effortAdapter.submitted).toHaveLength(0);
		expect(fs.existsSync(path.join(root, ".refarm", "scheduler", "ledger.json"))).toBe(false);
	});

	it("--submit dispatches the effort and records the .refarm ledger", async () => {
		const root = createProjectRoot(DUE_ONCE);
		const effortAdapter = createCollectingEffortAdapter();

		const envelope = await runTick(root, effortAdapter, ["--submit"]);

		expect(envelope.submitted).toBe(true);
		expect((envelope.report as { summary: unknown }).summary).toMatchObject({
			due: 1,
			submitted: 1,
			alreadyFired: 0,
		});
		expect(effortAdapter.submitted).toHaveLength(1);
		expect(fs.existsSync(path.join(root, ".refarm", "scheduler", "ledger.json"))).toBe(true);
	});

	it("--submit is idempotent across ticks via the persisted ledger", async () => {
		const root = createProjectRoot(DUE_ONCE);
		const effortAdapter = createCollectingEffortAdapter();

		await runTick(root, effortAdapter, ["--submit"]);
		const second = await runTick(root, effortAdapter, ["--submit"]);

		expect((second.report as { summary: unknown }).summary).toMatchObject({
			due: 1,
			submitted: 0,
			alreadyFired: 1,
		});
		expect(effortAdapter.submitted).toHaveLength(1);
	});

	it("dry-run reflects the real ledger after a prior submit", async () => {
		const root = createProjectRoot(DUE_ONCE);
		const effortAdapter = createCollectingEffortAdapter();

		await runTick(root, effortAdapter, ["--submit"]);
		const dry = await runTick(root, effortAdapter, []);

		// Dry-run sees the persisted fire and reports it would not re-fire.
		expect((dry.report as { summary: unknown }).summary).toMatchObject({
			submitted: 0,
			alreadyFired: 1,
		});
		expect(effortAdapter.submitted).toHaveLength(1);
	});
});
