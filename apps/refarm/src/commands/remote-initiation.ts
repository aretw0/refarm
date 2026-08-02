/**
 * WHICH OF REFARM'S OWN OPERATIONS AN ENROLLED DEVICE MAY START — AND THE SILENCE THAT
 * CLOSES EVERYTHING ELSE.
 *
 * R5 of `docs/superpowers/specs/2026-07-31-composable-onboarding-and-remote-initiation-design.md`.
 *
 * ── The distinction this rests on ───────────────────────────────────────────────────────
 * Two things that look alike and are not:
 *
 *   - **A declared workspace command is the OPERATOR'S OWN ARGV** (`pnpm --filter … run vpn`).
 *     Refarm cannot know what it does, so it needs the allowlist it already has:
 *     `workspaces.*.commands` in the config, resolved by `runDeclaredWorkspaceCommand`
 *     (`commands/workspace.ts`). That door is unchanged by this module and is NOT reachable
 *     through it — see `resolveRemoteInitiation`, which matches only ids in the table below.
 *   - **A refarm wizard is a KNOWN OPERATION** — refarm defines it, refarm knows its surface,
 *     and it is not argv anyone supplied.
 *
 * So an enrolled device may initiate refarm's own wizards. The operator's argv still requires
 * the allowlist. That was the operator's decision, recorded in R5.
 *
 * ── Why a declaration and not a deny-list ───────────────────────────────────────────────
 * Some refarm operations must never be startable from a phone — revocation being the obvious
 * one. A deny-list is the tempting answer and the wrong one: it is correct only until the next
 * dangerous operation is added, and then it is silently wrong, and it is silently wrong in the
 * direction that hurts.
 *
 * So each operation DECLARES whether it may be initiated remotely, and an operation that says
 * nothing may not. Silence is closed — exactly as it is for `surfaces`, `delivery` and
 * discovery, and as `route_requirement` already reads silence on the sidecar's own gate. A new
 * dangerous operation is safe by default and becomes remotely initiable only when someone adds
 * an entry HERE, in a diff, which is the moment a reviewer can ask why.
 *
 * The enforcement is structural, not a promise: {@link resolveRemoteInitiation} has exactly one
 * path to `ok: true` — an exact hit in {@link REMOTELY_INITIABLE_OPERATIONS} — and no fallback,
 * no prefix match, no derivation of argv from what the caller sent. `silence_is_closed_for_every
 * _command_the_cli_has` in the test file walks the REAL `program` tree and asserts refusal for
 * every command path except the declared ones, so a command added tomorrow is covered without
 * anyone remembering to cover it.
 *
 * ── The argv is a CONSTANT, and that is the point ───────────────────────────────────────
 * A device sends an ID and nothing else. It never sends argv, arguments, options or a channel
 * name; the argv it starts is the frozen array written below. That is why this door does not
 * need the allowlist the workspace catalog needs — there is no input to allow.
 *
 * The cost is real and is accepted: an operation that takes an argument (`delivery test <name>`,
 * `connection up <name>`) cannot be declared here yet, because declaring one would mean designing
 * where its parameter values may come from. The honest answer today is "not yet", not a hole.
 *
 * ── A wizard must never learn it was started remotely ───────────────────────────────────
 * A remotely-started wizard has to be indistinguishable from a locally-started one TO THE WIZARD,
 * or wizards start branching on it and the two paths drift. So the decision this module returns
 * carries an argv and NOTHING ELSE: no marker option, no environment, no field a caller could
 * pass down. There is nothing here to leak, which is a stronger guarantee than a rule saying not
 * to leak it. The wizard's questions reach the operator through the pending-prompt hub, on
 * whichever surface they are attending — which is the same path a locally-started wizard uses,
 * because it IS the same path.
 *
 * ── What is NOT here, and why ───────────────────────────────────────────────────────────
 * Every judgement below is about a specific operation, not a category:
 *
 *   - `auth enroll` — MINTS a device credential and PRINTS it. Output does not travel to the
 *     initiating device (deliberately — see "Not in this slice" in the design), so a remotely
 *     started enroll would emit a live credential onto a terminal nobody is sitting at. Refusing
 *     it is not caution about authority; it is refusing to put a secret somewhere nobody reads.
 *   - `auth revoke` — the operator's recovery lever when a device is LOST. A device that can
 *     revoke is a device that can cut off the operator's other devices, which is the one
 *     capability a stolen phone must not have. Named in R5 as the obvious exclusion.
 *   - `auth verify` — its entire security value is that a human is physically at the node
 *     comparing seven emoji. Starting it from elsewhere does not weaken it; it empties it.
 *   - `cert trust` (system store) — needs root at the node. `sudo` cannot be arranged from a
 *     phone and pretending otherwise would ship a button that always fails. Stated rather than
 *     silently omitted.
 *   - `intention arm`, `delivery list`, `delivery route`, `doctor`, `health` — non-interactive:
 *     their whole result is the payload they PRINT, and printed output does not travel. Starting
 *     one remotely would run it and show the operator nothing.
 *   - `init`, `sow` — `init` acts on whatever directory the node happens to be in, and `sow`
 *     completes through browser-based login flows that need the node's own display. Neither can
 *     honestly finish from a phone.
 *
 * None of those refusals is encoded as data. They are refusals BY SILENCE — there is no entry —
 * and this comment records the reasoning so the next reader does not have to re-derive it.
 */

