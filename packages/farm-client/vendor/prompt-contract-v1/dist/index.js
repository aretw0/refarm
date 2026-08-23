import readline from "node:readline";
export const PROMPT_CAPABILITY = "prompt:v1";
export class OperatorPromptCancelledError extends Error {
    constructor(message = "Operator prompt cancelled") {
        super(message);
        this.name = "OperatorPromptCancelledError";
    }
}
/**
 * Run `onAbort` when `signal` fires, and hand back the detach function to call
 * once the prompt settles. Fires immediately for an already-aborted signal, so
 * an abort that lands between constructing the channel and starting the prompt
 * is never lost. Returns a no-op detach when there is no signal.
 */
function onAbortOnce(signal, onAbort) {
    if (!signal)
        return () => { };
    if (signal.aborted) {
        onAbort();
        return () => { };
    }
    signal.addEventListener("abort", onAbort, { once: true });
    return () => signal.removeEventListener("abort", onAbort);
}
// ── createAutoOperatorChannel ─────────────────────────────────────────────────
// Returns the `default` value for every prompt without prompting.
// Use in non-interactive environments (CI, automated scripts).
export function createAutoOperatorChannel(options = {}) {
    const output = options.output ?? process.stdout;
    async function ask(prompt) {
        if (prompt.type === "confirm")
            return prompt.default ?? true;
        if (prompt.type === "select")
            return prompt.default ?? prompt.options[0]?.value ?? "";
        if (prompt.type === "secret")
            return "";
        return prompt.default ?? "";
    }
    /** Answering without a human does not mean SAYING without one — a wizard run
     *  in CI still explains itself into the log. */
    function say(notice) {
        output.write(`${normalizeNoticeInput(notice).message}\n`);
    }
    return { ask, say };
}
export function createScriptedOperatorChannel(answers) {
    const queue = [...answers];
    const said = [];
    async function ask(_prompt) {
        if (queue.length === 0) {
            throw new RangeError("createScriptedOperatorChannel: answer queue exhausted");
        }
        return queue.shift();
    }
    /** Recorded, never printed: a test suite must not spit a wizard's prose. */
    function say(notice) {
        said.push(normalizeNoticeInput(notice));
    }
    return { ask, say, notices: () => said };
}
// ── createStdioOperatorChannel ────────────────────────────────────────────────
// Interactive readline implementation. No external dependencies.
/**
 * The terminal, and ONLY the terminal.
 *
 * This is what `createStdioOperatorChannel` was before a process could declare
 * somewhere else to publish its questions (see `setPromptPublisher`), and it is
 * still exactly what that function returns when nothing is declared. Kept
 * separate and exported so "the terminal alone" stays reachable by name — a host
 * that must not peer, and a test asserting the undeclared path is unchanged,
 * both need to say so rather than hope.
 */
export function createTerminalOperatorChannel(options = {}) {
    const input = options.input ?? process.stdin;
    const output = options.output ?? process.stdout;
    const signal = options.signal;
    async function ask(prompt) {
        writePromptTransition(output, options.transition ?? "space");
        if (prompt.type === "confirm")
            return askConfirm(prompt, input, output, signal);
        if (prompt.type === "select")
            return askSelect(prompt, input, output, signal);
        if (prompt.type === "secret")
            return askSecret(prompt, input, output, signal);
        return askText(prompt, input, output, signal);
    }
    /**
     * THE INVARIANT (D8): byte-for-byte what `console.log(line)` did before this
     * existed. A channel with no publisher declared must be indistinguishable from
     * the one that shipped yesterday, or "silence is closed" stops being true.
     */
    function say(notice) {
        output.write(`${normalizeNoticeInput(notice).message}\n`);
    }
    return { ask, say };
}
function writePromptTransition(output, transition) {
    if (transition === "preserve")
        return;
    if (transition === "clear" && output.isTTY) {
        output.write("\x1b[2J\x1b[H");
        return;
    }
    output.write("\n");
}
let ambientPublisherSource = null;
/**
 * Declare where this process publishes its questions. Returns the undo.
 *
 * Deliberately process-global: the alternative is threading a publisher through
 * every wizard signature, which is precisely the D5 failure this exists to
 * avoid. Pass `null` to go back to the terminal alone.
 */
export function setPromptPublisher(source) {
    const previous = ambientPublisherSource;
    ambientPublisherSource = source;
    let restored = false;
    return () => {
        if (restored)
            return;
        restored = true;
        ambientPublisherSource = previous;
    };
}
/**
 * The publisher in force, or null.
 *
 * TOTAL: a source that throws is treated as "nowhere else", because a broken
 * notification arrangement must never be the reason a wizard cannot ask its
 * question. The failure is not silent — the host that installed the source is
 * the one that reports it (D4) — but it stops here.
 */
export function currentPromptPublisher() {
    if (ambientPublisherSource === null)
        return null;
    try {
        return ambientPublisherSource() ?? null;
    }
    catch {
        return null;
    }
}
/**
 * One signal that fires when either fires, without leaving a listener behind on
 * the caller's (long-lived) signal once the ask has settled.
 */
function anySignal(a, b) {
    if (!a)
        return b;
    if (!b)
        return a;
    if (a.aborted)
        return a;
    if (b.aborted)
        return b;
    const controller = new AbortController();
    const abort = () => controller.abort();
    a.addEventListener("abort", abort, { once: true });
    b.addEventListener("abort", abort, { once: true });
    controller.signal.addEventListener("abort", () => {
        a.removeEventListener("abort", abort);
        b.removeEventListener("abort", abort);
    }, { once: true });
    return controller.signal;
}
/**
 * Ask the operator — at the terminal, and anywhere else this process declared.
 *
 * With no publisher declared this IS `createTerminalOperatorChannel`, unchanged.
 * With one declared, the terminal keeps working exactly as it does today and
 * gains a peer; see `createPeeredOperatorChannel` for what "peer" costs and
 * guarantees.
 */
/**
 * PURE. The bracketed hints after a text question.
 *
 * A placeholder SHOWS THE SHAPE of an answer; a default IS one. When a caller passes the same
 * string as both, printing it twice makes one fact read as two — measured on a real terminal as
 * `Qual processo? (refarm já sabe propor: web-serve) (web-serve) [web-serve]:`, the same value
 * three times in one line.
 */
