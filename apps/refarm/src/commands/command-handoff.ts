export function quoteCommandArg(value: string): string {
	return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

export function joinCommand(parts: string[]): string {
	return parts.join(" ");
}

export function shellCommand(command: string, args: string[] = []): string {
	return joinCommand([command, ...args.map(quoteCommandArg)]);
}

export function refarmCommand(args: string[]): string {
	return joinCommand(["refarm", ...args]);
}

export function workspaceCommand(cwd: string, command: string): string {
	return joinCommand(["cd", quoteCommandArg(cwd), "&&", command]);
}
