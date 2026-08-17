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
	/**
	 * The QUESTIONS still standing — asked, not yet decided.
	 *
	 * OPTIONAL, and `undefined` is a readable answer: this trail cannot remember an outstanding
	 * question, so a caller must not conclude from an empty list that nobody has asked. Same third
	 * state `queryNodesPage` expresses in the storage contract.
	 */
	readQuestions?(): Promise<OperationQuestion[]>;
	openQuestion?(question: OperationQuestion): Promise<void>;
	/** The ASKER finished — answered, deferred, or raised. Ordinary end of a question. */
	closeQuestion?(requestId: string): Promise<void>;
	/**
	 * THE OPERATOR let it go: it is no longer relevant, or it was handled elsewhere.
	 *
	 * The same removal as `closeQuestion` and a different fact, which is why it has its own name.
	 * A question closed by its asker was resolved through the machinery; one dismissed by the
	 * operator was resolved OUTSIDE it — the VPN was brought up by hand, the deploy was cancelled,
	 * the reason evaporated. Reusing one verb for both would make the trail unable to say which.
	 *
	 * IT CLEARS THE NODE'S MEMORY, NOT A LIVE CARD. If the asker is still running and still
	 * waiting, its prompt is unaffected — that lives in the hub, under P1, and belongs to the
	 * process that put it. Dismissing here says "stop telling me about this", not "cancel it".
	 */
	dismissQuestion?(requestId: string): Promise<boolean>;
	/**
	 * Stop reporting every question whose window has closed. Returns how many went.
	 *
	 * The bulk form of `dismissQuestion`, and the one an operator actually reaches for: nobody
	 * dismisses fourteen things one id at a time. It touches only what has EXPIRED — an
	 * outstanding question is a live obligation and is never cleared by a tidy-up.
	 */
	dismissExpiredQuestions?(now: string): Promise<number>;
}

/**
 * A question that has been ASKED and not yet decided.
 *
 * ## Why this exists, and what it is not
 *
 * The trail already remembers DECISIONS, durably, and `standingDecision` is what stops a wizard
 * re-asking something already settled. Nothing remembered a question that was still WAITING — so
 * a background run that asked, and died before an answer came, left no trace of having asked. On
 * its next run it asked again, and again, which is how an operator ends up with the same card
 * four times for one VPN and learns that the questions are noise.
 *
 * That is also ISS-077's sentence, exactly: *"waiting for a human" is indistinguishable from
 * "dead"*. It is distinguishable now — one of them leaves this behind.
 *
 * ## It does not weaken P1
 *
 * `pending_prompt.rs` keeps its principle: a PROMPT's lifetime is its asker's, nothing persists,
 * no garbage collection, no stale-answer problem. This is a different record in a different place
 * — the trail the operator's decisions already live in — saying that a question was put. The
 * prompt still dies with its asker; the memory that it was asked does not.
 *
 * ## It expires by time, never by sweeping
 *
 * `expiresAt` carries the asker's own deadline. A run that dies hard leaves the record behind, and
 * a record with no expiry would stand forever and block the question from ever being asked again —
 * turning a crash into permanent silence. Past its deadline the record is `expired`, which is a
 * third state and not an absence: it says somebody asked, nobody answered, and the window closed.
 * Same self-expiry the security gate's accepted advisories carry, for the same reason.
 */
export interface OperationQuestion {
	/** The operation's identity — the same key `standingDecision` matches on. */
	requestId: string;
	kind: string;
	title: string;
	/** WHY, copied from the request, so a record found later explains itself. */
	purpose: string;
	/** WHO ASKED — and, with `host`/`pid`, whether that process is still around. */
	requester: string;
	askedAt: string;
	/** ISO. `null` only when the asker declared no deadline, which this surface discourages. */
	expiresAt: string | null;
	host?: string;
	pid?: number;
	/**
	 * THE WHOLE REQUEST, so this question can still be answered when the process that put it is
	 * gone.
	 *
	 * ## Why the title was not enough
	 *
	 * The first version of this record carried what a SURFACE needs — title, purpose, who asked.
	 * That is enough to report a question and enough to stop a second run asking it again. It is
	 * not enough to ANSWER one: a decision and its application happen together in this block, and
	 * `already-decided` deliberately does not re-apply. So a decision recorded out of band would
	 * have been a decision that never took effect — a worse outcome than not being able to decide
	 * at all, because it looks like it worked.
	 *
	 * The request carries its own `changes`, with a complete `before` and `after` for each file,
	 * which is exactly what applying it later needs.
	 *
	 * OPTIONAL, because a trail written before this field existed has questions without one. Those
	 * can be reported and dismissed; they cannot be answered, and the surface says so rather than
	 * offering a button that fails.
	 */
	request?: OperationRequest;
}

