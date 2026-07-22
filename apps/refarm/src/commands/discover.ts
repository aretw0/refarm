import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";

import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import {
	createProcessHandoffSpecFromRunner,
	runProcessHandoffSync,
	startDetachedProcessHandoff,
	type ProcessHandoffSpec,
} from "@refarm.dev/cli/process-handoff";
import { Command } from "commander";

import { refarmCommand } from "../brand.js";
import { findRepoRoot } from "./session-launch.js";

/**
 * `refarm discover announce` — the LAN announcer as a GOVERNED process.
 *
 * The operator's rule: nothing long-lived runs dangling. The announcer (the
 * farm-beacon responder devices find via `farm-hello`) starts DETACHED with a
 * pidfile and a log under `.refarm/` — the same sovereignty posture as the
 * runtime's own pidfiles — so start is idempotent, status tells the truth,
 * and stop actually stops. Announcing stays opt-in: this command is the opt-in.
 */

export interface DiscoverFarmAddress {
	address: string;
	interface: string;
}

export interface DiscoverAnnounceDeps {
	repoRoot(): string;
	startDetached(spec: ProcessHandoffSpec, options: { logPath: string }): { pid?: number };
	processAlive(pid: number): boolean;
	stopProcess(pid: number): void;
	readPid(pidFile: string): number | null;
	writePid(pidFile: string, pid: number): void;
	removePid(pidFile: string): void;
	/** The farm's reachable IPv4 addresses — surfaced so an operator (or wizard)
	 *  can hand a device an explicit address when discovery is filtered. */
	listAddresses?(): DiscoverFarmAddress[];
	/** Best-effort host firewall detection — an active firewall silently drops
	 *  device probes while every host-local test passes; the status must SAY it. */
	probeFirewall?(): { name: string; active: boolean } | null;
}

function defaultProbeFirewall(): { name: string; active: boolean } | null {
	for (const name of ["ufw", "firewalld"]) {
		try {
			const result = runProcessHandoffSync(
				createProcessHandoffSpecFromRunner("systemctl", ["is-active", name]),
				{ capture: true },
			);
			if (result.exitCode === 0) return { name, active: true };
		} catch {
			// systemctl unavailable (container, mac) — nothing to report
		}
	}
	return null;
}

function defaultListAddresses(): DiscoverFarmAddress[] {
	const addresses: DiscoverFarmAddress[] = [];
	for (const [name, entries] of Object.entries(networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.family !== "IPv4" || entry.internal) continue;
			addresses.push({ address: entry.address, interface: name });
		}
	}
	return addresses;
}

function defaultDeps(): DiscoverAnnounceDeps {
	return {
		repoRoot: findRepoRoot,
		startDetached: (spec, options) => {
			mkdirSync(dirname(options.logPath), { recursive: true });
			const child = startDetachedProcessHandoff(spec, { logPath: options.logPath });
			return { pid: (child as { pid?: number }).pid };
		},
		processAlive: (pid) => {
			try {
				process.kill(pid, 0);
				return true;
			} catch {
				return false;
			}
		},
		stopProcess: (pid) => {
			try {
				process.kill(pid, "SIGTERM");
			} catch {
				// Already gone — stop() reports through status, not by throwing.
			}
		},
		readPid: (pidFile) => {
			if (!existsSync(pidFile)) return null;
			const parsed = Number.parseInt(readFileSync(pidFile, "utf8").trim(), 10);
			return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
		},
		writePid: (pidFile, pid) => {
			mkdirSync(dirname(pidFile), { recursive: true });
			writeFileSync(pidFile, `${pid}\n`);
		},
		removePid: (pidFile) => {
			rmSync(pidFile, { force: true });
		},
	};
}

function announcePidFile(deps: DiscoverAnnounceDeps): string {
	return join(deps.repoRoot(), ".refarm", "farm-announce.pid");
}

