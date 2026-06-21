import readline from "node:readline";

export const PROMPT_CAPABILITY = "prompt:v1" as const;

// ── Prompt types ──────────────────────────────────────────────────────────────

export interface SelectOption {
	value: string;
	label: string;
	description?: string;
}

export interface ConfirmPrompt {
	type: "confirm";
	question: string;
	/** Default answer when the user presses Enter. Defaults to true. */
	default?: boolean;
}

export interface SelectPrompt {
	type: "select";
	question: string;
	options: SelectOption[];
	/** Value of the pre-selected option. Defaults to first option. */
	default?: string;
}

export interface TextPrompt {
	type: "text";
	question: string;
	/** Returned when the user submits an empty answer. */
	default?: string;
	/** Shown as a hint inside the prompt (does not constrain input). */
	placeholder?: string;
}

export interface SecretPrompt {
	type: "secret";
	question: string;
	/** Number of trailing characters to keep visible while typing. Defaults to 0. */
	visibleTail?: number;
}

export type OperatorPrompt = ConfirmPrompt | SelectPrompt | TextPrompt | SecretPrompt;

export class OperatorPromptCancelledError extends Error {
	constructor(message = "Operator prompt cancelled") {
		super(message);
		this.name = "OperatorPromptCancelledError";
	}
}

// ── OperatorChannel ───────────────────────────────────────────────────────────

export interface OperatorChannel {
	ask(prompt: ConfirmPrompt): Promise<boolean>;
	ask(prompt: SelectPrompt): Promise<string>;
	ask(prompt: TextPrompt): Promise<string>;
	ask(prompt: SecretPrompt): Promise<string>;
	ask(prompt: OperatorPrompt): Promise<boolean | string>;
}

export interface StdioOperatorChannelOptions {
	input?: NodeJS.ReadStream;
	output?: NodeJS.WriteStream;
}

// ── createAutoOperatorChannel ─────────────────────────────────────────────────
// Returns the `default` value for every prompt without prompting.
// Use in non-interactive environments (CI, automated scripts).

export function createAutoOperatorChannel(): OperatorChannel {
	function ask(prompt: ConfirmPrompt): Promise<boolean>;
	function ask(prompt: SelectPrompt): Promise<string>;
	function ask(prompt: TextPrompt): Promise<string>;
	function ask(prompt: SecretPrompt): Promise<string>;
	async function ask(prompt: OperatorPrompt): Promise<boolean | string> {
		if (prompt.type === "confirm") return prompt.default ?? true;
		if (prompt.type === "select") return prompt.default ?? prompt.options[0]?.value ?? "";
		if (prompt.type === "secret") return "";
		return prompt.default ?? "";
	}
	return { ask };
}

// ── createScriptedOperatorChannel ────────────────────────────────────────────
// Returns predefined answers in sequence. Throws RangeError if exhausted.
// Use in tests to drive an OperatorChannel without stdin.

export function createScriptedOperatorChannel(
	answers: Array<boolean | string>,
): OperatorChannel {
	const queue = [...answers];
	function ask(prompt: ConfirmPrompt): Promise<boolean>;
	function ask(prompt: SelectPrompt): Promise<string>;
	function ask(prompt: TextPrompt): Promise<string>;
	function ask(prompt: SecretPrompt): Promise<string>;
	async function ask(_prompt: OperatorPrompt): Promise<boolean | string> {
		if (queue.length === 0) {
			throw new RangeError("createScriptedOperatorChannel: answer queue exhausted");
		}
		return queue.shift()!;
	}
	return { ask };
}

// ── createStdioOperatorChannel ────────────────────────────────────────────────
// Interactive readline implementation. No external dependencies.

