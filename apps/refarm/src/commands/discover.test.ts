import { describe, expect, it, vi } from "vitest";
import {
	announceStatus,
	classifyAddressScope,
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

describe("classifyAddressScope — which address reaches from where", () => {
	it("labels a private LAN address as lan", () => {
		expect(classifyAddressScope("192.168.0.7", "wlp0s20f3")).toBe("lan");
		expect(classifyAddressScope("10.1.2.3", "eth0")).toBe("lan");
		expect(classifyAddressScope("172.16.5.5", "eth0")).toBe("lan");
	});

	it("labels the Tailscale CGNAT range as mesh — reachable from any network", () => {
		expect(classifyAddressScope("100.101.102.103", "tailscale0")).toBe("mesh");
		expect(classifyAddressScope("100.64.0.1", "eth0")).toBe("mesh");
		expect(classifyAddressScope("100.127.255.254", "x")).toBe("mesh");
	});

	it("labels a tailscale-named interface as mesh even outside the CGNAT guess", () => {
		expect(classifyAddressScope("10.9.8.7", "tailscale0")).toBe("mesh");
	});

	it("100.x OUTSIDE the CGNAT block is not mesh — real public 100.x exists", () => {
		expect(classifyAddressScope("100.128.0.1", "eth0")).toBe("other");
		expect(classifyAddressScope("100.63.255.255", "eth0")).toBe("other");
	});

	it("labels a known VPN tunnel interface as vpn", () => {
		expect(classifyAddressScope("172.24.38.251", "ovpntun0")).toBe("vpn");
		expect(classifyAddressScope("10.8.0.2", "tun0")).toBe("vpn");
		expect(classifyAddressScope("10.8.0.2", "wg0")).toBe("vpn");
	});
});

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

	it("status denounces an ENABLED host firewall with scoped allow rules", () => {
		const deps = makeDeps({
			listAddresses: () => [{ address: "192.168.0.7", interface: "wlp0s20f3" }],
			probeFilters: () => [{ name: "ufw", kind: "firewall", detail: "enabled" }],
		});
		const status = announceStatus(deps);
		expect(status.filters).toEqual([{ name: "ufw", kind: "firewall", detail: "enabled" }]);
		expect(status.nextActions.some((action) => action.includes("ufw allow"))).toBe(true);
	});

	it("status flags a managed-endpoint agent but offers no self-serve fix", () => {
		const deps = makeDeps({
			listAddresses: () => [{ address: "192.168.0.7", interface: "wlp0s20f3" }],
			probeFilters: () => [
				{ name: "ds_agent", kind: "endpoint-agent", detail: "Trend Micro Deep Security" },
			],
		});
		const status = announceStatus(deps);
		expect(status.filters?.[0]?.kind).toBe("endpoint-agent");
		// A corporate agent is not an operator `ufw allow` away — no false rule offered.
		expect(status.nextActions.some((action) => action.includes("allow"))).toBe(false);
	});

	it("status stays quiet when nothing is filtering", () => {
		const deps = makeDeps({ probeFilters: () => [] });
		const status = announceStatus(deps);
		expect(status.filters ?? []).toEqual([]);
	});

	it("status lists reachable addresses with their scope — mesh first", () => {
		const deps = makeDeps({
			listAddresses: () => [
				{ address: "192.168.0.7", interface: "wlp0s20f3", scope: "lan" },
				{ address: "100.101.102.103", interface: "tailscale0", scope: "mesh" },
			],
		});
		const status = announceStatus(deps);
		// A mesh address reaches from any network — it sorts to the front.
		expect(status.addresses?.[0]?.scope).toBe("mesh");
		expect(status.addresses?.[0]?.address).toBe("100.101.102.103");
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