/** One operation the operator has declared an enrolled device may start. */
export interface RemotelyInitiableOperation {
	/**
	 * The id a device sends. Matched EXACTLY — no trimming, no case folding, no prefix. It is
	 * spelled as the command path the operator would type, so the wire value and the thing it
	 * starts cannot drift into two different names.
	 */
	readonly id: string;
	/** The argv `refarm` is started with. A CONSTANT: nothing a device sends becomes argv. */
	readonly argv: readonly string[];
	/** Why this one is open, in one line. Printed by `refarm auth remote`, so the operator can
	 *  read the reasoning without reading this file. */
	readonly why: string;
}

/**
 * THE TABLE. Adding a line here is the whole act of opening an operation to devices, and it is
 * meant to be small enough that a reviewer reads all of it.
 */
export const REMOTELY_INITIABLE_OPERATIONS: readonly RemotelyInitiableOperation[] = Object.freeze([
	Object.freeze({
		id: "delivery add",
		argv: Object.freeze(["delivery", "add"]) as readonly string[],
		why:
			"A guided declaration whose entire interface is its questions, and they already reach " +
			"the device. It takes no argument, needs no root, writes only .refarm/config.json, and " +
			"what it writes is visible to `refarm delivery list` and removable. It is the operator " +
			"configuring a notification channel on the node without opening a terminal on the node — " +
			"the case this whole design was asked for.",
	}),
]);

/** Transport adaptation for Refarm's own question-only wizards; never part of the decision. */
export function remoteInitiationNeedsAttendance(operationId: string): boolean {
	return operationId === "delivery add";
}

interface WorkspaceOperationEntry {
	run: string[];
	description?: string;
	remote?: true;
}

/** Stable opaque id for a workspace operation. It is never parsed back into argv. */
export function workspaceRemoteOperationId(workspace: string, command: string): string {
	return `workspace:${workspace}:${command}`;
}

