import {
	type CapabilityDescriptor,
	type CapabilityEnvelope,
	type CapabilityGroup,
	type CapabilityInput,
} from "@refarm.dev/cli/capabilities";
import { printJson } from "@refarm.dev/cli/json-output";
import chalk from "chalk";
import { Command } from "commander";

/**
 * Render the standard red error line from an error envelope, for a hook's
 * renderText. The commander already derives process.exitCode from `ok === false`
 * (see toCommanderCommand / toCommanderGroup), so this NEVER touches exit
 * intent — it only formats the human line. `label` is the domain fallback
 * ("model error", "skill error") used when the envelope carries neither
 * `message` nor `error`. Call it after the case's own `if (ok === false)` guard
 * so the happy path keeps its narrowing.
 */
export function renderCapabilityError(
	envelope: CapabilityEnvelope,
	label: string,
): string {
	const e = envelope as { message?: string; error?: string };
	return chalk.red(`✗  ${e.message ?? e.error ?? label}`);
}

/**
 * Optional per-descriptor hooks the commander adapter uses to render text and
 * decide an exit code. Exit intent lives HERE (a surface concern), never inside
 * run() — so a `/slash` or a direct call over the same envelope never mutates
 * the REPL's exit state.
 */
export interface CapabilitySurfaceHooks {
	/**
	 * Render a human line from the envelope for non-JSON CLI output. Receives the
	 * resolved {@link CapabilityInput} too, so a hook can branch on an input flag
	 * that shapes presentation but not the envelope (e.g. `model env --shell`).
	 */
	renderText?(envelope: CapabilityEnvelope, input?: CapabilityInput): string;
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
		// commander passes (arg1, arg2, ..., options, command). The last arg is the
		// invoked Command; positionals precede the options object. We read options
		// via optsWithGlobals() so a flag like `--json` resolves whether commander
		// bound it to this subcommand or to the parent group scope (as it does for
		// `model providers --json`, where `--json` lands on the `model` group).
		const command = actionArgs[actionArgs.length - 1] as Command;
		const options = command.optsWithGlobals();
		const positionals = actionArgs.slice(0, actionArgs.length - 2);

		const input = buildCapabilityInput(descriptor, positionals, options);
		const envelope = await descriptor.run(input);

		if (input.json) {
			printJson(envelope);
		} else if (hooks.renderText) {
			console.log(hooks.renderText(envelope, input));
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

/**
 * Build the commander Command for a verb-group: the parent command, each
 * sub-action mounted as a subcommand via {@link toCommanderCommand}, and the
 * group-default wired so a bare `<group>` (with or without args) runs the
 * default action. This is the CLI projector for a CapabilityGroup — the SAME
 * group declaration drives the REPL dispatcher and a future API/web projector.
 *
 * `hooksFor` supplies per-sub-action surface hooks (render/exit), so exit intent
 * stays a surface concern per child, never inside run().
 */
export function toCommanderGroup(
	group: CapabilityGroup,
	hooksFor: (subVerb: string) => CapabilitySurfaceHooks = () => ({}),
): Command {
	const command = new Command(group.name).description(group.summary);

	for (const [subVerb, child] of Object.entries(group.actions)) {
		command.addCommand(toCommanderCommand(child, hooksFor(subVerb)));
	}

	// Group-default: `<group>` with no sub-verb runs the default action. Its own
	// commander subcommand still handles the explicit `<group> <default>` form;
	// this only covers the bare invocation.
	if (group.defaultAction) {
		const child = group.actions[group.defaultAction];
		if (child) {
			for (const arg of child.args ?? []) {
				const token = arg.variadic
					? `${arg.required ? "<" : "["}${arg.name}...${arg.required ? ">" : "]"}`
					: `${arg.required ? "<" : "["}${arg.name}${arg.required ? ">" : "]"}`;
				command.argument(token);
			}
			command.option("--json", "Output machine-readable result");
			command.action(async (...actionArgs: unknown[]) => {
				const cmd = actionArgs[actionArgs.length - 1] as Command;
				const options = cmd.optsWithGlobals();
				const positionals = actionArgs.slice(0, actionArgs.length - 2);
				const input = buildCapabilityInput(child, positionals, options);
				const envelope = await child.run(input);
				const hooks = hooksFor(group.defaultAction!);
				if (input.json) {
					printJson(envelope);
				} else if (hooks.renderText) {
					console.log(hooks.renderText(envelope, input));
				} else {
					printJson(envelope);
				}
				const code = hooks.exitCode
					? hooks.exitCode(envelope)
					: envelope.ok === false
						? 1
						: 0;
				if (code !== 0) process.exitCode = code;
				void cmd;
			});
		}
	}

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
		// commander stores a hyphenated flag (`--include-secrets`) under its
		// camelCased key (`includeSecrets`), but the descriptor addresses it by the
		// raw name. Look up both so a multi-word option actually reaches run().
		const value =
			commanderOptions[option.name] ??
			commanderOptions[camelCaseFlag(option.name)];
		if (value !== undefined) {
			options[option.name] = value as string | string[] | boolean;
		}
	}

	return { args, options, json: Boolean(commanderOptions.json) };
}

/** Mirror commander's flag→key transform: `include-secrets` → `includeSecrets`. */
function camelCaseFlag(name: string): string {
	return name.replace(/-([a-z])/g, (_all, letter: string) =>
		letter.toUpperCase(),
	);
}