export function textPromptHint(prompt) {
    const placeholder = prompt.placeholder?.trim();
    const fallback = prompt.default?.trim();
    let hint = "";
    if (placeholder && placeholder !== fallback)
        hint += ` (${placeholder})`;
    if (fallback)
        hint += ` [${fallback}]`;
    return hint;
}
export function createStdioOperatorChannel(options = {}) {
    const publisher = currentPromptPublisher();
    if (publisher === null)
        return createTerminalOperatorChannel(options);
    return createPeeredOperatorChannel({
        local: (signal) => createTerminalOperatorChannel({ ...options, signal: anySignal(options.signal, signal) }),
        remote: (signal) => publisher.remote(signal),
        ...(publisher.announce
            ? { announce: (notice) => publisher.announce(notice) }
            : {}),
    });
}
/**
 * The channel that matches HOW the operator is present — the same evidence the caller's own
 * interactive guard already weighed.
 *
 * ## The defect this exists to stop, measured 2026-08-11
 *
 * Five commands take `--attended-elsewhere` ("no terminal here, and that is fine — you are
 * attending from another surface"), gate their refusal on `atTerminal || attendedElsewhere`, and
 * then build `createStdioOperatorChannel()` REGARDLESS OF WHICH ONE WAS TRUE. That channel puts a
 * terminal in the race, and with `stdin` at `/dev/null` the terminal half settles instantly:
 *
 * ```
 *   the question is printed to a terminal nobody is reading
 *   the local side rejects       OperatorPromptCancelledError
 *   it WINS the race
 *   pending prompts on the hub: 0     <- withdrawn before any device could show it
 * ```
 *
 * So the flag did the opposite of what its own help text promised, in every command that offered
 * it. It appeared to work only when something was actively writing to stdin — a remote pty — which
 * is the one case the flag was not needed for.
 *
 * ## Three states, and the third is not a terminal
 *
 *  - AT A TERMINAL — the peered channel. The terminal keeps working and gains the devices as
 *    peers; either may answer and the other is withdrawn.
 *  - ATTENDED ELSEWHERE, NO TERMINAL — the devices alone. Putting a dead terminal in that race is
 *    not a fallback, it is a cancellation.
 *  - NEITHER — `null`. Nobody to ask, which the caller must refuse on rather than default.
 *
 * `null` ALSO COMES BACK when the caller claims attendance and nothing publishes this process's
 * questions. That is the honest answer: `--attended-elsewhere` is a claim about a human, and a
 * claim with no wire behind it is still nobody to ask.
 */
export function createOperatorChannelFor(presence, options = {}) {
    if (presence.atTerminal)
        return createStdioOperatorChannel(options);
    if (presence.attendedElsewhere) {
        const signal = options.signal;
        return createAttendedOperatorChannel(signal ? { signal } : {});
    }
    return null;
}
/**
 * Ask ONLY the devices attending this node. No terminal half.
 *
 * ## Why a peered channel is the WRONG answer when there is no terminal
 *
 * `createStdioOperatorChannel` races a terminal against the node's hub and lets whoever answers
 * first win. With no terminal that race is not merely pointless, it is HARMFUL: `readline` settles
 * a non-TTY stdin immediately — a closed or piped input fires `close`, which this module turns
 * into `OperatorPromptCancelledError` — so the local side REJECTS FIRST, wins, and
 * `createPeeredOperatorChannel` withdraws the question from every attending device before anyone
 * could see it. A peered channel with one dead peer is worse than no peer, because it reports
 * "cancelled" for a question the operator was never shown.
 *
 * So this builds the remote side alone, and its cancellation semantics are the remote's.
 *
 * ## Null is an answer
 *
 * `null` means NOTHING PUBLISHES THIS PROCESS'S QUESTIONS — no hub, nowhere to ask. A caller must
 * treat that as "there is no operator", exactly as it treats a missing terminal, rather than
 * inventing a default. The whole point of the surrounding design is that a consent prompt with
 * nobody behind it is not answered yes and is not answered no; it is not asked.
 */
export function createAttendedOperatorChannel(options = {}) {
    // Captured, not re-read. `currentPromptPublisher()` is a thunk a host may swap, and a channel
    // that resolved the publisher again inside `ask` could route a question to a different place
    // than the one it announced to — which is the class of bug the peered channel's abort logic
    // exists to prevent, one layer down.
    const publisher = currentPromptPublisher();
    if (publisher === null)
        return null;
    const attending = publisher;
    async function ask(prompt) {
        const controller = new AbortController();
        const detach = onAbortOnce(options.signal, () => controller.abort());
        try {
            return await attending.remote(controller.signal).ask(prompt);
        }
        finally {
            detach();
        }
    }
    /** A statement still has somewhere to go — and when the publisher cannot announce, it goes
     *  nowhere rather than to a terminal nobody is reading. */
    function say(notice) {
        attending.announce?.(notice);
    }
    return { ask, say };
}
/**
 * Ask a single line via `rl.question`, settling with the raw answer text — or
 * rejecting with `OperatorPromptCancelledError` when the operator cancels, by
 * either way a terminal user quits: SIGINT (Ctrl+C) or closing stdin (Ctrl+D /
 * piped EOF). Node's `readline.Interface` already turns both into its own
 * 'SIGINT' and 'close' events (even against a fake, non-real-TTY stream, which
 * is what lets the conformance suite drive this without a real terminal), so
 * this only needs to listen for them and settle exactly once. Listeners are
 * always removed before the promise settles so nothing leaks onto `rl` (or the
 * shared input stream) across the next prompt.
 */
function askLine(rl, query, signal) {
    return new Promise((resolve, reject) => {
        let settled = false;
        let detachAbort = () => { };
        const finish = (run) => {
            if (settled)
                return;
            settled = true;
            rl.off("SIGINT", onSigint);
            rl.off("close", onClose);
            detachAbort();
            run();
        };
        const onSigint = () => finish(() => {
            rl.close();
            reject(new OperatorPromptCancelledError());
        });
        const onClose = () => finish(() => reject(new OperatorPromptCancelledError()));
        rl.on("SIGINT", onSigint);
        rl.on("close", onClose);
        // An outside interrupt ends the prompt exactly as Ctrl+C does: close the
        // interface so the terminal is handed back, then reject. Registered AFTER
        // the rl listeners so an already-aborted signal still tears both down.
        detachAbort = onAbortOnce(signal, () => finish(() => {
            rl.close();
            reject(new OperatorPromptCancelledError());
        }));
        // An already-aborted signal settled (and closed `rl`) above — asking a
        // closed interface a question nobody is waiting for is at best a no-op.
        if (settled)
            return;
        rl.question(query, (answer) => finish(() => {
            rl.close();
            resolve(answer);
        }));
    });
}
async function askConfirm(prompt, input, output, signal) {
    const rl = readline.createInterface({ input, output });
    const hint = prompt.default === false ? "(y/N)" : "(Y/n)";
    const answer = await askLine(rl, `${prompt.question} ${hint} `, signal);
    const t = answer.trim().toLowerCase();
    if (!t)
        return prompt.default ?? true;
    return t !== "n" && t !== "no";
}
function askSelect(prompt, input, output, signal) {
    if (input.isTTY && output.isTTY && typeof input.setRawMode === "function") {
        return askSelectTui(prompt, input, output, signal);
    }
    return askSelectNumbered(prompt, input, output, signal);
}
async function askSelectNumbered(prompt, input, output, signal) {
    const rl = readline.createInterface({ input, output });
    output.write(`${prompt.question}\n`);
    prompt.options.forEach((opt, i) => {
        const marker = opt.value === prompt.default ? "▶" : " ";
        const desc = opt.description ? ` - ${opt.description}` : "";
        output.write(`  ${marker} ${i + 1}. ${opt.label}${desc}\n`);
    });
    const defaultIndex = prompt.default !== undefined
        ? prompt.options.findIndex((o) => o.value === prompt.default) + 1
        : 1;
    const effectiveDefault = defaultIndex > 0 ? defaultIndex : 1;
    const answer = await askLine(rl, `Enter number (${effectiveDefault}): `, signal);
    const t = answer.trim();
    if (!t) {
        return prompt.default ?? prompt.options[0]?.value ?? "";
    }
    const n = parseInt(t, 10);
    const opt = Number.isFinite(n) && n >= 1 && n <= prompt.options.length
        ? prompt.options[n - 1]
        : undefined;
    if (!opt) {
        process.stderr.write(`  Invalid choice, using default.\n`);
    }
    return opt?.value ?? prompt.default ?? prompt.options[0]?.value ?? "";
}
/**
 * PURE. Which options a frame may show, so that the frame FITS THE SCREEN.
 *
 * ## The defect this closes, measured 2026-08-17
 *
 * A 13-option picker builds a 15-row frame. On a screen that cannot hold it, writing the frame
 * SCROLLS the buffer — and what scrolls off the top is in SCROLLBACK, where `clearScreenDown` can
 * never reach it, because that code clears the VISIBLE screen and nothing else. Every redraw then
 * leaves one more copy of the frame's top behind:
 *
 *     viewport 16 rows   frame fits      clean
 *     viewport 12 rows   frame scrolls   the question line appears three times
 *
 * The redraw was CORRECT the whole time. Nothing about the erase can fix this, which is why the
 * earlier fix for a width change (recording the width the frame was painted at) left it standing:
 * the two look identical on screen and have nothing in common underneath.
 *
 * ## The window
 *
 * Centred on the selection, clamped to the ends, and never smaller than one option — an operator
 * on a very short screen gets a cramped picker rather than an empty one. `undefined` capacity (a
 * stream that reports no height) shows everything, because there is no screen to overflow.
 */
