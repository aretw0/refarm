import {
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityInput,
} from "@refarm.dev/cli/capabilities";
import { printJson } from "@refarm.dev/cli/json-output";
import { Command } from "commander";

/**
 * Optional per-descriptor hooks the commander adapter uses to render text and
 * decide an exit code. Exit intent lives HERE (a surface concern), never inside
 * run() — so a `/slash` or a direct call over the same envelope never mutates
 * the REPL's exit state.
 */
export interface CapabilitySurfaceHooks {
	/** Render a human line from the envelope for non-JSON CLI output. */
	renderText?(envelope: CapabilityEnvelope): string;
	/** Map an envelope to process.exitCode (default: 1 when ok === false). */
	exitCode?(envelope: CapabilityEnvelope): number;
}

function collectRepeatable(value: string, previous: string[] = []): string[] {
	return [...previous, value];
}

/**
 * Build the canonical commander Command for a capability. This is the ONE place
 * that reads commander's parsed values, packs them into CapabilityInput, awaits
 * run(), and prints — so the CLI surface is a thin, generated shell over the
 * descriptor. The same descriptor drives the REPL slash and any direct alias.
 */
export function toCommanderCommand(
	descriptor: CapabilityDescriptor,
	hooks: CapabilitySurfaceHooks = {},
): Command {
	const command = new Command(descriptor.name).description(descriptor.summary);

	for (const arg of descriptor.args ?? []) {
		const token = arg.variadic
			? `${arg.required ? "<" : "["}${arg.name}...${arg.required ? ">" : "]"}`
			: `${arg.required ? "<" : "["}${arg.name}${arg.required ? ">" : "]"}`;
		command.argument(token);
	}

	for (const option of descriptor.options ?? []) {
		const flag =
			option.kind === "boolean"
				? `--${option.name}`
				: `--${option.name} <value>`;
		if (option.kind === "string[]") {
			command.option(flag, option.summary, collectRepeatable, []);
		} else if (option.defaultValue !== undefined) {
			command.option(flag, option.summary, option.defaultValue as string);
		} else {
			command.option(flag, option.summary);
		}
	}
	command.option("--json", "Output machine-readable result");

	command.action(async (...actionArgs: unknown[]) => {
		// commander passes (arg1, arg2, ..., options, command). The options object
		// is second-to-last; positionals precede it in declared order.
		const command = actionArgs[actionArgs.length - 1] as Command;
		const options = actionArgs[actionArgs.length - 2] as Record<
			string,
			unknown
		>;
		const positionals = actionArgs.slice(0, actionArgs.length - 2);

		const input = buildCapabilityInput(descriptor, positionals, options);
		const envelope = await descriptor.run(input);

		if (input.json) {
			printJson(envelope);
		} else if (hooks.renderText) {
			console.log(hooks.renderText(envelope));
		} else {
			printJson(envelope);
		}

		const code = hooks.exitCode
			? hooks.exitCode(envelope)
			: envelope.ok === false
				? 1
				: 0;
		if (code !== 0) process.exitCode = code;
		void command;
	});

	return command;
}

function buildCapabilityInput(
	descriptor: CapabilityDescriptor,
	positionals: unknown[],
	commanderOptions: Record<string, unknown>,
): CapabilityInput {
	const args: Record<string, string | string[]> = {};
	(descriptor.args ?? []).forEach((arg, index) => {
		const value = positionals[index];
		if (value === undefined) return;
		args[arg.name] = value as string | string[];
	});

	const options: Record<string, string | string[] | boolean> = {};
	for (const option of descriptor.options ?? []) {
		const value = commanderOptions[option.name];
		if (value !== undefined) {
			options[option.name] = value as string | string[] | boolean;
		}
	}

	return { args, options, json: Boolean(commanderOptions.json) };
}
