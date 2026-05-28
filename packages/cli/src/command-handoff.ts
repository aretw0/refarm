export function quoteCommandArg(value: string): string {
	return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

export function quoteCommandArgIfNeeded(value: string): string {
	return /^[A-Za-z0-9._:@/-]+$/.test(value) ? value : quoteCommandArg(value);
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

export function binaryCommand(binary: string, args: string[]): string {
	return joinCommand([binary, ...args]);
}

export function applicationCommand(binary: string, args: string[]): string {
	return binaryCommand(binary, args);
}

export function workspaceCommand(cwd: string, command: string): string {
	return joinCommand(["cd", quoteCommandArg(cwd), "&&", command]);
}