export function visibleOptionWindow(total, selected, capacity) {
    if (capacity === undefined || !Number.isFinite(capacity) || capacity >= total) {
        return { start: 0, end: total };
    }
    const size = Math.max(1, Math.min(total, Math.floor(capacity)));
    // Centred, then pushed back inside the list. Clamping AFTER centring is what keeps the window
    // full at both ends instead of half-empty at the top and bottom.
    const half = Math.floor(size / 2);
    const start = Math.min(Math.max(0, selected - half), Math.max(0, total - size));
    return { start, end: start + size };
}
/**
 * PURE. How many option rows fit, given the screen and what the frame must always carry.
 *
 * The question, the hint, and each "more" indicator occupy rows too, so they are subtracted before
 * the options get any — a budget that forgot them would produce a frame one row too tall, which is
 * the entire failure, arrived at from the other direction.
 *
 * ONE ROW IS LEFT SPARE on purpose: the prompt is drawn at wherever the cursor already is, and the
 * caller's own preceding output is not this module's to measure.
 */
export function optionCapacityFor(rows, total) {
    if (rows === undefined || !Number.isFinite(rows) || rows <= 0)
        return undefined;
    // question + hint + one spare row
    const reserved = 3;
    const room = Math.floor(rows) - reserved;
    if (room >= total)
        return undefined;
    // Two more rows go to the indicators once the list is truncated at all.
    return Math.max(1, room - 2);
}
function askSelectTui(prompt, input, output, signal) {
    if (prompt.options.length === 0)
        return Promise.resolve("");
    const defaultIndex = prompt.default !== undefined ? prompt.options.findIndex((o) => o.value === prompt.default) : 0;
    let selectedIndex = defaultIndex >= 0 ? defaultIndex : 0;
    return new Promise((resolve, reject) => {
        const wasRaw = input.isRaw;
        /** The last frame, AND the width it was laid out against. Both, or the pair is a guess. */
        let painted = null;
        let settled = false;
        let detachAbort = () => { };
        const render = () => {
            const columns = output.columns;
            if (painted) {
                if (painted.columns === columns) {
                    readline.moveCursor(output, 0, -painted.rows);
                    readline.cursorTo(output, 0);
                }
                else {
                    // THE WIDTH MOVED UNDER THE FRAME, so its height on screen is no longer knowable
                    // here: a reflowing terminal re-wrapped it against the new width, one that does not
                    // reflow still holds the old layout, and nothing distinguishes them from this side.
                    // Both remembered and recomputed counts are guesses, and ISS-135 measured what each
                    // guess costs — narrowing leaves the top of the old frame behind, widening ERASES
                    // ROWS THIS PROMPT NEVER WROTE and says nothing. Refusing to guess costs the screen
                    // above the prompt, which is visible and recoverable by scrolling; the alternative
                    // destroys it silently and only sometimes.
                    readline.cursorTo(output, 0, 0);
                }
                readline.clearScreenDown(output);
            }
            // THE FRAME MUST FIT. A frame taller than the screen scrolls as it is written, and what
            // scrolls into scrollback is beyond any erase — see `visibleOptionWindow`.
            const capacity = optionCapacityFor(output.rows, prompt.options.length);
            const { start, end } = visibleOptionWindow(prompt.options.length, selectedIndex, capacity);
            const hiddenAbove = start;
            const hiddenBelow = prompt.options.length - end;
            const lines = [
                prompt.question,
                ...(hiddenAbove > 0 ? [`  ⋯ ${hiddenAbove} more above`] : []),
                ...prompt.options.slice(start, end).map((opt, offset) => {
                    const i = start + offset;
                    const marker = i === selectedIndex ? ">" : " ";
                    const desc = opt.description ? ` - ${opt.description}` : "";
                    return formatSelectLine(`  ${marker} ${opt.label}${desc}`, i === selectedIndex, output);
                }),
                ...(hiddenBelow > 0 ? [`  ⋯ ${hiddenBelow} more below`] : []),
                "  Use Up/Down and Enter.",
            ];
            output.write(lines.join("\n"));
            // Rows, not lines. `moveCursor` climbs PHYSICAL rows, and on a narrow terminal a
            // long option wraps into several — so counting the lines we MEANT to write made
            // the next redraw rise short, erase from the middle, and leave everything above
            // it on screen. Once per keystroke, that is the whole prompt reprinting itself.
            //
            // The WIDTH is recorded beside the count because the count is only true against it.
            painted = {
                rows: lines.reduce((rows, line) => rows + renderedRowsFor(line, output), 0) - 1,
                columns,
            };
        };
        // A frame is laid out against a width, so a resize is a repaint. Without this the prompt sits
        // wrongly wrapped until the operator happens to press something, and the repair then arrives
        // attached to an unrelated keystroke.
        const onResize = () => {
            if (!settled)
                render();
        };
        const cleanup = () => {
            input.off("keypress", onKeypress);
            input.off("end", onEnd);
            if (typeof output.off === "function")
                output.off("resize", onResize);
            detachAbort();
            input.setRawMode(wasRaw);
            input.pause();
            output.write("\n");
        };
        // Settle at most once — cancellation can race a completing keystroke, and
        // this guard is what keeps cleanup() (listeners + raw mode) from running
        // twice or a settled promise from being resolved/rejected again.
        const finish = (run) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            run();
        };
        // Defense in depth for a genuine stream close (e.g. piped stdin ending
        // mid-prompt) — Ctrl+D itself is caught below via the keypress handler,
        // since raw mode delivers it as data rather than a stream-level EOF.
        const onEnd = () => finish(() => reject(new OperatorPromptCancelledError()));
        const onKeypress = (str, key) => {
            if (key.ctrl && (key.name === "c" || key.name === "d")) {
                finish(() => reject(new OperatorPromptCancelledError()));
                return;
            }
            if (key.name === "up") {
                selectedIndex = (selectedIndex + prompt.options.length - 1) % prompt.options.length;
                render();
                return;
            }
            if (key.name === "down") {
                selectedIndex = (selectedIndex + 1) % prompt.options.length;
                render();
                return;
            }
            if (key.name === "return" || key.name === "enter") {
                finish(() => resolve(prompt.options[selectedIndex]?.value ?? ""));
                return;
            }
            if (/^[1-9]$/.test(str)) {
                const n = Number.parseInt(str, 10) - 1;
                if (n >= 0 && n < prompt.options.length) {
                    selectedIndex = n;
                    render();
                }
            }
        };
        readline.emitKeypressEvents(input);
        input.setRawMode(true);
        input.resume();
        input.on("keypress", onKeypress);
        input.once("end", onEnd);
        if (typeof output.on === "function")
            output.on("resize", onResize);
        // Registered last, so an already-aborted signal tears down a fully set-up
        // prompt (raw mode restored, listeners removed) instead of half of one.
        detachAbort = onAbortOnce(signal, () => finish(() => reject(new OperatorPromptCancelledError())));
        if (!settled)
            render();
    });
}
function formatSelectLine(line, selected, output) {
    if (!selected || !output.isTTY || process.env.NO_COLOR)
        return line;
    return `\x1b[7m${line}\x1b[0m`;
}
function promptSuffix(question) {
    return /[:?]\s*$/.test(question) ? " " : ": ";
}
async function askText(prompt, input, output, signal) {
    const rl = readline.createInterface({ input, output });
    const hint = textPromptHint(prompt);
    const answer = await askLine(rl, `${prompt.question}${hint}${promptSuffix(prompt.question)}`, signal);
    return answer.trim() || prompt.default || "";
}
/**
 * The mask, BOUNDED BY THE ROW.
 *
 * A secret prompt redraws in place — `clearLine` then `cursorTo(0)` — and that erases
 * exactly one physical row. A frame wider than the row wraps, so the redraw erases only
 * its last row and every earlier one survives, each still carrying its own `visibleTail`.
 * On a phone, pasting a token that way leaves a SLIDING WINDOW of the secret on screen,
 * and a sliding window of the last N characters reconstructs the whole string.
 *
 * So the row is the budget. The mask stops growing at it: the operator still sees input
 * arriving and still gets the tail to check their paste against, and every frame the
 * next one has to erase is one the next one CAN erase.
 *
 * `room` absent (a stream with no width) keeps the unbounded mask — there is no row to
 * overflow, and truncating against a guessed width would hide characters for no reason.
 */
