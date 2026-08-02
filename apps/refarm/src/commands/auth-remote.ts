import {
	createProcessHandoffDisplay,
	runProcessHandoff,
} from "@refarm.dev/cli/process-handoff";

import { buildJsonSuccessEnvelope, printJson } from "@refarm.dev/capabilities/envelope";
import { loadConfig } from "@refarm.dev/config";
import { Command } from "commander";

import { refarmCommand } from "../brand.js";
import {
	everyCommandPath,
	remoteInitiationCommandLine,
	remoteInitiationNeedsAttendance,
	REMOTELY_INITIABLE_OPERATIONS,
	resolveRemoteInitiation,
	workspaceInitiationOperations,
} from "./remote-initiation.js";

/**
 * `refarm auth remote` — WHAT AN ENROLLED DEVICE MAY START, asked and answered.
 *
 * The declaration in `remote-initiation.ts` would be worth much less if reading it meant reading
 * a source file: a rule the operator cannot inspect from the outside is a rule they have to trust
 * rather than check. This is the check. It is a subcommand of `auth`, beside `auth list` — which
 * answers "WHO is enrolled" — because together they are the whole sentence: these devices, these
 * operations.
 *
 * It lives in its own module rather than in `auth.ts` for a reason worth keeping: `auth.ts` is
 * under a source-text guard (`auth.test.ts`, "no enrolment module so much as names the declaration
 * file") which forbids enrolment code from even mentioning `config.json`, so that discovery can
 * never quietly start reading the operator's declaration. This command legitimately names that
 * file — to point the operator's OWN commands at the door they actually use — and the right answer
 * is to sit outside the guarded set, not to loosen the guard.
 *
 * It reads no policy file and touches no state: the answer is a property of this build, identical
 * on every node, and saying so is part of the point. Whether a given DEVICE is enrolled is
 * `auth list`'s question, and conflating the two would let a reader think an empty device list
 * narrowed this one.
 */
/**
 * `refarm auth remote run <operation>` — THE ONE ENTRYPOINT THE NODE'S ROUTE SPAWNS.
 *
 * R4 of the composable-onboarding design. The sidecar route
 * (`packages/tractor/src/sidecar/remote_initiation.rs`) accepts an OPAQUE operation id from an
 * enrolled device and spawns exactly this, as `<refarm> auth remote run <id>` — three constant
 * tokens and the caller's bytes in one argv element. It never parses, joins or derives a
 * command line from what a device sent, because it cannot: the decision is HERE, in the
 * runtime that owns the declaration.
 *
 * Duplicating the table in Rust would have been the obvious shape and is the one this refuses.
 * Two answers to "may this be started remotely" diverge — not at once, which is what makes it
 * dangerous, but at the first entry somebody adds to one side.
 *
 * ── The verdict line, and why it is a line ───────────────────────────────────────────────
 * The route has to answer its caller in milliseconds while the wizard it started runs for
 * minutes. So this command's FIRST act is to print exactly one line of JSON on stdout —
 * {@link REMOTE_INITIATION_WIRE} — saying whether it started, and only then does it start
 * anything. The node reads that one line (bounded by lines, bytes and a deadline), answers
 * its caller, and discards everything after it: output does not travel to the initiating
 * device, deliberately, and a drain that logged would smuggle it back in.
 *
 * ── Three refusals, not one ─────────────────────────────────────────────────────────────
 * {@link resolveRemoteInitiation} answers `undeclared` for two genuinely different situations,
 * and a device deserves to know which:
 *
 *   - `unknown-operation` — the id names no command this CLI has at all. A typo, an older
 *     phone, a guess.
 *   - `not-remotely-invocable` — the id names a REAL refarm command that did not declare
 *     itself remotely initiable. Silence is closed (R5), and saying so is how the operator
 *     learns the door exists and is shut rather than that they mistyped.
 *
 * The distinction is DERIVED from the real `program` tree ({@link everyCommandPath}) and is
 * consulted strictly after the gate has already refused. It phrases a refusal; it never
 * softens one — there is exactly one path to starting anything and it is an exact table hit.
 *
 * ── The wizard must not learn it was started remotely ───────────────────────────────────
 * It is spawned as a SEPARATE PROCESS with the table's own constant argv and inherited stdio,
 * reconstructing this process's own invocation (`execPath` + `execArgv` + `argv[1]`). No flag,
 * no environment variable, no marker of any kind — there is nothing to leak, which is stronger
 * than a rule saying not to leak it. Its questions reach the operator through the
 * pending-prompt hub because the CLI already publishes there; that path is untouched.
 *
 * stdin is INHERITED on purpose. The node hands this process a pipe it holds open and never
 * writes to, so the wizard's terminal side waits forever and the hub settles the question —
 * and when the node goes away, the pipe closes, the terminal side reads EOF, and the wizard
 * ends. A wizard started remotely cannot outlive the node that started it.
 */
