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

export type OperatorPrompt = ConfirmPrompt | SelectPrompt | TextPrompt;

// ── OperatorChannel ───────────────────────────────────────────────────────────

export interface OperatorChannel {
	ask(prompt: ConfirmPrompt): Promise<boolean>;
	ask(prompt: SelectPrompt): Promise<string>;
	ask(prompt: TextPrompt): Promise<string>;
	ask(prompt: OperatorPrompt): Promise<boolean | string>;
}

// ── createAutoOperatorChannel ─────────────────────────────────────────────────
// Returns the `default` value for every prompt without prompting.
// Use in non-interactive environments (CI, automated scripts).

export function createAutoOperatorChannel(): OperatorChannel {
	const ask = async (prompt: OperatorPrompt): Promise<boolean | string> => {
		if (prompt.type === "confirm") return prompt.default ?? true;
		if (prompt.type === "select") return prompt.default ?? prompt.options[0]?.value ?? "";
		return prompt.default ?? "";
	};
	return { ask } as OperatorChannel;
}

// ── createScriptedOperatorChannel ────────────────────────────────────────────
// Returns predefined answers in sequence. Throws RangeError if exhausted.
// Use in tests to drive an OperatorChannel without stdin.

export function createScriptedOperatorChannel(
	answers: Array<boolean | string>,
): OperatorChannel {
	const queue = [...answers];
	const ask = async (_prompt: OperatorPrompt): Promise<boolean | string> => {
		if (queue.length === 0) {
			throw new RangeError("createScriptedOperatorChannel: answer queue exhausted");
		}
		return queue.shift()!;
	};
	return { ask } as OperatorChannel;
}

// ── createStdioOperatorChannel ────────────────────────────────────────────────
// Interactive readline implementation. No external dependencies.

export function createStdioOperatorChannel(): OperatorChannel {
	const ask = async (prompt: OperatorPrompt): Promise<boolean | string> => {
		if (prompt.type === "confirm") return askConfirm(prompt);
		if (prompt.type === "select") return askSelect(prompt);
		return askText(prompt);
	};
	return { ask } as OperatorChannel;
}

function askConfirm(prompt: ConfirmPrompt): Promise<boolean> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
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

function askSelect(prompt: SelectPrompt): Promise<string> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	process.stdout.write(`${prompt.question}\n`);
	prompt.options.forEach((opt, i) => {
		const marker = opt.value === prompt.default ? "▶" : " ";
		const desc = opt.description ? `  — ${opt.description}` : "";
		process.stdout.write(`  ${marker} ${i + 1}. ${opt.label}${desc}\n`);
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
			const opt = Number.isFinite(n) ? prompt.options[n - 1] : undefined;
			resolve(opt?.value ?? prompt.default ?? prompt.options[0]?.value ?? "");
		});
	});
}

function askText(prompt: TextPrompt): Promise<string> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
	const hint = prompt.placeholder
		? ` (${prompt.placeholder})`
		: prompt.default
			? ` [${prompt.default}]`
			: "";
	return new Promise((resolve) => {
		rl.question(`${prompt.question}${hint}: `, (answer) => {
			rl.close();
			resolve(answer.trim() || prompt.default || "");
		});
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
	const total = 3;

	// 1 — confirm returns boolean
	try {
		const result = await channel.ask({ type: "confirm", question: "_conformance_", default: true });
		if (typeof result !== "boolean") failures.push("confirm: did not return boolean");
	} catch (e) {
		failures.push(`confirm threw: ${String(e)}`);
	}

	// 2 — select returns a value present in options
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

	const failed = failures.length;
	return { pass: failed === 0, total, failed, failures };
}