/** How many physical rows a rendered line occupies, ANSI colour excluded from the width.
 *  A stream with no width is one row per line — there is nothing to wrap against. */
function renderedRowsFor(line, output) {
    const columns = output.columns;
    if (typeof columns !== "number" || !Number.isFinite(columns) || columns <= 0)
        return 1;
    // eslint-disable-next-line no-control-regex
    const visible = line.replace(/\u001b\[[0-9;]*m/g, "");
    return Math.max(1, Math.ceil(visible.length / columns));
}
function maskSecret(value, visibleTail, room) {
    const tail = visibleTail > 0 && value.length > visibleTail ? value.slice(-visibleTail) : "";
    const stars = value.length - tail.length;
    if (room === undefined || !Number.isFinite(room))
        return "*".repeat(stars) + tail;
    const available = Math.max(0, Math.floor(room));
    const shownTail = tail.slice(Math.max(0, tail.length - available));
    const budget = Math.max(0, available - shownTail.length);
    return "*".repeat(Math.min(stars, budget)) + shownTail;
}
function askSecret(prompt, input, output, signal) {
    const visibleTail = prompt.visibleTail ?? 0;
    if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
        return askText({ type: "text", question: prompt.question }, input, output, signal);
    }
    return new Promise((resolve, reject) => {
        let value = "";
        const wasRaw = input.isRaw;
        let settled = false;
        let detachAbort = () => { };
        const render = () => {
            readline.clearLine(output, 0);
            readline.cursorTo(output, 0);
            const label = `${prompt.question}: `;
            // Re-read the width per frame: a terminal can be resized mid-paste, and the
            // budget must follow the row that `clearLine` will actually erase.
            const columns = output.columns;
            const room = typeof columns === "number" && Number.isFinite(columns) && columns > 0
                ? columns - label.length
                : undefined;
            output.write(`${label}${maskSecret(value, visibleTail, room)}`);
        };
        const cleanup = () => {
            input.off("keypress", onKeypress);
            input.off("end", onEnd);
            detachAbort();
            input.setRawMode(wasRaw);
            input.pause();
            output.write("\n");
        };
        // See askSelectTui's `finish` for why settling is guarded: cancellation can
        // race a completing keystroke, and this is what keeps cleanup() (listeners +
        // raw mode) from running twice or a settled promise from settling again.
        const finish = (run) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            run();
        };
        // Defense in depth for a genuine stream close — Ctrl+D itself is caught
        // below via the keypress handler, since raw mode delivers it as data
        // rather than a stream-level EOF.
        const onEnd = () => finish(() => reject(new OperatorPromptCancelledError()));
        const onKeypress = (str, key) => {
            if (key.ctrl && (key.name === "c" || key.name === "d")) {
                finish(() => reject(new OperatorPromptCancelledError()));
                return;
            }
            if (key.name === "return" || key.name === "enter") {
                finish(() => resolve(value));
                return;
            }
            if (key.name === "backspace") {
                value = value.slice(0, -1);
                render();
                return;
            }
            if (!key.ctrl && !key.meta && str) {
                value += str;
                render();
            }
        };
        readline.emitKeypressEvents(input);
        input.setRawMode(true);
        input.resume();
        input.on("keypress", onKeypress);
        input.once("end", onEnd);
        // Registered last — see askSelectTui. An abort here discards `value`
        // without rendering or returning it: an interrupted secret is not an answer.
        detachAbort = onAbortOnce(signal, () => finish(() => reject(new OperatorPromptCancelledError())));
        if (!settled)
            render();
    });
}
/** How long a channel gets to settle after `triggerCancel` fires before conformance
 * treats it as hung. Generous relative to real settling (same event-loop turn), but
 * short enough that a genuinely broken (never-settling) channel fails fast. */
