/**
 * The interactive INPUT FORM — the text-entry widget the dashboard opens when a chosen verb needs
 * arguments. A column of labeled fields: the user types into the focused field, Tab/arrows move between
 * fields, Enter submits (once every required field is filled), Esc cancels. This is the genuinely-hard
 * interactive part (raw-mode text input), kept testable: the loop is PURE given injected input+output.
 * Brand-neutral; colorizers injected.
 */
import { withInteractiveTerminal } from "./tui-interactive.js";
import type { Key, TerminalInput } from "./tui-input.js";

export interface FormField {
	name: string;
	required?: boolean;
	value?: string;
	/** Field kind: "text" (typed, default), "boolean" (space toggles a checkbox), "enum" (←/→ cycle). */
	kind?: "text" | "boolean" | "enum";
	/** The allowed values for an enum field. */
	options?: string[];
}

export interface FormColors {
	title?: (text: string) => string;
	label?: (text: string) => string;
	focusedLabel?: (text: string) => string;
	value?: (text: string) => string;
}

export interface RunInteractiveFormOptions {
	fields: FormField[];
	title?: string;
	colors?: FormColors;
	/** Headless drive (tests): inject a key source + frame sink. Omit for a real terminal (alt-screen). */
	input?: TerminalInput;
	output?: (frame: string) => void;
}

const identity = (text: string): string => text;
const DEL = String.fromCharCode(127);

/** The printable character a key represents, or null for a non-printable/control key. */
function printableChar(key: Key): string | null {
	if (key.ctrl || key.meta) return null;
	if (key.name === "space") return " ";
	const seq = key.sequence ?? "";
	if (seq.length === 1 && seq >= " " && seq !== DEL) return seq;
	if (key.name && key.name.length === 1) return key.name;
	return null;
}

interface FieldState {
	name: string;
	required: boolean;
	value: string;
	kind: "text" | "boolean" | "enum";
	options: string[];
}

/** Cycle an enum field's value through `["", ...options]` ("" = unset), wrapping. */
function cycleEnum(options: string[], current: string, dir: 1 | -1): string {
	const cycle = ["", ...options];
	const index = cycle.indexOf(current);
	return cycle[(index + dir + cycle.length) % cycle.length]!;
}

function renderForm(title: string | undefined, fields: FieldState[], focused: number, colors: FormColors): string {
	const titleColor = colors.title ?? identity;
	const labelColor = colors.label ?? identity;
	const focusedColor = colors.focusedLabel ?? identity;
	const valueColor = colors.value ?? identity;
	const lines: string[] = [];
	if (title) lines.push(titleColor(title));
	fields.forEach((field, index) => {
		const isFocused = index === focused;
		const label = `${isFocused ? "> " : "  "}${field.name}${field.required ? "*" : ""}: `;
		let display: string;
		if (field.kind === "boolean") display = field.value === "true" ? "[x]" : "[ ]";
		else if (field.kind === "enum") display = `< ${field.value || "(unset)"} >`;
		else display = `${field.value}${isFocused ? "_" : ""}`; // text: value + cursor
		lines.push(`${(isFocused ? focusedColor : labelColor)(label)}${valueColor(display)}`);
	});
	return lines.join("\n");
}

/**
 * Run an interactive form; resolve the collected `{name: value}` on submit, or null on cancel (Esc /
 * exhausted input). With `input` provided it runs headless (testable); otherwise it drives the real
 * terminal (alt-screen). Enter submits only when every required field is non-empty — otherwise focus
 * jumps to the first missing one.
 */
export async function runInteractiveForm(opts: RunInteractiveFormOptions): Promise<Record<string, string> | null> {
	const fields: FieldState[] = opts.fields.map((field) => ({
		name: field.name,
		required: Boolean(field.required),
		kind: field.kind ?? "text",
		options: field.options ?? [],
		value: field.value ?? (field.kind === "boolean" ? "false" : ""),
	}));
	if (fields.length === 0) return {}; // nothing to collect
	const colors = opts.colors ?? {};
	let focused = 0;

	const loop = async (
		input: TerminalInput,
		output: (frame: string) => void,
	): Promise<Record<string, string> | null> => {
		output(renderForm(opts.title, fields, focused, colors));
		for (;;) {
			const key = await input.readKey();
			if (!key) return null; // exhausted → cancel
			if (key.name === "escape") return null;
			if (key.name === "return") {
				const missing = fields.findIndex((field) => field.required && field.value.trim() === "");
				if (missing >= 0) {
					focused = missing; // block submit; jump to the first unfilled required field
					output(renderForm(opts.title, fields, focused, colors));
					continue;
				}
				return Object.fromEntries(fields.map((field) => [field.name, field.value]));
			}
			const current = fields[focused]!;
			if (key.name === "tab" || key.name === "down") focused = (focused + 1) % fields.length;
			else if (key.name === "up") focused = (focused - 1 + fields.length) % fields.length;
			else if (current.kind === "boolean") {
				// space / ←→ toggle the checkbox; typing is ignored.
				if (key.name === "space" || key.name === "left" || key.name === "right")
					current.value = current.value === "true" ? "false" : "true";
				else continue;
			} else if (current.kind === "enum") {
				// ←→ cycle the allowed values (incl. unset); typing is ignored.
				if (key.name === "left") current.value = cycleEnum(current.options, current.value, -1);
				else if (key.name === "right") current.value = cycleEnum(current.options, current.value, 1);
				else continue;
			} else if (key.name === "backspace") current.value = current.value.slice(0, -1);
			else {
				const char = printableChar(key);
				if (char === null) continue; // other control keys: ignore, no repaint
				current.value += char;
			}
			output(renderForm(opts.title, fields, focused, colors));
		}
	};

	if (opts.input) {
		return loop(opts.input, opts.output ?? ((frame) => void process.stdout.write(frame)));
	}
	return withInteractiveTerminal(loop);
}
