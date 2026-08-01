import { loadRawSovereignConfig } from "@refarm.dev/config";
import type { BaseSurfaceUnit } from "@refarm.dev/operator-state";
import { parseProcessCatalog, type ProcessStatus } from "@refarm.dev/process-contract-v1";
import { systemdUnitName } from "@refarm.dev/process-systemd-user";
import { parseSurfaces } from "@refarm.dev/std";
import path from "node:path";
import { refarmCommand } from "../brand.js";
import { readPolicy } from "./auth-policy-file.js";

export interface OperationalReadinessDeps {
	root?: string;
	config?: unknown;
	credentialCount?: number;
	observeProcesses?: (names: string[], root: string) => Promise<ProcessStatus[]>;
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

	return [
		buildDeviceAccessUnit(surfaces, credentialCount),
		buildSupervisionUnit(processes, processStatuses),
	];
}

async function observeProcesses(names: string[], root: string): Promise<ProcessStatus[]> {
	const { runProcessStatus } = await import("./process.js");
	return (await runProcessStatus(names, { root })).statuses;
}

function buildDeviceAccessUnit(
	surfaces: ReturnType<typeof parseSurfaces>,
	credentialCount: number,
): BaseSurfaceUnit {
	const names = [...surfaces.keys()];
	const gated = [...surfaces.values()].filter((entry) => entry.gate === "device-token").length;
	const actions: BaseSurfaceUnit["actions"] = [];
	if (names.length === 0) {
		actions.push({
			id: "declare-device-surface",
			label: "Declare a device surface",
			command: refarmCommand(["surface", "add"]),
			intent: "surface:declare",
			primary: true,
		});
	} else if (gated > 0 && credentialCount === 0) {
		actions.push({
			id: "enroll-device",
			label: "Enroll a device for the declared gate",
			command: refarmCommand(["auth", "enroll", "<device-label>"]),
			intent: "auth:enroll-device",
			primary: true,
		});
	}

	const ready = names.length > 0 && (gated === 0 || credentialCount > 0);
	return {
		id: "device-access",
		label: "Device access",
		owner: "apps/refarm",
		state: ready ? "ready" : "degraded",
		severity: ready ? "info" : "warning",
		summary:
			names.length === 0
				? "No device surface is declared yet."
				: ready
					? `${names.length} surface(s) declared; ${credentialCount} device identity(ies) enrolled.`
					: "A credential-gated surface exists, but no device identity is enrolled.",
		evidence: [
			{ kind: "count", label: "surfaces", value: String(names.length) },
			{ kind: "state", label: "declared", value: names.join(", ") || "none" },
			{ kind: "count", label: "enrolled devices", value: String(credentialCount) },
		],
		actions,
		details: { surfaces: names, gatedSurfaces: gated, enrolledDevices: credentialCount },
	};
}

function buildSupervisionUnit(
	processes: ReturnType<typeof parseProcessCatalog>,
	statuses: ProcessStatus[],
): BaseSurfaceUnit {
	const names = [...processes.keys()];
	const running = statuses.filter((status) => status.state === "running").length;
	const ready = names.length > 0 && running === names.length;
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
				: ready
					? `${running}/${names.length} declared process(es) are running.`
					: `${running}/${names.length} declared process(es) are known to be running.`,
		evidence: [
			{ kind: "count", label: "declared processes", value: String(names.length) },
			{ kind: "state", label: "declared", value: names.join(", ") || "none" },
			{ kind: "count", label: "running", value: String(running) },
		],
		actions,
		details: { processes: names, statuses },
	};
}