export const REMOTE_INITIATION_WIRE = "remote-initiation.v1";

/** Why an initiation was refused, in the two words the node relays verbatim. */
export type RemoteInitiationRefusalReason = "unknown-operation" | "not-remotely-invocable";

/** The one line this command prints before it does anything else. */
export type RemoteInitiationVerdict =
	| { readonly wire: string; readonly ok: true; readonly operation: string }
	| {
			readonly wire: string;
			readonly ok: false;
			readonly reason: RemoteInitiationRefusalReason;
			readonly detail: string;
	  };

/**
 * The verdict, as a PURE function of the requested id and what the CLI has.
 *
 * The credential is not a parameter and must not become one: authority is the NODE's
 * question, answered by the listener's own gate before this process exists (`/operations`
 * declares no scope, so it admits device credentials only). Accepting a credential here would
 * be a second authentication path reachable by anyone who can run this command locally —
 * which is everyone who is already on the node.
 */
export function remoteInitiationVerdict(
	requested: string,
	knownCommandPaths: readonly string[],
	operations = REMOTELY_INITIABLE_OPERATIONS,
): RemoteInitiationVerdict {
	// The gate, first and unchanged. Its `ok: true` is the only way past this line.
	const decision = resolveRemoteInitiation(
		{ operation: requested, credential: { kind: "device" } },
		operations,
	);
	if (decision.ok) {
		return { wire: REMOTE_INITIATION_WIRE, ok: true, operation: decision.operation.id };
	}
	const known = knownCommandPaths.includes(requested);
	return {
		wire: REMOTE_INITIATION_WIRE,
		ok: false,
		reason: known ? "not-remotely-invocable" : "unknown-operation",
		detail: known
			? "That is a real command on this node, and it has not declared itself startable " +
				"from a device. An operation that says nothing may not be started remotely — " +
				"silence is closed, including for an operation added tomorrow."
			: "This node has no such operation. " + decision.refusal.detail,
	};
}

/**
 * This process's own invocation, so the wizard is started the way the operator would have
 * started it — same interpreter, same loader flags, same entry script.
 *
 * `execArgv` matters: the installed `refarm` runs Node with `--import <loader>`, and dropping
 * it would start a wizard that cannot resolve the workspace at all.
 */
export function reinvocationArgv(
	operationArgv: readonly string[],
	process_: Pick<typeof process, "execArgv" | "argv"> = process,
): string[] {
	const entry = process_.argv[1];
	return [...process_.execArgv, ...(entry ? [entry] : []), ...operationArgv];
}