const CONFORMANCE_CANCEL_TIMEOUT_MS = 300;
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function runOperatorChannelConformance(channel, options = {}) {
    const failures = [];
    let checksRun = 0;
    // 1 — confirm returns boolean
    checksRun++;
    try {
        const result = await channel.ask({ type: "confirm", question: "_conformance_", default: true });
        if (typeof result !== "boolean")
            failures.push("confirm: did not return boolean");
    }
    catch (e) {
        failures.push(`confirm threw: ${String(e)}`);
    }
    // 2 — select returns a value present in options
    checksRun++;
    try {
        const opts = [
            { value: "a", label: "A" },
            { value: "b", label: "B" },
        ];
        const result = await channel.ask({
            type: "select",
            question: "_conformance_",
            options: opts,
            default: "a",
        });
        if (typeof result !== "string")
            failures.push("select: did not return string");
        else if (!opts.some((o) => o.value === result))
            failures.push(`select: returned value not in options: "${result}"`);
    }
    catch (e) {
        failures.push(`select threw: ${String(e)}`);
    }
    // 3 — text returns string
    checksRun++;
    try {
        const result = await channel.ask({
            type: "text",
            question: "_conformance_",
            default: "hello",
        });
        if (typeof result !== "string")
            failures.push("text: did not return string");
    }
    catch (e) {
        failures.push(`text threw: ${String(e)}`);
    }
    // 4 — secret returns string
    checksRun++;
    try {
        const result = await channel.ask({
            type: "secret",
            question: "_conformance_",
        });
        if (typeof result !== "string")
            failures.push("secret: did not return string");
    }
    catch (e) {
        failures.push(`secret threw: ${String(e)}`);
    }
    // 5 — cancellation: ask() must settle once cancellation is triggered, never
    // hang. An unsettled prompt promise is exactly the defect this check exists to
    // catch (an operator's Ctrl+C leaving an "unsettled top-level await" behind).
    checksRun++;
    {
        const pending = channel.ask({ type: "text", question: "_conformance_cancel_" });
        // Attach the outcome handler immediately (not after the race) so a channel
        // that settles LATE — after the timeout below already lost the race — never
        // produces its own unhandled-rejection warning; this itself always settles.
        const outcome = pending.then(() => "resolved", (error) => (error instanceof OperatorPromptCancelledError ? "cancelled" : "rejected-other"));
        options.triggerCancel?.();
        const settled = await Promise.race([outcome, delay(CONFORMANCE_CANCEL_TIMEOUT_MS).then(() => "timeout")]);
        if (settled === "timeout") {
            failures.push("cancellation: ask() did not settle after cancellation was triggered");
        }
        else if (options.triggerCancel && settled !== "cancelled") {
            failures.push(`cancellation: expected rejection with OperatorPromptCancelledError, got "${settled}"`);
        }
    }
    // 6 — say, when implemented, must be TOTAL: no throw, no return value.
    //
    // Deliberately asserts the contract rather than the output. The auto channel
    // writes to stdout, so a check that asserted on printed text would make every
    // suite running conformance spit "_conformance_" into its own log — the same
    // reason the checks above pass canned answers instead of touching a terminal.
    const announces = typeof channel.say === "function";
    if (announces && options.captureSay) {
        checksRun++;
        try {
            const returned = channel.say({ message: "_conformance_", kind: "context" });
            if (returned !== undefined)
                failures.push("say: returned a value; it must return void");
            if (options.captureSay().length === 0)
                failures.push("say: nothing reached the sink");
        }
        catch (e) {
            failures.push(`say threw: ${String(e)}`);
        }
    }
    const failed = failures.length;
    return { pass: failed === 0, total: checksRun, failed, failures, announces };
}
// ── The pending prompt on the wire ────────────────────────────────────────────
//
// P6 (docs/superpowers/specs/2026-07-30-pending-prompt-wire-design.md): the wire
// shape is the reusable part, so it is designed rather than extracted from an
// adapter afterwards. Three consumers read it — the node's remote channel, the
// attending kit command, and (later) a browser — so it carries what a prompt IS
// and nothing about how a surface draws it.
//
// It lives HERE, in the zero-dependency block that is already vendored into
// `packages/farm-client`, because the phone must be able to parse it with
// nothing installed.
/** Wire discriminator. Bump only for a breaking change to the shape below. */
export const PENDING_PROMPT_WIRE = "pending-prompt.v1";
/**
 * The `wire` a `GET /prompts` envelope declared, or `null`.
 *
 * An empty string is `null`, not a version: a peer that sent `""` declared
 * nothing, and treating it as a version to compare against would manufacture an
 * incompatibility out of a blank field.
 */
export function readDeclaredPendingPromptWire(body) {
    if (!isRecord(body))
        return null;
    const declared = body.wire;
    return typeof declared === "string" && declared !== "" ? declared : null;
}
/**
 * Compare what a peer declared against what this side speaks.
 *
 * PURE, and it decides nothing about what to DO — a surface reads `verdict` and
 * chooses its own words and its own remedy, because the remedy differs by
 * surface (a kit runs `farm-update`; a browser reloads). What must not differ,
 * and therefore lives here, is the judgement itself.
 *
 * ── WHY `unknown` IS ADMITTED AND NOT REFUSED ────────────────────────────────
 *
 * `unknown` is a peer that declared nothing. In this topology there is exactly
 * one thing that can be: a peer OLDER than the declaration. Every peer that has
 * the field sends it, so refusing on `unknown` would refuse precisely the older
 * peers — and the older peer, always, is the operator's phone, whose kit is
 * frozen at the last `farm-update`, and the browser tab holding a cached page.
 * A safety mechanism whose first act is to lock the operator out of a device
 * that works today has not made anything safer.
 *
 * It is admitted, not ignored. The verdict stays `unknown` all the way to the
 * surface, which says so; nobody is left believing a version was checked when
 * none was offered. That is the difference between admitting a case and
 * collapsing it into `compatible`.
 */
export function checkPendingPromptWire(declared, expected = PENDING_PROMPT_WIRE) {
    if (declared === null)
        return { verdict: "unknown", declared: null, expected };
    return {
        verdict: declared === expected ? "compatible" : "incompatible",
        declared,
        expected,
    };
}
/** The verdict on a `GET /prompts` envelope, in one call. */
export function checkPendingPromptListWire(body, expected = PENDING_PROMPT_WIRE) {
    return checkPendingPromptWire(readDeclaredPendingPromptWire(body), expected);
}
/**
 * The interval an attending device is TOLD to poll at, and the ceiling backoff
 * may walk to. Stated rather than implied: honest polling means a declared
 * interval and a backoff, not as-fast-as-possible (E5 of the phone-initiated
 * enrolment design; the traffic doctrine says the same).
 */
export const PENDING_PROMPT_POLL_INTERVAL_MS = 2_000;
export const PENDING_PROMPT_POLL_MAX_INTERVAL_MS = 20_000;
/**
 * Answering identities that are NOT devices on the wire.
 *
 * ` terminal` is the stdio peer that asked; ` node-local` is an unauthenticated
 * caller on the node's own loopback listener. Both describe a position an
 * enrolled device is definitionally not in, so a settlement that recorded either
 * for a remote caller would LIE about who answered — and the record of which
 * device answered is the whole of P3.
 *
 * The leading space is the same trick `auth.ts` uses for its select sentinels,
 * for the same reason: `validateIdentityLabel` trims, so a validated device
 * label can never begin with one and can never collide with these.
 */
export const TERMINAL_PROMPT_DEVICE = " terminal";
export const NODE_LOCAL_PROMPT_DEVICE = " node-local";
export const RESERVED_PROMPT_DEVICES = [
    TERMINAL_PROMPT_DEVICE,
    NODE_LOCAL_PROMPT_DEVICE,
];
// ── The notice: what a wizard STATES, as opposed to what it asks ──────────────
//
// D1 of the announcement-contract design. An `OperatorChannel` could only ask, so
// a wizard's framing had nowhere to go but `console.log` — which stays on the node
// while the questions travel. This is the shape that travels WITH them.
export const OPERATOR_NOTICE_WIRE = "operator-notice.v1";
const NOTICE_KINDS = ["context", "decision", "caution"];
/** A bare string is a `context` notice. PURE. */
export function normalizeNoticeInput(input) {
    if (typeof input === "string")
        return { message: input, kind: "context" };
    return { message: input.message, kind: input.kind ?? "context" };
}
/**
 * A kind this side does not know degrades to `context` rather than dropping the
 * notice. The MESSAGE is the part the operator needs, and a newer node talking to a
 * frozen kit is the normal direction of skew here — the same judgement
 * `checkPendingPromptWire` makes when it admits `unknown` instead of refusing.
 */
