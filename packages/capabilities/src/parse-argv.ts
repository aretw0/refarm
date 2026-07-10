import type {
	CapabilityDescriptor,
	CapabilityInput,
	CapabilityOptionSpec,
} from "./types.js";

/**
 * Parse a token list (from the REPL's splitCommandLine) into the SAME
 * CapabilityInput that the commander adapter builds from the same descriptor.
 * This is the one arg-shape definition both surfaces read, so a slash form and
 * a CLI subcommand form of a verb can never drift on how they interpret flags.
 *
 * Supported per the descriptor schema:
 * - positionals in order; a trailing variadic arg collects the rest;
 * - `--flag` (boolean), `--opt value` / `--opt=value` (string), and repeatable
 *   `--opt a --opt b` (string[]);
 * - `--json` is always accepted and sets `input.json`.
 *
 * Throws on an unknown flag or a string option missing its value, mirroring how
 * commander rejects them, so a malformed slash fails loudly instead of running a
 * half-parsed capability.
 */
export function parseCapabilityArgv(
	descriptor: CapabilityDescriptor,
	argv: string[],
): CapabilityInput {
	const optionByFlag = new Map<string, CapabilityOptionSpec>();
	for (const option of descriptor.options ?? []) {
		optionByFlag.set(`--${option.name}`, option);
	}

	const options: Record<string, string | string[] | boolean> = {};
	for (const option of descriptor.options ?? []) {
		if (option.defaultValue !== undefined) {
			options[option.name] = option.defaultValue;
		} else if (option.kind === "boolean") {
			options[option.name] = false;
		} else if (option.kind === "string[]") {
			options[option.name] = [];
		}
	}
	let json = false;
	const positionals: string[] = [];

	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (token === undefined) continue;
		if (!token.startsWith("--")) {
			positionals.push(token);
			continue;
		}
		const eq = token.indexOf("=");
		const flag = eq === -1 ? token : token.slice(0, eq);
		const inlineValue = eq === -1 ? undefined : token.slice(eq + 1);

		if (flag === "--json") {
			json = true;
			continue;
		}
		const option = optionByFlag.get(flag);
		if (!option) {
			throw new Error(`Unknown option: ${flag}`);
		}
		if (option.kind === "boolean") {
			options[option.name] = true;
			continue;
		}
		const value = inlineValue ?? argv[++i];
		if (value === undefined) {
			throw new Error(`Option ${flag} requires a value`);
		}
		if (option.kind === "string[]") {
			const current = options[option.name];
			options[option.name] = [
				...(Array.isArray(current) ? current : []),
				value,
			];
		} else {
			options[option.name] = value;
		}
	}

	const args = bindPositionals(descriptor, positionals);
	return { args, options, json };
}

function bindPositionals(
	descriptor: CapabilityDescriptor,
	positionals: string[],
): Record<string, string | string[]> {
	const args: Record<string, string | string[]> = {};
	const specs = descriptor.args ?? [];
	let cursor = 0;
	for (const spec of specs) {
		if (spec.variadic) {
			args[spec.name] = positionals.slice(cursor);
			cursor = positionals.length;
			continue;
		}
		const value = positionals[cursor];
		if (value !== undefined) {
			args[spec.name] = value;
			cursor += 1;
		} else if (spec.required) {
			throw new Error(`Missing required argument: ${spec.name}`);
		}
	}
	return args;
}
