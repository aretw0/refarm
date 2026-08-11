import { loadRawSovereignConfig } from "@refarm.dev/config";
import type { BaseSurfaceUnit } from "@refarm.dev/operator-state";
import { parseProcessCatalog, type ProcessStatus } from "@refarm.dev/process-contract-v1";
import {
	createNodeCommandRunner,
	readLingerState,
	systemdUnitName,
	type LingerState,
} from "@refarm.dev/process-systemd-user";
import {
	parseSurfaces,
	SURFACE_DAEMON_WS,
	SURFACE_SIDECAR_HTTP,
	SURFACE_WEB,
} from "@refarm.dev/std";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { refarmCommand } from "../brand.js";
import { readPolicy } from "./auth-policy-file.js";

export interface OperationalReadinessDeps {
	root?: string;
	config?: unknown;
	credentialCount?: number;
	observeProcesses?: (names: string[], root: string) => Promise<ProcessStatus[]>;
	observeSupervisionLifetime?: () => Promise<SupervisionLifetimeReadiness>;
	observeDistribution?: (directory: string) => DistributionReadiness;
}

export interface SupervisionLifetimeReadiness {
	state: LingerState;
	detail: string;
}

export interface DistributionReadiness {
	directory: string;
	manifest: boolean;
	installer: boolean;
}

/**
 * Configuration introspection for every renderer of the base surface.
 *
 * These units report durable facts from their canonical stores. They deliberately do not infer
 * that a device roundtrip succeeded merely because declarations exist; acceptance evidence is a
 * separate concern. No credential material enters the model — only the number of enrolled
 * identities.
 */
export async function resolveOperationalReadinessUnits(
	deps: OperationalReadinessDeps = {},
): Promise<BaseSurfaceUnit[]> {
	// os-resolution: project — reads the workspace tier config the operator is standing in
	const root = deps.root ?? process.cwd();
	const config = deps.config ?? loadRawSovereignConfig(root);
	const surfaces = parseSurfaces(config);
	const processes = parseProcessCatalog(config);
	const credentialCount =
		deps.credentialCount ??
		(await readPolicy(path.join(root, ".refarm", "auth-policy.json"))).credentials.length;
	const processNames = [...processes.keys()];
	const processStatuses =
		processNames.length === 0
			? []
			: await (deps.observeProcesses ?? observeProcesses)(processNames, root);
	const supervisionLifetime =
		processNames.length === 0
			? null
			: await (deps.observeSupervisionLifetime ?? observeSupervisionLifetime)();

	const units = [
		buildDeviceAccessUnit(surfaces, credentialCount),
		buildSupervisionUnit(processes, processStatuses, supervisionLifetime),
	];
	const webServe = processes.get("web-serve");
	const directory = webServe ? webServeDirectory(webServe.command) : null;
	if (directory) {
		units.push(
			buildDistributionUnit(
				(deps.observeDistribution ?? observeDistribution)(directory),
			),
		);
	}
	return units;
}

function webServeDirectory(command: readonly string[]): string | null {
	const web = command.findIndex((part, index) => part === "web" && command[index + 1] === "serve");
	const directory = web >= 0 ? command[web + 2] : undefined;
	return typeof directory === "string" && path.isAbsolute(directory) ? directory : null;
}

function observeDistribution(directory: string): DistributionReadiness {
	return {
		directory,
		manifest: fs.existsSync(path.join(directory, "manifest.json")),
		installer: fs.existsSync(path.join(directory, "install.mjs")),
	};
}

function buildDistributionUnit(readiness: DistributionReadiness): BaseSurfaceUnit {
	const missing = [
		...(readiness.manifest ? [] : ["manifest.json"]),
		...(readiness.installer ? [] : ["install.mjs"]),
	];
	const ready = missing.length === 0;
	return {
		id: "distribution",
		label: "Device distribution",
		owner: "apps/refarm",
		state: ready ? "ready" : "degraded",
		severity: ready ? "info" : "warning",
		summary: ready
			? "The supervised web root contains the update manifest and cold installer."
			: `The supervised web root is missing ${missing.join(" and ")}; a running server would answer 404.`,
		evidence: [
			{ kind: "path", label: "served root", value: readiness.directory },
			{ kind: "state", label: "manifest.json", value: readiness.manifest ? "present" : "missing" },
			{ kind: "state", label: "install.mjs", value: readiness.installer ? "present" : "missing" },
		],
		actions: ready
			? []
			: [
					{
						id: "repair-web-distribution",
						label: "Review the web-serve publication root",
						command: refarmCommand(["process", "add", "web-serve", "--replace"]),
						intent: "distribution:repair",
						primary: true,
					},
				],
		details: { ...readiness, missingFiles: missing },
	};
}

async function observeProcesses(names: string[], root: string): Promise<ProcessStatus[]> {
	const { runProcessStatus } = await import("./process.js");
	return (await runProcessStatus(names, { root })).statuses;
}

async function observeSupervisionLifetime(): Promise<SupervisionLifetimeReadiness> {
	const user = process.env.USER?.trim() || process.env.LOGNAME?.trim() || os.userInfo().username;
	return readLingerState(createNodeCommandRunner(), user);
}

