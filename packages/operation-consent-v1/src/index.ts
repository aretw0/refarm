/**
 * operation-consent:v1 — a CONFIGURATION CHANGE is asked for, authorised, applied, and remembered.
 *
 * `packages/wallet/src/consent.ts` already proved the journey for a different domain: a service
 * SUBMITS a request, the citizen SEES it, DECIDES before anything happens, and the decision leaves a
 * durable trail with decline as a first-class outcome. That journey generalises. Its RECORD does
 * not: `AuthorizationReceipt` carries `holder`/`scope`/`expiresAt` — the vocabulary of *what was
 * revealed*. An operation has to record *what was changed* and *how to undo it*, and `scope:
 * string[]` cannot hold a file snapshot. So this is the sibling record, sharing the journey and the
 * append-only-history mechanism, not a receipt bent into a shape it was never designed for.
 *
 * Three properties are the whole point:
 *
 *  1. **The request is the diff, not a category.** `renderOperationRequest` states the file, the
 *     exact line, the position, and what the file looks like RIGHT NOW. The operator authorises a
 *     specific change; nobody is asked "may I configure your shell?".
 *  2. **The record carries the undo.** Every change is a full before/after snapshot — the same
 *     reasoning `history-contract-v1` applies to records: with no structural delta engine, a full
 *     snapshot is the only honest reconstruction. Undoing is applying the reverse of those
 *     snapshots, so the undo is executable, not a sentence in a log. An operation that cannot be
 *     undone must say so IN THE REQUEST, because that is information the operator deserves while
 *     deciding, not after.
 *  3. **A change that cannot be remembered is not made.** If the trail cannot be written after the
 *     files were, the change is rolled back and the failure raised. "Não configura nada e esquece"
 *     is the requirement; a silently unrecorded change is exactly that failure.
 *
 * Zero runtime dependencies, `node:` built-ins only — so the node and the zero-dependency device kit
 * (a phone in Termux with nothing but Node) can consume the same block. The operator channel is
 * accepted STRUCTURALLY rather than imported, which is what keeps `@refarm.dev/prompt-contract-v1`
 * off the dependency list while a real `OperatorChannel` still satisfies it. Cancellation is not
 * caught here: the prompt block's `OperatorPromptCancelledError` propagates, and nothing is applied
 * and nothing is recorded — a cancelled question was never answered.
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const OPERATION_CONSENT_CAPABILITY = "operation-consent:v1" as const;

/** The stable context IRI for operation-consent artifacts (parallels authorization/records). */
export const OPERATION_CONSENT_CONTEXT_IRI =
	"https://refarm.dev/contexts/operation-consent/v1" as const;

// ── The change ────────────────────────────────────────────────────────────────

/** WHERE a change lands, in the terms R2 requires: which line, at which position. */
export interface OperationInsertion {
	/** 1-based line number, in `after`, of the FIRST added line. */
	line: number;
	/** The exact text added (may span lines) — shown verbatim before the decision. */
	text: string;
	/** The position in the operator's own words ("no fim do arquivo", "antes da linha 3"). */
	placement: string;
}

/**
 * One file this operation writes, as a pair of COMPLETE snapshots.
 *
 * `before: null` means the file does not exist yet (applying creates it); `after: null` means it
 * must not exist afterwards (applying removes it). The pair is symmetric on purpose: reversing a
 * change is swapping the two, which is what makes the undo executable rather than descriptive.
 */
export interface OperationFileChange {
	/** Absolute path of the file. */
	path: string;
	/** The complete file BEFORE — `null` when it does not exist. */
	before: string | null;
	/** The complete file AFTER — `null` when the file must be removed. */
	after: string | null;
	/** The precise insertion, when the change adds text at a known place. Absent for a whole-file
	 *  rewrite, which the render then describes without a line number rather than inventing one. */
	insertion?: OperationInsertion;
}

