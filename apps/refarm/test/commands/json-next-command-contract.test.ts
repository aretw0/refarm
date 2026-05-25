import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const COMMANDS_DIR = join(process.cwd(), "apps", "refarm", "src", "commands");

function commandSourceFiles(dir = COMMANDS_DIR): string[] {
	return readdirSync(dir)
		.flatMap((entry) => {
			const path = join(dir, entry);
			return statSync(path).isDirectory() ? commandSourceFiles(path) : [path];
		})
		.filter((path) => path.endsWith(".ts"));
}

function hasInteractiveSowCommand(value: string): boolean {
	return /\brefarm sow(?:\b| --(?:github|cloudflare|all)\b)/.test(value) &&
		!/\brefarm sow --model\b/.test(value);
}

function hasPlaceholderCommand(value: string): boolean {
	return /["'`][^"'`]*(?:nextCommand|nextCommands|actionCommand)?[^"'`]*<[^>"'`]+>[^"'`]*["'`]/.test(value);
}

function hasReplCommand(value: string): boolean {
	return /["'`]\/[A-Za-z][^"'`]*["'`]/.test(value);
}

function propertyBlocks(source: string, property: string): string[] {
	const blocks: string[] = [];
	const pattern = new RegExp(`${property}\\s*:`, "g");
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(source)) !== null) {
		const start = match.index;
		const arrayStart = source.indexOf("[", pattern.lastIndex);
		const lineEnd = source.indexOf("\n", pattern.lastIndex);
		if (arrayStart === -1 || (lineEnd !== -1 && lineEnd < arrayStart)) {
			blocks.push(source.slice(start, lineEnd === -1 ? source.length : lineEnd));
			continue;
		}
		let depth = 0;
		for (let index = arrayStart; index < source.length; index += 1) {
			const char = source[index];
			if (char === "[") depth += 1;
			if (char === "]") {
				depth -= 1;
				if (depth === 0) {
					blocks.push(source.slice(start, index + 1));
					break;
				}
			}
		}
	}
	return blocks;
}

describe("JSON next command contract", () => {
	it("keeps interactive credential collection out of executable handoffs", () => {
		const violations = commandSourceFiles().flatMap((file) => {
			const source = readFileSync(file, "utf8");
			return ["nextCommand", "nextCommands", "actionCommand"]
				.flatMap((property) => propertyBlocks(source, property)
					.filter(hasInteractiveSowCommand)
					.map((block) => `${relative(process.cwd(), file)} ${property}: ${block.trim()}`));
		});

		expect(violations).toEqual([]);
	});

	it("keeps placeholders out of executable handoffs", () => {
		const violations = commandSourceFiles().flatMap((file) => {
			const source = readFileSync(file, "utf8");
			return ["nextCommand", "nextCommands", "actionCommand"]
				.flatMap((property) => propertyBlocks(source, property)
					.filter(hasPlaceholderCommand)
					.map((block) => `${relative(process.cwd(), file)} ${property}: ${block.trim()}`));
		});

		expect(violations).toEqual([]);
	});

	it("keeps REPL-only commands out of executable handoffs", () => {
		const violations = commandSourceFiles().flatMap((file) => {
			const source = readFileSync(file, "utf8");
			return ["nextCommand", "nextCommands", "actionCommand"]
				.flatMap((property) => propertyBlocks(source, property)
					.filter(hasReplCommand)
					.map((block) => `${relative(process.cwd(), file)} ${property}: ${block.trim()}`));
		});

		expect(violations).toEqual([]);
	});
});
