export function quoteCommandArg(value: string): string {
	return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

export function quoteCommandArgIfNeeded(value: string): string {
	return /^[A-Za-z0-9._:@/\\-]+$/.test(value) ? value : quoteCommandArg(value);
}

export function joinCommand(parts: string[]): string {
	return parts.join(" ");
}

export function normalizeHandoffValues(values: string[]): string[] {
	return Array.from(
		new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
	);
}

export function shellCommand(command: string, args: string[] = []): string {
	return joinCommand([command, ...args.map(quoteCommandArg)]);
}

export interface ApplicationProcessSpec {
	command: string;
	args: string[];
	display: string;
}

export type CommandTemplateParameters = Record<string, string>;

export interface CommandTemplateSpec {
	id: string;
	command: string;
	process?: ApplicationProcessSpec;
	parameters: string[];
	cwdParameter?: string;
	useWhen: string;
}

export interface InstantiatedCommandTemplate {
	id: string;
	command: string;
	process?: ApplicationProcessSpec;
	cwd?: string;
}

export function commandTemplateParameters(value: string | string[]): string[] {
	const values = Array.isArray(value) ? value : [value];
	return normalizeHandoffValues(
		values.flatMap((entry) => [...entry.matchAll(/<([^<>]+)>/g)].map((match) => match[1]!)),
	);
}

export function substituteCommandTemplateValue(
	value: string,
	parameters: CommandTemplateParameters,
): string {
	return value.replace(/<([^<>]+)>/g, (_placeholder, parameter: string) => {
		const replacement = parameters[parameter];
		if (replacement === undefined) {
			throw new Error(`Missing command template parameter: ${parameter}`);
		}
		return replacement;
	});
}

export function substituteCommandTemplateValues(
	values: string[],
	parameters: CommandTemplateParameters,
): string[] {
	return values.map((value) => substituteCommandTemplateValue(value, parameters));
}

export function instantiateProcessTemplate(
	processSpec: ApplicationProcessSpec,
	parameters: CommandTemplateParameters,
): ApplicationProcessSpec {
	return {
		command: substituteCommandTemplateValue(processSpec.command, parameters),
		args: substituteCommandTemplateValues(processSpec.args, parameters),
		display: substituteCommandTemplateValue(processSpec.display, parameters),
	};
}

export function instantiateCommandTemplate(
	template: CommandTemplateSpec,
	parameters: CommandTemplateParameters,
): InstantiatedCommandTemplate {
	const declaredParameters = new Set(template.parameters);
	const usedParameters = commandTemplateParameters([
		template.command,
		template.process?.command ?? "",
		...(template.process?.args ?? []),
		template.process?.display ?? "",
		template.cwdParameter ? `<${template.cwdParameter}>` : "",
	]);
	for (const parameter of usedParameters) {
		if (!declaredParameters.has(parameter)) {
			throw new Error(`Undeclared command template parameter: ${parameter}`);
		}
	}
	for (const parameter of template.parameters) {
		if (parameters[parameter] === undefined) {
			throw new Error(`Missing command template parameter: ${parameter}`);
		}
	}
	return {
		id: template.id,
		command: substituteCommandTemplateValue(template.command, parameters),
		...(template.process
			? { process: instantiateProcessTemplate(template.process, parameters) }
			: {}),
		...(template.cwdParameter ? { cwd: parameters[template.cwdParameter]! } : {}),
	};
}

export function instantiateCommandTemplateById(
	templates: CommandTemplateSpec[],
	id: string,
	parameters: CommandTemplateParameters,
): InstantiatedCommandTemplate {
	const template = templates.find((entry) => entry.id === id);
	if (!template) {
		throw new Error(`Unknown command template: ${id}`);
	}
	return instantiateCommandTemplate(template, parameters);
}

export function binaryCommand(binary: string, args: string[]): string {
	return joinCommand([binary, ...args]);
}

function applicationCommandOverrideEnv(binary: string): string {
	return `${binary.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_COMMAND`;
}

// NOTE: `applicationCommand` is DELIBERATELY product-agnostic and does NOT honor
// the `<BINARY>_COMMAND` override — that env is a LAUNCHER PATH (e.g. a full
// `C:\tmp\refarm.cmd`), used only by `applicationProcess` to spawn the real
// executable. The public handoff STRING a user reads/copies must stay the stable
// canonical binary name (a launcher path leaking into a shareable command would be
// wrong). White-label of the binary name itself is a distribution concern (the
// rebrand protocol renames the source), not a runtime override here.
export function applicationCommand(binary: string, args: string[]): string {
	return binaryCommand(binary, args);
}

/** Absolute in the sense a shell means it: no PATH lookup will happen. POSIX `/…`, a
 *  Windows drive root `C:\…`, or a UNC share `\\host\share`. Kept local so this module
 *  stays import-free — `node:path` would answer for the HOST platform, and a handoff can
 *  be rendered for a target that is not it. */
export function isAbsoluteCommandPath(value: string): boolean {
	return /^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

/**
 * The execArgv flags that are part of HOW THE ENTRYPOINT LOADS, and therefore must survive
 * into a re-invocation of it. A launcher shim uses exactly these (`node --import <loader>
 * <entry>`); everything else in `execArgv` — `--inspect`, `--test`, profiler flags — belongs
 * to the session that happens to be running, never in a line the operator is told to type.
 */
const MODULE_HOOK_EXEC_ARGV =
	/^(--import|--loader|--experimental-loader|--require|-r|--conditions|-C)(=|$)/;

function moduleHookExecArgv(execArgv: readonly string[]): string[] {
	const kept: string[] = [];
	for (let index = 0; index < execArgv.length; index += 1) {
		const flag = execArgv[index]!;
		if (!MODULE_HOOK_EXEC_ARGV.test(flag)) continue;
		kept.push(flag);
		// The separated form (`--import <value>`) carries its value in the NEXT slot.
		if (!flag.includes("=") && index + 1 < execArgv.length) {
			const value = execArgv[index + 1]!;
			if (!value.startsWith("-")) {
				kept.push(value);
				index += 1;
			}
		}
	}
	return kept;
}

/** Where a privileged invocation is looked up from. Not the caller's `PATH`: `sudo` replaces
 *  it with `secure_path`, and every distribution that sets one omits per-user bin directories
 *  such as `~/.local/bin`. This is the Debian/Ubuntu default, kept as the MODEL a handoff is
 *  checked against — nothing here reads or trusts the local sudoers file. */
export const SUDO_SECURE_PATH_MODEL = [
	"/usr/local/sbin",
	"/usr/local/bin",
	"/usr/sbin",
	"/usr/bin",
	"/sbin",
	"/bin",
] as const;

export interface PrivilegedInvocationSource {
	/** The interpreter running this program. Absolute, always, when Node provides it. */
	execPath?: string;
	/** Node's own flags for this process — filtered to the module hooks the entrypoint needs. */
	execArgv?: readonly string[];
	/** The script Node was pointed at (`process.argv[1]`). `null` when there is none. */
	entrypoint?: string | null;
}

/**
 * A privileged invocation of THIS program, written so a ROOT shell can find it.
 *
 * WHY THIS IS NOT `sudo -E <binary> …`. `sudo` resets `PATH` to `secure_path`, and every
 * distribution that sets one omits `~/.local/bin` — where a per-user CLI install puts its
 * launcher. So a guidance line that says `sudo -E refarm cert trust` is unrunnable exactly
 * where it is needed: the operator gets `sudo: refarm: command not found`. That is not a
 * packaging bug to fix downstream, it is correct Unix behaviour, and the emitter is the
 * thing that has to know it.
 *
 * The answer is to name NOTHING that needs looking up: the interpreter and the entrypoint
 * are both taken from the running process, both already absolute, so `secure_path` never
 * enters into it. Derived, never hardcoded — a literal `/home/<someone>` would be right for
 * exactly one machine.
 *
 * Falls back to the bare binary only when the process cannot describe itself (no entrypoint,
 * or a relative one — an embedded host, not a CLI). Nothing better is available then, and
 * inventing a path would be worse than naming the binary.
 */
export function privilegedApplicationCommand(
	binary: string,
	args: string[],
	source: PrivilegedInvocationSource = {},
): string {
	const execPath = source.execPath ?? process.execPath;
	const entrypoint =
		source.entrypoint === undefined ? (process.argv[1] ?? null) : source.entrypoint;
	const execArgv = source.execArgv ?? process.execArgv;
	if (!entrypoint || !isAbsoluteCommandPath(execPath) || !isAbsoluteCommandPath(entrypoint)) {
		return joinCommand(["sudo", "-E", binary, ...args]);
	}
	return joinCommand([
		"sudo",
		"-E",
		quoteCommandArgIfNeeded(execPath),
		...moduleHookExecArgv(execArgv).map(quoteCommandArgIfNeeded),
		quoteCommandArgIfNeeded(entrypoint),
		...args,
	]);
}

export function applicationProcess(binary: string, args: string[]): ApplicationProcessSpec {
	const override = process.env[applicationCommandOverrideEnv(binary)]?.trim();
	const command = override || binary;
	return {
		command,
		args,
		display: binaryCommand(quoteCommandArgIfNeeded(command), args),
	};
}

// `refarmCommand` / `refarmProcess` moved to apps/refarm/src/brand.ts (ADR-087):
// only the app that owns the brand names it. This package stays agnostic, exposing
// the neutral `applicationCommand` / `applicationProcess` a white-label app builds
// its own brand helpers over.

export function workspaceCommand(cwd: string, command: string): string {
	return joinCommand(["cd", quoteCommandArg(cwd), "&&", command]);
}
