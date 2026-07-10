import chalk from "chalk";
import { Command } from "commander";

import { printJson } from "@refarm.dev/capabilities/envelope";
import {
	isCapabilityGroup,
	type CapabilityDescriptor,
	type CapabilityEntry,
	type CapabilityEnvelope,
	type CapabilityGroup,
	type CapabilityInput,
	type CapabilityOptionSpec,
} from "@refarm.dev/capabilities";

/**
 * The Commander CLI projector — the CLI half of the declare-once capability
 * projection, PARAMETERIZED so any app (refarm, or an external white-label app
 * that composes refarm's builtins with its own verbs) builds its CLI from a
 * registry it owns. It lives in `@refarm.dev/cli` (not `apps/refarm`) precisely so
 * the two-layer model works: a consuming app imports `capabilityCliCommands` and
 * mounts them on its own Commander program under its own binary name.
 *
 * Sibling of http-projector.ts (HTTP) + agent-projector.ts (agent tools). Each
 * reads the SAME descriptor; this one renders Commander commands + wires surface
 * hooks (text render + exit intent).
 */

/**
 * Render the standard red error line from an error envelope, for a hook's
 * renderText. The commander already derives process.exitCode from `ok === false`
 * (see toCommanderCommand / toCommanderGroup), so this NEVER touches exit
 * intent — it only formats the human line. `label` is the domain fallback
 * ("model error", "skill error") used when the envelope carries neither
 * `message` nor `error`. Call it after the case's own `if (ok === false)` guard
 * so the happy path keeps its narrowing.
 */
export function renderCapabilityError(envelope: CapabilityEnvelope, label: string): string {
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

/** A per-entry hooks resolver: given a capability's name (or a `"<group> <sub>"`
 * key), return its surface hooks. Apps back this with their own hooks map. */
export type CapabilityHooksResolver = (name: string) => CapabilitySurfaceHooks;

function collectRepeatable(value: string, previous: string[] = []): string[] {
	return [...previous, value];
}

/**
 * Register one capability option on a commander command — the ONE place that maps
 * a CapabilityOptionSpec to a commander flag, so the descriptor and group-child
 * projectors never drift. A `short` alias mints `-x, --name`; string[] collects
 * repeatably; a defaultValue seeds the flag.
 */
function applyOption(command: Command, option: CapabilityOptionSpec): void {
	const long = option.kind === "boolean" ? `--${option.name}` : `--${option.name} <value>`;
	const flag = option.short ? `-${option.short}, ${long}` : long;
	if (option.kind === "string[]") {
		command.option(flag, option.summary, collectRepeatable, []);
	} else if (option.defaultValue !== undefined) {
		command.option(flag, option.summary, option.defaultValue as string);
	} else {
		command.option(flag, option.summary);
	}
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
		applyOption(command, option);
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

		const code = hooks.exitCode ? hooks.exitCode(envelope) : envelope.ok === false ? 1 : 0;
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
			// Project the default child's OWN options onto the parent too, so the
			// bare `<group>` form accepts them (e.g. `health --next-action`), not only
			// the explicit `<group> <default> --flag` subcommand. Mirrors the
			// toCommanderCommand loop. A child option named `json` would collide with
			// the reserved `--json` below — that name is the projector's, not a
			// descriptor's to take.
			for (const option of child.options ?? []) {
				applyOption(command, option);
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
				const code = hooks.exitCode ? hooks.exitCode(envelope) : envelope.ok === false ? 1 : 0;
				if (code !== 0) process.exitCode = code;
				void cmd;
			});
		}
	}

	return command;
}

/** Project ONE registry entry into a Commander Command, binding a group's
 * per-sub hooks by the composite `"<group> <sub>"` key and a flat descriptor by
 * its own name. The `hooksFor` resolver is the app's — refarm backs it with its
 * builtin hooks map; an example backs it with its own. */
export function capabilityToCliCommand(
	entry: CapabilityEntry,
	hooksFor: CapabilityHooksResolver,
): Command {
	if (isCapabilityGroup(entry)) {
		return toCommanderGroup(entry, (subVerb) => hooksFor(`${entry.name} ${subVerb}`));
	}
	return toCommanderCommand(entry, hooksFor(entry.name));
}

/**
 * The TOP-LEVEL CLI commands for a set of registry entries — the CLI half of the
 * declare-once projection, PARAMETERIZED over the entries + a hooks resolver so an
 * app (refarm or an external white-label app) mounts them on its own program.
 *
 * Honors the two `transports.cli` hints: an entry without `cli.group` is a
 * top-level verb; an entry with `cli.group` mounts under that parent (via
 * {@link capabilityCliCommandsForGroup}) unless it also sets `cli.directAlias`,
 * which mints a top-level forwarder too.
 */
export function capabilityCliCommands(
	entries: readonly CapabilityEntry[],
	hooksFor: CapabilityHooksResolver,
): Command[] {
	return entries
		.filter(
			(entry) =>
				entry.transports?.cli?.group === undefined || entry.transports?.cli?.directAlias === true,
		)
		.map((entry) => capabilityToCliCommand(entry, hooksFor));
}

/** The CLI commands whose `transports.cli.group === groupName` — the verbs a
 * parent command self-populates from the registry. */
export function capabilityCliCommandsForGroup(
	entries: readonly CapabilityEntry[],
	groupName: string,
	hooksFor: CapabilityHooksResolver,
): Command[] {
	return entries
		.filter((entry) => entry.transports?.cli?.group === groupName)
		.map((entry) => capabilityToCliCommand(entry, hooksFor));
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
		const value = commanderOptions[option.name] ?? commanderOptions[camelCaseFlag(option.name)];
		if (value !== undefined) {
			options[option.name] = value as string | string[] | boolean;
		}
	}

	return { args, options, json: Boolean(commanderOptions.json) };
}

/** Mirror commander's flag→key transform: `include-secrets` → `includeSecrets`. */
function camelCaseFlag(name: string): string {
	return name.replace(/-([a-z])/g, (_all, letter: string) => letter.toUpperCase());
}
