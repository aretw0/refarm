import {
	createFileOperationTrail,
	createNodeOperationFileSystem,
	operationTimeline,
	recordOperation,
	undoOperationRecord,
	type OperationFileChange,
	type OperationFileSystem,
	type OperationRecord,
	type OperationRequest,
	type OperationTrail,
} from "@refarm.dev/operation-consent-v1";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * `refarm config set`/`unset` as OPERATIONS — applied, and REMEMBERED with their undo.
 *
 * WHY THERE IS NO PROMPT HERE, since that is the design decision and not an omission.
 * `docs/superpowers/specs/2026-07-30-operation-consent-and-record-design.md` has two separable
 * parts, and only one of them belongs to this command:
 *
 * - the **consent prompt** is for something proposing a change *on the operator's behalf* — the
 *   installer that wants to edit `.bashrc` must acquire the human first (R2);
 * - the **record** is R3: what changed, why, who, when, and how to undo it.
 *
 * `refarm config set runtime.autostart always` is the operator's own deliberate intent. Asking
 * them to confirm what they just typed carries no information and costs precisely what R4 exists
 * to protect: a prompt nobody learns from is a prompt people learn to click through, and the next
 * one — the real one — gets waved past too. So `config set` gets the record and no confirmation,
 * and consequently no `--yes` flag either: there is nothing to suppress.
 *
 * What it does NOT get to skip is being remembered. `config set`/`unset` mutated persisted
 * configuration and recorded nothing at all — "não configura nada e esquece", the exact failure
 * the design names, one layer in from the PATH line.
 *
 * WHERE THE TRAIL LIVES, and why it is not one fixed file. The trail sits BESIDE the
 * configuration it describes: `<scope>/.refarm/operations.json`, the same directory as the
 * `config.json` that was mutated.
 *
 * - For the default (home) scope that resolves to `~/.refarm/operations.json` — byte for byte the
 *   file the cold-bootstrap kit already writes its PATH decision into. That convergence is the
 *   point: one place to read "what has been configured on this machine, and by whom", whether the
 *   change came from the kit's installer or from a command. The kit chose that path so a decision
 *   survives `farm-update`; a home-scoped config change has exactly the same lifetime.
 * - For `--local` it resolves to `<repo>/.refarm/operations.json` instead, because a record whose
 *   `changes[].path` points inside a checkout must not outlive the checkout. Keeping it in HOME
 *   would accumulate undo snapshots for directories that no longer exist, and would make
 *   `refarm config history --local` in one repo show another repo's changes. A trail that travels
 *   with the thing it describes stays true; one that does not decays into a log of paths.
 *
 * Node-scoped (replicated) is deliberately NOT the answer for this slice, for the same reason
 * `surfaces` is read from the filesystem: this records what happened on THIS machine, and R5
 * keeps the record local to whichever machine performed the operation. Converging device records
 * into the node is a later slice.
 */

/** The two families of config operation. Distinct kinds, not one with a flag, because "I set
 *  this" and "I removed this so the default applies" are different intentions to read back. */
export const CONFIG_SET_KIND = "config-set" as const;
export const CONFIG_UNSET_KIND = "config-unset" as const;

export type ConfigScope = "home" | "local";

/** Where the operation trail for a mutated config file lives: beside it. */
export function configTrailPath(configFilePath: string): string {
	return path.join(path.dirname(configFilePath), "operations.json");
}

/**
 * The operation's IDENTITY — `config:<scope>:<key>`, deliberately NOT unique per change.
 *
 * `OperationRequest.id` is identity, never a nonce, and here that buys the history view: every
 * record about one key in one scope shares it, so `operationTimeline` answers "how did this value
 * get to be what it is" as a pure function over the trail.
 */
export function configOperationId(scope: ConfigScope, key: string): string {
	return `config:${scope}:${key}`;
}