/** The reverse of a change: what it takes to put the file back. PURE. */
export function reverseChange(change: OperationFileChange): OperationFileChange {
	return { path: change.path, before: change.after, after: change.before };
}

/** The reverse of a whole change set. PURE. */
export function reverseChanges(changes: OperationFileChange[]): OperationFileChange[] {
	return changes.map(reverseChange);
}

// ── The undo ──────────────────────────────────────────────────────────────────

/**
 * How the operation is undone — or an explicit, reasoned statement that it cannot be.
 *
 * `restore-snapshot` needs no payload: the record already holds every file's `before`, so the undo
 * IS the snapshots. `irreversible` exists so the request can say so out loud; a record whose undo is
 * missing would be a log, and a log does not give the operator sovereignty over what was done.
 */
export type OperationUndo =
	| { kind: "restore-snapshot"; summary: string }
	| { kind: "irreversible"; reason: string };

/** Can this operation be reversed? PURE. */
export function isReversible(undo: OperationUndo): boolean {
	return undo.kind === "restore-snapshot";
}

// ── The request ───────────────────────────────────────────────────────────────

/**
 * A proposed operation, stated exactly, BEFORE it is made.
 *
 * `id` is the operation's IDENTITY, not a nonce: the same question asked again must carry the same
 * id, because that is what lets a prior decline be recognised instead of re-asked. Derive it from
 * what makes the question the question (`shell-path:/home/op/.local/bin`), never from a clock.
 */
export interface OperationRequest {
	id: string;
	/** The family of operation ("shell-path"), for grouping and for a consumer's own dispatch. */
	kind: string;
	/** One line the operator reads first. */
	title: string;
	/** WHY — the purpose the operator is authorising, carried into the record verbatim. */
	purpose: string;
	/** WHO is asking (a wizard, an installer, a command). */
	requester: string;
	/** When the request was built (ISO-8601, injected — no ambient clock). */
	requestedAt: string;
	changes: OperationFileChange[];
	undo: OperationUndo;
	/** Anything else the operator needs WHILE DECIDING that the diff alone does not say — why this
	 *  file and not the other candidate, what will still be needed afterwards. Carried into the
	 *  record, because the reason a choice was made is part of judging whether it was made well. */
	notes?: string[];
}

// ── The record ────────────────────────────────────────────────────────────────

/**
 * The outcome of a decision. `declined` is first-class (R4) — a refusal that is dropped is a wizard
 * that asks again forever, which is how people are trained to click through prompts. `undone` is
 * the reversal, appended as its own record so the trail stays append-only and shows the file going
 * back, rather than a prior record being edited to claim it never happened.
 */
export type OperationDecision = "authorized" | "declined" | "undone";

/** What was done, why, by whom, and how to undo it — the record R3 demands. */
export interface OperationRecord {
	/** Unique per DECISION: `${requestId}#${decidedAt}`. */
	id: string;
	/** The operation's identity — what a later run matches to find the standing decision. */
	requestId: string;
	kind: string;
	title: string;
	/** WHY — copied from the request the operator authorised, never re-worded afterwards. */
	purpose: string;
	/** WHO ASKED. */
	requester: string;
	/** WHO AUTHORISED (or declined). */
	decidedBy: string;
	decision: OperationDecision;
	/** WHEN it was asked. */
	requestedAt: string;
	/** WHEN it was decided. */
	decidedAt: string;
	/** WHEN it was written to disk — `null` on a decline (nothing was written). */
	appliedAt: string | null;
	/** WHAT CHANGED — full before/after snapshots. On a decline these are the snapshots that were
	 *  PROPOSED, so the operator can later see what they refused, not merely that they refused. */
	changes: OperationFileChange[];
	/** HOW TO UNDO IT — or why it cannot be undone. */
	undo: OperationUndo;
	/** What the operator was told while deciding, beyond the diff itself. */
	notes?: string[];
	/** The machine that performed it. For this slice the record stays local to it (R5). */
	host?: string;
	/** The record id this decision deliberately supersedes — set only on a revisit, so "I changed
	 *  my mind" is visible in the trail as a chain rather than as two unrelated answers. */
	revisitOf?: string;
}

