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

/** How far an address reaches. `mesh` (a Tailscale/overlay address) reaches from
 *  ANY network — it is what an operator hands a device on mobile data. `lan` is
 *  same-subnet only; `vpn` rides a corporate tunnel; `other` is unclassified. */
export type DiscoverAddressScope = "mesh" | "lan" | "vpn" | "other";

export interface DiscoverFarmAddress {
	address: string;
	interface: string;
	scope?: DiscoverAddressScope;
}

const SCOPE_ORDER: Record<DiscoverAddressScope, number> = {
	mesh: 0,
	lan: 1,
	vpn: 2,
	other: 3,
};

/** Classify an address by reach, from its value + interface name. Pure —
 *  a Tailscale interface OR the 100.64.0.0/10 CGNAT block it uses reads as mesh;
 *  tun/wg/ovpn interfaces read as vpn; RFC1918 reads as lan. */
export function classifyAddressScope(address: string, iface: string): DiscoverAddressScope {
	const name = iface.toLowerCase();
	if (/^(tailscale|ts)\d*/.test(name)) return "mesh";
	if (inCidr(address, "100.64.0.0", 10)) return "mesh";
	if (/^(tun|wg|ovpn|ovpntun|utun|wt|zt|nebula)\d*/.test(name)) return "vpn";
	if (inCidr(address, "10.0.0.0", 8)) return "lan";
	if (inCidr(address, "172.16.0.0", 12)) return "lan";
	if (inCidr(address, "192.168.0.0", 16)) return "lan";
	return "other";
}

function inCidr(address: string, network: string, prefix: number): boolean {
	const a = ipInt(address);
	const n = ipInt(network);
	if (a === null || n === null) return false;
	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
	return (a & mask) === (n & mask);
}

function ipInt(address: string): number | null {
	const parts = address.split(".").map(Number);
	if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
	return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
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
	/** Best-effort detection of anything that silently drops inbound device
	 *  probes while every host-local test passes — the status must SAY it. */
	probeFilters?(): DiscoverInboundFilter[];
}

/** Something on the host that can drop inbound traffic. `firewall` is
 *  operator-owned (fixable with a scoped allow); `endpoint-agent` is a managed
 *  security agent (corporate policy — not a self-serve `allow` away). */
export interface DiscoverInboundFilter {
	name: string;
	kind: "firewall" | "endpoint-agent";
	detail: string;
}

/** Managed endpoint/host-IPS agents whose presence explains an inbound black
 *  hole that no local test reveals. Keyed by systemd unit basename. */
const ENDPOINT_AGENTS: Record<string, string> = {
	ds_agent: "Trend Micro Deep Security",
	falcon_sensor: "CrowdStrike Falcon",
	mfetpd: "McAfee/Trellix Endpoint",
	cbagentd: "VMware Carbon Black",
	cortex: "Palo Alto Cortex XDR",
	sentinelone: "SentinelOne",
};

/** Read ufw's REAL state: the service can run with the firewall disabled — the
 *  truth is `ENABLED=yes` in ufw.conf, readable without sudo. */
function ufwEnabled(): boolean {
	try {
		const conf = readFileSync("/etc/ufw/ufw.conf", "utf8");
		return /^\s*ENABLED\s*=\s*yes\s*$/im.test(conf);
	} catch {
		return false;
	}
}

function systemdUnitActive(unit: string): boolean {
	try {
		return (
			runProcessHandoffSync(createProcessHandoffSpecFromRunner("systemctl", ["is-active", unit]), {
				capture: true,
			}).exitCode === 0
		);
	} catch {
		return false;
	}
}

function defaultProbeFilters(): DiscoverInboundFilter[] {
	const filters: DiscoverInboundFilter[] = [];
	if (ufwEnabled()) filters.push({ name: "ufw", kind: "firewall", detail: "enabled" });
	if (systemdUnitActive("firewalld")) {
		filters.push({ name: "firewalld", kind: "firewall", detail: "active" });
	}
	for (const [unit, product] of Object.entries(ENDPOINT_AGENTS)) {
		if (systemdUnitActive(unit)) {
			filters.push({ name: unit, kind: "endpoint-agent", detail: product });
		}
	}
	return filters;
}

function defaultListAddresses(): DiscoverFarmAddress[] {
	const addresses: DiscoverFarmAddress[] = [];
	for (const [name, entries] of Object.entries(networkInterfaces())) {
		for (const entry of entries ?? []) {
			if (entry.family !== "IPv4" || entry.internal) continue;
			addresses.push({
				address: entry.address,
				interface: name,
				scope: classifyAddressScope(entry.address, name),
			});
		}
	}
	return addresses;
}

/** Reach-first ordering: a mesh address (works from any network) before a LAN
 *  one before a VPN one — the operator sees the "from anywhere" address first. */
function byReach(addresses: DiscoverFarmAddress[]): DiscoverFarmAddress[] {
	return [...addresses].sort(
		(a, b) => SCOPE_ORDER[a.scope ?? "other"] - SCOPE_ORDER[b.scope ?? "other"],
	);
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
	filters?: DiscoverInboundFilter[];
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
	const addresses = byReach((deps.listAddresses ?? defaultListAddresses)());
	const filters = (deps.probeFilters ?? defaultProbeFilters)();
	const nextCommand = running
		? refarmCommand(STOP_COMMAND_ARGS)
		: refarmCommand(START_COMMAND_ARGS);
	// A host firewall the operator OWNS gets scoped allow rules (their LAN /24,
	// beacon + sync). A managed endpoint agent does NOT — offering a `ufw allow`
	// for it would be a lie; it names the agent and stops there.
	const lan = addresses.find((entry) => entry.address.includes("."));
	const firewallActions =
		lan && filters.some((filter) => filter.kind === "firewall")
			? filters
					.filter((filter) => filter.kind === "firewall")
					.flatMap((filter) => {
						const cidr = `${lan.address.split(".").slice(0, 3).join(".")}.0/24`;
						return [
							`sudo ${filter.name} allow from ${cidr} to any port 42002 proto udp`,
							`sudo ${filter.name} allow from ${cidr} to any port 42000 proto tcp`,
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
				...(filters.length > 0 ? { filters } : {}),
			},
		}),
		running,
		...(running && pid ? { pid } : {}),
		addresses,
		...(filters.length > 0 ? { filters } : {}),
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
					const reach =
						entry.scope === "mesh"
							? " — mesh: alcançável de QUALQUER rede (4G inclusive)"
							: entry.scope === "lan"
								? " — só na mesma rede local"
								: entry.scope === "vpn"
									? " — via túnel VPN"
									: "";
					console.log(`   fazenda alcançável em ${entry.address} (${entry.interface})${reach}`);
				}
				if (!(result.addresses ?? []).some((entry) => entry.scope === "mesh")) {
					console.log(
						"   dica: sem endereço mesh — uma overlay (Tailscale) daria um IP alcançável de qualquer rede.",
					);
				}
				for (const filter of result.filters ?? []) {
					if (filter.kind === "firewall") {
						console.log(
							`   ⚠️ firewall LIGADO (${filter.name}) — probes de dispositivos podem ser descartados em silêncio.`,
						);
					} else {
						console.log(
							`   ⚠️ agente de segurança gerido: ${filter.detail} (${filter.name}) — pode filtrar tráfego de entrada por POLÍTICA CORPORATIVA, fora do seu alcance com sudo. Se a LAN não passar, o caminho é o rail P2P (spec do Pears).`,
						);
					}
				}
				for (const action of result.nextActions) {
					console.log(`   liberar (escopo LAN): ${action}`);
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
