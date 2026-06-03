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
		new Set(
			values
				.map((value) => value.trim())
				.filter((value) => value.length > 0),
		),
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

export function commandTemplateParameters(value: string | string[]): string[] {
	const values = Array.isArray(value) ? value : [value];
	return normalizeHandoffValues(
		values.flatMap((entry) =>
			[...entry.matchAll(/<([^<>]+)>/g)].map((match) => match[1]!),
		),
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

export function binaryCommand(binary: string, args: string[]): string {
	return joinCommand([binary, ...args]);
}

function applicationCommandOverrideEnv(binary: string): string {
	return `${binary.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_COMMAND`;
}

export function applicationCommand(binary: string, args: string[]): string {
	const override = process.env[applicationCommandOverrideEnv(binary)]?.trim();
	const command = override ? quoteCommandArgIfNeeded(override) : binary;
	return binaryCommand(command, args);
}

export function applicationProcess(
	binary: string,
	args: string[],
): ApplicationProcessSpec {
	const override = process.env[applicationCommandOverrideEnv(binary)]?.trim();
	const command = override || binary;
	return {
		command,
		args,
		display: applicationCommand(binary, args),
	};
}

export function workspaceCommand(cwd: string, command: string): string {
	return joinCommand(["cd", quoteCommandArg(cwd), "&&", command]);
}