/** Build the record for a decision. PURE — clock and identity are injected. */
export function makeOperationRecord(input: {
	request: OperationRequest;
	decision: OperationDecision;
	decidedBy: string;
	decidedAt: string;
	appliedAt?: string | null;
	changes?: OperationFileChange[];
	host?: string;
	revisitOf?: string;
}): OperationRecord {
	const { request } = input;
	return {
		id: `${request.id}#${input.decidedAt}`,
		requestId: request.id,
		kind: request.kind,
		title: request.title,
		purpose: request.purpose,
		requester: request.requester,
		decidedBy: input.decidedBy,
		decision: input.decision,
		requestedAt: request.requestedAt,
		decidedAt: input.decidedAt,
		appliedAt: input.appliedAt ?? null,
		changes: input.changes ?? request.changes,
		undo: request.undo,
		...(request.notes?.length ? { notes: request.notes } : {}),
		...(input.host ? { host: input.host } : {}),
		...(input.revisitOf ? { revisitOf: input.revisitOf } : {}),
	};
}

// ── The trail ─────────────────────────────────────────────────────────────────

/**
 * The durable trail — append-only, like `history-contract-v1`'s revisions. Reading returns every
 * record in the order it was appended, which is what makes "the latest decision" a pure function
 * over the list rather than a mutable flag someone has to keep correct.
 */
export interface OperationTrail {
	read(): Promise<OperationRecord[]>;
	append(record: OperationRecord): Promise<OperationRecord>;
}

/** The on-disk shape of a file trail. */
export interface OperationTrailDocument {
	capability: typeof OPERATION_CONSENT_CAPABILITY;
	version: 1;
	records: OperationRecord[];
}

/** The operator's STANDING decision on an operation — the last thing they said about it, or null
 *  when they have never been asked. PURE. This is what stops a wizard re-asking (R4). */
export function standingDecision(
	records: OperationRecord[],
	requestId: string,
): OperationRecord | null {
	let standing: OperationRecord | null = null;
	for (const record of records) {
		if (record.requestId === requestId) standing = record;
	}
	return standing;
}

/** Every decision about one operation, oldest → newest — the "was this well done?" view. PURE. */
export function operationTimeline(
	records: OperationRecord[],
	requestId: string,
): OperationRecord[] {
	return records.filter((record) => record.requestId === requestId);
}

/** An in-memory trail — the reference adapter, and what tests drive. */
export function createMemoryOperationTrail(seed: OperationRecord[] = []): OperationTrail {
	const records = [...seed];
	return {
		async read() {
			return [...records];
		},
		async append(record) {
			records.push(record);
			return record;
		},
	};
}

/**
 * A trail kept in one JSON file. The block does not choose WHERE — a consumer knows whether its
 * records belong beside a kit, a config, or a home directory, and hard-coding a path here would
 * make a generic block know about one deployment's layout.
 *
 * An unreadable or corrupt file reads as an EMPTY trail rather than throwing: losing the memory of
 * past decisions must degrade into asking again, never into a wizard that cannot run at all.
 */
export function createFileOperationTrail(
	path: string,
	fs: OperationFileSystem = createNodeOperationFileSystem(),
): OperationTrail {
	async function readAll(): Promise<OperationRecord[]> {
		const raw = await fs.readFile(path);
		if (raw === null) return [];
		try {
			const parsed = JSON.parse(raw) as Partial<OperationTrailDocument>;
			return Array.isArray(parsed?.records) ? parsed.records : [];
		} catch {
			return [];
		}
	}
	return {
		read: readAll,
		async append(record) {
			const document: OperationTrailDocument = {
				capability: OPERATION_CONSENT_CAPABILITY,
				version: 1,
				records: [...(await readAll()), record],
			};
			await fs.writeFile(path, `${JSON.stringify(document, null, 2)}\n`);
			return record;
		},
	};
}

