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
import { quoteCommandArgIfNeeded } from "@refarm.dev/cli/command-handoff";
import {
	createProcessHandoffDisplay,
	runProcessHandoff,
	type ProcessHandoffRunResult,
} from "@refarm.dev/cli/process-handoff";
import { declaredBase, loadConfig } from "@refarm.dev/config";
import { fetchSidecarWithTimeout } from "@refarm.dev/sidecar-client";
import chalk from "chalk";
import { Command } from "commander";
import { refarmCommand } from "../brand.js";
import {
	DEFAULT_READY_TIMEOUT_MS,
	readConnectionCatalog,
	resolveBinary,
	type CatalogIssue,
	type DeclaredConnection,
} from "./connection-catalog.js";
import { reportSidecarError } from "./sidecar-error.js";
import { sidecarUrl } from "./sidecar-url.js";

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

// ─── `refarm connection up` / `refarm connection down` ──────────────────────────
//
// Unlike `status` above (a direct probe, works with no runtime), `up` and `down`
// need the RUNTIME: establishing or stopping a shared connection is the host's
// job — it owns the `ConnectionRegistry`, the claim bookkeeping, and the real
// adapters (`spawn_establish_process`/`run_probe`) that decide what "up" means.
// These two subcommands are thin HTTP callers of `POST /connections/:name/up`
// and `POST /connections/:name/down` on the sidecar; they never spawn anything
// themselves.
//
// WHY `up` IS SHAPED THIS WAY (decision D13, declared-connections-shared-
// sessions-design.md): the defect this whole feature responds to was the
// supervisor spending phone-approval pushes at an ABSENT human — establishing a
// connection can need a human (a push, a QR scan, an MFA code), and that is a
// scarce resource that only exists when the human is actually there. D13's rule
// is that a step needing a human must first ACQUIRE the human before spending
// that resource. `refarm connection up <name>` satisfies this BY CONSTRUCTION,
// not as a nicety: the operator had to type the command for it to run at all, so
// the acquisition already happened — there is no supervisor guessing whether
// anyone is present. This is why `up` is a command the operator RUNS, rather
// than something a background process is left to retry on its own.

/** Mirrors the Rust `ConnectionOperatorState` (`connection_ops.rs`) — the JSON
 * body `POST /connections/:name/{up,down}` and `GET /connections` return on
 * success. `status` is the registry's own vocabulary, distinct from `probe`'s
 * three-state `up`/`down`/`unknown` above: the host can report `connecting` or
 * `failed` mid-flight, states a client-side probe never sees. */
export interface ConnectionOperatorState {
	name: string;
	/**
	 * The registry's own status vocabulary — today `"down" | "connecting" | "up" |
	 * "failed"`, but deliberately typed as a plain `string`, NOT that closed union.
	 * D13 (`declared-connections-shared-sessions-design.md`) plans a `needs-attention`
	 * state for a connection waiting on a phone approval — a real, distinct state the
	 * operator needs to SEE as itself. Forwarding whatever the sidecar reports, verbatim,
	 * is what makes that forward-compatible; coercing anything unrecognised down to
	 * `"down"` (the previous behaviour) is exactly the D12 lie this surface exists to
	 * prevent — a state the operator has never seen before would default to the ONE
	 * state that reads as "nothing to worry about, already handled".
	 */
	status: string;
	sinceNs: number | null;
	claims: number;
	claim: number | null;
}

/**
 * The outcome of one `up`/`down` call against the sidecar — a closed set so the
 * command layer never has to sniff error text to decide how to respond:
 *   - `ok`        — the host acted and returned the resulting state.
 *   - `undeclared`— no connection by that name in `.refarm/config.json` (the
 *     sidecar's clean 404, never a 500).
 *   - `failed`    — the host tried and could not do it (a malformed config, a
 *     spawn/probe error, the registry itself refusing). Not the operator's typo
 *     to fix by retrying with a different name.
 * A genuinely UNREACHABLE sidecar (runtime not running) is deliberately NOT a
 * member of this union — `requestConnectionUp`/`requestConnectionDown` let that
 * case propagate as a thrown error, so the caller can route it to
 * `reportSidecarError` and get the runtime-recovery wording instead of a
 * connection-specific message that would misdiagnose "the runtime is down" as
 * "this connection failed".
 */
export type ConnectionOperatorOutcome =
	| { outcome: "ok"; state: ConnectionOperatorState }
	| { outcome: "undeclared"; message: string }
	| { outcome: "failed"; message: string };

