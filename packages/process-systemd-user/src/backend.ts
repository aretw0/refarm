import type { OperationFileChange, OperationRequest } from "@refarm.dev/operation-consent-v1";
import {
	processCouldNotAsk,
	processNotRunning,
	processRunning,
	type ProcessDeclaration,
	type ProcessStatus,
	type SupervisionBackend,
	type SupervisionReadiness,
} from "@refarm.dev/process-contract-v1";

import {
	describeUnitLifetime,
	PROCESS_UNIT_OPERATION_KIND,
	readLingerState,
	refuseBundledLinger,
	type LingerState,
} from "./linger.js";
import type { CommandRunner } from "./runner.js";
import {
	isPeriodic,
	renderSystemdTimer,
	renderSystemdUnit,
	systemdTimerName,
	systemdTimerPath,
	systemdUnitName,
	systemdUnitPath,
} from "./unit.js";

export const SYSTEMD_USER_BACKEND_ID = "systemd-user";

/** The operation a systemd install IS: the files, plus the commands only the operator runs. */
export interface SystemdUnitPlan {
	unitName: string;
	unitPath: string;
	unitText: string;
	existingUnit: string | null;
	/**
	 * The timer, for a periodic declaration — `null` for a long-running one.
	 *
	 * SURFACED SEPARATELY BECAUSE CONSENT IS ABOUT WHAT LANDS ON DISK. `request.changes` already
	 * carried both files, but the plan exposed only `unitText`, so every caller rendering "here is
	 * the unit" showed ONE of the two files it was about to write. A consent surface that displays
	 * half of an operation is not a consent surface; it is a formality with a diff attached.
	 */
	timerName: string | null;
	timerPath: string | null;
	timerText: string | null;
	existingTimer: string | null;
	/** What the operator will actually enable — the timer when there is one, else the service. */
	activationUnit: string;
	linger: LingerState;
	lifetime: string;
	request: OperationRequest;
	/**
	 * What the operator runs AFTERWARDS, by hand.
	 *
	 * refarm writes the file and stops there. `systemctl --user enable --now` starts a process in
	 * the operator's live session, and this slice deliberately does not reach into it — the same
	 * boundary `refarm cert trust` draws when it writes the anchor and then says "falta rodar
	 * update-ca-certificates".
	 */
	activationCommands: string[];
}

export interface SystemdUserBackendOptions {
	runner: CommandRunner;
	/** The session user, for lingering and for the honest lifetime statement. */
	user: string;
	env?: NodeJS.ProcessEnv;
	/** Override the unit directory. A throwaway one is how units are generated and inspected in tests. */
	unitDir?: string;
	/** Reads an existing unit so the consent request can show a real before/after. */
	readFile: (path: string) => Promise<string | null>;
	/**
	 * The operator-facing binary name, threaded in rather than spelled here (ADR-087: a generic
	 * package never names the brand — a white-label build supplies it). REQUIRED and undefaulted,
	 * the same shape `buildCapabilities(binary)` uses in `@refarm.dev/cli`: a default would put
	 * the brand back in this package and read as correct forever.
	 */
	binary: string;
	requester?: string;
	now?: () => string;
}

/** Parse `systemctl show --property=…` output into a plain map. */
function parseShowProperties(stdout: string): Record<string, string> {
	const properties: Record<string, string> = {};
	for (const line of stdout.split("\n")) {
		const index = line.indexOf("=");
		if (index <= 0) continue;
		properties[line.slice(0, index)] = line.slice(index + 1).trim();
	}
	return properties;
}

/**
 * The systemd-user supervision backend — W1's borrowed act.
 *
 * It NEVER starts, stops or enables anything. It reads state, it renders a unit, and it builds the
 * request that proposes writing that unit. Every act that changes the operator's machine leaves
 * this object either through the consent journey (the file) or through the operator's own hands
 * (the `systemctl` verbs).
 */
