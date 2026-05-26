import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAgentCommand } from "../../src/commands/agent.js";
import { deployCommand } from "../../src/commands/deploy.js";
import { extensionCommand } from "../../src/commands/extension.js";
import { migrateCommand } from "../../src/commands/migrate.js";
import { createModelCommand } from "../../src/commands/model.js";
import { createPackageManagerCommand } from "../../src/commands/package-manager.js";
import { pluginCommand } from "../../src/commands/plugin.js";
import { provisionCommand } from "../../src/commands/provision.js";
import { createTuiCommand } from "../../src/commands/tui.js";
import { createWebCommand } from "../../src/commands/web.js";

const COMMANDS_DIR = statSync(join(process.cwd(), "src", "commands"), { throwIfNoEntry: false })
	? join(process.cwd(), "src", "commands")
	: join(process.cwd(), "apps", "refarm", "src", "commands");

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
		!/\brefarm sow\b[^"'`]*--json\b/.test(value) &&
		!/\brefarm sow --model\b/.test(value);
}

function hasPlaceholderCommand(value: string): boolean {
	return /["'`][^"'`]*(?:nextCommand|nextCommands|actionCommand)?[^"'`]*<[^>"'`]+>[^"'`]*["'`]/.test(value);
}

function hasCommandLikePlaceholderAction(value: string): boolean {
	return /["'`]\s*(?:refarm|git|gh|pnpm|npm|yarn|bun|cargo|node)\b[^"'`]*<[^>"'`]+>[^"'`]*["'`]/.test(value);
}

function hasReplCommand(value: string): boolean {
	return /["'`]\/[A-Za-z][^"'`]*["'`]/.test(value);
}

function generatedExecutableCommands(payloads: {
	nextCommand?: string | null;
	nextCommands?: string[];
}[]): string[] {
	return payloads.flatMap((payload) =>
		[payload.nextCommand, ...(payload.nextCommands ?? [])]
			.filter((command): command is string => typeof command === "string"),
	);
}

function generatedActions(payloads: {
	nextAction?: string | null;
	nextActions?: string[];
}[]): string[] {
	return payloads.flatMap((payload) =>
		[payload.nextAction, ...(payload.nextActions ?? [])]
			.filter((action): action is string => typeof action === "string"),
	);
}

function generatedTemplates(payloads: {
	verification?: {
		templates?: {
			command?: string;
			parameters?: string[];
		}[];
	};
}[]): { command: string; parameters: string[] }[] {
	return payloads.flatMap((payload) =>
		payload.verification?.templates
			?.filter((template) => typeof template.command === "string")
			.map((template) => ({
				command: template.command!,
				parameters: template.parameters ?? [],
			})) ?? [],
	);
}

function makeReadyStatus(renderer: "tui" | "web") {
	return {
		schemaVersion: 1 as const,
		host: {
			app: "apps/refarm",
			command: "refarm",
			profile: "dev",
			mode: renderer,
		},
		renderer: {
			id: `refarm-${renderer}`,
			kind: renderer,
			capabilities: [],
		},
		runtime: {
			ready: true,
			namespace: "refarm-main",
			databaseName: "refarm-main",
		},
		plugins: {
			installed: 0,
			active: 0,
			rejectedSurfaces: 0,
			surfaceActions: 0,
		},
		trust: {
			profile: "dev",
			warnings: 0,
			critical: 0,
		},
		streams: { active: 0, terminal: 0 },
		diagnostics: [],
	};
}

interface ParsedCommandJson {
	nextAction?: string | null;
	nextActions?: string[];
	nextCommand?: string | null;
	nextCommands?: string[];
	verification?: {
		templates?: {
			command?: string;
			parameters?: string[];
		}[];
	};
}

async function parseCommandJson(command: { parseAsync: (args: string[], options: { from: "user" }) => Promise<unknown> }, args: string[]): Promise<ParsedCommandJson> {
	const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	const originalExitCode = process.exitCode;
	try {
		await command.parseAsync(args, { from: "user" });
		return JSON.parse(String(logSpy.mock.calls[0]?.[0])) as ParsedCommandJson;
	} finally {
		process.exitCode = originalExitCode;
		logSpy.mockRestore();
	}
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

	it("keeps command-like placeholders out of static action handoffs", () => {
		const violations = commandSourceFiles().flatMap((file) => {
			const source = readFileSync(file, "utf8");
			return ["nextAction", "nextActions"]
				.flatMap((property) => propertyBlocks(source, property)
					.filter(hasCommandLikePlaceholderAction)
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

	it("keeps generated public nextCommands executable", async () => {
		const payloads = [
			await parseCommandJson(createAgentCommand(), ["--json"]),
			await parseCommandJson(createAgentCommand(), ["finish", "--json"]),
			await parseCommandJson(createAgentCommand(), ["finish", "--templates", "--json"]),
			await parseCommandJson(createAgentCommand(), ["finish", "--lanes", "--json"]),
			await parseCommandJson(createAgentCommand(), ["finish", "--lane", "after-edit", "--json"]),
			await parseCommandJson(createAgentCommand(), ["finish", "--lane", "handoffs", "--json"]),
			await parseCommandJson(createAgentCommand(), ["finish", "--lane", "with-package-tests", "--json"]),
			await parseCommandJson(deployCommand, ["--target", "workers", "--dry-run", "--json"]),
			await parseCommandJson(extensionCommand, ["publish", "my-tool", "--json"]),
			await parseCommandJson(migrateCommand, ["--dry-run", "--json"]),
			await parseCommandJson(createPackageManagerCommand({
				cwd: () => ".",
				env: { REFARM_PACKAGE_MANAGER: "npm" },
			}), ["--json"]),
			await parseCommandJson(createModelCommand({
				loadTokens: async () => ({}),
				saveTokens: vi.fn(),
			}), ["current", "--json"]),
			await parseCommandJson(createModelCommand({
				loadTokens: async () => ({}),
				saveTokens: vi.fn(),
			}), ["providers", "--json"]),
			await parseCommandJson(pluginCommand, ["list", "--json"]),
			await parseCommandJson(provisionCommand, ["list", "--json"]),
			await parseCommandJson(provisionCommand, ["cloudflare", "--dry-run", "--json"]),
			await parseCommandJson(provisionCommand, ["cloudflare", "turbo-cache", "--dry-run", "--json"]),
			await parseCommandJson(createTuiCommand({
				resolveStatusPayload: async () => ({ json: makeReadyStatus("tui") }),
				printStatusSummary: vi.fn(),
				launch: vi.fn(),
			}), ["--launch", "--dry-run", "--json"]),
			await parseCommandJson(createWebCommand({
				resolveStatusPayload: async () => ({ json: makeReadyStatus("web") }),
				printStatusSummary: vi.fn(),
				launch: vi.fn(),
				open: vi.fn(),
			}), ["--launch", "--dry-run", "--json"]),
		];

		const commands = generatedExecutableCommands(payloads);
		const actions = generatedActions(payloads);
		const placeholders = commands.filter((command) => /<[^>]+>/.test(command));
		const actionPlaceholders = actions.filter((action) => /<[^>]+>/.test(action));
		const interactiveSow = commands.filter(hasInteractiveSowCommand);
		const replOnly = commands.filter((command) => /^\/[A-Za-z]/.test(command));

		expect(placeholders).toEqual([]);
		expect(actionPlaceholders).toEqual([]);
		expect(interactiveSow).toEqual([]);
		expect(replOnly).toEqual([]);
	});

	it("keeps parameterized generated commands in templates", async () => {
		const payloads = [
			await parseCommandJson(createAgentCommand(), ["--json"]),
		];
		const commands = generatedExecutableCommands(payloads);
		const actions = payloads.flatMap((payload) => payload.nextActions ?? []);
		const templates = generatedTemplates(payloads);
		const templateCommands = templates.map((template) => template.command);

		expect(templateCommands).toContain(
			"refarm agent finish --profile package --workspace <dir> --next-command",
		);
		expect(templateCommands).toContain(
			"refarm agent finish --profile affected --since <ref> --run --json",
		);
		expect(commands).not.toContain(
			"refarm agent finish --profile package --workspace <dir> --next-command",
		);
		expect(commands).not.toContain(
			"refarm agent finish --profile affected --since <ref> --run --json",
		);
		expect(actions).not.toContain(
			"refarm agent finish --profile package --workspace <dir> --next-command",
		);
		expect(actions).not.toContain(
			"refarm agent finish --profile affected --since <ref> --run --json",
		);
		expect(actions.filter((action) => /<[^>]+>/.test(action))).toEqual([]);
		expect(templates).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					command: "refarm agent finish --profile package --workspace <dir> --next-command",
					parameters: ["dir"],
				}),
				expect.objectContaining({
					command: "refarm agent finish --profile affected --since <ref> --run --json",
					parameters: ["ref"],
				}),
			]),
		);
	});
});