function buildDeviceAccessUnit(
	surfaces: ReturnType<typeof parseSurfaces>,
	credentialCount: number,
): BaseSurfaceUnit {
	const names = [...surfaces.keys()];
	const required = [SURFACE_WEB, SURFACE_SIDECAR_HTTP, SURFACE_DAEMON_WS] as const;
	const missing = required.filter((name) => !surfaces.has(name));
	const gated = [...surfaces.values()].filter((entry) => entry.gate === "device-token").length;
	const actions: BaseSurfaceUnit["actions"] = [];
	for (const name of missing) {
		actions.push({
			id: `declare-${name}`,
			label: `Declare the ${name} device surface`,
			command: refarmCommand(["surface", "add", name]),
			intent: "surface:declare",
			primary: actions.length === 0,
		});
	}
	if (gated > 0 && credentialCount === 0) {
		actions.push({
			id: "enroll-device",
			label: "Enroll a device for the declared gate",
			command: refarmCommand(["auth", "enroll", "<device-label>"]),
			intent: "auth:enroll-device",
			primary: actions.length === 0,
		});
	}

	const ready = missing.length === 0 && credentialCount > 0;
	return {
		id: "device-access",
		label: "Device access",
		owner: "apps/refarm",
		state: ready ? "ready" : "degraded",
		severity: ready ? "info" : "warning",
		summary:
			missing.length > 0
				? `${missing.length} device-access surface(s) still need a declaration.`
				: ready
					? `${names.length} surface(s) declared; ${credentialCount} device identity(ies) enrolled.`
					: "The device-access surfaces are declared, but no device identity is enrolled.",
		evidence: [
			{ kind: "count", label: "surfaces", value: String(names.length) },
			{ kind: "state", label: "declared", value: names.join(", ") || "none" },
			{ kind: "count", label: "enrolled devices", value: String(credentialCount) },
		],
		actions,
		details: {
			surfaces: names,
			requiredSurfaces: required,
			missingSurfaces: missing,
			gatedSurfaces: gated,
			enrolledDevices: credentialCount,
		},
	};
}

function buildSupervisionUnit(
	processes: ReturnType<typeof parseProcessCatalog>,
	statuses: ProcessStatus[],
	lifetime: SupervisionLifetimeReadiness | null,
): BaseSurfaceUnit {
	const names = [...processes.keys()];
	const running = statuses.filter((status) => status.state === "running").length;
	const requiresDurability = processes.has("web-serve");
	const durable = !requiresDurability || lifetime?.state === "enabled";
	const ready = names.length > 0 && running === names.length && durable;
	const actions: BaseSurfaceUnit["actions"] = [];
	if (names.length === 0) {
		actions.push({
			id: "declare-web-supervision",
			label: "Declare the web server for supervision",
			command: refarmCommand(["process", "add", "web-serve"]),
			intent: "process:declare",
			primary: true,
		});
	} else {
		for (const status of statuses) {
			if (status.state === "running") continue;
			if (status.state === "not-running" && status.supervised && status.backend === "systemd-user") {
				actions.push({
					id: `restart-${status.name}`,
					label: `Restart ${status.name}`,
					command: `systemctl --user restart ${systemdUnitName(status.name)}`,
					intent: "process:restart",
					primary: actions.length === 0,
				});
			} else if (status.state === "not-running" && status.supervised === false) {
				actions.push({
					id: `install-${status.name}`,
					label: `Install supervision for ${status.name}`,
					command: refarmCommand(["process", "install", status.name]),
					intent: "process:install",
					primary: actions.length === 0,
				});
			} else {
				actions.push({
					id: `inspect-${status.name}`,
					label: `Inspect ${status.name}`,
					command: refarmCommand(["process", "status", status.name, "--json"]),
					intent: "process:inspect",
					primary: actions.length === 0,
				});
			}
		}
		if (running === names.length && !durable) {
			actions.push({
				id: "enable-durable-supervision",
				label: "Keep device distribution running after logout",
				command: refarmCommand(["process", "linger"]),
				intent: "process:linger",
				primary: actions.length === 0,
			});
		}
	}
	return {
		id: "supervision",
		label: "Supervision",
		owner: "apps/refarm",
		state: ready ? "ready" : "degraded",
		severity: ready ? "info" : "warning",
		summary:
			names.length === 0
				? "No long-running process is declared for host supervision."
				: running === names.length && !durable
					? lifetime?.state === "disabled"
						? "All declared processes are running, but device distribution stops at logout."
						: "All declared processes are running, but logout/boot durability could not be verified."
					: ready
					? `${running}/${names.length} declared process(es) are running.`
					: `${running}/${names.length} declared process(es) are known to be running.`,
		evidence: [
			{ kind: "count", label: "declared processes", value: String(names.length) },
			{ kind: "state", label: "declared", value: names.join(", ") || "none" },
			{ kind: "count", label: "running", value: String(running) },
			...(requiresDurability
				? [{ kind: "state" as const, label: "logout/boot durability", value: lifetime?.state ?? "unknown" }]
				: []),
		],
		actions,
		details: { processes: names, statuses, requiresDurability, lifetime },
	};
}