function asNoticeKind(value) {
    return NOTICE_KINDS.includes(value)
        ? value
        : "context";
}
/** Validate an `OperatorNotice` off the wire, or null. Round-trips a stamped one. */
export function parseOperatorNotice(value) {
    if (!isRecord(value))
        return null;
    if (value.wire !== OPERATOR_NOTICE_WIRE)
        return null;
    const message = asString(value.message);
    if (message === null || message === "")
        return null;
    if (typeof value.ordinal !== "number" || !Number.isFinite(value.ordinal))
        return null;
    if (typeof value.at !== "number" || !Number.isFinite(value.at))
        return null;
    if (!isRecord(value.asker))
        return null;
    const command = asString(value.asker.command);
    if (command === null)
        return null;
    const asker = { command };
    if (typeof value.asker.pid === "number" && Number.isFinite(value.asker.pid)) {
        asker.pid = value.asker.pid;
    }
    const host = asString(value.asker.host);
    if (host !== null)
        asker.host = host;
    return {
        wire: OPERATOR_NOTICE_WIRE,
        ordinal: value.ordinal,
        message,
        kind: asNoticeKind(value.kind),
        asker,
        at: value.at,
    };
}
/** Validate a list payload, dropping entries that do not parse. */
export function parseOperatorNoticeList(value) {
    const raw = isRecord(value) && Array.isArray(value.notices) ? value.notices : [];
    const parsed = [];
    for (const entry of raw) {
        const notice = parseOperatorNotice(entry);
        if (notice !== null)
            parsed.push(notice);
    }
    return parsed;
}
/** True when answering this prompt would put its value on the wire (P4). */
export function promptAnswerTravels(prompt) {
    return prompt.type === "secret";
}
/** Build the wire shape for a prompt about to be published. PURE. */
export function toPendingPrompt(prompt, options) {
    const askedAt = options.askedAt ?? Date.now();
    const timeoutMs = options.timeoutMs ?? null;
    return {
        wire: PENDING_PROMPT_WIRE,
        id: options.id,
        prompt,
        answerTravels: promptAnswerTravels(prompt),
        asker: options.asker,
        askedAt,
        expiresAt: timeoutMs === null ? null : askedAt + timeoutMs,
        // Omitted when absent rather than written as `undefined`: this shape crosses a wire, and
        // a key that is present-but-undefined is a third state nobody declared.
        ...(options.subject ? { subject: options.subject } : {}),
    };
}
// ── Parsing: a device receives untrusted JSON ─────────────────────────────────
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asString(value) {
    return typeof value === "string" ? value : null;
}
function parseSelectOptions(value) {
    if (!Array.isArray(value) || value.length === 0)
        return null;
    const options = [];
    for (const raw of value) {
        if (!isRecord(raw))
            return null;
        const optValue = asString(raw.value);
        const label = asString(raw.label);
        if (optValue === null || label === null)
            return null;
        const description = asString(raw.description);
        options.push(description === null ? { value: optValue, label } : { value: optValue, label, description });
    }
    return options;
}
/**
 * Validate an `OperatorPrompt` off the wire. Returns null rather than throwing —
 * a malformed entry in a list must not take down the whole list on a phone.
 */
export function parseOperatorPrompt(value) {
    if (!isRecord(value))
        return null;
    const question = asString(value.question);
    if (question === null)
        return null;
    switch (value.type) {
        case "confirm":
            return typeof value.default === "boolean"
                ? { type: "confirm", question, default: value.default }
                : { type: "confirm", question };
        case "select": {
            const options = parseSelectOptions(value.options);
            if (options === null)
                return null;
            const fallback = asString(value.default);
            const valid = fallback !== null && options.some((o) => o.value === fallback);
            return valid
                ? { type: "select", question, options, default: fallback }
                : { type: "select", question, options };
        }
        case "text": {
            const prompt = { type: "text", question };
            const fallback = asString(value.default);
            if (fallback !== null)
                prompt.default = fallback;
            const placeholder = asString(value.placeholder);
            if (placeholder !== null)
                prompt.placeholder = placeholder;
            return prompt;
        }
        case "secret":
            return typeof value.visibleTail === "number" && Number.isFinite(value.visibleTail)
                ? { type: "secret", question, visibleTail: value.visibleTail }
                : { type: "secret", question };
        default:
            return null;
    }
}
/** Validate a `PendingPrompt` off the wire, or null. Round-trips `toPendingPrompt`. */
export function parsePendingPrompt(value) {
    if (!isRecord(value))
        return null;
    if (value.wire !== PENDING_PROMPT_WIRE)
        return null;
    const id = asString(value.id);
    if (id === null || id === "")
        return null;
    const prompt = parseOperatorPrompt(value.prompt);
    if (prompt === null)
        return null;
    if (!isRecord(value.asker))
        return null;
    const command = asString(value.asker.command);
    if (command === null)
        return null;
    if (typeof value.askedAt !== "number" || !Number.isFinite(value.askedAt))
        return null;
    const expiresAt = typeof value.expiresAt === "number" && Number.isFinite(value.expiresAt)
        ? value.expiresAt
        : null;
    if (value.expiresAt !== null && expiresAt === null)
        return null;
    const asker = { command };
    if (typeof value.asker.pid === "number" && Number.isFinite(value.asker.pid)) {
        asker.pid = value.asker.pid;
    }
    const host = asString(value.asker.host);
    if (host !== null)
        asker.host = host;
    return {
        wire: PENDING_PROMPT_WIRE,
        id,
        prompt,
        // Recomputed from the prompt, never trusted from the wire: a peer that
        // under-reported `answerTravels` would silently strip P4's warning off a
        // secret. The kind decides, and the kind is right here.
        answerTravels: promptAnswerTravels(prompt),
        asker,
        askedAt: value.askedAt,
        expiresAt,
    };
}
/** Validate a list payload, dropping entries that do not parse. */
export function parsePendingPromptList(value) {
    const raw = isRecord(value) && Array.isArray(value.prompts) ? value.prompts : [];
    const parsed = [];
    for (const entry of raw) {
        const prompt = parsePendingPrompt(entry);
        if (prompt !== null)
            parsed.push(prompt);
    }
    return parsed;
}
const CONFIRM_TRUE = new Set(["true", "yes", "y", "1"]);
const CONFIRM_FALSE = new Set(["false", "no", "n", "0"]);
/**
 * Is this a legal answer to this prompt? Constraints live with the shape (P6),
 * so every surface enforces the same ones — a select cannot settle on a value
 * that was never offered, whichever device typed it.
 *
 * Rejection reasons never quote the submitted value: for a secret prompt that
 * would put the secret in an error string, which is the one place it must not go.
 */