function createAuthRemoteRunCommand(): Command {
	return new Command("run")
		.description("Start a declared operation — the entrypoint the node's /operations route spawns")
		.argument("<operation>", "The declared operation id, exactly as `refarm auth remote` prints it")
		.action(async (requested: string) => {
			// The real command tree, imported lazily: `program.ts` imports `auth.ts` imports this
			// module, so a top-level import would be a cycle. By the time an action runs, the
			// module graph is settled and this is a cache hit.
			const { program } = await import("../program.js");
			const config = loadConfig(process.cwd());
			const allWorkspaceOperations = workspaceInitiationOperations(config);
			const operations = [
				...REMOTELY_INITIABLE_OPERATIONS,
				...workspaceInitiationOperations(config, { remoteOnly: true }),
			];
			const knownOperationIds = [
				...everyCommandPath(program),
				...allWorkspaceOperations.map((operation) => operation.id),
			];
			const verdict = remoteInitiationVerdict(requested, knownOperationIds, operations);
			// ONE line, and it is the first thing on stdout. The node reads exactly this.
			process.stdout.write(`${JSON.stringify(verdict)}\n`);
			if (!verdict.ok) {
				process.exitCode = 1;
				return;
			}
			const decision = resolveRemoteInitiation(
				{ operation: requested, credential: { kind: "device" } },
				operations,
			);
			// Unreachable: `verdict.ok` is exactly `decision.ok`. Spelled out rather than
			// asserted so a future edit that breaks the correspondence fails closed.
			if (!decision.ok) {
				process.exitCode = 1;
				return;
			}
			// Through the process boundary, never `node:child_process` here — the rule
			// `test/architecture/process-boundary.test.ts` enforces, for the reason P1 gave
			// when it consolidated: one place decides how a child is spawned, so the CLI and
			// the Rust host cannot drift on environment isolation or on what a signal death
			// means.
			//
			// `capture: false` is the interactive shape (inherited stdio), which is exactly
			// what this needs — the child IS the wizard, its questions reach the operator
			// through the pending-prompt hub, and its stdin stays open as its lifeline.
			// The DECLARATION stays byte-identical to what an operator would type — that is a
			// pinned property of the table, so nothing there reads as a provenance marker and a
			// wizard cannot branch on where the request came from.
			//
			// This allowance belongs to the INVOCATION instead, and states one thing only: no
			// local terminal is required. It is necessary because the child genuinely cannot
			// know a device is attending — a prompt publisher exists on every node since the
			// pending-prompt bridge, so its presence proves nothing, and without this the wizard
			// would refuse for want of a TTY or wait forever on a human who is not there.
			const argv = [
				...reinvocationArgv(decision.argv),
				...(remoteInitiationNeedsAttendance(decision.operation.id)
					? ["--attended-elsewhere"]
					: []),
			];
			const result = await runProcessHandoff(
				{
					command: process.execPath,
					args: argv,
					display: createProcessHandoffDisplay(process.execPath, argv),
				},
				{ capture: false },
			);
			// `-1` means it never exited with a code — a signal death, or a spawn that failed.
			// Both are "it did not succeed", and neither may be reported as a clean 0.
			process.exitCode = result.exitCode === -1 ? 1 : result.exitCode;
		});
}

export function createAuthRemoteCommand(): Command {
	return new Command("remote")
		.description("List the operations an enrolled device may start on this node")
		.addCommand(createAuthRemoteRunCommand())
		.option("--json", "Print the result as JSON")
		.action((options: { json?: boolean }) => {
			const operations = [
				...REMOTELY_INITIABLE_OPERATIONS,
				...workspaceInitiationOperations(loadConfig(process.cwd()), { remoteOnly: true }),
			].map((operation) => ({
				id: operation.id,
				command: remoteInitiationCommandLine(operation),
				why: operation.why,
			}));
			if (options.json) {
				printJson(
					buildJsonSuccessEnvelope({
						command: "auth",
						operation: "remote",
						nextAction: "Confirm which devices hold a credential that could start these.",
						nextCommands: [refarmCommand(["auth", "list", "--json"])],
						extra: { operations, closedByDefault: true },
					}),
				);
				return;
			}
			if (operations.length === 0) {
				process.stdout.write(
					"No operation on this node may be started by a device.\n" +
						"  An operation that does not declare itself remotely initiable may not be started\n" +
						"  remotely — silence is closed, and nothing here has spoken.\n",
				);
				return;
			}
			process.stdout.write(
				`Operations an enrolled device may start (${operations.length}):\n` +
					operations.map(({ command, why }) => `  • ${command}\n      ${why}\n`).join("") +
					"\n" +
					"  Everything else is closed. An operation that does not declare itself remotely\n" +
					"  initiable may not be started remotely, including one added tomorrow.\n" +
					"  Workspace operations appear only when their own declaration says remote: true;\n" +
					"  every other named operation remains local-only.\n",
			);
		});
}