export function createStdioOperatorChannel(
	options: StdioOperatorChannelOptions = {},
): OperatorChannel {
	const input = options.input ?? process.stdin;
	const output = options.output ?? process.stdout;
	function ask(prompt: ConfirmPrompt): Promise<boolean>;
	function ask(prompt: SelectPrompt): Promise<string>;
	function ask(prompt: TextPrompt): Promise<string>;
	function ask(prompt: SecretPrompt): Promise<string>;
	async function ask(prompt: OperatorPrompt): Promise<boolean | string> {
		if (prompt.type === "confirm") return askConfirm(prompt, input, output);
		if (prompt.type === "select") return askSelect(prompt, input, output);
		if (prompt.type === "secret") return askSecret(prompt, input, output);
		return askText(prompt, input, output);
	}
	return { ask };
}

function askConfirm(
	prompt: ConfirmPrompt,
	input: NodeJS.ReadStream,
	output: NodeJS.WriteStream,
): Promise<boolean> {
	const rl = readline.createInterface({ input, output });
	const hint = prompt.default === false ? "(y/N)" : "(Y/n)";
	return new Promise((resolve) => {
		rl.question(`${prompt.question} ${hint} `, (answer) => {
			rl.close();
			const t = answer.trim().toLowerCase();
			if (!t) resolve(prompt.default ?? true);
			else resolve(t !== "n" && t !== "no");
		});
	});
}

function askSelect(
	prompt: SelectPrompt,
	input: NodeJS.ReadStream,
	output: NodeJS.WriteStream,
): Promise<string> {
	if (input.isTTY && output.isTTY && typeof input.setRawMode === "function") {
		return askSelectTui(prompt, input, output);
	}
	return askSelectNumbered(prompt, input, output);
}

function askSelectNumbered(
	prompt: SelectPrompt,
	input: NodeJS.ReadStream,
	output: NodeJS.WriteStream,
): Promise<string> {
	const rl = readline.createInterface({ input, output });
	output.write(`${prompt.question}\n`);
	prompt.options.forEach((opt, i) => {
		const marker = opt.value === prompt.default ? "▶" : " ";
		const desc = opt.description ? ` - ${opt.description}` : "";
		output.write(`  ${marker} ${i + 1}. ${opt.label}${desc}\n`);
	});
	const defaultIndex =
		prompt.default !== undefined
			? prompt.options.findIndex((o) => o.value === prompt.default) + 1
			: 1;
	const effectiveDefault = defaultIndex > 0 ? defaultIndex : 1;

	return new Promise((resolve) => {
		rl.question(`Enter number (${effectiveDefault}): `, (answer) => {
			rl.close();
			const t = answer.trim();
			if (!t) {
				resolve(prompt.default ?? prompt.options[0]?.value ?? "");
				return;
			}
			const n = parseInt(t, 10);
			const opt = Number.isFinite(n) && n >= 1 && n <= prompt.options.length
				? prompt.options[n - 1]
				: undefined;
			if (!opt) {
				process.stderr.write(`  Invalid choice, using default.\n`);
			}
			resolve(opt?.value ?? prompt.default ?? prompt.options[0]?.value ?? "");
		});
	});
}