function announceLogFile(deps: DiscoverAnnounceDeps): string {
	return join(deps.repoRoot(), ".refarm", "logs", "farm-announce.log");
}

const STATUS_COMMAND_ARGS = ["discover", "announce", "--status", "--json"];
const STOP_COMMAND_ARGS = ["discover", "announce", "--stop", "--json"];
const START_COMMAND_ARGS = ["discover", "announce", "--json"];

/** One shape for every announce outcome — the optional discriminants tell the story. */
export interface DiscoverAnnounceResult {
	addresses?: DiscoverFarmAddress[];
	firewall?: { name: string; active: boolean };
	command?: string;
	operation?: string;
	ok: boolean;
	pid?: number;
	running?: boolean;
	alreadyRunning?: boolean;
	stopped?: boolean;
	alreadyStopped?: boolean;
	pidFile?: string;
	logFile?: string;
	error?: string;
	message?: string;
	nextAction: string | null;
	nextActions: string[];
	nextCommand: string | null;
	nextCommands: string[];
}

export function announceStatus(
	deps: DiscoverAnnounceDeps = defaultDeps(),
): DiscoverAnnounceResult {
	const pidFile = announcePidFile(deps);
	const pid = deps.readPid(pidFile);
	const running = pid !== null && deps.processAlive(pid);
	const addresses = (deps.listAddresses ?? defaultListAddresses)();
	const firewall = (deps.probeFirewall ?? defaultProbeFirewall)();
	const nextCommand = running
		? refarmCommand(STOP_COMMAND_ARGS)
		: refarmCommand(START_COMMAND_ARGS);
	// An active firewall is the classic silent killer of device probes: name it
	// and hand the operator scoped allow rules (their LAN /24, beacon + sync).
	const firewallActions = firewall?.active
		? addresses
				.filter((entry) => entry.address.includes("."))
				.slice(0, 1)
				.flatMap((entry) => {
					const lan = `${entry.address.split(".").slice(0, 3).join(".")}.0/24`;
					return [
						`sudo ${firewall.name} allow from ${lan} to any port 42002 proto udp`,
						`sudo ${firewall.name} allow from ${lan} to any port 42000 proto tcp`,
					];
				})
		: [];
	return {
		...buildJsonSuccessEnvelope({
			command: "discover",
			operation: "announce-status",
			nextActions: firewallActions,
			nextCommand,
			nextCommands: [nextCommand],
			extra: {
				running,
				...(running && pid ? { pid } : {}),
				pidFile,
				addresses,
				...(firewall?.active ? { firewall } : {}),
			},
		}),
		running,
		...(running && pid ? { pid } : {}),
		addresses,
		...(firewall?.active ? { firewall } : {}),
	};
}

export function startAnnounce(deps: DiscoverAnnounceDeps = defaultDeps()): DiscoverAnnounceResult {
	const pidFile = announcePidFile(deps);
	const existing = deps.readPid(pidFile);
	const statusCommand = refarmCommand(STATUS_COMMAND_ARGS);
	if (existing !== null && deps.processAlive(existing)) {
		return {
			...buildJsonSuccessEnvelope({
				command: "discover",
				operation: "announce",
				nextCommand: statusCommand,
				nextCommands: [statusCommand, refarmCommand(STOP_COMMAND_ARGS)],
				extra: { pid: existing, pidFile, alreadyRunning: true },
			}),
			pid: existing,
			alreadyRunning: true as const,
		};
	}
	if (existing !== null) deps.removePid(pidFile); // stale pidfile — dead process

	const scriptPath = join(deps.repoRoot(), "scripts", "farm-announce.mjs");
	const spec = createProcessHandoffSpecFromRunner(process.execPath, [scriptPath], {
		cwd: deps.repoRoot(),
	});
	const { pid } = deps.startDetached(spec, { logPath: announceLogFile(deps) });
	if (!pid) {
		const retry = refarmCommand(START_COMMAND_ARGS);
		return {
			command: "discover",
			operation: "announce",
			ok: false as const,
			error: "announce-spawn-failed",
			message: "The announcer process did not report a pid.",
			nextAction: retry,
			nextActions: [retry],
			nextCommand: retry,
			nextCommands: [retry],
		};
	}
	deps.writePid(pidFile, pid);
	return {
		...buildJsonSuccessEnvelope({
			command: "discover",
			operation: "announce",
			nextCommand: statusCommand,
			nextCommands: [statusCommand, refarmCommand(STOP_COMMAND_ARGS)],
			extra: { pid, pidFile, logFile: announceLogFile(deps) },
		}),
		pid,
	};
}