export function createSystemdUserBackend(
	options: SystemdUserBackendOptions,
): SupervisionBackend<SystemdUnitPlan> {
	const { runner, user } = options;
	const env = options.env ?? process.env;
	const requester = options.requester ?? `${options.binary} process install`;

	async function lingerState(): Promise<{ state: LingerState; detail: string }> {
		return readLingerState(runner, user);
	}

	return {
		id: SYSTEMD_USER_BACKEND_ID,
		title: "systemd --user (the supervisor this host already runs)",

		/**
		 * Is there a user bus to talk to?
		 *
		 * `show-environment` is the cheap probe that needs the BUS, not merely the binary: a host with
		 * `systemctl` on PATH but no user instance (a container, a bare `ssh` with no
		 * `XDG_RUNTIME_DIR`) would otherwise look ready and fail at the moment of use.
		 */
		async preflight(): Promise<SupervisionReadiness> {
			const result = await runner.run("systemctl", ["--user", "show-environment"]);
			if (!result.spawned) {
				return {
					ready: false,
					detail: "systemctl is not on PATH — this host does not run systemd",
					fix:
						"Nothing to fix here if this is Termux or macOS: systemd is simply not the supervisor " +
						"on this host, and a backend for the real one is what belongs here.",
				};
			}
			if (result.code !== 0) {
				return {
					ready: false,
					detail: `systemctl --user could not reach a user bus (exit ${result.code}: ${result.stderr.trim().split("\n")[0] ?? ""})`,
					fix:
						"A user instance needs a session: log in on this host (or `machinectl shell`), and make " +
						"sure XDG_RUNTIME_DIR and DBUS_SESSION_BUS_ADDRESS are set.",
				};
			}
			return { ready: true, detail: "systemd --user is running and reachable" };
		},

		/** W3, answered from the machine rather than from a hopeful sentence. */
		async describeLifetime(): Promise<string> {
			const { state } = await lingerState();
			return describeUnitLifetime(state, user, options.binary);
		},

		/**
		 * The three-way answer, from one read-only probe.
		 *
		 * `LoadState=not-found` is "declared, never installed" — a real verdict, not an unknown. A
		 * probe that could not run at all, or whose output cannot be read, is `could-not-ask`, because
		 * refarm genuinely does not know and the operator needs to know that it does not.
		 */
		async status(declaration: ProcessDeclaration): Promise<ProcessStatus> {
			const unit = systemdUnitName(declaration.name);
			const result = await runner.run("systemctl", [
				"--user",
				"show",
				unit,
				"--property=LoadState",
				"--property=ActiveState",
				"--property=SubState",
			]);
			if (!result.spawned) {
				return processCouldNotAsk(
					declaration.name,
					`systemctl is not on this host, so nothing could be asked about ${unit}`,
				);
			}
			const properties = parseShowProperties(result.stdout);
			const load = properties.LoadState;
			const active = properties.ActiveState;
			if (!load || !active) {
				return processCouldNotAsk(
					declaration.name,
					`systemctl --user did not answer for ${unit} (exit ${result.code}: ${result.stderr.trim().split("\n")[0] ?? "no output"})`,
					SYSTEMD_USER_BACKEND_ID,
				);
			}
			if (load === "not-found") {
				return processNotRunning(
					declaration.name,
					SYSTEMD_USER_BACKEND_ID,
					`declared, but no ${unit} is installed — \`${options.binary} process install ${declaration.name}\` writes it`,
					false,
				);
			}
			if (active === "active") {
				return processRunning(
					declaration.name,
					SYSTEMD_USER_BACKEND_ID,
					`${unit} is ${active} (${properties.SubState ?? "running"})`,
				);
			}
			return processNotRunning(
				declaration.name,
				SYSTEMD_USER_BACKEND_ID,
				`${unit} is ${active}${properties.SubState ? ` (${properties.SubState})` : ""}`,
			);
		},

		/**
		 * PROPOSE the unit. Nothing is written here — `plan` returns the request, and the caller runs
		 * the consent journey with it (W2).
		 */
		async plan(declaration: ProcessDeclaration): Promise<SystemdUnitPlan> {
			const unitName = systemdUnitName(declaration.name);
			const unitPath = systemdUnitPath(declaration.name, env, options.unitDir);
			const unitText = renderSystemdUnit(declaration, {
				generator: options.binary,
				rewriteCommand: `${options.binary} process install ${declaration.name}`,
			});
			const existingUnit = await options.readFile(unitPath);
			const { state, detail } = await lingerState();
			const lifetime = describeUnitLifetime(state, user, options.binary);
			const unitChanged = existingUnit !== null && existingUnit !== unitText;

			// A PERIODIC declaration is TWO files, and the one that gets enabled is the TIMER.
			// Enabling the service instead runs it once at boot and never again — which looks
			// exactly like a working install right up until the second interval does not arrive.
			const periodic = isPeriodic(declaration);
			const timerName = systemdTimerName(declaration.name);
			const timerPath = systemdTimerPath(declaration.name, env, options.unitDir);
			const timerText = periodic
				? renderSystemdTimer(declaration, {
						generator: options.binary,
						rewriteCommand: `${options.binary} process install ${declaration.name}`,
					})
				: null;
			const existingTimer = periodic ? await options.readFile(timerPath) : null;

			const activationTarget = periodic ? timerName : unitName;
			const changed =
				unitChanged || (timerText !== null && existingTimer !== null && existingTimer !== timerText);
			const activationCommands = changed
				? [
						"systemctl --user daemon-reload",
						`systemctl --user enable ${activationTarget}`,
						`systemctl --user restart ${activationTarget}`,
					]
				: [
						"systemctl --user daemon-reload",
						`systemctl --user enable --now ${activationTarget}`,
					];

			const change: OperationFileChange = {
				path: unitPath,
				before: existingUnit,
				after: unitText,
				insertion: {
					line: 1,
					text: unitText.trimEnd(),
					placement: "o arquivo inteiro É a unit — isto é exatamente o que vai para o disco",
				},
			};

			const request: OperationRequest = {
				id: `${PROCESS_UNIT_OPERATION_KIND}:${SYSTEMD_USER_BACKEND_ID}:${declaration.name}`,
				kind: PROCESS_UNIT_OPERATION_KIND,
				title: `Instalar a unit ${unitName} para o processo declarado "${declaration.name}"`,
				purpose:
					`Para que "${declaration.name}" seja SUPERVISIONADO — reiniciado quando cai, parado em ` +
					`ordem quando você pede — em vez de rodar solto num shell que ninguém observa.`,
				requester,
				requestedAt: options.now?.() ?? new Date().toISOString(),
				changes:
					timerText === null
						? [change]
						: [
								change,
								{
									path: timerPath,
									before: existingTimer,
									after: timerText,
									insertion: {
										line: 1,
										text: timerText.trimEnd(),
										placement:
											"o arquivo inteiro É o timer — é ele que roda o serviço acima no relógio",
									},
								},
							],
				undo: {
					kind: "restore-snapshot",
					summary:
						existingUnit === null
							? `apaga ${unitPath}. Se você já tiver habilitado a unit, rode antes \`systemctl --user disable --now ${unitName}\`.`
							: `restaura ${unitPath} exatamente como estava antes desta operação.`,
				},
				notes: [
					lifetime,
					`Estado medido agora: ${detail}.`,
					`O QUE A UNIT FAZ: Restart=${declaration.restart}, espera ${declaration.stopTimeoutSeconds}s ` +
						`ao parar antes de matar, e espera ${declaration.restartDelaySeconds}s entre tentativas.`,
					`ESTE COMANDO SÓ ESCREVE O ARQUIVO. Quem liga é você: ${activationCommands.join(" && ")}.`,
				],
			};

			// The rule, at the moment it could be broken: a unit installation carries the unit and
			// nothing else. Checked here rather than only at the call site, so the request that leaves
			// this function is already known not to bundle.
			refuseBundledLinger(request, options.binary);

			return {
				unitName,
				unitPath,
				unitText,
				existingUnit,
				timerName: periodic ? timerName : null,
				timerPath: periodic ? timerPath : null,
				timerText,
				existingTimer,
				activationUnit: activationTarget,
				linger: state,
				lifetime,
				request,
				activationCommands,
			};
		},
	};
}