// ── The filesystem seam ───────────────────────────────────────────────────────

/** The only I/O this block performs, behind an interface so a test never needs a real HOME. */
export interface OperationFileSystem {
	/** The file's contents, or `null` when it does not exist. */
	readFile(path: string): Promise<string | null>;
	/** Write contents, creating parent directories. */
	writeFile(path: string, content: string): Promise<void>;
	/** Remove a file. A missing file is not an error. */
	removeFile(path: string): Promise<void>;
}

/**
 * The real filesystem.
 *
 * `writeFile` truncates in place instead of writing a temp file and renaming over the target. For a
 * shell profile that difference matters: a rename replaces the inode, so the file would silently
 * come back with default permissions and lose any hard link or ownership it had. Atomicity is worth
 * less here than not quietly re-permissioning the operator's `~/.bashrc`.
 */
export function createNodeOperationFileSystem(): OperationFileSystem {
	return {
		async readFile(path) {
			try {
				return await readFile(path, "utf8");
			} catch {
				return null;
			}
		},
		async writeFile(path, content) {
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, content);
		},
		async removeFile(path) {
			await rm(path, { force: true });
		},
	};
}

/** Apply a change set — write every `after` (or remove the file when `after` is null). */
export async function applyChanges(
	changes: OperationFileChange[],
	fs: OperationFileSystem,
): Promise<void> {
	for (const change of changes) {
		if (change.after === null) await fs.removeFile(change.path);
		else await fs.writeFile(change.path, change.after);
	}
}

// ── Rendering the request ─────────────────────────────────────────────────────

/** Every operator-facing word the render emits, so a surface can translate without forking it. */
export interface OperationRenderLabels {
	heading: string;
	purpose: string;
	requester: string;
	file: string;
	fileMissing: string;
	fileLines: (count: number) => string;
	placement: string;
	added: string;
	current: string;
	currentEmpty: string;
	result: string;
	undo: string;
	irreversible: string;
	question: string;
	authorize: string;
	authorizeHint: string;
	decline: string;
	declineHint: string;
	later: string;
	laterHint: string;
}

export const DEFAULT_OPERATION_LABELS: OperationRenderLabels = {
	heading: "Operação proposta",
	purpose: "Por quê",
	requester: "Quem pede",
	file: "Arquivo",
	fileMissing: "ainda não existe — será criado",
	fileLines: (count) => `${count} linha${count === 1 ? "" : "s"}`,
	placement: "Onde",
	added: "O que acrescento, exatamente",
	current: "Como está agora",
	currentEmpty: "(vazio)",
	result: "Como fica",
	undo: "Desfazer",
	irreversible: "NÃO dá para desfazer",
	question: "Autorizo esta operação?",
	authorize: "Sim — faça a alteração",
	authorizeHint: "aplico agora e guardo o registro com o desfazer",
	decline: "Não — e não me pergunte de novo",
	declineHint: "registro a recusa; a instrução manual continua valendo",
	later: "Agora não — pergunte na próxima vez",
	laterHint: "não registro nada",
};

function splitLines(content: string): string[] {
	const lines = content.split("\n");
	// A trailing newline is a terminator, not an empty last line — dropping it keeps
	// "how many lines" honest and stops the render showing a phantom blank tail.
	if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
	return lines;
}

function numbered(lines: string[], from: number, marked: Set<number>, width: number): string[] {
	return lines.map((line, index) => {
		const lineNumber = from + index;
		const mark = marked.has(lineNumber) ? "+" : " ";
		return `      ${mark} ${String(lineNumber).padStart(width)} │ ${line}`;
	});
}

