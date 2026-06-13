export function splitCommandLine(commandLine: string, label = "command line"): string[] {
	const words: string[] = [];
	let current = "";
	let quote: "'" | "\"" | null = null;
	let escaping = false;

	for (const char of commandLine.trim()) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}

		if (char === "\\") {
			escaping = true;
			continue;
		}

		if (quote) {
			if (char === quote) {
				quote = null;
			} else {
				current += char;
			}
			continue;
		}

		if (char === "'" || char === "\"") {
			quote = char;
			continue;
		}

		if (/\s/.test(char)) {
			if (current) {
				words.push(current);
				current = "";
			}
			continue;
		}

		current += char;
	}

	if (escaping) current += "\\";
	if (quote) throw new Error(`Unterminated quote in ${label}.`);
	if (current) words.push(current);
	return words;
}