export type ConnectionDownOutcome =
	| { outcome: "ok"; state: ConnectionOperatorState; claimsActive: number }
	| { outcome: "undeclared"; message: string }
	| { outcome: "failed"; message: string };

const CONNECTION_STATUS_JSON_COMMAND = refarmCommand(["connection", "status", "--json"]);

/**
 * The status field is forwarded VERBATIM when it is a non-empty string — including a
 * value this CLI does not yet know about (see `ConnectionOperatorState.status`'s own
 * doc). `"unknown"` is used ONLY when the sidecar's response is malformed (the field is
 * missing or not a string at all) — that is genuinely unknown, unlike a recognised-but-
 * unfamiliar status string, which is not.
 */
function asConnectionOperatorState(body: Record<string, unknown>): ConnectionOperatorState {
	const status = typeof body.status === "string" && body.status.trim().length > 0 ? body.status : "unknown";
	return {
		name: typeof body.name === "string" ? body.name : "",
		status,
		sinceNs: typeof body.sinceNs === "number" ? body.sinceNs : null,
		claims: typeof body.claims === "number" ? body.claims : 0,
		claim: typeof body.claim === "number" ? body.claim : null,
	};
}

/**
 * `@refarm.dev/sidecar-client`'s OWN silent default when no `timeoutMs` is passed
 * (`DEFAULT_SIDE_REQUEST_TIMEOUT_MS`, `sidecar-client/src/index.ts`) — 500ms. That is
 * sized for a request the sidecar answers itself, in-process. `POST /connections/:name/up`
 * is not that: it SYNCHRONOUSLY awaits the establish inside the HTTP handler
 * (`ensure_connection_as_operator` → `ConnectionRegistry::ensure`), and establishing is
 * the one thing in this whole feature that can legitimately take a while — up to a
 * declaration's `readyTimeoutMs` (120s by default; the Serpro VPN case this feature was
 * built for waits on a phone-approval push). Passing this bare 500ms default to `up`
 * would abort the CLI's OWN wait long before the host is done — the establish keeps
 * running server-side regardless, so the operator would see a raw abort error while a
 * real login attempt was quietly still in flight. `up` must NEVER call
 * `requestConnectionAction`/`fetchSidecarWithTimeout` without an explicit, generous
 * `timeoutMs` override; `printConnectionUp` computes one from the DECLARED
 * `readyTimeoutMs` before ever reaching this function — see `resolveConnectionUpTimeoutMs`.
 */
const CONNECTION_UP_TIMEOUT_HEADROOM_MS = 5_000;

/** POST `/connections/:name/{up,down}` and classify the response. Network/timeout
 * failures are NOT caught here — they propagate to the caller as a thrown error,
 * which is exactly what lets `up`/`down` tell "the sidecar is unreachable" apart
 * from "the sidecar answered no". */
async function requestConnectionAction(
	name: string,
	action: "up" | "down",
	timeoutMs?: number,
): Promise<{ status: number; body: Record<string, unknown> }> {
	const response = await fetchSidecarWithTimeout(
		sidecarUrl(`/connections/${encodeURIComponent(name)}/${action}`),
		{ method: "POST" },
		timeoutMs === undefined ? {} : { timeoutMs },
	);
	const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
	return { status: response.status, body };
}

function classifyConnectionError(status: number): "undeclared" | "failed" {
	return status === 404 ? "undeclared" : "failed";
}

function connectionErrorMessage(status: number, body: Record<string, unknown>): string {
	return typeof body.error === "string" ? body.error : `sidecar HTTP ${status}`;
}

/**
 * The real `up` adapter — the default for `ConnectionCommandDeps.connectionUp`.
 * `timeoutMs` is REQUIRED, not optional with a silent fallback here: the one thing this
 * function must never do is quietly inherit the sidecar client's 500ms default for a
 * request that can legitimately run for two minutes (see `CONNECTION_UP_TIMEOUT_HEADROOM_MS`'s
 * doc). The command computes it from the declaration; a caller with no declaration to
 * read from must still pass something — `resolveConnectionUpTimeoutMs`'s own generous
 * fallback — rather than omitting the argument and reverting to the bug this exists to
 * fix.
 */
export async function requestConnectionUp(
	name: string,
	timeoutMs: number,
): Promise<ConnectionOperatorOutcome> {
	const { status, body } = await requestConnectionAction(name, "up", timeoutMs);
	if (status === 200) return { outcome: "ok", state: asConnectionOperatorState(body) };
	return { outcome: classifyConnectionError(status), message: connectionErrorMessage(status, body) };
}

