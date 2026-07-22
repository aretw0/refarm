import { describe, expect, it, vi } from "vitest";
import {
	announceStatus,
	startAnnounce,
	stopAnnounce,
	type DiscoverAnnounceDeps,
} from "./discover.js";

function makeDeps(overrides: Partial<DiscoverAnnounceDeps> = {}): DiscoverAnnounceDeps & {
	pids: Map<string, number>;
} {
	const pids = new Map<string, number>();
	const alive = new Set<number>();
	return {
		pids,
		repoRoot: () => "/repo",
		startDetached: vi.fn(() => {
			alive.add(4242);
			return { pid: 4242 };
		}),
		processAlive: (pid: number) => alive.has(pid),
		stopProcess: (pid: number) => {
			alive.delete(pid);
		},
		readPid: (pidFile: string) => pids.get(pidFile) ?? null,
		writePid: (pidFile: string, pid: number) => {
			pids.set(pidFile, pid);
		},
		removePid: (pidFile: string) => {
			pids.delete(pidFile);
		},
		...overrides,
	};
}

describe("refarm discover announce — the managed LAN announcer", () => {
	it("starts detached, records the pid, and hands off to status", () => {
		const deps = makeDeps();
		const result = startAnnounce(deps);
		expect(result.ok).toBe(true);
		expect(result.pid).toBe(4242);
		expect(deps.pids.get("/repo/.refarm/farm-announce.pid")).toBe(4242);
		expect(result.nextCommands.some((cmd) => cmd.includes("--status"))).toBe(true);
	});

	it("is idempotent — a live announcer is reported, never doubled", () => {
		const deps = makeDeps();
		startAnnounce(deps);
		const again = startAnnounce(deps);
		expect(again.ok).toBe(true);
		expect(again.alreadyRunning).toBe(true);
		expect(deps.startDetached).toHaveBeenCalledTimes(1);
	});

	it("a stale pidfile (dead process) is cleaned and a fresh announcer starts", () => {
		const deps = makeDeps();
		deps.pids.set("/repo/.refarm/farm-announce.pid", 9999); // nobody alive at 9999
		const result = startAnnounce(deps);
		expect(result.ok).toBe(true);
		expect(result.alreadyRunning).toBeUndefined();
		expect(deps.pids.get("/repo/.refarm/farm-announce.pid")).toBe(4242);
	});

	it("status tells the truth in both states", () => {
		const deps = makeDeps();
		expect(announceStatus(deps).running).toBe(false);
		startAnnounce(deps);
		const status = announceStatus(deps);
		expect(status.running).toBe(true);
		expect(status.pid).toBe(4242);
	});

	it("stop kills the announcer, removes the pidfile, and hands off to start", () => {
		const deps = makeDeps();
		startAnnounce(deps);
		const result = stopAnnounce(deps);
		expect(result.ok).toBe(true);
		expect(result.stopped).toBe(true);
		expect(deps.pids.has("/repo/.refarm/farm-announce.pid")).toBe(false);
		expect(announceStatus(deps).running).toBe(false);
	});

	it("stop without a running announcer is honest and points at start", () => {
		const deps = makeDeps();
		const result = stopAnnounce(deps);
		expect(result.ok).toBe(true);
		expect(result.alreadyStopped).toBe(true);
		expect(result.nextCommands.some((cmd) => cmd.includes("discover announce"))).toBe(true);
	});
});
