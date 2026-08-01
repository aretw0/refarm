import { loadRawSovereignConfig } from "@refarm.dev/config";
import type { BaseSurfaceUnit } from "@refarm.dev/operator-state";
import { parseProcessCatalog } from "@refarm.dev/process-contract-v1";
import { parseSurfaces } from "@refarm.dev/std";
import path from "node:path";
import { refarmCommand } from "../brand.js";
import { readPolicy } from "./auth-policy-file.js";

export interface OperationalReadinessDeps {
	root?: string;
	config?: unknown;
	credentialCount?: number;
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

	return [
		buildDeviceAccessUnit(surfaces, credentialCount),
		buildSupervisionUnit(processes),
	];
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
): BaseSurfaceUnit {
	const names = [...processes.keys()];
	const ready = names.length > 0;
	return {
		id: "supervision",
		label: "Supervision",
		owner: "apps/refarm",
		state: ready ? "ready" : "degraded",
		severity: ready ? "info" : "warning",
		summary: ready
			? `${names.length} long-running process(es) declared for host supervision.`
			: "No long-running process is declared for host supervision.",
		evidence: [
			{ kind: "count", label: "declared processes", value: String(names.length) },
			{ kind: "state", label: "declared", value: names.join(", ") || "none" },
		],
		actions: ready
			? []
			: [
					{
						id: "declare-web-supervision",
						label: "Declare the web server for supervision",
						command: refarmCommand(["process", "add", "web-serve"]),
						intent: "process:declare",
						primary: true,
					},
				],
		details: { processes: names },
	};
}