/** The real `down` adapter — the default for `ConnectionCommandDeps.connectionDown`.
 * `POST /connections/:name/down` (`stop_connection_as_operator` → `ConnectionRegistry::
 * stop`) does not await a spawn or a probe — it is a synchronous registry mutation — so
 * unlike `up` it carries no slow-path hazard and can use the sidecar client's own default
 * timeout. */
export async function requestConnectionDown(name: string): Promise<ConnectionDownOutcome> {
	const { status, body } = await requestConnectionAction(name, "down");
	if (status === 200) {
		return {
			outcome: "ok",
			state: asConnectionOperatorState(body),
			claimsActive: typeof body.claimsActive === "number" ? body.claimsActive : 0,
		};
	}
	return { outcome: classifyConnectionError(status), message: connectionErrorMessage(status, body) };
}

const KNOWN_OPERATOR_STATE_COLOR: Record<string, (text: string) => string> = {
	up: chalk.green,
	connecting: chalk.yellow,
	down: chalk.red,
	failed: chalk.red,
};

/** A status this CLI does not recognise (a forward-compatible one like D13's planned
 * `needs-attention`, or a malformed `"unknown"`) is shown in the ATTENTION colour, never
 * silently green or red — those two are reserved for a state this code actually knows
 * the meaning of. */
function operatorStateColor(status: string): (text: string) => string {
	return KNOWN_OPERATOR_STATE_COLOR[status] ?? chalk.yellow;
}

/**
 * How long the CLI should wait for `POST /connections/:name/up` to answer, sized off the
 * connection's OWN declared `readyTimeoutMs` plus `CONNECTION_UP_TIMEOUT_HEADROOM_MS` —
 * never the sidecar client's bare 500ms default. Reading the local catalog here is
 * DIAGNOSTIC ONLY: the HOST is the authority on whether `name` is declared and what its
 * `readyTimeoutMs` is (this same request will 404 cleanly if it is not), so a failure to
 * load `.refarm/config.json`, or `name` simply not being present in it, must never block
 * the `up` attempt itself — it falls back to `DEFAULT_READY_TIMEOUT_MS` (the same default
 * the Rust parser and this CLI's own catalog reader already use when a declaration omits
 * the field) plus the same headroom, so an operator invoking `up` from ANY directory — not
 * just a checkout with a local catalog — still gets a timeout generous enough for a REAL
 * establish.
 *
 * The catalog itself is read from `declaredBase()` (the node's declared base — same
 * resolution `printConnectionStatus` uses below, and the same one `workspace.ts` already
 * uses for its own declared-command catalog), NOT `process.cwd()`: this reads the SAME
 * `connections` block `status` reports on, and a connection is a node-level fact, not a
 * per-directory one — sizing `up`'s timeout off a DIFFERENT catalog than `status` just
 * reported from would be its own, quieter version of the directory-dependence defect this
 * file exists to fix.
 */
function resolveConnectionUpTimeoutMs(name: string, deps: ConnectionCommandDeps | undefined): number {
	try {
		const baseDir = deps?.cwd?.() ?? declaredBase();
		const config = (deps?.loadConfig ?? loadConfig)(baseDir) as Record<string, unknown>;
		const { connections } = readConnectionCatalog(config);
		const declared = connections.find((connection) => connection.name === name);
		return (declared?.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS) + CONNECTION_UP_TIMEOUT_HEADROOM_MS;
	} catch {
		return DEFAULT_READY_TIMEOUT_MS + CONNECTION_UP_TIMEOUT_HEADROOM_MS;
	}
}

/**
 * True for the `AbortError` `fetchSidecarWithTimeout`'s internal `AbortController`
 * produces when ITS OWN deadline elapses (Node/undici names it `"AbortError"`). Must be
 * checked before `reportSidecarError`: an abort here means this specific REQUEST did not
 * get an answer in time — it says nothing about whether the runtime is reachable (it
 * plainly is; it accepted the request and started working). Routing it through
 * `reportSidecarError`'s generic path would either misreport it as
 * "Refarm runtime is not running" (if the message happened to match
 * `isSidecarUnavailable`) or as an opaque request failure — both wrong, and for `up`
 * specifically actively misleading: the establish this request started keeps running
 * SERVER-SIDE regardless of the CLI giving up on waiting for it.
 */
function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

