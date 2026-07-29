// `refarm connection status` — the operator's answer to "is it up?" for a declared,
// long-lived, shared connection (a VPN client holding a tunnel, a logged-in session).
//
// This exists for a specific failure: the operator's VPN dropped while they were away
// from their phone, a supervisor burned approval pushes at an absent human, and the
// tunnel sat down with nothing saying so. The fix is a probe the operator can run
// ANY time, with NO plugin and NO running host registry — it asks the system directly,
// the same way `connection_engine.rs`'s `run_probe` does on the host, but from the CLI.
//
// Never conflate "the probe ran and said no" (down) with "the probe could not run at
// all" (unknown) — see `ConnectionReport.state` below. The two lead the operator to
// different next actions: fix the tunnel, or fix the setup that is supposed to check it.

import {
	buildJsonErrorEnvelope,
	buildJsonSuccessEnvelope,
	printJson,
} from "@refarm.dev/capabilities/envelope";
import {
	createProcessHandoffDisplay,
	runProcessHandoff,
	type ProcessHandoffRunResult,
} from "@refarm.dev/cli/process-handoff";
import { loadConfig } from "@refarm.dev/config";
import chalk from "chalk";
import { Command } from "commander";
import {
	readConnectionCatalog,
	resolveBinary,
	type CatalogIssue,
	type DeclaredConnection,
} from "./connection-catalog.js";

/**
 * Mirrors `PROBE_TIMEOUT_MS` in `connection_engine.rs`: a health check that hangs must
 * not stall the operator's terminal — the probe's own timeout is what fails it shut.
 */
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/**
 * What a probe attempt concluded. NOT a boolean: the third case is the whole point.
 *
 * `up`      — the probe ran and said yes.
 * `down`    — the probe ran and said no.
 * `unknown` — the probe could not be RUN. The operator's fix is the setup (a missing
 *             binary, a `cwd` that does not exist, a permissions error), not the tunnel.
 *
 * Collapsing `unknown` into `down` is the failure this file's header forbids: a typo in
 * `cwd` would paint every connection red and send the operator to re-establish a tunnel
 * that was never down.
 */
export interface ProbeResult {
	outcome: "up" | "down" | "unknown";
	detail?: string;
}

export interface ConnectionReport {
	name: string;
	/** The argv that brings the connection up — reported so the operator can see what
	 * WOULD run, even when this surface never runs it itself. */
	establish: string[];
	/** Resolved `establish[0]`, or `null` when it does not resolve on PATH/as a path.
	 * Informational only — a missing establish binary does not block probing, since
	 * probing asks whether the connection is ALREADY up, which is independent of
	 * whether it could be brought up right now. */
	establishBinary: string | null;
	/** Resolved `probe.run[0]`, or `null` when the probe could not even be attempted. */
	probeBinary: string | null;
	/**
	 * `up` — the probe ran and succeeded.
	 * `down` — the probe ran and reported the connection is not up.
	 * `unknown` — the probe could not run at all: its binary does not resolve, or the
	 * declaration itself has an issue that makes the probe unrunnable (missing `probe`,
	 * an empty `probe.run`, a shell-like `probe.run[0]`, or an undeclared `probe.shell`
	 * grant). `unknown` must never be reported as `down` — "I asked and it said no" and
	 * "I could not ask" send the operator to different fixes.
	 */
	state: "up" | "down" | "unknown";
	/** Why the state is not `up`. Absent for `up` (nothing to explain). */
	detail?: string;
	/** Catalog issues for this connection specifically — a broken declaration is still
	 * reported here, never dropped from the list. */
	issues: CatalogIssue[];
}