/** What answering a standing question did — and every way it can honestly fail. */
export type AnswerStandingQuestionOutcome =
	| { status: "applied"; record: OperationRecord }
	| { status: "declined"; record: OperationRecord }
	/** No standing question with that id. Not an error: it may have been answered a moment ago. */
	| { status: "not-found"; record: null }
	/** Its window closed before anyone answered. */
	| { status: "expired"; record: null }
	/** Recorded before the request was stored, so there is nothing to apply. */
	| { status: "unanswerable"; record: null }
	/**
	 * THE WORLD MOVED. At least one file no longer looks like it did when the question was put, so
	 * applying the stored `after` would clobber whatever changed in between.
	 *
	 * This is the second half of ISS-118 made real: a precondition checked BEFORE asking is not
	 * enough, because the gap between asking and answering is exactly where a card sits on a phone
	 * for an hour. Refusing here is the only honest answer — the operator authorised a change to
	 * the file they were shown, not to this one.
	 */
	| { status: "stale"; record: null; drifted: string[] };

/**
 * PURE-ish (reads files). Is this change ALREADY DONE?
 *
 * ## The operator's complaint, answered without a word of new vocabulary
 *
 * *"um operador ficando pedindo pra conectar na vpn sendo que já esta conectado"*. The generic
 * form is: a question whose precondition already holds should not be asked. It looked like it
 * needed a new declaration — a predicate per operation, domain knowledge in a block that has
 * none — and it did not. Every request already carries a complete `after` for each file it
 * touches. If the world ALREADY looks like that, there is nothing to do, so there is nothing to
 * consent to.
 *
 * It is `driftedChanges` read the other way round, and that symmetry is the point: one asks
 * whether reality still matches where we STARTED, the other whether it already matches where we
 * were GOING.
 *
 * ## An empty change set is NOT already applied
 *
 * A request with no file changes describes a side effect this block cannot see: something leaves
 * the machine, or a command is handed back for the operator to run. Vacuous truth would silently
 * skip asking about every one of them, which is the opposite of what this is for.
 */
export async function alreadyApplied(
	changes: readonly OperationFileChange[],
	fs: OperationFileSystem,
): Promise<boolean> {
	if (changes.length === 0) return false;
	for (const change of changes) {
		if ((await fs.readFile(change.path)) !== change.after) return false;
	}
	return true;
}

/** PURE-ish (reads files). Which of a request's changes no longer match the world they were
 *  captured from. Empty means every `before` is still true. */
export async function driftedChanges(
	changes: readonly OperationFileChange[],
	fs: OperationFileSystem,
): Promise<string[]> {
	const drifted: string[] = [];
	for (const change of changes) {
		const current = await fs.readFile(change.path);
		if (current !== change.before) drifted.push(change.path);
	}
	return drifted;
}

/**
 * Answer a question whose asker is gone.
 *
 * The loop this completes: a run asks and dies, the node remembers, `refarm resume` reports it,
 * and this is where the operator's answer finally lands — applying the change the original process
 * would have applied, and recording the decision in the same trail it would have written to.
 */