function printConnectionRequestTimedOut(
	operation: "up" | "down",
	message: string,
	options: { json?: boolean },
): void {
	if (options.json) {
		printJson(
			buildJsonErrorEnvelope({
				command: "connection",
				operation,
				error: "connection-request-timed-out",
				message,
				nextAction: `Run \`${CONNECTION_STATUS_JSON_COMMAND}\` to check whether it finished.`,
				nextCommand: CONNECTION_STATUS_JSON_COMMAND,
			}),
		);
	} else {
		console.error(chalk.red(`✗  ${message}`));
		console.error(chalk.dim(`   ${CONNECTION_STATUS_JSON_COMMAND}`));
	}
	process.exitCode = 1;
}

export interface ConnectionUpCommandOptions {
	json?: boolean;
}

export interface ConnectionDownCommandOptions {
	json?: boolean;
}

async function printConnectionUp(
	name: string,
	options: ConnectionUpCommandOptions,
	deps: ConnectionCommandDeps | undefined,
): Promise<void> {
	let result: ConnectionOperatorOutcome;
	try {
		const timeoutMs = resolveConnectionUpTimeoutMs(name, deps);
		result = await (deps?.connectionUp ?? requestConnectionUp)(name, timeoutMs);
	} catch (error) {
		if (isAbortError(error)) {
			// Do NOT claim to know whether the establish is still running — that is not
			// knowable from here (see `isAbortError`'s doc). Point at the two things the
			// operator can actually do: check reality, or force it down.
			printConnectionRequestTimedOut(
				"up",
				`connection '${name}': timed out waiting for a reply. It may or may not still be establishing on the host — check \`${CONNECTION_STATUS_JSON_COMMAND}\`, or force it down with \`${refarmCommand(["connection", "down", quoteCommandArgIfNeeded(name)])}\`.`,
				options,
			);
			return;
		}
		reportSidecarError(error, { json: options.json, command: "connection", operation: "up" });
		return;
	}

	if (result.outcome === "undeclared") {
		if (options.json) {
			printJson(
				buildJsonErrorEnvelope({
					command: "connection",
					operation: "up",
					error: "connection-undeclared",
					message: result.message,
					nextAction: `Run \`${CONNECTION_STATUS_JSON_COMMAND}\` to see which connections are declared.`,
					nextCommand: CONNECTION_STATUS_JSON_COMMAND,
				}),
			);
		} else {
			console.error(chalk.red(`✗  ${result.message}`));
			console.error(chalk.dim(`   ${CONNECTION_STATUS_JSON_COMMAND}`));
		}
		process.exitCode = 1;
		return;
	}

	if (result.outcome === "failed") {
		reportSidecarError(new Error(result.message), {
			json: options.json,
			command: "connection",
			operation: "up",
		});
		return;
	}

	const { state } = result;
	if (options.json) {
		printJson(
			buildJsonSuccessEnvelope({
				command: "connection",
				operation: "up",
				extra: {
					name: state.name,
					status: state.status,
					sinceNs: state.sinceNs,
					claims: state.claims,
					claim: state.claim,
				},
				nextCommand: CONNECTION_STATUS_JSON_COMMAND,
			}),
		);
		return;
	}
	const color = operatorStateColor(state.status);
	console.log(`${chalk.bold(state.name)}: ${color(state.status)}`);
	console.log(chalk.dim(`  claims: ${state.claims}`));
}