/**
 * Catalog issue fields that make the probe unrunnable ON THE HOST — as opposed to, say, a
 * `linger` or `establish` issue, which does not prevent asking whether the connection is
 * up right now. A declaration flagged this way must not be probed even when its
 * `probe.run[0]` happens to resolve on PATH.
 *
 * Two distinct reasons land in this set:
 *   - `probe`, `probe.run`, `probe.shell`: the probe argv itself is refused. E.g.
 *     `probe.run: ["sh", "-c", "..."]` resolves `sh` fine, but the catalog reader already
 *     refused it as a shell escape, and probing it anyway would run exactly the shell
 *     invocation the catalog reader exists to prevent.
 *   - `env`, `cwd`: the host's SPAWN-TIME guards (`enforce_spawn_env`,
 *     `enforce_spawn_cwd`) reject these BEFORE the process exists, and `run_probe`
 *     swallows that error into `false`. So the host's probe can never run for such a
 *     declaration. This CLI spawns through Node, which has no such guards — it would
 *     spawn happily and report `up` for something the engine reports `down` for. That is
 *     the lie running the dangerous way, so these become `unknown` here: the honest
 *     answer is "I could not ask", and the fix is the declaration, not the tunnel.
 */
const BLOCKING_PROBE_ISSUE_FIELDS = new Set(["probe", "probe.run", "probe.shell", "env", "cwd"]);

function findBlockingProbeIssue(issues: CatalogIssue[]): CatalogIssue | undefined {
	return issues.find((issue) => BLOCKING_PROBE_ISSUE_FIELDS.has(issue.field));
}

/** The connection status report: per-connection results plus any catalog-level issue —
 * one attached to the `connections` block as a whole (a malformed block, an over-cap
 * declaration count) rather than to any single named connection (Task 1's
 * `readConnectionCatalog` tags these with the sentinel connection name `"(connections)"`).
 * A catalog-level issue is never dropped just because it has no connection to attach
 * to — this surface exists to show the operator reality, and a silently-missing issue
 * is a wrong default for that purpose. */
export interface ConnectionStatusReport {
	connections: ConnectionReport[];
	catalogIssues: CatalogIssue[];
}

/**
 * Build the connection status report. The probe runner is INJECTED so this function is
 * hermetic — every test drives it with a literal `runProbe`, no process is ever spawned
 * here. `runProbeProcess` below is the real adapter used by the command.
 */
export async function reportConnections(deps: {
	config: Record<string, unknown>;
	runProbe: (connection: DeclaredConnection) => Promise<ProbeResult>;
}): Promise<ConnectionStatusReport> {
	const { connections, issues } = readConnectionCatalog(deps.config);
	const reports: ConnectionReport[] = [];

	for (const connection of connections) {
		const connectionIssues = issues.filter((issue) => issue.connection === connection.name);
		const establishBinary =
			connection.establish.length > 0 ? resolveBinary(connection.establish[0]!) : null;
		const probeBinary =
			connection.probe.run.length > 0 ? resolveBinary(connection.probe.run[0]!) : null;
		const blockingIssue = findBlockingProbeIssue(connectionIssues);

		if (probeBinary === null || blockingIssue) {
			const detail = blockingIssue
				? `probe declaration is unrunnable: ${blockingIssue.message}`
				: connection.probe.run.length === 0
					? "no probe command declared — cannot ask the system"
					: `probe binary not found: ${connection.probe.run[0]}`;
			reports.push({
				name: connection.name,
				establish: connection.establish,
				establishBinary,
				probeBinary: blockingIssue ? null : probeBinary,
				state: "unknown",
				detail,
				issues: connectionIssues,
			});
			continue;
		}

		// The runner's three-state outcome maps STRAIGHT through — no boolean in between.
		// Any collapse here would re-create the conflation this file's header forbids.
		const result = await deps.runProbe(connection);
		reports.push({
			name: connection.name,
			establish: connection.establish,
			establishBinary,
			probeBinary,
			state: result.outcome,
			...(result.detail !== undefined ? { detail: result.detail } : {}),
			issues: connectionIssues,
		});
	}

	// Any issue not attributable to a specific reported connection is catalog-level —
	// this is deliberately a structural check (not a hardcoded match on Task 1's private
	// `"(connections)"` sentinel) so it also catches any future catalog-wide issue kind
	// without this file needing to know its exact name.
	const reportedNames = new Set(reports.map((report) => report.name));
	const catalogIssues = issues.filter((issue) => !reportedNames.has(issue.connection));

	return { connections: reports, catalogIssues };
}