export function checkPendingPromptAnswer(prompt, value) {
    if (prompt.type === "confirm") {
        if (typeof value === "boolean")
            return { ok: true, value };
        if (typeof value === "string") {
            const normalized = value.trim().toLowerCase();
            if (CONFIRM_TRUE.has(normalized))
                return { ok: true, value: true };
            if (CONFIRM_FALSE.has(normalized))
                return { ok: true, value: false };
        }
        return { ok: false, reason: "confirm expects a boolean" };
    }
    if (typeof value !== "string")
        return { ok: false, reason: `${prompt.type} expects a string` };
    if (prompt.type === "select") {
        return prompt.options.some((option) => option.value === value)
            ? { ok: true, value }
            : { ok: false, reason: "select expects one of the offered option values" };
    }
    return { ok: true, value };
}
/**
 * Which identity to record for an answer (P3): the one the transport's GATE
 * resolved, and nothing else.
 *
 * There is deliberately no way for a caller to name itself, not even as a
 * suggestion when the gate resolved nobody. That is the whole defence of the
 * ungated loopback path: a local caller may answer (it could equally walk to the
 * terminal and type), but it is recorded as ` node-local` and can never claim to
 * have been an enrolled device. An attribution a caller can choose is not an
 * attribution.
 *
 * Trimming is what makes the reserved sentinels unreachable from outside: a
 * gate-resolved label loses any leading space, so it can never come back as one.
 */
export function resolveAnsweringDevice(authenticated) {
    const resolved = typeof authenticated === "string" ? authenticated.trim() : "";
    return resolved || NODE_LOCAL_PROMPT_DEVICE;
}
export function createPendingPromptHub(options = {}) {
    const maxPending = options.maxPending ?? 64;
    const recentCapacity = options.recentSettlements ?? 32;
    const now = options.now ?? (() => Date.now());
    const entries = new Map();
    const recent = [];
    const listeners = new Set();
    const noticeCapacity = options.recentNotices ?? 32;
    const notices = [];
    let noticeOrdinal = 0;
    function remember(settlement) {
        recent.push(settlement);
        while (recent.length > recentCapacity)
            recent.shift();
    }
    /**
     * THE first-answer-wins rule, in one place (P2).
     *
     * The whole rule is these three lines, and they are synchronous with no await
     * between the read of `entry.settled` and the write — so on a single-threaded
     * runtime this is an atomic compare-and-set. Two devices answering in the same
     * tick, a remote answer landing as the terminal answers, a withdraw racing an
     * answer: all of them funnel through here, and exactly one gets `true`.
     *
     * Every other path (answer, withdraw, expiry, cancellation) MUST settle by
     * calling this and MUST respect its verdict. Nothing else may touch
     * `entry.settled` or resolve the ticket.
     */
    function claim(entry, settlement, value) {
        if (entry.settled)
            return false;
        entry.settled = true;
        entries.delete(entry.pending.id);
        remember(settlement);
        entry.settle(settlement, value);
        return true;
    }
    function publish(pending) {
        if (entries.has(pending.id)) {
            throw new RangeError(`createPendingPromptHub: prompt id already pending: ${pending.id}`);
        }
        if (entries.size >= maxPending) {
            throw new RangeError(`createPendingPromptHub: ${maxPending} prompts already pending — refusing to queue more`);
        }
        let settle;
        const promise = new Promise((resolve) => {
            settle = resolve;
        });
        const entry = {
            pending,
            settled: false,
            settle: (settlement, value) => settle({ settlement, value }),
        };
        entries.set(pending.id, entry);
        for (const listener of listeners)
            listener(pending);
        return {
            pending,
            settled: promise,
            withdraw: (reason = "withdrawn", device = TERMINAL_PROMPT_DEVICE) => claim(entry, { promptId: pending.id, outcome: "abandoned", device, reason, at: now() }, null),
        };
    }
    return {
        pollIntervalMs: PENDING_PROMPT_POLL_INTERVAL_MS,
        publish,
        list: () => [...entries.values()].map((entry) => entry.pending),
        answer(promptId, value, device) {
            const entry = entries.get(promptId);
            if (!entry) {
                const settlement = recent.find((s) => s.promptId === promptId);
                // "The answer is no" and "I could not ask" are different answers, and
                // a peer that lost a race deserves the first one.
                return settlement ? { ok: false, reason: "already-settled", settlement } : { ok: false, reason: "unknown" };
            }
            const check = checkPendingPromptAnswer(entry.pending.prompt, value);
            if (!check.ok)
                return { ok: false, reason: "invalid", detail: check.reason };
            const settlement = {
                promptId,
                outcome: "answered",
                device,
                at: now(),
            };
            if (!claim(entry, settlement, check.value)) {
                const won = recent.find((s) => s.promptId === promptId);
                return won
                    ? { ok: false, reason: "already-settled", settlement: won }
                    : { ok: false, reason: "unknown" };
            }
            return { ok: true, settlement };
        },
        settlementOf: (promptId) => recent.find((s) => s.promptId === promptId) ?? null,
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        announce(asker, notice) {
            const normalized = normalizeNoticeInput(notice);
            noticeOrdinal += 1;
            const stamped = {
                wire: OPERATOR_NOTICE_WIRE,
                ordinal: noticeOrdinal,
                message: normalized.message,
                kind: normalized.kind,
                asker,
                at: now(),
            };
            notices.push(stamped);
            while (notices.length > noticeCapacity)
                notices.shift();
            // NOT notifying `listeners`, and that omission is the whole of D9. That
            // set is what `attachDeliveryToHub` subscribes to, so notifying here
            // would push a wizard's preflight to the operator's phone one line at a
            // time. Framing reaches a push surface by riding the question instead —
            // see `takeNoticesFor`.
            return stamped;
        },
        notices: () => [...notices],
        noticesFor: (askerCommand, since = 0) => notices.filter((notice) => notice.asker.command === askerCommand && notice.ordinal > since),
    };
}
// ── The remote channel ────────────────────────────────────────────────────────
/**
 * The asker's deadline passed with nobody answering (P5).
 *
 * Deliberately NOT an `OperatorPromptCancelledError`: a blocked CLI that waits
 * forever is a CLI that gets killed with Ctrl+C and leaves half-applied state,
 * so expiry is an outcome the asker handles — and it is a different outcome from
 * the operator saying no.
 */
export class OperatorPromptExpiredError extends Error {
    constructor(message = "Operator prompt expired") {
        super(message);
        this.name = "OperatorPromptExpiredError";
    }
}
const DEFAULT_PROMPT_TIMEOUT_MS = 10 * 60 * 1000;
let idCounter = 0;
/** Unique enough for prompts within one asker's lifetime, which is all a
 *  never-persisted id has to be (P1). No crypto import for a non-secret. */