export interface ConfigMutationInput {
	kind: typeof CONFIG_SET_KIND | typeof CONFIG_UNSET_KIND;
	key: string;
	/** The value being persisted — absent for an unset. */
	value?: string;
	scope: ConfigScope;
	/** The config file being written. */
	filePath: string;
	/** The COMPLETE file before the change — `null` when it does not exist yet. */
	before: string | null;
	/** The COMPLETE file after. Never `null`: neither operation deletes the config file. */
	after: string;
	/** The operator's own reason, when they gave one (`--why`). */
	why?: string | undefined;
	requestedAt: string;
}

/**
 * The request the record is made from. PURE.
 *
 * Exported because it is what a reviewer should read to check R3 is actually satisfied: the file,
 * both complete snapshots, the purpose, who asked, and an undo that is a snapshot restore rather
 * than a sentence.
 */
export function buildConfigOperationRequest(input: ConfigMutationInput): OperationRequest {
	const verb = input.kind === CONFIG_SET_KIND ? "set" : "unset";
	const title =
		input.kind === CONFIG_SET_KIND
			? `refarm config set ${input.key} ${input.value ?? ""}`.trimEnd()
			: `refarm config unset ${input.key}`;
	const change: OperationFileChange = {
		path: input.filePath,
		before: input.before,
		after: input.after,
	};
	return {
		id: configOperationId(input.scope, input.key),
		kind: input.kind,
		title,
		// The operator's words when they gave them; otherwise the honest default — WHAT they
		// asked for, never an invented motive. A record that guesses why is worse than one that
		// says only what.
		purpose:
			input.why?.trim() ||
			(input.kind === CONFIG_SET_KIND
				? `Operator set ${input.key} to ${JSON.stringify(input.value ?? "")} in the ${input.scope} scope.`
				: `Operator removed ${input.key} from the ${input.scope} scope so the default or environment applies.`),
		requester: `refarm config ${verb}`,
		requestedAt: input.requestedAt,
		changes: [change],
		undo: {
			kind: "restore-snapshot",
			summary:
				input.before === null
					? `Removes ${input.filePath} (it did not exist before this change).`
					: `Restores ${input.filePath} to exactly its contents before this change.`,
		},
	};
}

export interface ConfigRecordDeps {
	now?: () => string;
	/** WHO made the change. The OS user by default — they are who typed the command. */
	decidedBy?: string;
	host?: string;
	fs?: OperationFileSystem;
	/** Injected by tests so a trail can be driven in memory. */
	trail?: OperationTrail;
}

/** The operator identity a record is attributed to, when the caller does not name one. */
export function defaultDecidedBy(env: NodeJS.ProcessEnv = process.env): string {
	const fromEnv = env.USER?.trim() || env.LOGNAME?.trim();
	if (fromEnv) return fromEnv;
	try {
		return os.userInfo().username;
	} catch {
		return "operator";
	}
}

function trailFor(input: ConfigMutationInput, deps: ConfigRecordDeps): OperationTrail {
	return (
		deps.trail ??
		createFileOperationTrail(
			configTrailPath(input.filePath),
			deps.fs ?? createNodeOperationFileSystem(),
		)
	);
}

/**
 * Write the config change AND its record, or neither.
 *
 * The write is performed by the block, not by `writeConfig`, precisely so the rollback comes with
 * it: if the trail cannot be appended, the file goes back and the failure is raised. That is the
 * same guarantee the kit's PATH operation has, and it is what makes "remembered" a property of the
 * change rather than a best-effort side effect.
 */
export async function recordConfigMutation(
	input: ConfigMutationInput,
	deps: ConfigRecordDeps = {},
): Promise<OperationRecord> {
	const request = buildConfigOperationRequest(input);
	return recordOperation({
		request,
		trail: trailFor(input, deps),
		...(deps.fs ? { fs: deps.fs } : {}),
		...(deps.now ? { now: deps.now } : {}),
		decidedBy: deps.decidedBy ?? defaultDecidedBy(),
		host: deps.host ?? os.hostname(),
	});
}