/**
 * Turn a boundary result into the probe's three-state verdict — exactly like the host's
 * `run_probe`: success is exit code 0 AND, when `probe.expect` is declared, the pattern
 * matching the COMBINED stdout+stderr. A missing interface exits non-zero (down via exit
 * code); an existing-but-down one can still exit zero while printing e.g. "DOWN" (down
 * via the unmatched `expect`). Both halves matter — checking only the exit code would
 * report that second case as `up`.
 *
 * Which outcome each result shape takes, and why:
 *   - `result.spawnError` set -> `unknown`. The spawn never happened (a nonexistent
 *     `cwd`, EACCES, the binary vanishing between resolution and spawn) — nothing was
 *     asked, so nothing can be concluded about the tunnel. The operator's fix is the
 *     setup, not a re-establish.
 *   - `result.timedOut` -> `down`, deliberately. The host agrees: `run_probe` treats
 *     `timed_out` exactly like a non-zero exit and returns `false`. A health check that
 *     hangs is not a healthy connection, and reporting `unknown` here would diverge from
 *     the engine on a case the engine has already decided.
 *   - non-zero exit, or `expect` declared and unmatched -> `down` (the probe RAN and
 *     answered no).
 *   - exit 0 (and `expect` matches, when declared) -> `up`.
 */
function interpretProbeResult(
	result: ProcessHandoffRunResult,
	expect: string | undefined,
	timeoutMs: number,
): ProbeResult {
	if (result.spawnError) {
		return { outcome: "unknown", detail: `probe could not be started: ${result.spawnError.message}` };
	}
	if (result.timedOut) {
		return { outcome: "down", detail: `probe timed out after ${timeoutMs}ms` };
	}
	if (result.exitCode !== 0) {
		return { outcome: "down", detail: `probe exited with code ${result.exitCode}` };
	}
	if (!expect) {
		return { outcome: "up" };
	}
	const combined = (result.stdout ?? "") + (result.stderr ?? "");
	let matches = false;
	try {
		matches = new RegExp(expect).test(combined);
	} catch {
		// An uncompilable `expect` should already have been dropped by the catalog reader
		// (`readOptionalPatternField`), so this is unreachable in practice — but never
		// throw out of a probe over a defensive fallback either way.
		matches = false;
	}
	return matches
		? { outcome: "up" }
		: { outcome: "down", detail: `probe output did not match expected pattern /${expect}/` };
}

/**
 * The real probe adapter — a thin caller of the `@refarm.dev/process-handoff` boundary
 * (`runProcessHandoff`), which now carries every guarantee this probe needs: a timeout, a
 * 1 MiB-per-stream output cap with the host's own truncation marker, environment
 * isolation, process-group kill on timeout, and spawn failure surfaced as a result
 * instead of a thrown error. See `docs/superpowers/specs/2026-07-29-process-administration-
 * layer-design.md` (decision P1) — these were implemented here first and have moved down
 * a layer so `commands/workspace.ts` and any future caller get them too, without
 * `apps/refarm/src` importing `node:child_process` directly (the architecture test in
 * `test/architecture/process-boundary.test.ts` forbids it).
 *
 * `probe.run` is spawned as structured argv — NEVER a shell. The child gets ONLY the
 * declared `env` (`isolatedEnv: true`) — nothing inherited from this process. This
 * mirrors the host exactly: `run_probe` -> `spawn_process` in
 * `host_effects_bridge/core.rs` does `.env_clear().envs(env)`, so a probe whose verdict
 * depends on an inherited-but-undeclared variable reports `down` there. If this adapter
 * merged in `process.env` instead, the CLI could report `up` for the same declaration
 * the host would call `down` — a disagreement with the engine that defeats this
 * command's entire purpose (telling the operator what the host would find). Because the
 * child's environment is cleared, there is no `PATH` left to search a bare command name
 * against at spawn time, so `probe.run[0]` is resolved to an ABSOLUTE path up front via
 * Task 1's `resolveBinary` (against THIS process's real PATH). That is a small,
 * deliberate improvement over the host's PATH-at-spawn behaviour — deterministic,
 * single resolution, reusing the same function `reportConnections` already used to
 * decide whether to attempt the probe at all — not an accidental divergence.
 */
