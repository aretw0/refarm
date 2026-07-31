import {
	ProcessDeclarationError,
	type ProcessDeclaration,
	type RestartPolicy,
} from "@refarm.dev/process-contract-v1";

/**
 * A declared process, rendered as a `systemd --user` unit.
 *
 * PURE, and deliberately so: the exact bytes that will land on the operator's machine are a total
 * function of the declaration, which is what lets the consent request SHOW them before anything is
 * written and lets a test assert on them without a systemd anywhere.
 */

/** Every unit refarm writes carries this prefix, so `systemctl --user list-units 'refarm-*'` works
 *  and so a unit refarm did not write is never mistaken for one it did. */
export const UNIT_PREFIX = "refarm-";

/** The unit's filename for a declared process name. */
export function systemdUnitName(processName: string): string {
	return `${UNIT_PREFIX}${processName}.service`;
}

/**
 * Where a user unit lives.
 *
 * `XDG_CONFIG_HOME` first — not as a nicety but because it is what makes this testable at all: a
 * throwaway `XDG_CONFIG_HOME` is how a unit gets generated and inspected without ever touching the
 * operator's real `~/.config/systemd/user`.
 */
export function systemdUserUnitDir(env: NodeJS.ProcessEnv = process.env): string {
	const configHome = env.XDG_CONFIG_HOME?.trim();
	if (configHome) return `${configHome.replace(/\/+$/, "")}/systemd/user`;
	const home = env.HOME?.trim();
	if (!home) {
		throw new ProcessDeclarationError(
			"systemd-user: neither XDG_CONFIG_HOME nor HOME is set, so there is no user unit directory " +
				"to write to. Set HOME, or pass an explicit directory.",
		);
	}
	return `${home.replace(/\/+$/, "")}/.config/systemd/user`;
}

export function systemdUnitPath(
	processName: string,
	env: NodeJS.ProcessEnv = process.env,
	dir?: string,
): string {
	const base = dir ?? systemdUserUnitDir(env);
	return `${base.replace(/\/+$/, "")}/${systemdUnitName(processName)}`;
}

/** systemd's own vocabulary for the declared policy. `never` is spelled `no`. */
export function systemdRestartValue(policy: RestartPolicy): string {
	switch (policy) {
		case "always":
			return "always";
		case "on-failure":
			return "on-failure";
		case "never":
			return "no";
	}
}

/**
 * Escape one value for a unit file.
 *
 * `%` is the one that bites: systemd expands `%h`, `%i`, `%n` and friends anywhere in a unit value,
 * so an unescaped `%` in a path or an argument silently becomes something else. Doubling it is the
 * documented literal.
 */
function escapeUnitValue(value: string): string {
	return value.replaceAll("%", "%%");
}

/**
 * Quote one ExecStart argument.
 *
 * systemd splits ExecStart on whitespace and understands `"…"` with C-style escapes inside, so an
 * argument holding a space, a quote or a backslash is wrapped and escaped. An argument that holds
 * none of those is left bare, because a unit an operator can read is a unit an operator can check.
 */
export function quoteExecArgument(argument: string): string {
	const escaped = escapeUnitValue(argument);
	if (!/[\s"'\\]/.test(argument)) return escaped;
	return `"${escaped.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * systemd requires an ABSOLUTE ExecStart. A relative one is not a warning, it is a unit that fails
 * to load — so it is refused here, while the operator is looking at the declaration, with the
 * command that produces the right answer.
 */
export function refuseRelativeExecutable(declaration: ProcessDeclaration): void {
	const executable = declaration.command[0] ?? "";
	if (!executable.startsWith("/")) {
		throw new ProcessDeclarationError(
			`processes."${declaration.name}": command[0] must be an ABSOLUTE path for a systemd unit ` +
				`(got "${executable}") — systemd does not search PATH. \`command -v ${executable}\` prints ` +
				`the path to put here.`,
		);
	}
}

export interface RenderUnitOptions {
	/** What wrote it, named in the header so the file explains itself a year later. */
	generator?: string;
	/** The command that rewrites this file, printed in the "do not edit" header. */
	rewriteCommand?: string;
}

/**
 * The unit, exactly.
 *
 * Two things in here are the whole reason W1 says the act is worth borrowing:
 *
 *  - `Restart=` + `RestartSec=` + `StartLimit*` — supervision policy refarm would otherwise have to
 *    write itself, including the anti-hot-loop cooldown `packages/tractor/src/respawn.rs` already
 *    argues for on the plugin side.
 *  - `TimeoutStopSec=` — ORDERED TERMINATION, which refarm gets here for free and does not have
 *    today. Neither the runtime nor `refarm web serve` handles `SIGTERM`; systemd asks anyway,
 *    waits this long, then kills. Teaching those two processes to handle the signal is a real
 *    improvement and a SEPARATE one: it makes the wait productive rather than making it exist.
 */
export function renderSystemdUnit(
	declaration: ProcessDeclaration,
	options: RenderUnitOptions = {},
): string {
	refuseRelativeExecutable(declaration);
	const generator = options.generator ?? "refarm";
	const rewrite = options.rewriteCommand ?? `refarm process install ${declaration.name}`;

	const lines: string[] = [
		`# Generated by ${generator} from the "processes" declaration in .refarm/config.json.`,
		`# Process: ${declaration.name}`,
		`# Do not edit by hand — \`${rewrite}\` rewrites this file.`,
		"",
		"[Unit]",
		`Description=refarm: ${escapeUnitValue(declaration.description)}`,
		"# Anti-hot-loop: stop trying after 5 starts in 60s rather than spinning forever.",
		"StartLimitIntervalSec=60",
		"StartLimitBurst=5",
		"",
		"[Service]",
		"Type=simple",
	];

	if (declaration.workingDirectory) {
		lines.push(`WorkingDirectory=${escapeUnitValue(declaration.workingDirectory)}`);
	}
	for (const [key, value] of Object.entries(declaration.environment)) {
		lines.push(`Environment="${escapeUnitValue(`${key}=${value}`).replaceAll('"', '\\"')}"`);
	}

	lines.push(`ExecStart=${declaration.command.map(quoteExecArgument).join(" ")}`);
	lines.push(`Restart=${systemdRestartValue(declaration.restart)}`);
	lines.push(`RestartSec=${declaration.restartDelaySeconds}`);
	lines.push(
		"# Ordered termination comes from the supervisor, not from the process: refarm's processes",
		"# handle no SIGTERM today, so systemd asks, waits this long, then kills.",
		`TimeoutStopSec=${declaration.stopTimeoutSeconds}`,
		"KillMode=mixed",
		"",
		"[Install]",
		"WantedBy=default.target",
		"",
	);
	return lines.join("\n");
}
