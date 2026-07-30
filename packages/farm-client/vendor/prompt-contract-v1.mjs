import readline from "node:readline";
export const PROMPT_CAPABILITY = "prompt:v1";
export class OperatorPromptCancelledError extends Error {
    constructor(message = "Operator prompt cancelled") {
        super(message);
        this.name = "OperatorPromptCancelledError";
    }
}
// ── createAutoOperatorChannel ─────────────────────────────────────────────────
// Returns the `default` value for every prompt without prompting.
// Use in non-interactive environments (CI, automated scripts).
export function createAutoOperatorChannel() {
    async function ask(prompt) {
        if (prompt.type === "confirm")
            return prompt.default ?? true;
        if (prompt.type === "select")
            return prompt.default ?? prompt.options[0]?.value ?? "";
        if (prompt.type === "secret")
            return "";
        return prompt.default ?? "";
    }
    return { ask };
}
// ── createScriptedOperatorChannel ────────────────────────────────────────────
// Returns predefined answers in sequence. Throws RangeError if exhausted.
// Use in tests to drive an OperatorChannel without stdin.
export function createScriptedOperatorChannel(answers) {
    const queue = [...answers];
    async function ask(_prompt) {
        if (queue.length === 0) {
            throw new RangeError("createScriptedOperatorChannel: answer queue exhausted");
        }
        return queue.shift();
    }
    return { ask };
}
// ── createStdioOperatorChannel ────────────────────────────────────────────────
// Interactive readline implementation. No external dependencies.
export function createStdioOperatorChannel(options = {}) {
    const input = options.input ?? process.stdin;
    const output = options.output ?? process.stdout;
    async function ask(prompt) {
        if (prompt.type === "confirm")
            return askConfirm(prompt, input, output);
        if (prompt.type === "select")
            return askSelect(prompt, input, output);
        if (prompt.type === "secret")
            return askSecret(prompt, input, output);
        return askText(prompt, input, output);
    }
    return { ask };
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
function askLine(rl, query) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (run) => {
            if (settled)
                return;
            settled = true;
            rl.off("SIGINT", onSigint);
            rl.off("close", onClose);
            run();
        };
        const onSigint = () => finish(() => {
            rl.close();
            reject(new OperatorPromptCancelledError());
        });
        const onClose = () => finish(() => reject(new OperatorPromptCancelledError()));
        rl.on("SIGINT", onSigint);
        rl.on("close", onClose);
        rl.question(query, (answer) => finish(() => {
            rl.close();
            resolve(answer);
        }));
    });
}
async function askConfirm(prompt, input, output) {
    const rl = readline.createInterface({ input, output });
    const hint = prompt.default === false ? "(y/N)" : "(Y/n)";
    const answer = await askLine(rl, `${prompt.question} ${hint} `);
    const t = answer.trim().toLowerCase();
    if (!t)
        return prompt.default ?? true;
    return t !== "n" && t !== "no";
}
function askSelect(prompt, input, output) {
    if (input.isTTY && output.isTTY && typeof input.setRawMode === "function") {
        return askSelectTui(prompt, input, output);
    }
    return askSelectNumbered(prompt, input, output);
}
async function askSelectNumbered(prompt, input, output) {
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
    const answer = await askLine(rl, `Enter number (${effectiveDefault}): `);
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
function askSelectTui(prompt, input, output) {
    if (prompt.options.length === 0)
        return Promise.resolve("");
    const defaultIndex = prompt.default !== undefined ? prompt.options.findIndex((o) => o.value === prompt.default) : 0;
    let selectedIndex = defaultIndex >= 0 ? defaultIndex : 0;
    return new Promise((resolve, reject) => {
        const wasRaw = input.isRaw;
        let renderedLines = 0;
        let settled = false;
        const render = () => {
            if (renderedLines > 0) {
                readline.moveCursor(output, 0, -renderedLines);
                readline.cursorTo(output, 0);
                readline.clearScreenDown(output);
            }
            const lines = [
                prompt.question,
                ...prompt.options.map((opt, i) => {
                    const marker = i === selectedIndex ? ">" : " ";
                    const desc = opt.description ? ` - ${opt.description}` : "";
                    return formatSelectLine(`  ${marker} ${opt.label}${desc}`, i === selectedIndex, output);
                }),
                "  Use Up/Down and Enter.",
            ];
            output.write(lines.join("\n"));
            renderedLines = lines.length - 1;
        };
        const cleanup = () => {
            input.off("keypress", onKeypress);
            input.off("end", onEnd);
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
async function askText(prompt, input, output) {
    const rl = readline.createInterface({ input, output });
    let hint = "";
    if (prompt.placeholder)
        hint += ` (${prompt.placeholder})`;
    if (prompt.default)
        hint += ` [${prompt.default}]`;
    const answer = await askLine(rl, `${prompt.question}${hint}${promptSuffix(prompt.question)}`);
    return answer.trim() || prompt.default || "";
}
function maskSecret(value, visibleTail) {
    if (visibleTail <= 0)
        return "*".repeat(value.length);
    if (value.length <= visibleTail)
        return "*".repeat(value.length);
    return "*".repeat(value.length - visibleTail) + value.slice(-visibleTail);
}
function askSecret(prompt, input, output) {
    const visibleTail = prompt.visibleTail ?? 0;
    if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
        return askText({ type: "text", question: prompt.question }, input, output);
    }
    return new Promise((resolve, reject) => {
        let value = "";
        const wasRaw = input.isRaw;
        let settled = false;
        const render = () => {
            readline.clearLine(output, 0);
            readline.cursorTo(output, 0);
            output.write(`${prompt.question}: ${maskSecret(value, visibleTail)}`);
        };
        const cleanup = () => {
            input.off("keypress", onKeypress);
            input.off("end", onEnd);
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
    const failed = failures.length;
    return { pass: failed === 0, total: checksRun, failed, failures };
}
//# sourceMappingURL=index.js.map