export async function answerStandingQuestion(options: {
	requestId: string;
	decision: "authorized" | "declined";
	trail: OperationTrail;
	fs?: OperationFileSystem;
	now?: () => string;
	decidedBy?: string;
	host?: string;
}): Promise<AnswerStandingQuestionOutcome> {
	const fs = options.fs ?? createNodeOperationFileSystem();
	const now = options.now ?? (() => new Date().toISOString());
	const decidedAt = now();
	const questions = (await options.trail.readQuestions?.()) ?? [];
	const { standing, question } = standingQuestion(questions, options.requestId, decidedAt);
	if (!question) return { status: "not-found", record: null };
	if (standing === "expired") return { status: "expired", record: null };
	if (!question.request) return { status: "unanswerable", record: null };

	const request = question.request;
	if (options.decision === "declined") {
		const record = makeOperationRecord({
			request,
			decision: "declined",
			decidedBy: options.decidedBy ?? "operator",
			decidedAt,
			appliedAt: null,
			...(options.host ? { host: options.host } : {}),
		});
		await options.trail.append(record);
		return { status: "declined", record };
	}

	const drifted = await driftedChanges(request.changes, fs);
	if (drifted.length > 0) return { status: "stale", record: null, drifted };

	await applyChanges(request.changes, fs);
	const record = makeOperationRecord({
		request,
		decision: "authorized",
		decidedBy: options.decidedBy ?? "operator",
		decidedAt,
		appliedAt: decidedAt,
		...(options.host ? { host: options.host } : {}),
	});
	await options.trail.append(record);
	return { status: "applied", record };
}

/**
 * Every question this node is waiting on the operator for, folded across the trails that keep
 * them.
 *
 * ## Why a summary type exists at all
 *
 * The durable question record stops a run asking twice. It does nothing for the operator until
 * something SHOWS it — a record nobody reads is a write-only file, and the failure it was built
 * to prevent (four cards for one VPN) is a failure of ATTENTION, which only a surface fixes.
 *
 * ## `expired` is reported, not swept
 *
 * A question whose window closed is not noise: it says somebody asked, nobody answered, and the
 * chance passed. That is exactly the fact an operator needs in order to notice a commitment the
 * node could not keep — the same reason the automation spec reports a skipped window rather than
 * silently moving on (D5). Sweeping them would make the node look like it never asked.
 */
export interface StandingQuestions {
	outstanding: OperationQuestion[];
	expired: OperationQuestion[];
}

/** PURE. Fold a set of questions into what is still waiting and what timed out. Newest first,
 *  because an operator scanning a list reads the top of it. */
export function summariseStandingQuestions(
	questions: readonly OperationQuestion[],
	now: string,
): StandingQuestions {
	const outstanding: OperationQuestion[] = [];
	const expired: OperationQuestion[] = [];
	for (const question of questions) {
		const { standing } = standingQuestion([question], question.requestId, now);
		if (standing === "outstanding") outstanding.push(question);
		else if (standing === "expired") expired.push(question);
	}
	const newestFirst = (a: OperationQuestion, b: OperationQuestion) => b.askedAt.localeCompare(a.askedAt);
	return { outstanding: outstanding.sort(newestFirst), expired: expired.sort(newestFirst) };
}

/** What a standing question MEANS. Three states, never two: an absent record is not the same
 *  fact as a record whose window closed. */
export type QuestionStanding = "outstanding" | "expired" | "none";

/**
 * PURE. Whether this operation is already being asked about.
 *
 * `none` covers both "never asked" and "asked and since decided" — the caller checks
 * `standingDecision` for the difference, which is the question that function already answers.
 */
export function standingQuestion(
	questions: OperationQuestion[],
	requestId: string,
	now: string,
): { standing: QuestionStanding; question: OperationQuestion | null } {
	let latest: OperationQuestion | null = null;
	for (const question of questions) {
		if (question.requestId === requestId) latest = question;
	}
	if (!latest) return { standing: "none", question: null };
	if (latest.expiresAt !== null && latest.expiresAt <= now) {
		return { standing: "expired", question: latest };
	}
	return { standing: "outstanding", question: latest };
}

