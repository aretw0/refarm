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

/**
 * Every unit this backend writes carries this prefix, so `systemctl --user list-units 'refarm-*'`
 * works and so a unit it did not write is never mistaken for one it did.
 *
 * A VALUE, NOT A LABEL, and that is why it stays a literal while the advice strings around it were
 * parameterized (ADR-087 phase 3, ISS-114). This string is written to the operator's disk as
 * `refarm-<name>.service` and is how every ALREADY-INSTALLED unit is found again. Threading a
 * binary name into it would rename units that exist, orphaning them from the tooling that
 * installed them — the rename would not debrand anything, it would lose track of running
 * processes. The brand guard's own allowlist exists for exactly this shape, and this is the
 * distinction that decides the rest of the inventory: a string PRINTED to the operator is a label
 * and takes the binary; a string WRITTEN to disk or matched against what is already there is a
 * value and does not.
 */
export const UNIT_PREFIX = "refarm-";

/** The unit's filename for a declared process name. */
export function systemdUnitName(processName: string): string {
	return `${UNIT_PREFIX}${processName}.service`;
}

/** The timer's filename. Same stem as the service, which is how systemd pairs them by default. */
export function systemdTimerName(processName: string): string {
	return `${UNIT_PREFIX}${processName}.timer`;
}

export function systemdTimerPath(
	processName: string,
	env: NodeJS.ProcessEnv = process.env,
	dir?: string,
): string {
	const base = dir ?? systemdUserUnitDir(env);
	return `${base.replace(/\/+$/, "")}/${systemdTimerName(processName)}`;
}

/** Whether this declaration runs on a clock rather than staying up. */
export function isPeriodic(declaration: ProcessDeclaration): boolean {
	return typeof declaration.everySeconds === "number";
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
	// The PARAMETERS already existed; only their defaults spelled the brand (ADR-087, ISS-114).
	// These two strings become COMMENTS inside the generated unit — a human reads them to find out
	// what wrote the file and what rewrites it — so they are labels and take the caller's binary.
	// The unit's identity is `UNIT_PREFIX`, which is a value and stays literal; see its doc.
	//
	// The fallbacks are brand-free rather than clever: a caller that supplies nothing gets a
	// truthful comment that names no tool, instead of naming the wrong one.
	const generator = options.generator ?? "the process supervisor";
	const rewrite = options.rewriteCommand ?? "re-running the installer";

	const periodic = isPeriodic(declaration);
	const lines: string[] = [
		`# Generated by ${generator} from the "processes" declaration in .refarm/config.json.`,
		`# Process: ${declaration.name}${periodic ? ` (run by ${systemdTimerName(declaration.name)})` : ""}`,
		`# Do not edit by hand — \`${rewrite}\` rewrites this file.`,
		"",
		"[Unit]",
		`Description=refarm: ${escapeUnitValue(declaration.description)}`,
		"# Anti-hot-loop: stop trying after 5 starts in 60s rather than spinning forever.",
		"StartLimitIntervalSec=60",
		"StartLimitBurst=5",
		"",
		"[Service]",
		// `oneshot` is what makes the timer's own accounting correct: systemd considers the run
		// finished when the process exits, so `OnUnitActiveSec` measures from a real completion
		// rather than from a launch.
		periodic ? "Type=oneshot" : "Type=simple",
	];

	if (declaration.workingDirectory) {
		lines.push(`WorkingDirectory=${escapeUnitValue(declaration.workingDirectory)}`);
	}
	for (const [key, value] of Object.entries(declaration.environment)) {
		lines.push(`Environment="${escapeUnitValue(`${key}=${value}`).replaceAll('"', '\\"')}"`);
	}

	lines.push(`ExecStart=${declaration.command.map(quoteExecArgument).join(" ")}`);
	if (periodic) {
		// `Restart=always` on a `Type=oneshot` is REFUSED BY SYSTEMD, not merely odd — and the
		// contract refuses the combination one layer earlier, where the operator is still looking
		// at the declaration. `on-failure` remains meaningful: retry a run that failed.
		if (declaration.restart !== "never") {
			lines.push(`Restart=${systemdRestartValue(declaration.restart)}`);
			lines.push(`RestartSec=${declaration.restartDelaySeconds}`);
		}
		lines.push(
			`TimeoutStopSec=${declaration.stopTimeoutSeconds}`,
			"",
			// NO [Install] SECTION. The TIMER is what gets enabled; a periodic service enabled on
			// its own would run once at boot and never again, which looks like it worked.
		);
		return lines.join("\n");
	}
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

/**
 * The timer that drives a periodic declaration.
 *
 * THREE LINES IN HERE ARE DECISIONS, not boilerplate:
 *
 *  - `Persistent=false` — a window missed while the node was off is SKIPPED, not caught up. This
 *    is spec D5, and systemd's default is the opposite of what a careless reading would install:
 *    `Persistent=true` fires immediately at boot for every window that passed, so a week offline
 *    becomes a week of backlog at once. For every customer this timer has, a late run has no
 *    value — a rate check wants the current page, a tick wants now.
 *  - `AccuracySec=1s` — systemd's default accuracy is ONE MINUTE, which it spends freely to batch
 *    wakeups. On a minutely timer that is enough to land two runs in the same minute and skip the
 *    next one entirely, and the automation evaluator decides due-ness AT MINUTE RESOLUTION with a
 *    fire key to match. A skipped minute is a skipped automation that nothing reports.
 *  - `OnBootSec` beside `OnUnitActiveSec` — the second alone never fires the first time, because
 *    there is no previous activation to measure from.
 */
export function renderSystemdTimer(
	declaration: ProcessDeclaration,
	options: RenderUnitOptions = {},
): string {
	const everySeconds = declaration.everySeconds;
	if (everySeconds === undefined) {
		throw new ProcessDeclarationError(
			`processes."${declaration.name}": a timer needs "everySeconds"; this declaration is a ` +
				"long-running process, which is supervised by its service unit alone.",
		);
	}
	const generator = options.generator ?? "the process supervisor";
	const rewrite = options.rewriteCommand ?? "re-running the installer";
	return [
		`# Generated by ${generator} from the "processes" declaration in .refarm/config.json.`,
		`# Process: ${declaration.name} (every ${everySeconds}s)`,
		`# Do not edit by hand — \`${rewrite}\` rewrites this file.`,
		"",
		"[Unit]",
		`Description=refarm: ${escapeUnitValue(declaration.description)} (every ${everySeconds}s)`,
		"",
		"[Timer]",
		`Unit=${systemdUnitName(declaration.name)}`,
		`OnBootSec=${everySeconds}s`,
		`OnUnitActiveSec=${everySeconds}s`,
		"# systemd spends up to a MINUTE of slack by default to batch wakeups, which is enough to",
		"# skip a whole minute on a minutely timer. Due-ness is decided at minute resolution.",
		"AccuracySec=1s",
		"# A window missed while this node was off is SKIPPED, not caught up: a week offline must",
		"# not produce a week of backlog at boot, and a late run has no value for any customer here.",
		"Persistent=false",
		"",
		"[Install]",
		"WantedBy=timers.target",
		"",
	].join("\n");
}