/** How many lines of context the render shows around an insertion, and of the current tail. */
export const OPERATION_RENDER_CONTEXT_LINES = 3;

/**
 * The request as the operator reads it: which file, which line, at which position, what the file
 * looks like now, what it looks like after, and how it is undone. PURE — returns lines; the caller
 * decides where they go (stdout, a TUI pane, an HTML pane).
 *
 * This is R2 made concrete. Anything less — "may I configure your shell?" — is asking for a
 * category of permission, which is exactly the prompt people learn to click through.
 */
export function renderOperationRequest(
	request: OperationRequest,
	options: { labels?: Partial<OperationRenderLabels>; contextLines?: number } = {},
): string[] {
	const l = { ...DEFAULT_OPERATION_LABELS, ...options.labels };
	const context = options.contextLines ?? OPERATION_RENDER_CONTEXT_LINES;
	const out: string[] = [`🔧 ${l.heading}: ${request.title}`];
	out.push(`   ${l.purpose}: ${request.purpose}`);
	out.push(`   ${l.requester}: ${request.requester}`);

	for (const change of request.changes) {
		const beforeLines = change.before === null ? [] : splitLines(change.before);
		const afterLines = change.after === null ? [] : splitLines(change.after);
		const state = change.before === null ? l.fileMissing : l.fileLines(beforeLines.length);
		out.push(`   ${l.file}: ${change.path} (${state})`);

		if (change.insertion) {
			out.push(`   ${l.placement}: ${change.insertion.placement}`);
			out.push(`   ${l.added}:`);
			for (const line of change.insertion.text.split("\n")) out.push(`       ${line}`);
		}

		if (change.before !== null) {
			out.push(`   ${l.current}:`);
			const tail = beforeLines.slice(Math.max(0, beforeLines.length - context));
			const from = beforeLines.length - tail.length + 1;
			const width = String(beforeLines.length).length;
			if (tail.length === 0 || (tail.length === 1 && tail[0] === "")) {
				out.push(`       ${l.currentEmpty}`);
			} else {
				out.push(...numbered(tail, from, new Set(), width));
			}
		}

		if (change.after !== null && change.insertion) {
			const added = change.insertion.text.split("\n").length;
			const first = change.insertion.line;
			const last = first + added - 1;
			const start = Math.max(1, first - context);
			const end = Math.min(afterLines.length, last + context);
			const marked = new Set<number>();
			for (let n = first; n <= last; n++) marked.add(n);
			out.push(`   ${l.result}:`);
			out.push(...numbered(afterLines.slice(start - 1, end), start, marked, String(end).length));
		}
	}

	for (const note of request.notes ?? []) out.push(`   ℹ️  ${note}`);
	out.push(
		request.undo.kind === "restore-snapshot"
			? `   ${l.undo}: ${request.undo.summary}`
			: `   ⚠️  ${l.irreversible}: ${request.undo.reason}`,
	);
	return out;
}

/** A one-screen summary of what was decided, for "was this well done?". PURE. */
export function renderOperationRecord(
	record: OperationRecord,
	options: { labels?: Partial<OperationRenderLabels> } = {},
): string[] {
	const l = { ...DEFAULT_OPERATION_LABELS, ...options.labels };
	const verb =
		record.decision === "authorized"
			? "autorizada"
			: record.decision === "declined"
				? "recusada"
				: "desfeita";
	const out = [
		`• ${record.title} — ${verb} em ${record.decidedAt} por ${record.decidedBy}`,
		`   ${l.purpose}: ${record.purpose}`,
		`   ${l.requester}: ${record.requester}`,
	];
	for (const change of record.changes) out.push(`   ${l.file}: ${change.path}`);
	out.push(
		record.undo.kind === "restore-snapshot"
			? `   ${l.undo}: ${record.undo.summary}`
			: `   ⚠️  ${l.irreversible}: ${record.undo.reason}`,
	);
	return out;
}