/** The on-disk shape of a file trail. */
export interface OperationTrailDocument {
	capability: typeof OPERATION_CONSENT_CAPABILITY;
	version: 1;
	records: OperationRecord[];
	/** ADDITIVE: a document written before this field existed simply has none, and reads as a
	 *  trail that remembers decisions but not outstanding questions. */
	questions?: OperationQuestion[];
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
	options: {
		/** Injectable so the retention rule is testable without waiting a day. */
		now?: () => string;
		maxExpiredKept?: number;
	} = {},
): OperationTrail {
	const now = options.now ?? (() => new Date().toISOString());
	const maxExpiredKept = options.maxExpiredKept ?? DEFAULT_EXPIRED_QUESTIONS_KEPT;

	/** PURE-ish (reads the clock): drop the oldest expired questions past the bound. Outstanding
	 *  ones are untouched, whatever the count — see {@link DEFAULT_EXPIRED_QUESTIONS_KEPT}. */
	function prune(questions: OperationQuestion[]): OperationQuestion[] {
		const summary = summariseStandingQuestions(questions, now());
		if (summary.expired.length <= maxExpiredKept) return questions;
		const kept = new Set(summary.expired.slice(0, maxExpiredKept).map((q) => q.requestId));
		return questions.filter(
			(question) =>
				summary.expired.every((expired) => expired.requestId !== question.requestId) ||
				kept.has(question.requestId),
		);
	}

	async function readDocument(): Promise<Partial<OperationTrailDocument>> {
		const raw = await fs.readFile(path);
		if (raw === null) return {};
		try {
			return JSON.parse(raw) as Partial<OperationTrailDocument>;
		} catch {
			return {};
		}
	}
	async function readAll(): Promise<OperationRecord[]> {
		const parsed = await readDocument();
		return Array.isArray(parsed.records) ? parsed.records : [];
	}
	async function readQuestions(): Promise<OperationQuestion[]> {
		const parsed = await readDocument();
		return Array.isArray(parsed.questions) ? parsed.questions : [];
	}
	async function write(
		records: OperationRecord[],
		unpruned: OperationQuestion[],
	): Promise<void> {
		// Retention is applied ON WRITE, so a trail that is never touched again never grows, and
		// one that is touched cleans up as a side effect of the work rather than needing a sweep.
		const questions = prune(unpruned);
		// NOTHING TO REMEMBER ⇒ NO FILE. A run that asks and then defers used to leave no trace on
		// disk at all, and that is a property worth keeping: "the operator was asked and said not
		// now" must not be distinguishable from "nobody ran this" by a stray empty document. The
		// standing-question record made every ask touch the file, so this puts it back.
		//
		// A crashed run still leaves its question behind, because nothing removes it — which is
		// the whole point, and exactly why the removal is conditional on BOTH lists being empty.
		if (records.length === 0 && questions.length === 0) {
			await fs.removeFile(path);
			return;
		}
		const document: OperationTrailDocument = {
			capability: OPERATION_CONSENT_CAPABILITY,
			version: 1,
			records,
			// Omitted when empty, so a trail that never asked anything keeps the exact document
			// shape it had before this field existed.
			...(questions.length > 0 ? { questions } : {}),
		};
		await fs.writeFile(path, `${JSON.stringify(document, null, 2)}\n`);
	}
	return {
		read: readAll,
		readQuestions,
		async append(record) {
			// A decision ENDS the question by definition, so appending one clears any standing
			// record for the same operation. Leaving it would make an answered operation look
			// like it were still waiting — the exact confusion this pair exists to remove.
			const questions = (await readQuestions()).filter(
				(question) => question.requestId !== record.requestId,
			);
			await write([...(await readAll()), record], questions);
			return record;
		},
		async openQuestion(question) {
			const questions = (await readQuestions()).filter(
				(existing) => existing.requestId !== question.requestId,
			);
			await write(await readAll(), [...questions, question]);
		},
		async dismissQuestion(requestId) {
			const questions = await readQuestions();
			if (!questions.some((question) => question.requestId === requestId)) return false;
			await write(
				await readAll(),
				questions.filter((question) => question.requestId !== requestId),
			);
			return true;
		},
		async dismissExpiredQuestions(at) {
			const questions = await readQuestions();
			const { expired } = summariseStandingQuestions(questions, at);
			if (expired.length === 0) return 0;
			const gone = new Set(expired.map((question) => question.requestId));
			await write(
				await readAll(),
				questions.filter((question) => !gone.has(question.requestId)),
			);
			return expired.length;
		},
		async closeQuestion(requestId) {
			const questions = await readQuestions();
			if (!questions.some((question) => question.requestId === requestId)) return;
			await write(
				await readAll(),
				questions.filter((question) => question.requestId !== requestId),
			);
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
	| { status: "deferred"; record: null }
	/**
	 * SOMEBODY IS ALREADY ASKING THIS, and the operator has not answered yet.
	 *
	 * Distinct from `already-decided` (they answered) and from `deferred` (they said not now).
	 * Returned instead of publishing a second identical question — the failure this exists to stop
	 * is a background run that asks, dies, restarts, and asks again, until the operator has four
	 * cards for one decision and has learned to ignore all of them.
	 */
	| { status: "already-asked"; record: null; question: OperationQuestion }
	/**
	 * THE WORLD ALREADY LOOKS LIKE THE ANSWER. Every file this request would change already holds
	 * exactly what it would write, so there is nothing to do and nothing to consent to.
	 *
	 * Nothing is asked and nothing is recorded — deliberately. A record here would claim the
	 * operator authorised something, and they were never asked; the state arrived some other way,
	 * possibly by their own hand. Saying so is the whole point: an operator asked to authorise
	 * what is already true learns the questions are noise, which is how a consent surface stops
	 * working without ever going red.
	 */
	| { status: "already-applied"; record: null };

export interface RunOperationConsentOptions {
	request: OperationRequest;
	trail: OperationTrail;
	/**
	 * How long a standing question stays standing, in ms. Default {@link DEFAULT_QUESTION_TTL_MS}.
	 *
	 * This is the BACKSTOP, not the ordinary path: a run that ends normally closes its own
	 * question in a `finally`. The TTL is for the run that is killed outright — and without one, a
	 * single `kill -9` would block the operation from ever being asked about again.
	 */
	questionTtlMs?: number;
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
/** A day. Long enough that an operator who is asleep still gets to answer in the morning; short
 *  enough that a question nobody ever answered does not become a permanent veto. */
export const DEFAULT_QUESTION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * How many EXPIRED questions a trail keeps.
 *
 * ## Why a bound rather than a sweep
 *
 * An expired question is worth reporting — it says the node asked and nobody answered, which is a
 * commitment it could not keep. Worth reporting once. Kept forever, it becomes the thing an
 * operator scrolls past, and a surface people scroll past has stopped working, which is the exact
 * failure the whole standing-question record was built to prevent. So the trail keeps the most
 * recent few and drops the rest at the moment it writes.
 *
 * OUTSTANDING QUESTIONS ARE NEVER DROPPED, at any count. A question still inside its window is a
 * live obligation; discarding one to save space would silently lose the thing this record is for.
 * The bound applies only to what has already timed out.
 *
 * Same idiom as the prompt hub's `recent_capacity` ring: bounded memory of what settled, and no
 * garbage collector anywhere.
 */
export const DEFAULT_EXPIRED_QUESTIONS_KEPT = 10;

/** PURE. When a question put at `askedAt` stops standing. */
export function questionExpiry(askedAt: string, ttlMs = DEFAULT_QUESTION_TTL_MS): string | null {
	const asked = Date.parse(askedAt);
	if (!Number.isFinite(asked)) return null;
	return new Date(asked + ttlMs).toISOString();
}

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

	// IS IT ALREADY TRUE? Checked before anything is asked, recorded or rendered. `revisit` still
	// forces the question, because an operator who explicitly re-opened a decision is asking to
	// see it regardless of what the files say.
	if (!revisit && (await alreadyApplied(request.changes, fs))) {
		return { status: "already-applied", record: null };
	}

	// IS SOMEBODY ALREADY ASKING THIS? Only a trail that can remember outstanding questions can
	// say — one that cannot returns `undefined` here, and this whole block is skipped, leaving
	// its behaviour byte-for-byte what it was. An absent answer is not a "no".
	if (trail.readQuestions && !revisit) {
		const outstanding = standingQuestion(await trail.readQuestions(), request.id, now());
		if (outstanding.standing === "outstanding" && outstanding.question) {
			return { status: "already-asked", record: null, question: outstanding.question };
		}
		// `expired` falls through and asks again ON PURPOSE: the window closed with nobody
		// answering, and a record that blocked the question forever would turn one crashed run
		// into permanent silence.
	}

	if (announce) {
		for (const line of renderOperationRequest(request, { labels })) announce(line);
	}

	// RECORDED BEFORE THE ASK, because the whole point is to survive the asker. A record written
	// after the answer would be exactly as absent as no record at all for the run that dies
	// waiting — which is the run this is for.
	await trail.openQuestion?.({
		requestId: request.id,
		kind: request.kind,
		title: request.title,
		purpose: request.purpose,
		requester: request.requester,
		askedAt: now(),
		expiresAt: questionExpiry(now(), options.questionTtlMs),
		...(host ? { host } : {}),
		// The whole request, so this can still be ANSWERED when this process is gone. Reporting a
		// question needs its title; answering one needs its changes.
		request,
	});

	let answer: string;
	try {
		answer = await channel.ask(operationDecisionPrompt(request, { labels }));
	} finally {
		// CLOSED ON EVERY EXIT, including a throw. A question left standing because its asker
		// raised would block the next run from asking at all, until the deadline passed — the
		// crash would become silence, which is the shape the expiry above is the backstop for and
		// this is the ordinary path for.
		await trail.closeQuestion?.(request.id);
	}
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

export interface RecordOperationOptions {
	/** The change, stated as exactly as a proposed one — the record is read later by someone
	 *  asking "was this well done?", and a vaguer request makes a vaguer answer. */
	request: OperationRequest;
	trail: OperationTrail;
	fs?: OperationFileSystem;
	now?: () => string;
	/** WHO made the change. For an operator-issued command this is the operator. */
	decidedBy?: string;
	host?: string;
}

/**
 * Apply and remember an operation the operator DID NOT need to be asked about — the half of this
 * block that is the RECORD without the CONSENT PROMPT.
 *
 * WHY THAT SPLIT EXISTS, because it decides where each function belongs. {@link
 * runOperationConsent} is for something proposing a change *on the operator's behalf*: an
 * installer that wants to edit `.bashrc` has to acquire the human first (R2/D13). `refarm config
 * set runtime.autostart always` is not that. The operator typed the change. Asking them to confirm
 * what they just typed adds no information and costs the thing R4 exists to protect — a prompt
 * nobody learns anything from is a prompt people learn to click through, which is exactly how a
 * later, real question gets waved past. So: no prompt, and deliberately no `--yes` flag to
 * suppress one that should never have existed.
 *
 * What does NOT change is R3. The command is the authorisation; it is not the memory. `config
 * set`/`unset` mutated persisted configuration and recorded nothing — "não configura nada e
 * esquece" is the failure named in the design, and it is the same gap the PATH operation had, one
 * layer in. So the full record is written: what changed (before/after snapshots), why, who, when,
 * and an undo that executes.
 *
 * Ordering is the same as the consent journey and for the same reason: files are written BEFORE
 * the record, and if the record cannot be written the files are put back and the failure raised. A
 * change nobody can remember is a change this block will not make.
 */
export async function recordOperation(options: RecordOperationOptions): Promise<OperationRecord> {
	const {
		request,
		trail,
		fs = createNodeOperationFileSystem(),
		now = () => new Date().toISOString(),
		decidedBy = "operator",
		host,
	} = options;

	const decidedAt = now();
	await applyChanges(request.changes, fs);
	const record = makeOperationRecord({
		request,
		decision: "authorized",
		decidedBy,
		decidedAt,
		appliedAt: decidedAt,
		host,
	});
	try {
		await trail.append(record);
	} catch (error) {
		// Roll back rather than leave an unrecorded change behind — identical to the consent
		// journey's rollback, and best-effort for the same reason: if the rollback itself fails
		// there is nothing honest left to do but raise the original failure.
		try {
			await applyChanges(reverseChanges(request.changes), fs);
		} catch {
			// fall through — the append failure is the one worth reporting
		}
		throw error;
	}
	return record;
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