export async function runProbeProcess(
	connection: DeclaredConnection,
	timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
	const argv0 = connection.probe.run[0];
	if (!argv0) {
		return { outcome: "unknown", detail: "probe.run is empty — there is nothing to ask" };
	}
	const bin = resolveBinary(argv0);
	if (!bin) {
		return { outcome: "unknown", detail: `probe binary not found: ${argv0}` };
	}
	const args = connection.probe.run.slice(1);

	const result = await runProcessHandoff(
		{ command: bin, args, cwd: connection.cwd, display: createProcessHandoffDisplay(bin, args) },
		{
			capture: true,
			env: connection.env,
			isolatedEnv: true,
			timeout: timeoutMs,
			outputCap: true,
			spawnErrorAsResult: true,
		},
	);
	return interpretProbeResult(result, connection.probe.expect, timeoutMs);
}

const STATE_COLOR: Record<ConnectionReport["state"], (text: string) => string> = {
	up: chalk.green,
	down: chalk.red,
	unknown: chalk.yellow,
};

/**
 * The one-line remedy for `unknown`. `unknown` is the FIRST state most operators meet —
 * the declared binary is simply not installed on this machine yet — and an accurate but
 * terminal "unknown" line leaves them with a colour and no move. `refarm doctor` already
 * knows the answer (see `missingBinaryRecommendation` in `connection-doctor.ts`); this
 * says the same thing at the moment the operator is actually looking.
 */
const UNKNOWN_REMEDY =
	"fix: install the binary where refarm can reach it, fix PATH, or fix this connection's declaration in .refarm/config.json";

export function printConnectionReports(report: ConnectionStatusReport): void {
	console.log(chalk.bold("Connections"));
	if (report.catalogIssues.length > 0) {
		console.log(chalk.yellow(`  ${report.catalogIssues.length} catalog-level issue(s):`));
		for (const issue of report.catalogIssues) {
			console.log(chalk.dim(`    ${issue.field}: ${issue.message}`));
		}
	}
	if (report.connections.length === 0) {
		console.log(chalk.dim("  none declared"));
		return;
	}
	for (const connection of report.connections) {
		const color = STATE_COLOR[connection.state];
		const suffix =
			connection.state === "up"
				? ""
				: ` ${chalk.dim(`(${connection.detail ?? "no reason given"})`)}`;
		console.log(`  ${connection.name}: ${color(connection.state)}${suffix}`);
		if (connection.state === "unknown") {
			console.log(chalk.dim(`    ${UNKNOWN_REMEDY}`));
		}
		if (connection.issues.length > 0) {
			console.log(chalk.dim(`    ${connection.issues.length} declaration issue(s):`));
			for (const issue of connection.issues) {
				console.log(chalk.dim(`      ${issue.field}: ${issue.message}`));
			}
		}
	}
}

/**
 * ALWAYS EMPTY, on purpose — and this is a contract, not an oversight.
 *
 * `nextCommands` is not advice. CLAUDE.md §4 tells every agent in this repo to FOLLOW it,
 * so a command here that does not run is worse than no command at all: it hands the
 * repo's own operator loop a guaranteed failure on the primary case.
 *
 * There is no correct command to emit today:
 *   - `refarm workspace run <ws> <cmd>` (what this used to emit) resolves a NAMED entry
 *     from a workspace's declared-command allowlist. It does not take an argv, so
 *     `refarm workspace run <workspace> serpro-vpn connect` would look for a command
 *     literally named `serpro-vpn` — and `<workspace>` was never even filled in.
 *   - There is no generic re-establish command. Establishing a connection is the HOST's
 *     job (`spawn_establish_process`, the claim/linger registry), and the WIT surface that
 *     would let the CLI ask for it is not built. Naming a fake one here would be inventing
 *     a capability.
 *   - `refarm doctor --json` is real and runnable, but `connection-doctor.ts` already
 *     points its own findings BACK at `refarm connection status --json`. Emitting it would
 *     close a two-command livelock that an agent following handoffs would spin in.
 *
 * The remedy the operator actually needs is prose, so it goes out as `nextActions` (see
 * `connectionStatusNextActions`) — the envelope carries both, and only one of them is a
 * promise that something will execute.
 */