// ── The decision ──────────────────────────────────────────────────────────────

export const OPERATION_AUTHORIZE = "authorize" as const;
export const OPERATION_DECLINE = "decline" as const;
export const OPERATION_LATER = "later" as const;

/** The three answers. `later` exists so "no" can mean NO — an operator who only wants to skip this
 *  run is not forced into a permanent refusal to keep the wizard quiet. */
export type OperationAnswer =
	| typeof OPERATION_AUTHORIZE
	| typeof OPERATION_DECLINE
	| typeof OPERATION_LATER;

/** The prompt shape — structurally a `SelectPrompt` from `@refarm.dev/prompt-contract-v1`, spelled
 *  here so this block imports nothing. */
export interface OperationDecisionPrompt {
	type: "select";
	question: string;
	options: Array<{ value: string; label: string; description?: string }>;
	default: string;
}

/**
 * Whatever can ask the operator. Structural, not imported: a real `OperatorChannel` satisfies it,
 * and so does a test double, and neither costs this block a dependency.
 */
export interface OperationConsentChannel {
	ask(prompt: OperationDecisionPrompt): Promise<string>;
}

/** The decision prompt. Defaults to `later`, so pressing Enter changes NOTHING. PURE. */
export function operationDecisionPrompt(
	request: OperationRequest,
	options: { labels?: Partial<OperationRenderLabels> } = {},
): OperationDecisionPrompt {
	const l = { ...DEFAULT_OPERATION_LABELS, ...options.labels };
	return {
		type: "select",
		question: `${l.question} (${request.title})`,
		options: [
			{ value: OPERATION_AUTHORIZE, label: l.authorize, description: l.authorizeHint },
			{ value: OPERATION_DECLINE, label: l.decline, description: l.declineHint },
			{ value: OPERATION_LATER, label: l.later, description: l.laterHint },
		],
		default: OPERATION_LATER,
	};
}

// ── The journey ───────────────────────────────────────────────────────────────

export type OperationOutcome =
	/** The operator already answered this exact question; nothing was asked and nothing changed. */
	| { status: "already-decided"; record: OperationRecord }
	/** No operator to ask (no TTY, no channel): nothing asked, nothing read, nothing recorded. */
	| { status: "no-operator"; record: null }
	| { status: "authorized"; record: OperationRecord }
	| { status: "declined"; record: OperationRecord }
	/** "Agora não" — deliberately nothing recorded, so the question comes back next run. */
	| { status: "deferred"; record: null };

export interface RunOperationConsentOptions {
	request: OperationRequest;
	trail: OperationTrail;
	/** `null`/absent ⇒ there is nobody to ask. Never prompts, never records. */
	channel?: OperationConsentChannel | null;
	fs?: OperationFileSystem;
	now?: () => string;
	/** Who is authorising — an operator handle, a device name, whatever the deployment knows. */
	decidedBy?: string;
	/** The machine performing the operation (R5: the record stays here for this slice). */
	host?: string;
	/** Deliberately re-open a question the operator already answered. The new record links back to
	 *  the one it supersedes, so a change of mind is a chain in the trail, not an orphan. */
	revisit?: boolean;
	labels?: Partial<OperationRenderLabels>;
	/** Where the request text goes. Absent ⇒ the caller renders it itself. */
	announce?: (line: string) => void;
}

/**
 * Propose → see → decide → apply → record.
 *
 * Ordering is the design. The standing decision is consulted BEFORE the operator is disturbed;
 * files are written BEFORE the record, and if the record cannot be written the files are put back
 * and the failure raised — a change nobody can remember is a change this block will not make.
 *
 * Cancellation (`OperatorPromptCancelledError` from the prompt block) is deliberately not caught:
 * it propagates with nothing applied and nothing recorded.
 */
