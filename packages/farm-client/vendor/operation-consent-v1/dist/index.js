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
export const OPERATION_CONSENT_CAPABILITY = "operation-consent:v1";
/** The stable context IRI for operation-consent artifacts (parallels authorization/records). */
export const OPERATION_CONSENT_CONTEXT_IRI = "https://refarm.dev/contexts/operation-consent/v1";
/** The reverse of a change: what it takes to put the file back. PURE. */
export function reverseChange(change) {
    return { path: change.path, before: change.after, after: change.before };
}
/** The reverse of a whole change set. PURE. */
export function reverseChanges(changes) {
    return changes.map(reverseChange);
}
/** Can this operation be reversed? PURE. */
export function isReversible(undo) {
    return undo.kind === "restore-snapshot";
}
/** Build the record for a decision. PURE — clock and identity are injected. */
export function makeOperationRecord(input) {
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
export async function alreadyApplied(changes, fs) {
    if (changes.length === 0)
        return false;
    for (const change of changes) {
        if ((await fs.readFile(change.path)) !== change.after)
            return false;
    }
    return true;
}
/** PURE-ish (reads files). Which of a request's changes no longer match the world they were
 *  captured from. Empty means every `before` is still true. */
export async function driftedChanges(changes, fs) {
    const drifted = [];
    for (const change of changes) {
        const current = await fs.readFile(change.path);
        if (current !== change.before)
            drifted.push(change.path);
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
export async function answerStandingQuestion(options) {
    const fs = options.fs ?? createNodeOperationFileSystem();
    const now = options.now ?? (() => new Date().toISOString());
    const decidedAt = now();
    const questions = (await options.trail.readQuestions?.()) ?? [];
    const { standing, question } = standingQuestion(questions, options.requestId, decidedAt);
    if (!question)
        return { status: "not-found", record: null };
    if (standing === "expired")
        return { status: "expired", record: null };
    if (!question.request)
        return { status: "unanswerable", record: null };
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
    if (drifted.length > 0)
        return { status: "stale", record: null, drifted };
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
/** PURE. Fold a set of questions into what is still waiting and what timed out. Newest first,
 *  because an operator scanning a list reads the top of it. */
export function summariseStandingQuestions(questions, now) {
    const outstanding = [];
    const expired = [];
    for (const question of questions) {
        const { standing } = standingQuestion([question], question.requestId, now);
        if (standing === "outstanding")
            outstanding.push(question);
        else if (standing === "expired")
            expired.push(question);
    }
    const newestFirst = (a, b) => b.askedAt.localeCompare(a.askedAt);
    return { outstanding: outstanding.sort(newestFirst), expired: expired.sort(newestFirst) };
}
/**
 * PURE. Whether this operation is already being asked about.
 *
 * `none` covers both "never asked" and "asked and since decided" — the caller checks
 * `standingDecision` for the difference, which is the question that function already answers.
 */
export function standingQuestion(questions, requestId, now) {
    let latest = null;
    for (const question of questions) {
        if (question.requestId === requestId)
            latest = question;
    }
    if (!latest)
        return { standing: "none", question: null };
    if (latest.expiresAt !== null && latest.expiresAt <= now) {
        return { standing: "expired", question: latest };
    }
    return { standing: "outstanding", question: latest };
}
/** The operator's STANDING decision on an operation — the last thing they said about it, or null
 *  when they have never been asked. PURE. This is what stops a wizard re-asking (R4). */
export function standingDecision(records, requestId) {
    let standing = null;
    for (const record of records) {
        if (record.requestId === requestId)
            standing = record;
    }
    return standing;
}
/** Every decision about one operation, oldest → newest — the "was this well done?" view. PURE. */
export function operationTimeline(records, requestId) {
    return records.filter((record) => record.requestId === requestId);
}
/** An in-memory trail — the reference adapter, and what tests drive. */
export function createMemoryOperationTrail(seed = []) {
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
export function createFileOperationTrail(path, fs = createNodeOperationFileSystem(), options = {}) {
    const now = options.now ?? (() => new Date().toISOString());
    const maxExpiredKept = options.maxExpiredKept ?? DEFAULT_EXPIRED_QUESTIONS_KEPT;
    /** PURE-ish (reads the clock): drop the oldest expired questions past the bound. Outstanding
     *  ones are untouched, whatever the count — see {@link DEFAULT_EXPIRED_QUESTIONS_KEPT}. */
    function prune(questions) {
        const summary = summariseStandingQuestions(questions, now());
        if (summary.expired.length <= maxExpiredKept)
            return questions;
        const kept = new Set(summary.expired.slice(0, maxExpiredKept).map((q) => q.requestId));
        return questions.filter((question) => summary.expired.every((expired) => expired.requestId !== question.requestId) ||
            kept.has(question.requestId));
    }
    async function readDocument() {
        const raw = await fs.readFile(path);
        if (raw === null)
            return {};
        try {
            return JSON.parse(raw);
        }
        catch {
            return {};
        }
    }
    async function readAll() {
        const parsed = await readDocument();
        return Array.isArray(parsed.records) ? parsed.records : [];
    }
    async function readQuestions() {
        const parsed = await readDocument();
        return Array.isArray(parsed.questions) ? parsed.questions : [];
    }
    async function write(records, unpruned) {
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
        const document = {
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
            const questions = (await readQuestions()).filter((question) => question.requestId !== record.requestId);
            await write([...(await readAll()), record], questions);
            return record;
        },
        async openQuestion(question) {
            const questions = (await readQuestions()).filter((existing) => existing.requestId !== question.requestId);
            await write(await readAll(), [...questions, question]);
        },
        async dismissQuestion(requestId) {
            const questions = await readQuestions();
            if (!questions.some((question) => question.requestId === requestId))
                return false;
            await write(await readAll(), questions.filter((question) => question.requestId !== requestId));
            return true;
        },
        async dismissExpiredQuestions(at) {
            const questions = await readQuestions();
            const { expired } = summariseStandingQuestions(questions, at);
            if (expired.length === 0)
                return 0;
            const gone = new Set(expired.map((question) => question.requestId));
            await write(await readAll(), questions.filter((question) => !gone.has(question.requestId)));
            return expired.length;
        },
        async closeQuestion(requestId) {
            const questions = await readQuestions();
            if (!questions.some((question) => question.requestId === requestId))
                return;
            await write(await readAll(), questions.filter((question) => question.requestId !== requestId));
        },
    };
}
/**
 * The real filesystem.
 *
 * `writeFile` truncates in place instead of writing a temp file and renaming over the target. For a
 * shell profile that difference matters: a rename replaces the inode, so the file would silently
 * come back with default permissions and lose any hard link or ownership it had. Atomicity is worth
 * less here than not quietly re-permissioning the operator's `~/.bashrc`.
 */
export function createNodeOperationFileSystem() {
    return {
        async readFile(path) {
            try {
                return await readFile(path, "utf8");
            }
            catch {
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
export async function applyChanges(changes, fs) {
    for (const change of changes) {
        if (change.after === null)
            await fs.removeFile(change.path);
        else
            await fs.writeFile(change.path, change.after);
    }
}
export const DEFAULT_OPERATION_LABELS = {
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
function splitLines(content) {
    const lines = content.split("\n");
    // A trailing newline is a terminator, not an empty last line — dropping it keeps
    // "how many lines" honest and stops the render showing a phantom blank tail.
    if (lines.length > 1 && lines[lines.length - 1] === "")
        lines.pop();
    return lines;
}
function numbered(lines, from, marked, width) {
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
export function renderOperationRequest(request, options = {}) {
    const l = { ...DEFAULT_OPERATION_LABELS, ...options.labels };
    const context = options.contextLines ?? OPERATION_RENDER_CONTEXT_LINES;
    const out = [`🔧 ${l.heading}: ${request.title}`];
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
            for (const line of change.insertion.text.split("\n"))
                out.push(`       ${line}`);
        }
        if (change.before !== null) {
            out.push(`   ${l.current}:`);
            const tail = beforeLines.slice(Math.max(0, beforeLines.length - context));
            const from = beforeLines.length - tail.length + 1;
            const width = String(beforeLines.length).length;
            if (tail.length === 0 || (tail.length === 1 && tail[0] === "")) {
                out.push(`       ${l.currentEmpty}`);
            }
            else {
                out.push(...numbered(tail, from, new Set(), width));
            }
        }
        if (change.after !== null && change.insertion) {
            const added = change.insertion.text.split("\n").length;
            const first = change.insertion.line;
            const last = first + added - 1;
            const start = Math.max(1, first - context);
            const end = Math.min(afterLines.length, last + context);
            const marked = new Set();
            for (let n = first; n <= last; n++)
                marked.add(n);
            out.push(`   ${l.result}:`);
            out.push(...numbered(afterLines.slice(start - 1, end), start, marked, String(end).length));
        }
    }
    for (const note of request.notes ?? [])
        out.push(`   ℹ️  ${note}`);
    out.push(request.undo.kind === "restore-snapshot"
        ? `   ${l.undo}: ${request.undo.summary}`
        : `   ⚠️  ${l.irreversible}: ${request.undo.reason}`);
    return out;
}
/** A one-screen summary of what was decided, for "was this well done?". PURE. */
export function renderOperationRecord(record, options = {}) {
    const l = { ...DEFAULT_OPERATION_LABELS, ...options.labels };
    const verb = record.decision === "authorized"
        ? "autorizada"
        : record.decision === "declined"
            ? "recusada"
            : "desfeita";
    const out = [
        `• ${record.title} — ${verb} em ${record.decidedAt} por ${record.decidedBy}`,
        `   ${l.purpose}: ${record.purpose}`,
        `   ${l.requester}: ${record.requester}`,
    ];
    for (const change of record.changes)
        out.push(`   ${l.file}: ${change.path}`);
    out.push(record.undo.kind === "restore-snapshot"
        ? `   ${l.undo}: ${record.undo.summary}`
        : `   ⚠️  ${l.irreversible}: ${record.undo.reason}`);
    return out;
}
// ── The decision ──────────────────────────────────────────────────────────────
export const OPERATION_AUTHORIZE = "authorize";
export const OPERATION_DECLINE = "decline";
export const OPERATION_LATER = "later";
/** The decision prompt. Defaults to `later`, so pressing Enter changes NOTHING. PURE. */
export function operationDecisionPrompt(request, options = {}) {
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
export function questionExpiry(askedAt, ttlMs = DEFAULT_QUESTION_TTL_MS) {
    const asked = Date.parse(askedAt);
    if (!Number.isFinite(asked))
        return null;
    return new Date(asked + ttlMs).toISOString();
}
export async function runOperationConsent(options) {
    const { request, trail, channel = null, fs = createNodeOperationFileSystem(), now = () => new Date().toISOString(), decidedBy = "operator", host, revisit = false, labels, announce, } = options;
    // Nobody to ask ⇒ nothing happens at all. Checked first so a non-interactive run neither
    // prompts nor touches the trail: its behaviour is exactly what it was before this block existed.
    if (!channel)
        return { status: "no-operator", record: null };
    const prior = standingDecision(await trail.read(), request.id);
    if (prior && !revisit)
        return { status: "already-decided", record: prior };
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
        for (const line of renderOperationRequest(request, { labels }))
            announce(line);
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
    let answer;
    try {
        answer = await channel.ask(operationDecisionPrompt(request, { labels }));
    }
    finally {
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
    }
    catch (error) {
        // Roll back rather than leave an unrecorded change behind. Best-effort: if the rollback
        // itself fails there is nothing honest left to do but raise the original failure, with the
        // snapshots still in the error's reach through `request.changes`.
        try {
            await applyChanges(reverseChanges(request.changes), fs);
        }
        catch {
            // fall through — the append failure is the one worth reporting
        }
        throw error;
    }
    return { status: "authorized", record };
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
export async function recordOperation(options) {
    const { request, trail, fs = createNodeOperationFileSystem(), now = () => new Date().toISOString(), decidedBy = "operator", host, } = options;
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
    }
    catch (error) {
        // Roll back rather than leave an unrecorded change behind — identical to the consent
        // journey's rollback, and best-effort for the same reason: if the rollback itself fails
        // there is nothing honest left to do but raise the original failure.
        try {
            await applyChanges(reverseChanges(request.changes), fs);
        }
        catch {
            // fall through — the append failure is the one worth reporting
        }
        throw error;
    }
    return record;
}
/**
 * Reverse an applied operation and APPEND the reversal as its own record.
 *
 * The trail stays append-only (history-contract-v1's rule): the original record is never edited to
 * pretend the change did not happen. The undo record's changes are the reverse snapshots, so the
 * trail reads as what it is — the file went there, then came back.
 */
export async function undoOperationRecord(options) {
    const { record, trail, fs = createNodeOperationFileSystem(), now = () => new Date().toISOString(), decidedBy = record.decidedBy, host = record.host, } = options;
    if (record.decision !== "authorized") {
        throw new Error(`operation-consent: only an authorized operation can be undone (got "${record.decision}")`);
    }
    if (!isReversible(record.undo)) {
        throw new Error(`operation-consent: "${record.title}" was recorded as irreversible — it cannot be undone`);
    }
    const changes = reverseChanges(record.changes);
    await applyChanges(changes, fs);
    const undoneAt = now();
    const undone = {
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
//# sourceMappingURL=index.js.map