/** Every record in a scope's trail, oldest → newest. A missing or corrupt trail reads empty —
 *  losing the memory must degrade into "nothing to show", never into a command that cannot run. */
export async function readConfigTrail(
	configFilePath: string,
	deps: ConfigRecordDeps = {},
): Promise<OperationRecord[]> {
	const trail =
		deps.trail ??
		createFileOperationTrail(
			configTrailPath(configFilePath),
			deps.fs ?? createNodeOperationFileSystem(),
		);
	return trail.read();
}

/** One line per record, as `refarm config history` prints it — what, when, who, why, and the
 *  command that would reverse it. PURE. */
export interface ConfigHistoryEntry {
	id: string;
	requestId: string;
	kind: string;
	title: string;
	purpose: string;
	requester: string;
	decidedBy: string;
	decision: string;
	decidedAt: string;
	paths: string[];
	undo: string;
	/** The exact command that reverses this record, or `null` when it cannot be reversed. */
	undoCommand: string | null;
}

/** Project the trail into the history view, newest first. PURE. */
export function buildConfigHistory(
	records: OperationRecord[],
	options: { local?: boolean; limit?: number } = {},
): ConfigHistoryEntry[] {
	const entries = records.map((record): ConfigHistoryEntry => {
		// Only an APPLIED change can be reversed. A decline changed nothing, and a reversal is
		// itself undone by re-applying rather than by "undoing the undo".
		const reversible = record.decision === "authorized" && record.undo.kind === "restore-snapshot";
		return {
			id: record.id,
			requestId: record.requestId,
			kind: record.kind,
			title: record.title,
			purpose: record.purpose,
			requester: record.requester,
			decidedBy: record.decidedBy,
			decision: record.decision,
			decidedAt: record.decidedAt,
			paths: record.changes.map((change) => change.path),
			undo: record.undo.kind === "restore-snapshot" ? record.undo.summary : record.undo.reason,
			undoCommand: reversible
				? `refarm config history undo ${record.id}${options.local ? " --local" : ""}`
				: null,
		};
	});
	entries.reverse();
	const limit = options.limit;
	return limit !== undefined && limit > 0 ? entries.slice(0, limit) : entries;
}

/** Every decision about ONE key in one scope, oldest → newest. PURE. */
export function configKeyTimeline(
	records: OperationRecord[],
	scope: ConfigScope,
	key: string,
): OperationRecord[] {
	return operationTimeline(records, configOperationId(scope, key));
}

/**
 * Reverse a recorded config change and append the reversal to the same trail.
 *
 * The trail stays append-only: the original record is never edited to pretend the change did not
 * happen. What the operator sees afterwards is the truth — the value went there, then came back.
 */
export async function undoConfigOperation(
	configFilePath: string,
	recordId: string,
	deps: ConfigRecordDeps = {},
): Promise<OperationRecord> {
	const trail =
		deps.trail ??
		createFileOperationTrail(
			configTrailPath(configFilePath),
			deps.fs ?? createNodeOperationFileSystem(),
		);
	const records = await trail.read();
	const record = records.find((entry) => entry.id === recordId);
	if (!record) {
		throw new Error(
			`No operation with id "${recordId}" in ${configTrailPath(configFilePath)}. ` +
				"Run `refarm config history` to see the ids that exist.",
		);
	}
	return undoOperationRecord({
		record,
		trail,
		...(deps.fs ? { fs: deps.fs } : {}),
		...(deps.now ? { now: deps.now } : {}),
		decidedBy: deps.decidedBy ?? defaultDecidedBy(),
	});
}

/** The complete current contents of a config file, or `null` when it does not exist — the
 *  `before` snapshot, read as BYTES rather than re-serialised from the parsed object, so the undo
 *  restores what was actually there (comments, ordering, trailing newline and all). */
export function readConfigSnapshot(filePath: string): string | null {
	try {
		return fs.readFileSync(filePath, "utf-8");
	} catch {
		return null;
	}
}
