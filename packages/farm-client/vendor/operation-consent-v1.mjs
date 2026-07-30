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
export function createFileOperationTrail(path, fs = createNodeOperationFileSystem()) {
    async function readAll() {
        const raw = await fs.readFile(path);
        if (raw === null)
            return [];
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed?.records) ? parsed.records : [];
        }
        catch {
            return [];
        }
    }
    return {
        read: readAll,
        async append(record) {
            const document = {
                capability: OPERATION_CONSENT_CAPABILITY,
                version: 1,
                records: [...(await readAll()), record],
            };
            await fs.writeFile(path, `${JSON.stringify(document, null, 2)}\n`);
            return record;
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
export async function runOperationConsent(options) {
    const { request, trail, channel = null, fs = createNodeOperationFileSystem(), now = () => new Date().toISOString(), decidedBy = "operator", host, revisit = false, labels, announce, } = options;
    // Nobody to ask ⇒ nothing happens at all. Checked first so a non-interactive run neither
    // prompts nor touches the trail: its behaviour is exactly what it was before this block existed.
    if (!channel)
        return { status: "no-operator", record: null };
    const prior = standingDecision(await trail.read(), request.id);
    if (prior && !revisit)
        return { status: "already-decided", record: prior };
    if (announce) {
        for (const line of renderOperationRequest(request, { labels }))
            announce(line);
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