export function connectionStatusNextCommands(_reports: ConnectionReport[]): string[] {
	return [];
}

/**
 * The prose half of the handoff: what to DO about each non-`up` connection. Unlike
 * `nextCommands` these are read, not executed, so they can describe an action refarm
 * cannot yet perform on the operator's behalf.
 */
export function connectionStatusNextActions(reports: ConnectionReport[]): string[] {
	const actions: string[] = [];
	for (const report of reports) {
		if (report.state === "unknown") {
			actions.push(
				`Connection '${report.name}' could not be probed — ${UNKNOWN_REMEDY}, then re-run refarm connection status --json.`,
			);
		} else if (report.state === "down") {
			// The establish argv is REPORTED (it is already on every `ConnectionReport`),
			// never handed over as a command: refarm cannot run it for the operator yet, and
			// pretending otherwise is what finding 1 was.
			actions.push(
				`Connection '${report.name}' is down — bring it up with its declared establish command (${report.establish.join(" ")}), then re-run refarm connection status --json.`,
			);
		}
	}
	return actions;
}

export interface ConnectionStatusCommandOptions {
	json?: boolean;
}

export interface ConnectionCommandDeps {
	cwd?: () => string;
	loadConfig?: (root?: string) => Record<string, unknown>;
	runProbe?: (connection: DeclaredConnection) => Promise<ProbeResult>;
}

async function printConnectionStatus(
	options: ConnectionStatusCommandOptions,
	deps: ConnectionCommandDeps | undefined,
): Promise<void> {
	const baseDir = deps?.cwd?.() ?? process.cwd();
	let config: Record<string, unknown>;
	try {
		config = (deps?.loadConfig ?? loadConfig)(baseDir) as Record<string, unknown>;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (options.json) {
			printJson(
				buildJsonErrorEnvelope({
					command: "connection",
					operation: "status",
					error: "config-load-failed",
					message,
					nextAction: "Fix .refarm/config.json so it can be read, then retry.",
				}),
			);
			return;
		}
		console.error(chalk.red(`Failed to load config: ${message}`));
		process.exitCode = 1;
		return;
	}

	const report = await reportConnections({
		config,
		runProbe: deps?.runProbe ?? ((connection) => runProbeProcess(connection)),
	});

	if (options.json) {
		printJson(
			buildJsonSuccessEnvelope({
				command: "connection",
				operation: "status",
				extra: { connections: report.connections, catalogIssues: report.catalogIssues },
				nextActions: connectionStatusNextActions(report.connections),
				nextCommands: connectionStatusNextCommands(report.connections),
			}),
		);
		return;
	}
	printConnectionReports(report);
}

export function createConnectionCommand(deps?: ConnectionCommandDeps): Command {
	const command = new Command("connection").description(
		"Inspect declared long-lived connections (VPN tunnels, logged-in sessions)",
	);

	command
		.command("status")
		.description("Probe every connection declared under .refarm/config.json's `connections`")
		.option("--json", "Output machine-readable connection status")
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm connection status",
				"  $ refarm connection status --json",
				"",
				"Notes:",
				"  This asks the SYSTEM directly — it needs no plugin and no running host registry.",
				"  A connection is declared under `connections` in .refarm/config.json; see",
				"  connection_decl.rs for the authoritative shape the host runs.",
			].join("\n"),
		)
		.action(async (options: ConnectionStatusCommandOptions) => {
			await printConnectionStatus(options, deps);
		});

	return command;
}

export const connectionCommand = createConnectionCommand();
