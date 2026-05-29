import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_SRC_DIR = path.resolve(__dirname, "../../src");
const APP_COMMANDS_DIR = path.join(APP_SRC_DIR, "commands");
const PROCESS_MODULE_PATTERNS = [
	/from\s+["']node:child_process["']/,
	/from\s+["']child_process["']/,
	/require\(["']node:child_process["']\)/,
	/require\(["']child_process["']\)/,
] as const;
const LEGACY_REFARM_ACTION_ALIAS_PATTERNS = [
	/\bRefarmAction[A-Za-z0-9_]*/,
	/\bcreateRefarmAction[A-Za-z0-9_]*/,
	/\bformatRefarmAction[A-Za-z0-9_]*/,
	/\bresolveRefarmAction[A-Za-z0-9_]*/,
	/\bgetRefarmStatusAvailableActions\b/,
] as const;
const HARDCODED_PACKAGE_MANAGER_EXECUTION_PATTERNS = [
	/\bcommand:\s*["']pnpm["']/,
	/\bcommand:\s*["']npm["']/,
	/\bcommand:\s*["']yarn["']/,
	/\bcommand:\s*["']bun["']/,
	/\bspawn(?:Sync)?\(\s*["'](?:pnpm|npm|yarn|bun)["']/,
	/\bexecFile(?:Sync)?\(\s*["'](?:pnpm|npm|yarn|bun)["']/,
] as const;
const HARDCODED_REFARM_CONTRACT_FIELD_PATTERNS = [
	/\bcommand:\s*["']refarm\s/,
	/\bactionCommand:\s*["']refarm\s/,
	/\bnextAction:\s*["']refarm\s/,
	/\bnextCommand:\s*["']refarm\s/,
] as const;

function sourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir)) {
		const filePath = path.join(dir, entry);
		const stat = statSync(filePath);
		if (stat.isDirectory()) {
			files.push(...sourceFiles(filePath));
			continue;
		}
		if (/\.[cm]?[jt]s$/.test(entry)) files.push(filePath);
	}
	return files;
}

function runtimeSourceFiles(dir: string): string[] {
	return sourceFiles(dir).filter((filePath) => !/\.test\.[cm]?[jt]s$/.test(filePath));
}

describe("process execution boundary", () => {
	it("keeps child process adapters out of the refarm app source", () => {
		const offenders = sourceFiles(APP_SRC_DIR).filter((filePath) => {
			const source = readFileSync(filePath, "utf-8");
			return PROCESS_MODULE_PATTERNS.some((pattern) => pattern.test(source));
		});

		expect(offenders.map((filePath) => path.relative(APP_SRC_DIR, filePath))).toEqual([]);
	});

	it("uses agnostic surface action helper names in app commands", () => {
		const offenders = sourceFiles(APP_COMMANDS_DIR).filter((filePath) => {
			const source = readFileSync(filePath, "utf-8");
			return LEGACY_REFARM_ACTION_ALIAS_PATTERNS.some((pattern) =>
				pattern.test(source),
			);
		});

		expect(offenders.map((filePath) => path.relative(APP_COMMANDS_DIR, filePath))).toEqual([]);
	});

	it("routes package manager execution through resolver helpers", () => {
		const offenders = sourceFiles(APP_SRC_DIR).filter((filePath) => {
			const source = readFileSync(filePath, "utf-8");
			return HARDCODED_PACKAGE_MANAGER_EXECUTION_PATTERNS.some((pattern) =>
				pattern.test(source),
			);
		});

		expect(offenders.map((filePath) => path.relative(APP_SRC_DIR, filePath))).toEqual([]);
	});

	it("builds refarm command contract fields through handoff helpers", () => {
		const offenders = runtimeSourceFiles(APP_COMMANDS_DIR).filter((filePath) => {
			const source = readFileSync(filePath, "utf-8");
			return HARDCODED_REFARM_CONTRACT_FIELD_PATTERNS.some((pattern) =>
				pattern.test(source),
			);
		});

		expect(offenders.map((filePath) => path.relative(APP_COMMANDS_DIR, filePath))).toEqual([]);
	});
});