function askSelectTui(
	prompt: SelectPrompt,
	input: NodeJS.ReadStream,
	output: NodeJS.WriteStream,
): Promise<string> {
	if (prompt.options.length === 0) return Promise.resolve("");
	const defaultIndex =
		prompt.default !== undefined
			? prompt.options.findIndex((o) => o.value === prompt.default)
			: 0;
	let selectedIndex = defaultIndex >= 0 ? defaultIndex : 0;

	return new Promise((resolve, reject) => {
		const wasRaw = input.isRaw;
		let renderedLines = 0;

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
			input.setRawMode(wasRaw);
			input.pause();
			output.write("\n");
		};

		const onKeypress = (str: string, key: readline.Key) => {
			if (key.ctrl && key.name === "c") {
				cleanup();
				reject(new OperatorPromptCancelledError());
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
				cleanup();
				resolve(prompt.options[selectedIndex]?.value ?? "");
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
		render();
	});
}

function formatSelectLine(line: string, selected: boolean, output: NodeJS.WriteStream): string {
	if (!selected || !output.isTTY || process.env.NO_COLOR) return line;
	return `\x1b[7m${line}\x1b[0m`;
}

function promptSuffix(question: string): string {
	return /[:?]\s*$/.test(question) ? " " : ": ";
}

function askText(
	prompt: TextPrompt,
	input: NodeJS.ReadStream,
	output: NodeJS.WriteStream,
): Promise<string> {
	const rl = readline.createInterface({ input, output });
	let hint = "";
	if (prompt.placeholder) hint += ` (${prompt.placeholder})`;
	if (prompt.default) hint += ` [${prompt.default}]`;
	return new Promise((resolve) => {
		rl.question(`${prompt.question}${hint}${promptSuffix(prompt.question)}`, (answer) => {
			rl.close();
			resolve(answer.trim() || prompt.default || "");
		});
	});
}

function maskSecret(value: string, visibleTail: number): string {
	if (visibleTail <= 0) return "*".repeat(value.length);
	if (value.length <= visibleTail) return "*".repeat(value.length);
	return "*".repeat(value.length - visibleTail) + value.slice(-visibleTail);
}

function askSecret(
	prompt: SecretPrompt,
	input: NodeJS.ReadStream,
	output: NodeJS.WriteStream,
): Promise<string> {
	const visibleTail = prompt.visibleTail ?? 0;

	if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
		return askText({ type: "text", question: prompt.question }, input, output);
	}

	return new Promise((resolve, reject) => {
		let value = "";
		const wasRaw = input.isRaw;

		const render = () => {
			readline.clearLine(output, 0);
			readline.cursorTo(output, 0);
			output.write(`${prompt.question}: ${maskSecret(value, visibleTail)}`);
		};

		const cleanup = () => {
			input.off("keypress", onKeypress);
			input.setRawMode(wasRaw);
			input.pause();
			output.write("\n");
		};

		const onKeypress = (str: string, key: readline.Key) => {
			if (key.ctrl && key.name === "c") {
				cleanup();
				reject(new OperatorPromptCancelledError());
				return;
			}
			if (key.name === "return" || key.name === "enter") {
				cleanup();
				resolve(value);
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
		render();
	});
}

// ── Conformance runner ────────────────────────────────────────────────────────

export interface OperatorChannelConformanceResult {
	pass: boolean;
	total: number;
	failed: number;
	failures: string[];
}

export async function runOperatorChannelConformance(
	channel: OperatorChannel,
): Promise<OperatorChannelConformanceResult> {
	const failures: string[] = [];
	let checksRun = 0;

	// 1 — confirm returns boolean
	checksRun++;
	try {
		const result = await channel.ask({ type: "confirm", question: "_conformance_", default: true });
		if (typeof result !== "boolean") failures.push("confirm: did not return boolean");
	} catch (e) {
		failures.push(`confirm threw: ${String(e)}`);
	}

	// 2 — select returns a value present in options
	checksRun++;
	try {
		const opts: SelectOption[] = [
			{ value: "a", label: "A" },
			{ value: "b", label: "B" },
		];
		const result = await channel.ask({
			type: "select",
			question: "_conformance_",
			options: opts,
			default: "a",
		});
		if (typeof result !== "string") failures.push("select: did not return string");
		else if (!opts.some((o) => o.value === result))
			failures.push(`select: returned value not in options: "${result}"`);
	} catch (e) {
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
		if (typeof result !== "string") failures.push("text: did not return string");
	} catch (e) {
		failures.push(`text threw: ${String(e)}`);
	}

	// 4 — secret returns string
	checksRun++;
	try {
		const result = await channel.ask({
			type: "secret",
			question: "_conformance_",
		});
		if (typeof result !== "string") failures.push("secret: did not return string");
	} catch (e) {
		failures.push(`secret threw: ${String(e)}`);
	}

	const failed = failures.length;
	return { pass: failed === 0, total: checksRun, failed, failures };
}