function defaultPromptId() {
    idCounter += 1;
    return `p-${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
/**
 * An `OperatorChannel` answered from somewhere else: it publishes the prompt to
 * the hub and waits for whichever attending device settles it.
 *
 * Every wizard already written goes through `OperatorChannel`, so this adapter
 * is what makes all of them remotely answerable without one of them changing.
 */
export function createRemoteOperatorChannel(options) {
    const { hub, asker } = options;
    const now = options.now ?? (() => Date.now());
    const newId = options.newId ?? defaultPromptId;
    const timeoutMs = options.timeoutMs === undefined ? DEFAULT_PROMPT_TIMEOUT_MS : options.timeoutMs;
    let last = null;
    async function ask(prompt) {
        const pending = toPendingPrompt(prompt, {
            id: newId(),
            asker,
            askedAt: now(),
            timeoutMs,
        });
        const ticket = hub.publish(pending);
        const detachAbort = onAbortOnce(options.signal, () => {
            ticket.withdraw("cancelled", TERMINAL_PROMPT_DEVICE);
        });
        let timer = null;
        if (pending.expiresAt !== null) {
            timer = setTimeout(() => ticket.withdraw("expired", TERMINAL_PROMPT_DEVICE), Math.max(0, pending.expiresAt - now()));
            // A pending question must never be the reason a CLI refuses to exit.
            timer.unref?.();
        }
        try {
            const { settlement, value } = await ticket.settled;
            last = settlement;
            if (settlement.outcome === "answered")
                return value;
            if (settlement.reason === "expired") {
                throw new OperatorPromptExpiredError(`No answer before the deadline (asked by ${asker.command}).`);
            }
            throw new OperatorPromptCancelledError();
        }
        finally {
            detachAbort();
            if (timer)
                clearTimeout(timer);
        }
    }
    function say(notice) {
        hub.announce(asker, notice);
    }
    return { ask, say, lastSettlement: () => last };
}
function defaultNotify(message) {
    process.stderr.write(`${message}\n`);
}
/**
 * Offer one prompt at the terminal that asked AND to attending devices at the
 * same time; the first answer wins and the loser is told (P2).
 *
 * The stdio channel is NOT demoted by this: sitting at the desk stays the
 * fastest path, and the phone is what you reach for when you are not at the
 * desk. The failure this exists to avoid is a prompt left visibly hanging at a
 * terminal someone is looking at, which is why losing locally ABORTS the local
 * prompt and says which device answered instead of going quiet.
 *
 * A remote side that is simply broken (sidecar down, transport error) must not
 * be able to break the terminal: its failure is swallowed and the local prompt
 * keeps waiting. Only an expiry — the ASKER's own deadline, which belongs to the
 * ask rather than to either surface — ends both sides.
 */
export function createPeeredOperatorChannel(options) {
    const notify = options.notify ?? defaultNotify;
    async function ask(prompt) {
        const localAbort = new AbortController();
        const remoteAbort = new AbortController();
        const remoteChannel = options.remote(remoteAbort.signal);
        // Both handlers are attached at creation, so a side that settles LATE —
        // after the other already won — can never surface as an unhandled rejection.
        const settle = (side, promise) => promise.then((value) => ({ side, ok: true, value }), (error) => ({ side, ok: false, error }));
        const localTask = settle("local", options.local(localAbort.signal).ask(prompt));
        const remoteTask = settle("remote", remoteChannel.ask(prompt));
        const inFlight = new Set([localTask, remoteTask]);
        try {
            while (inFlight.size > 0) {
                const outcome = await Promise.race(inFlight);
                inFlight.delete(outcome.side === "local" ? localTask : remoteTask);
                if (outcome.side === "local") {
                    // The terminal settled it, either way. Withdraw the question from
                    // every attending device: a prompt answered here is not still open
                    // there.
                    remoteAbort.abort();
                    if (outcome.ok)
                        return outcome.value;
                    throw outcome.error;
                }
                if (outcome.ok) {
                    // Answered elsewhere. Say WHERE — silence is what leaves a prompt
                    // hanging at a terminal someone is watching.
                    localAbort.abort();
                    const device = remoteChannel.lastSettlement()?.device ?? "another device";
                    notify(`↩ answered on ${device} — this prompt is settled here.`);
                    return outcome.value;
                }
                if (outcome.error instanceof OperatorPromptExpiredError) {
                    // The asker's deadline, not a surface's — it ends both sides.
                    localAbort.abort();
                    throw outcome.error;
                }
                // The remote side is unavailable or was withdrawn. The operator is
                // still standing at the terminal; keep the prompt they can see.
            }
            // Unreachable: the local task always settles into one of the branches above.
            throw new OperatorPromptCancelledError();
        }
        finally {
            // A prompt that has settled is settled on BOTH sides — a still-published
            // question after the asker moved on is exactly the artifact P1 refuses.
            remoteAbort.abort();
            localAbort.abort();
        }
    }
    function say(notice) {
        // The TERMINAL first: it is the surface someone may be looking at right now,
        // and a broken elsewhere must never be the reason they did not see this.
        options.local(new AbortController().signal).say?.(notice);
        try {
            options.announce?.(notice);
        }
        catch {
            // `say` is TOTAL. A publisher that throws is a broken notification
            // arrangement, and that must not become the wizard's problem — the same
            // judgement `currentPromptPublisher` already makes for a throwing source.
        }
    }
    return { ask, say };
}
const ANSWER_PATH = /^\/prompts\/([^/]+)\/answer$/;
/**
 * Serve the pending-prompt surface.
 *
 * WHO MAY ANSWER (P3): exactly whoever this listener let through. There is no
 * finer permission model here, because an enrolled device IS the operator's
 * device — but the settlement records WHICH one, and the identity it records is
 * the gate's, never the caller's own claim (see `resolveAnsweringDevice`).
 *
 * ON THE UNGATED LOOPBACK LISTENER: the node additionally listens on 127.0.0.1
 * without the credential layer, by design — a token the node presents to itself
 * defends nothing against someone who already has local shell. That reasoning
 * survives here: a local caller could equally walk to the terminal that asked
 * and type the answer, so answering from loopback grants no authority local
 * shell did not already have. Two things must still hold, and are enforced
 * below rather than assumed:
 *
 *   1. an unauthenticated caller is recorded as `node-local` and may NOT claim
 *      to be an enrolled device or the terminal — otherwise the record of who
 *      answered would be forgeable, and that record is the whole of P3;
 *   2. nothing readable comes back that was not already local knowledge: a
 *      settlement carries no answer value, so this surface cannot be used to
 *      read an answer — only to give one.
 */
export function handlePendingPromptHttp(hub, request) {
    const method = request.method.toUpperCase();
    if (request.path === "/prompts") {
        if (method !== "GET")
            return { status: 405, body: { error: "method-not-allowed" } };
        return {
            status: 200,
            body: {
                wire: PENDING_PROMPT_WIRE,
                // Stated, not implied — an attending device should not have to guess
                // how often it is welcome to ask.
                pollIntervalMs: hub.pollIntervalMs,
                prompts: hub.list(),
            },
        };
    }
    const answerMatch = ANSWER_PATH.exec(request.path);
    if (answerMatch) {
        if (method !== "POST")
            return { status: 405, body: { error: "method-not-allowed" } };
        const promptId = decodeURIComponent(answerMatch[1]);
        const body = isRecord(request.body) ? request.body : {};
        // Only `value` is read off the body. A `device` field, if a caller sends
        // one, is ignored rather than merged — see `resolveAnsweringDevice`.
        const device = resolveAnsweringDevice(request.authenticatedDevice);
        const result = hub.answer(promptId, body.value, device);
        if (result.ok) {
            return { status: 200, body: { outcome: "answered", device: result.settlement.device } };
        }
        if (result.reason === "already-settled") {
            // 409, with WHO settled it: a peer that lost the race is told what
            // happened, because a silent drop teaches a caller to retry harder.
            return {
                status: 409,
                body: {
                    error: "already-settled",
                    outcome: result.settlement.outcome,
                    device: result.settlement.device,
                    ...(result.settlement.reason ? { reason: result.settlement.reason } : {}),
                },
            };
        }
        if (result.reason === "invalid") {
            return { status: 400, body: { error: "invalid-answer", detail: result.detail } };
        }
        return { status: 404, body: { error: "unknown-prompt" } };
    }
    return { status: 404, body: { error: "not-found" } };
}
//# sourceMappingURL=index.js.map