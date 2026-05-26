import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAgentCommand } from "../../src/commands/agent.js";
import { createConfigCommand } from "../../src/commands/config.js";
import { deployCommand } from "../../src/commands/deploy.js";
import { extensionCommand } from "../../src/commands/extension.js";
import { migrateCommand } from "../../src/commands/migrate.js";
import { createModelCommand } from "../../src/commands/model.js";
import { createOpenUrlCommand } from "../../src/commands/open-url.js";
import { createPackageManagerCommand } from "../../src/commands/package-manager.js";
import { pluginCommand } from "../../src/commands/plugin.js";
import { provisionCommand } from "../../src/commands/provision.js";
import { createTreeCommand } from "../../src/commands/tree.js";
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

function generatedCommandEntries(payloads: Array<{
	nextCommand?: string | null;
	nextCommands?: string[];
	sampleId: string;
}>): Array<{ command: string; sampleId: string }> {
	return payloads.flatMap((payload) =>
		[payload.nextCommand, ...(payload.nextCommands ?? [])]
			.filter((command): command is string => typeof command === "string")
			.map((command) => ({ command, sampleId: payload.sampleId })),
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

function generatedActionEntries(payloads: Array<{
	nextAction?: string | null;
	nextActions?: string[];
	sampleId: string;
}>): Array<{ action: string; sampleId: string }> {
	return payloads.flatMap((payload) =>
		[payload.nextAction, ...(payload.nextActions ?? [])]
			.filter((action): action is string => typeof action === "string")
			.map((action) => ({ action, sampleId: payload.sampleId })),
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

function createTempConfigCommand() {
	const cwd = mkdtempSync(join(tmpdir(), "refarm-config-contract-cwd-"));
	const home = mkdtempSync(join(tmpdir(), "refarm-config-contract-home-"));
	return {
		cleanup: () => {
			rmSync(cwd, { recursive: true, force: true });
			rmSync(home, { recursive: true, force: true });
		},
		command: createConfigCommand({
			cwd: () => cwd,
			home: () => home,
		}),
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

interface JsonCommandSample {
	args: string[];
	command: { parseAsync: (args: string[], options: { from: "user" }) => Promise<unknown> };
	id: string;
}

async function parseCommandJson(sample: JsonCommandSample): Promise<ParsedCommandJson & { sampleId: string }> {
	const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	const originalExitCode = process.exitCode;
	try {
		await sample.command.parseAsync(sample.args, { from: "user" });
		return {
			...(JSON.parse(String(logSpy.mock.calls[0]?.[0])) as ParsedCommandJson),
			sampleId: sample.id,
		};
	} finally {
		process.exitCode = originalExitCode;
		logSpy.mockRestore();
	}
}

async function parseCommandJsonSamples(samples: JsonCommandSample[]): Promise<Array<ParsedCommandJson & { sampleId: string }>> {
	const payloads: Array<ParsedCommandJson & { sampleId: string }> = [];
	for (const sample of samples) {
		payloads.push(await parseCommandJson(sample));
	}
	return payloads;
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
		const config = createTempConfigCommand();
		try {
			const payloads = await parseCommandJsonSamples([
				{ id: "agent-handoff", command: createAgentCommand(), args: ["--json"] },
				{ id: "agent-finish-plan", command: createAgentCommand(), args: ["finish", "--json"] },
				{ id: "agent-finish-templates", command: createAgentCommand(), args: ["finish", "--templates", "--json"] },
				{ id: "agent-finish-lanes", command: createAgentCommand(), args: ["finish", "--lanes", "--json"] },
				{ id: "agent-finish-after-edit", command: createAgentCommand(), args: ["finish", "--lane", "after-edit", "--json"] },
				{ id: "agent-finish-handoffs", command: createAgentCommand(), args: ["finish", "--lane", "handoffs", "--json"] },
				{ id: "agent-finish-with-package-tests", command: createAgentCommand(), args: ["finish", "--lane", "with-package-tests", "--json"] },
				{
					id: "config-set-local",
					command: config.command,
					args: ["set", "operator.openExternalLinks", "never", "--local", "--json"],
				},
				{
					id: "deploy-invalid-target",
					command: deployCommand,
					args: ["--target", "workers", "--dry-run", "--json"],
				},
				{ id: "extension-publish", command: extensionCommand, args: ["publish", "my-tool", "--json"] },
				{ id: "migrate-missing-target", command: migrateCommand, args: ["--dry-run", "--json"] },
				{
					id: "open-url-dry-run",
					command: createOpenUrlCommand({ open: vi.fn() }),
					args: ["https://example.test/auth?code=a&state=b", "--dry-run", "--json"],
				},
				{
					id: "package-manager",
					command: createPackageManagerCommand({
						cwd: () => ".",
						env: { REFARM_PACKAGE_MANAGER: "npm" },
					}),
					args: ["--json"],
				},
				{
					id: "model-current",
					command: createModelCommand({
						loadTokens: async () => ({}),
						saveTokens: vi.fn(),
					}),
					args: ["current", "--json"],
				},
				{
					id: "model-providers",
					command: createModelCommand({
						loadTokens: async () => ({}),
						saveTokens: vi.fn(),
					}),
					args: ["providers", "--json"],
				},
				{ id: "plugin-list", command: pluginCommand, args: ["list", "--json"] },
				{ id: "provision-list", command: provisionCommand, args: ["list", "--json"] },
				{ id: "provision-cloudflare", command: provisionCommand, args: ["cloudflare", "--dry-run", "--json"] },
				{
					id: "provision-cloudflare-turbo-cache",
					command: provisionCommand,
					args: ["cloudflare", "turbo-cache", "--dry-run", "--json"],
				},
				{
					id: "tree-invalid-list-scope",
					command: createTreeCommand(),
					args: ["list", "--scope", "crdt", "--json"],
				},
				{
					id: "tree-invalid-list-limit",
					command: createTreeCommand(),
					args: ["list", "--scope", "all", "--limit", "0", "--json"],
				},
				{
					id: "tree-invalid-operation-scope",
					command: createTreeCommand(),
					args: ["show", "abc123", "--scope", "all", "--json"],
				},
				{
					id: "tui-launch-dry-run",
					command: createTuiCommand({
						resolveStatusPayload: async () => ({ json: makeReadyStatus("tui") }),
						printStatusSummary: vi.fn(),
						launch: vi.fn(),
					}),
					args: ["--launch", "--dry-run", "--json"],
				},
				{
					id: "web-launch-dry-run",
					command: createWebCommand({
						resolveStatusPayload: async () => ({ json: makeReadyStatus("web") }),
						printStatusSummary: vi.fn(),
						launch: vi.fn(),
						open: vi.fn(),
					}),
					args: ["--launch", "--dry-run", "--json"],
				},
			]);

			const commandEntries = generatedCommandEntries(payloads);
			const actionEntries = generatedActionEntries(payloads);
			const placeholders = commandEntries
				.filter(({ command }) => /<[^>]+>/.test(command))
				.map(({ command, sampleId }) => `${sampleId}: ${command}`);
			const actionPlaceholders = actionEntries
				.filter(({ action }) => /<[^>]+>/.test(action))
				.map(({ action, sampleId }) => `${sampleId}: ${action}`);
			const interactiveSow = commandEntries
				.filter(({ command }) => hasInteractiveSowCommand(command))
				.map(({ command, sampleId }) => `${sampleId}: ${command}`);
			const replOnly = commandEntries
				.filter(({ command }) => /^\/[A-Za-z]/.test(command))
				.map(({ command, sampleId }) => `${sampleId}: ${command}`);
			const missingNextActions = payloads
				.filter((payload) => !Array.isArray(payload.nextActions))
				.map((payload) => payload.sampleId);
			const missingNextCommands = payloads
				.filter((payload) => !Array.isArray(payload.nextCommands))
				.map((payload) => payload.sampleId);

			expect(placeholders).toEqual([]);
			expect(actionPlaceholders).toEqual([]);
			expect(interactiveSow).toEqual([]);
			expect(replOnly).toEqual([]);
			expect(missingNextActions).toEqual([]);
			expect(missingNextCommands).toEqual([]);
		} finally {
			config.cleanup();
		}
	});

	it("keeps parameterized generated commands in templates", async () => {
		const payloads = [
			await parseCommandJson({
				id: "agent-handoff",
				command: createAgentCommand(),
				args: ["--json"],
			}),
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