async function printConnectionDown(
	name: string,
	options: ConnectionDownCommandOptions,
	deps: ConnectionCommandDeps | undefined,
): Promise<void> {
	let result: ConnectionDownOutcome;
	try {
		result = await (deps?.connectionDown ?? requestConnectionDown)(name);
	} catch (error) {
		if (isAbortError(error)) {
			printConnectionRequestTimedOut(
				"down",
				`connection '${name}': the request to stop it timed out — it may still have taken effect on the host.`,
				options,
			);
			return;
		}
		reportSidecarError(error, { json: options.json, command: "connection", operation: "down" });
		return;
	}

	if (result.outcome === "undeclared") {
		if (options.json) {
			printJson(
				buildJsonErrorEnvelope({
					command: "connection",
					operation: "down",
					error: "connection-undeclared",
					message: result.message,
					nextAction: `Run \`${CONNECTION_STATUS_JSON_COMMAND}\` to see which connections are declared.`,
					nextCommand: CONNECTION_STATUS_JSON_COMMAND,
				}),
			);
		} else {
			console.error(chalk.red(`✗  ${result.message}`));
			console.error(chalk.dim(`   ${CONNECTION_STATUS_JSON_COMMAND}`));
		}
		process.exitCode = 1;
		return;
	}

	if (result.outcome === "failed") {
		reportSidecarError(new Error(result.message), {
			json: options.json,
			command: "connection",
			operation: "down",
		});
		return;
	}

	const { state, claimsActive } = result;
	if (options.json) {
		printJson(
			buildJsonSuccessEnvelope({
				command: "connection",
				operation: "down",
				extra: {
					name: state.name,
					status: state.status,
					sinceNs: state.sinceNs,
					claims: state.claims,
					claim: state.claim,
					// D12 ("the operator is shown reality"): a `down` taken while other claims
					// were outstanding is sovereign — it still happens — but this count must
					// never be swallowed. Someone else's plugin/session was relying on this
					// connection; silently dropping that fact is exactly what D12 forbids.
					claimsActive,
				},
				nextCommand: CONNECTION_STATUS_JSON_COMMAND,
			}),
		);
		return;
	}
	const color = operatorStateColor(state.status);
	console.log(`${chalk.bold(state.name)}: ${color(state.status)}`);
	console.log(chalk.dim(`  claims active when stopped: ${claimsActive}`));
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
	/** Test seam ONLY — overrides the base directory `loadConfig` reads the declared
	 * `connections` catalog from. The non-injected default is `declaredBase()`
	 * (`@refarm.dev/config`), never `process.cwd()`: the catalog is a NODE-level
	 * declaration, like the workspace catalog `workspace.ts` reads the same way, so the
	 * operator's declared connections must answer identically regardless of which
	 * directory `refarm connection status`/`up` happens to be invoked from. A real caller
	 * has no reason to pass this — it exists so a test can point at a fixture directory
	 * without touching `process.cwd()` or the operator's real declared base. */
	cwd?: () => string;
	loadConfig?: (root?: string) => Record<string, unknown>;
	runProbe?: (connection: DeclaredConnection) => Promise<ProbeResult>;
	/** Injected in tests so `up`/`down` are hermetic — no network, no runtime.
	 * `timeoutMs` is the value `resolveConnectionUpTimeoutMs` computed from the declared
	 * `readyTimeoutMs` (see its doc) — a test can assert on it to prove the CLI is not
	 * silently using the sidecar client's bare 500ms default for a slow establish. */
	connectionUp?: (name: string, timeoutMs: number) => Promise<ConnectionOperatorOutcome>;
	connectionDown?: (name: string) => Promise<ConnectionDownOutcome>;
}

async function printConnectionStatus(
	options: ConnectionStatusCommandOptions,
	deps: ConnectionCommandDeps | undefined,
): Promise<void> {
	// The declared `connections` catalog is a NODE-level fact (like the workspace catalog
	// `workspace.ts` reads via the same `declaredBase()`), not a per-directory one — see
	// `ConnectionCommandDeps.cwd`'s doc for why `process.cwd()` must never be the fallback
	// here.
	const baseDir = deps?.cwd?.() ?? declaredBase();
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

	command
		.command("up <name>")
		.description("Bring a declared connection up through the runtime")
		.option("--json", "Output machine-readable connection state")
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm connection up serpro-vpn",
				"  $ refarm connection up serpro-vpn --json",
				"",
				"Notes:",
				"  Unlike `status`, this needs the runtime: establishing a connection is the",
				"  host's job. If establishing needs a human (a push, a QR scan), typing this",
				"  command IS that acquisition — the operator is present by construction,",
				"  because they had to type it (design decision D13).",
				"  If the runtime is not running, this reports that plainly with the recovery",
				"  command, instead of a confusing connection error.",
			].join("\n"),
		)
		.action(async (name: string, options: ConnectionUpCommandOptions) => {
			await printConnectionUp(name, options, deps);
		});

	command
		.command("down <name>")
		.description("Stop a declared connection through the runtime")
		.option("--json", "Output machine-readable connection state")
		.addHelpText(
			"after",
			[
				"",
				"Examples:",
				"  $ refarm connection down serpro-vpn",
				"  $ refarm connection down serpro-vpn --json",
				"",
				"Notes:",
				"  Sovereign: this stops the connection even if other plugins/sessions hold",
				"  claims on it. The number of claims active at the moment of the stop is",
				"  always reported (design decision D12) — it is never dropped silently.",
			].join("\n"),
		)
		.action(async (name: string, options: ConnectionDownCommandOptions) => {
			await printConnectionDown(name, options, deps);
		});

	return command;
}

export const connectionCommand = createConnectionCommand();