export async function runOperationConsent(
	options: RunOperationConsentOptions,
): Promise<OperationOutcome> {
	const {
		request,
		trail,
		channel = null,
		fs = createNodeOperationFileSystem(),
		now = () => new Date().toISOString(),
		decidedBy = "operator",
		host,
		revisit = false,
		labels,
		announce,
	} = options;

	// Nobody to ask ⇒ nothing happens at all. Checked first so a non-interactive run neither
	// prompts nor touches the trail: its behaviour is exactly what it was before this block existed.
	if (!channel) return { status: "no-operator", record: null };

	const prior = standingDecision(await trail.read(), request.id);
	if (prior && !revisit) return { status: "already-decided", record: prior };

	if (announce) {
		for (const line of renderOperationRequest(request, { labels })) announce(line);
	}

	const answer = await channel.ask(operationDecisionPrompt(request, { labels }));
	if (answer !== OPERATION_AUTHORIZE && answer !== OPERATION_DECLINE) {
		return { status: "deferred", record: null };
	}

	const decidedAt = now();
	const revisitOf = revisit && prior ? prior.id : undefined;

	if (answer === OPERATION_DECLINE) {
		const record = makeOperationRecord({
			request,
			decision: "declined",
			decidedBy,
			decidedAt,
			appliedAt: null,
			host,
			revisitOf,
		});
		await trail.append(record);
		return { status: "declined", record };
	}

	await applyChanges(request.changes, fs);
	const record = makeOperationRecord({
		request,
		decision: "authorized",
		decidedBy,
		decidedAt,
		appliedAt: decidedAt,
		host,
		revisitOf,
	});
	try {
		await trail.append(record);
	} catch (error) {
		// Roll back rather than leave an unrecorded change behind. Best-effort: if the rollback
		// itself fails there is nothing honest left to do but raise the original failure, with the
		// snapshots still in the error's reach through `request.changes`.
		try {
			await applyChanges(reverseChanges(request.changes), fs);
		} catch {
			// fall through — the append failure is the one worth reporting
		}
		throw error;
	}
	return { status: "authorized", record };
}

export interface UndoOperationOptions {
	/** The record to reverse — must be an `authorized` one with a reversible undo. */
	record: OperationRecord;
	trail: OperationTrail;
	fs?: OperationFileSystem;
	now?: () => string;
	decidedBy?: string;
	host?: string;
}

/**
 * Reverse an applied operation and APPEND the reversal as its own record.
 *
 * The trail stays append-only (history-contract-v1's rule): the original record is never edited to
 * pretend the change did not happen. The undo record's changes are the reverse snapshots, so the
 * trail reads as what it is — the file went there, then came back.
 */
export async function undoOperationRecord(options: UndoOperationOptions): Promise<OperationRecord> {
	const {
		record,
		trail,
		fs = createNodeOperationFileSystem(),
		now = () => new Date().toISOString(),
		decidedBy = record.decidedBy,
		host = record.host,
	} = options;

	if (record.decision !== "authorized") {
		throw new Error(
			`operation-consent: only an authorized operation can be undone (got "${record.decision}")`,
		);
	}
	if (!isReversible(record.undo)) {
		throw new Error(
			`operation-consent: "${record.title}" was recorded as irreversible — it cannot be undone`,
		);
	}

	const changes = reverseChanges(record.changes);
	await applyChanges(changes, fs);
	const undoneAt = now();
	const undone: OperationRecord = {
		id: `${record.requestId}#${undoneAt}`,
		requestId: record.requestId,
		kind: record.kind,
		title: record.title,
		purpose: record.purpose,
		requester: record.requester,
		decidedBy,
		decision: "undone",
		requestedAt: record.requestedAt,
		decidedAt: undoneAt,
		appliedAt: undoneAt,
		changes,
		undo: { kind: "restore-snapshot", summary: `Reaplica a operação "${record.title}".` },
		...(host ? { host } : {}),
		revisitOf: record.id,
	};
	await trail.append(undone);
	return undone;
}