/** Project host-owned workspace allowlists into remotely inspectable operations. */
export function workspaceInitiationOperations(
	config: unknown,
	options: { baseDir?: string; remoteOnly?: boolean } = {},
): RemotelyInitiableOperation[] {
	const operations: RemotelyInitiableOperation[] = [];
	for (const workspace of declaredWorkspacesFromConfig(config, {
		baseDir: options.baseDir ?? process.cwd(),
	})) {
		if (!workspace) continue;
		const commands =
			(workspace as { commands?: Record<string, WorkspaceOperationEntry> }).commands ?? {};
		for (const [name, command] of Object.entries(commands)) {
			if (options.remoteOnly && command.remote !== true) continue;
			operations.push({
				id: workspaceRemoteOperationId(workspace.id, name),
				// Invoke the existing allowlist boundary by name. The device never supplies argv,
				// and execution re-reads the declaration instead of trusting this projection.
				argv: Object.freeze(["workspace", "run", workspace.id, name]),
				why:
					command.description ??
					`Named operation "${name}" declared by workspace "${workspace.id}".`,
			});
		}
	}
	return operations.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * What the caller authenticated as. Initiation is DEVICE-ONLY: a scoped credential — the one a
 * browser holds to answer questions — must never be able to start anything, whatever its scope.
 *
 * Modelled as a closed union rather than a boolean so "we did not check" cannot be spelled as
 * `false` and read as "checked, and it was fine".
 */
export type RemoteInitiationCredential =
	| { readonly kind: "device" }
	| { readonly kind: "scoped"; readonly scope: readonly string[] };

/** Why an initiation was refused. Never carries what the caller sent back to them verbatim. */
export type RemoteInitiationRefusal =
	| {
			readonly reason: "not-a-device";
			readonly detail: string;
	  }
	| {
			readonly reason: "undeclared";
			readonly detail: string;
	  };

/** The verdict. `ok: true` carries an argv and nothing else — see the header. */
export type RemoteInitiationDecision =
	| {
			readonly ok: true;
			readonly operation: RemotelyInitiableOperation;
			readonly argv: readonly string[];
	  }
	| { readonly ok: false; readonly refusal: RemoteInitiationRefusal };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * THE GATE. PURE: an id and a credential in, a verdict out. No filesystem, no config, no clock,
 * nothing a request can influence beyond the two values it passes.
 *
 * The credential is judged FIRST, deliberately. A caller that is not a device learns only that it
 * is not a device — never whether the id it named exists, which would make this a catalog anyone
 * could enumerate by guessing.
 */
export function resolveRemoteInitiation(request: {
	readonly operation: unknown;
	readonly credential: unknown;
}, operations: readonly RemotelyInitiableOperation[] = REMOTELY_INITIABLE_OPERATIONS): RemoteInitiationDecision {
	const credential = request.credential;
	if (!isRecord(credential) || credential.kind !== "device") {
		// Everything that is not exactly a device credential lands here: a scoped credential
		// (whatever its scope), an unrecognised shape, and silence. Fail-closed, one branch.
		const scoped =
			isRecord(credential) && credential.kind === "scoped"
				? " A scoped credential may answer the farm's questions; it may not start work."
				: "";
		return {
			ok: false,
			refusal: {
				reason: "not-a-device",
				detail:
					"Starting an operation on this node requires an enrolled device credential." + scoped,
			},
		};
	}

	if (typeof request.operation !== "string") {
		return {
			ok: false,
			refusal: {
				reason: "undeclared",
				detail: "No operation was named.",
			},
		};
	}
	const requested = request.operation;
	const operation = operations.find((entry) => entry.id === requested);
	if (!operation) {
		// The one closed branch, and the reason there is no other: an id that is not in the table
		// is refused whether it names a real refarm command, a workspace command from the
		// operator's own allowlist, or nothing at all. Silence is closed.
		return {
			ok: false,
			refusal: {
				reason: "undeclared",
				detail:
					"That operation is not declared as remotely initiable on this node. " +
					`Declared: ${operations.map((entry) => entry.id).join(", ") || "(none)"}.`,
			},
		};
	}
	return { ok: true, operation, argv: operation.argv };
}

/** The invocation an operator would type to run the operation at the node themselves. */
export function remoteInitiationCommandLine(operation: RemotelyInitiableOperation): string {
	return ["refarm", ...operation.argv].join(" ");
}

/** The shape of a commander command, named structurally so this module keeps no runtime
 *  dependency on commander — it is a pure declaration and stays one. */
interface CommandLike {
	name(): string;
	readonly commands: readonly CommandLike[];
}

/**
 * Every command path the CLI actually has, as the space-joined id a device would send.
 *
 * Exists so a refusal can tell "I do not know that command" from "I know it and it is not
 * open to devices" — two different sentences that a single `undeclared` verdict collapses.
 * The walk is the point: a command added to `program.ts` is covered for free, and a
 * hand-maintained list is exactly what fails to cover the next one.
 *
 * DERIVED, never authoritative. Nothing here decides whether something may be started —
 * {@link resolveRemoteInitiation} is the only gate, and this is consulted strictly AFTER it
 * has already refused, purely to phrase the refusal.
 */
export function everyCommandPath(root: CommandLike): string[] {
	const paths: string[] = [];
	const walk = (command: CommandLike, prefix: readonly string[]): void => {
		for (const child of command.commands) {
			// Commander keeps the declared spelling (`run <workspace> <command>`) in `name()` for
			// some commands; the head token is the name a device would ever plausibly send.
			const name = child.name().split(/\s+/)[0] ?? child.name();
			const here = [...prefix, name];
			paths.push(here.join(" "));
			walk(child, here);
		}
	};
	walk(root, []);
	return paths;
}
import { declaredWorkspacesFromConfig } from "@refarm.dev/config";