export function stopAnnounce(deps: DiscoverAnnounceDeps = defaultDeps()): DiscoverAnnounceResult {
	const pidFile = announcePidFile(deps);
	const pid = deps.readPid(pidFile);
	const startCommand = refarmCommand(START_COMMAND_ARGS);
	if (pid === null || !deps.processAlive(pid)) {
		if (pid !== null) deps.removePid(pidFile);
		return {
			...buildJsonSuccessEnvelope({
				command: "discover",
				operation: "announce-stop",
				nextCommand: startCommand,
				nextCommands: [startCommand],
				extra: { alreadyStopped: true, pidFile },
			}),
			alreadyStopped: true as const,
		};
	}
	deps.stopProcess(pid);
	deps.removePid(pidFile);
	return {
		...buildJsonSuccessEnvelope({
			command: "discover",
			operation: "announce-stop",
			nextCommand: startCommand,
			nextCommands: [startCommand],
			extra: { stopped: true, pid, pidFile },
		}),
		stopped: true as const,
	};
}

interface DiscoverAnnounceOptions {
	stop?: boolean;
	status?: boolean;
	json?: boolean;
}

export function createDiscoverCommand(deps: DiscoverAnnounceDeps = defaultDeps()): Command {
	const announce = new Command("announce")
		.description("Start (default), inspect, or stop the governed LAN announcer")
		.option("--status", "Report whether the announcer is running")
		.option("--stop", "Stop the running announcer")
		.option("--json", "Output machine-readable JSON")
		.action((options: DiscoverAnnounceOptions) => {
			const result = options.status
				? announceStatus(deps)
				: options.stop
					? stopAnnounce(deps)
					: startAnnounce(deps);
			if (options.json) {
				printJson(result);
				if (!result.ok) process.exitCode = 1;
				return;
			}
			if ("running" in result) {
				console.log(
					result.running
						? `📣 anunciando (pid ${result.pid}) — pare com: ${result.nextCommand}`
						: `silencioso — anuncie com: ${result.nextCommand}`,
				);
				for (const entry of result.addresses ?? []) {
					console.log(`   fazenda alcançável em ${entry.address} (${entry.interface})`);
				}
				if (result.firewall?.active) {
					console.log(
						`   ⚠️ firewall ATIVO (${result.firewall.name}) — probes de dispositivos são descartados em silêncio.`,
					);
					for (const action of result.nextActions) {
						console.log(`   liberar (escopo LAN): ${action}`);
					}
				}
				return;
			}
			if ("stopped" in result || "alreadyStopped" in result) {
				console.log("stopped" in result ? "📣 anunciante parado." : "já estava parado.");
				return;
			}
			if (!result.ok) {
				console.error(`falha ao anunciar: ${"message" in result ? result.message : ""}`);
				process.exitCode = 1;
				return;
			}
			console.log(
				"alreadyRunning" in result
					? `já anunciando (pid ${result.pid}).`
					: `📣 anunciando na LAN (pid ${result.pid}) — dispositivos com farm-hello vão encontrar esta fazenda.`,
			);
		});

	return new Command("discover")
		.description("LAN presence: let the operator's devices find this farm")
		.addCommand(announce);
}

export const discoverCommand = createDiscoverCommand();
