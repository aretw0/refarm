import { describe, expect, it, vi } from "vitest";
import { EffortQueue } from "./effort-queue.js";

async function waitForQueue(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("EffortQueue", () => {
	it("processes efforts serially in submission order", async () => {
		const events: string[] = [];
		let releaseFirst: (() => void) | undefined;
		const firstBlocked = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		const queue = new EffortQueue(async (effortId) => {
			events.push(`start:${effortId}`);
			if (effortId === "first") await firstBlocked;
			events.push(`end:${effortId}`);
		});

		queue.enqueue("first");
		queue.enqueue("second");
		await waitForQueue();
		expect(events).toEqual(["start:first"]);
		expect(queue.depth).toBe(1);

		releaseFirst?.();
		await waitForQueue();
		expect(events).toEqual(["start:first", "end:first", "start:second", "end:second"]);
	});

	it("de-duplicates queued efforts and upgrades force", async () => {
		let releaseBlocker: (() => void) | undefined;
		const blocker = new Promise<void>((resolve) => {
			releaseBlocker = resolve;
		});
		const handler = vi.fn(async (effortId: string) => {
			if (effortId === "blocker") await blocker;
		});
		const queue = new EffortQueue(handler);

		queue.enqueue("blocker");
		queue.enqueue("effort-1");
		queue.enqueue("effort-1", { force: true });
		expect(queue.depth).toBe(1);

		releaseBlocker?.();
		await waitForQueue();
		expect(handler).toHaveBeenCalledTimes(2);
		expect(handler).toHaveBeenLastCalledWith("effort-1", { force: true });
	});
});
