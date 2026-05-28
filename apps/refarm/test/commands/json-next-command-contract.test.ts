import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createActionsCommand } from "../../src/commands/actions.js";
import { createAgentCommand } from "../../src/commands/agent.js";
import { createCheckCommand } from "../../src/commands/check.js";
import { createConfigCommand } from "../../src/commands/config.js";
import { deployCommand } from "../../src/commands/deploy.js";
import { doctorCommand } from "../../src/commands/doctor.js";
import { extensionCommand } from "../../src/commands/extension.js";
import { createGuideCommand } from "../../src/commands/guide.js";
import { headlessCommand } from "../../src/commands/headless.js";
import { healthCommand } from "../../src/commands/health.js";
import { createInitCommand } from "../../src/commands/init.js";
import { migrateCommand } from "../../src/commands/migrate.js";
import { createModelCommand } from "../../src/commands/model.js";
import { createOpenUrlCommand } from "../../src/commands/open-url.js";
import { createPackageManagerCommand } from "../../src/commands/package-manager.js";
import { pluginCommand } from "../../src/commands/plugin.js";
import { provisionCommand } from "../../src/commands/provision.js";
import { createResumeCommand } from "../../src/commands/resume.js";
import { createRuntimeCommand } from "../../src/commands/runtime.js";
import { createSessionsCommand } from "../../src/commands/sessions.js";
import { createSowCommand } from "../../src/commands/sow.js";
import { createTaskCommand } from "../../src/commands/task.js";
import { createTasksCommand } from "../../src/commands/tasks.js";
import { createTelemetryCommand } from "../../src/commands/telemetry.js";
import { createTidyCommand } from "../../src/commands/tidy.js";
import { createTreeCommand } from "../../src/commands/tree.js";
import { createTuiCommand } from "../../src/commands/tui.js";
import { createWebCommand } from "../../src/commands/web.js";
import { HISTORY } from "./tree.fixtures.js";

const COMMANDS_DIR = statSync(join(process.cwd(), "src", "commands"), { throwIfNoEntry: false })
	? join(process.cwd(), "src", "commands")
	: join(process.cwd(), "apps", "refarm", "src", "commands");

const PACKAGE_CLI_SRC_DIR = [
	join(process.cwd(), "../../packages/cli/src"),
	join(process.cwd(), "packages", "cli", "src"),
].find((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory());

const STATUS_WITH_ACTIONS_FIXTURE = [
	join(process.cwd(), "test", "fixtures", "status-with-actions.json"),
	join(process.cwd(), "apps", "refarm", "test", "fixtures", "status-with-actions.json"),
].find((file) => statSync(file, { throwIfNoEntry: false })?.isFile());

function commandSourceFiles(dir = COMMANDS_DIR): string[] {
	return readdirSync(dir)
		.flatMap((entry) => {
			const path = join(dir, entry);
			return statSync(path).isDirectory() ? commandSourceFiles(path) : [path];
		})
		.filter((path) => path.endsWith(".ts"));
}

function optionalSourceFiles(dir: string | undefined): string[] {
	return dir ? commandSourceFiles(dir) : [];
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

function hasHardcodedPackageManagerCommand(value: string): boolean {
	return /["'`]\s*(?:pnpm|npm|yarn|bun)\b/.test(value);
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

function generatedHandoffEntries(payloads: Array<{
	handoffs?: Record<string, unknown>;
	sampleId: string;
}>): Array<{ handoff: string; key: string; sampleId: string }> {
	return payloads.flatMap((payload) =>
		Object.entries(payload.handoffs ?? {})
			.filter((entry): entry is [string, string] => typeof entry[1] === "string")
			.map(([key, handoff]) => ({ handoff, key, sampleId: payload.sampleId })),
	);
}

function generatedTemplates(payloads: unknown[]): { command: string; parameters: string[] }[] {
	return payloads.flatMap((payload) => collectGeneratedTemplates(payload));
}

function collectGeneratedTemplates(value: unknown): { command: string; parameters: string[] }[] {
	if (!value || typeof value !== "object") return [];
	if (Array.isArray(value)) return value.flatMap(collectGeneratedTemplates);
	return Object.entries(value).flatMap(([key, entry]) => {
		const nested = collectGeneratedTemplates(entry);
		if (key !== "templates" || !Array.isArray(entry)) return nested;
		return [
			...entry
				.filter((template): template is { command: string; parameters?: string[] } =>
					Boolean(template) &&
					typeof template === "object" &&
					typeof (template as { command?: unknown }).command === "string",
				)
				.map((template) => ({
					command: template.command,
					parameters: template.parameters ?? [],
				})),
			...nested,
		];
	});
}

function commandTemplateParameters(command: string): string[] {
	return [...command.matchAll(/<([^>]+)>/g)].map((match) => match[1]!);
}

function generatedCommandFieldPlaceholderLeaks(
	value: unknown,
	options: { inTemplates?: boolean; path?: string[] } = {},
): string[] {
	const path = options.path ?? [];
	if (typeof value === "string") {
		const key = path.at(-1) ?? "";
		if (!options.inTemplates && /command/i.test(key) && /<[^>]+>/.test(value)) {
			return [`${path.join(".")}: ${value}`];
		}
		return [];
	}
	if (!value || typeof value !== "object") return [];
	if (Array.isArray(value)) {
		return value.flatMap((entry, index) =>
			generatedCommandFieldPlaceholderLeaks(entry, {
				inTemplates: options.inTemplates,
				path: [...path, String(index)],
			}),
		);
	}
	return Object.entries(value).flatMap(([key, entry]) =>
		generatedCommandFieldPlaceholderLeaks(entry, {
			inTemplates: options.inTemplates || key === "templates",
			path: [...path, key],
		}),
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

function makeStatusWithActions() {
	return {
		...makeReadyStatus("tui"),
		plugins: {
			installed: 1,
			active: 1,
			rejectedSurfaces: 0,
			surfaceActions: 1,
			availableActions: [
				{
					id: "inspect-trust",
					label: "Inspect trust",
					intent: "trust:inspect",
				},
			],
		},
	};
}

function createContractActionsCommand() {
	return createActionsCommand({
		resolveStatusPayload: vi.fn().mockResolvedValue({
			json: makeStatusWithActions(),
		}),
	});
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

function createTempStatusFile(diagnostics: string[]) {
	const dir = mkdtempSync(join(tmpdir(), "refarm-status-contract-"));
	const path = join(dir, "status.json");
	const status = {
		...makeReadyStatus("tui"),
		runtime: {
			ready: !diagnostics.includes("runtime:not-ready"),
			namespace: "refarm-main",
			databaseName: "refarm-main",
		},
		diagnostics,
	};
	writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`);
	return {
		path,
		cleanup: () => rmSync(dir, { recursive: true, force: true }),
	};
}

function createContractGuideCommand() {
	return createGuideCommand({
		env: () => ({}),
		loadConfig: () => ({ brand: { name: "contract farm" } }),
		createSilo: () => ({
			provision: vi.fn().mockResolvedValue({
				REFARM_GITHUB_TOKEN: "ghp_contract",
			}),
			loadTokens: vi.fn().mockResolvedValue({
				modelProvider: "openai",
				modelApiKey: "sk-contract",
			}),
		}),
		writeFile: vi.fn(),
	});
}

function createContractInitCommand() {
	const cwd = mkdtempSync(join(tmpdir(), "refarm-init-contract-"));
	return {
		cleanup: () => rmSync(cwd, { recursive: true, force: true }),
		command: createInitCommand({
			cwd: () => cwd,
			createOperator: () => ({
				ask: vi.fn().mockResolvedValue("workspace"),
			}),
			createSilo: () => ({
				bootstrapIdentity: vi.fn().mockResolvedValue({
					publicKey: "pk_contract",
					timestamp: "2026-05-01T00:00:00.000Z",
				}),
			}),
			createSower: () => ({
				scaffold: vi.fn().mockResolvedValue({ config: { type: "app" } }),
			}),
		}),
	};
}

function makeContractFetch() {
	return vi.fn().mockImplementation(async (url: string | URL) => {
		const value = String(url);
		if (value.includes("/tasks/")) {
			return {
				ok: true,
				status: 200,
				json: async () => ({
					task: {
						"@id": "urn:refarm:task:v1:abc123def456",
						"@type": "Task",
						title: "contract task",
						status: "active",
					},
					events: [
						{
							"@id": "urn:refarm:task-event:v1:event123",
							task_id: "urn:refarm:task:v1:abc123def456",
							event: "status_changed",
						},
					],
				}),
			};
		}
		if (value.includes("/tasks")) {
			return {
				ok: true,
				status: 200,
				json: async () => ({
					tasks: [
						{
							"@id": "urn:refarm:task:v1:abc123def456",
							"@type": "Task",
							title: "contract task",
							status: "active",
							created_at_ns: 1_700_000_000_000_000_000,
						},
					],
				}),
			};
		}
		if (value.includes("/plugins")) {
			return {
				ok: true,
				status: 200,
				json: async () => ({
					installed: ["@refarm/pi-agent"],
					loaded: ["@refarm/pi-agent"],
					local: [],
					known: ["@refarm/pi-agent"],
				}),
			};
		}
		return {
			ok: true,
			status: 200,
			json: async () => HISTORY,
		};
	});
}

function createContractTaskCommand() {
	const effort = {
		effortId: "effort-abc",
		status: "in-progress",
		submittedAt: "2026-05-01T00:00:00.000Z",
		results: [],
	};
	const adapter = {
		submit: vi.fn().mockResolvedValue("effort-abc"),
		query: vi.fn().mockResolvedValue(effort),
		list: vi.fn().mockResolvedValue([effort]),
		logs: vi.fn().mockResolvedValue([
			{
				timestamp: "2026-05-01T00:00:01.000Z",
				level: "info",
				event: "started",
				message: "started",
			},
		]),
		retry: vi.fn().mockResolvedValue(true),
		cancel: vi.fn().mockResolvedValue(true),
		summary: vi.fn().mockResolvedValue({
			total: 1,
			pending: 0,
			inProgress: 1,
			done: 0,
			partial: 0,
			failed: 0,
			timedOut: 0,
			cancelled: 0,
		}),
	};
	const recorder = {
		rememberRun: vi.fn(),
		rememberStatus: vi.fn(),
		rememberList: vi.fn(),
		rememberLogs: vi.fn(),
		rememberControl: vi.fn(),
		getCheckpoint: vi.fn().mockReturnValue({
			version: 1,
			updatedAt: "2026-05-01T00:00:02.000Z",
			activeEffortId: "effort-abc",
			efforts: [
				{
					effortId: "effort-abc",
					transport: "file",
					lastStatus: "in-progress",
					statusCommand: "refarm task status effort-abc --transport file",
					logsCommand: "refarm task logs effort-abc --transport file",
				},
			],
		}),
	};
	return createTaskCommand(() => adapter as never, recorder as never);
}

function createContractCheckCommand() {
	return createCheckCommand({
		runHealth: vi.fn().mockResolvedValue({
			command: "health",
			operation: "audit",
			ok: true,
			issueCount: 0,
			results: { git: [], builds: [], alignment: [] },
			resolution: [],
			recommendations: [],
			nextAction: null,
			nextActions: [],
			nextCommand: null,
			nextCommands: [],
		}),
		runDoctor: vi.fn().mockResolvedValue({
			command: "doctor",
			operation: "diagnose",
			ok: false,
			failureCount: 1,
			warningCount: 0,
			failures: ["runtime:not-ready"],
			warnings: [],
			informational: [],
			recommendations: [
				{
					diagnostic: "runtime:not-ready",
					severity: "failure",
					summary: "Runtime is not ready.",
					action: "Start the runtime.",
					command: "refarm runtime ensure --wait --next-command",
				},
			],
			nextAction: "Start the runtime.",
			nextActions: ["Start the runtime."],
			nextCommand: "refarm runtime ensure --wait --next-command",
			nextCommands: ["refarm runtime ensure --wait --next-command"],
			host: {
				app: "apps/refarm",
				command: "refarm",
				profile: "dev",
				version: "0.1.0",
				packageManager: "pnpm",
			},
			status: makeReadyStatus("tui"),
		}),
	});
}

function createContractRuntimeCommand() {
	return createRuntimeCommand({
		repoRoot: () => "/repo",
		readEngine: () => "ts",
		readAutostart: () => "ask",
		probeReady: vi.fn().mockResolvedValue(false),
		resolveRuntime: () => ({
			configuredEngine: "ts",
			activeEngine: "ts",
			reason: "configured-ts",
		}),
		startRuntime: vi.fn(),
		waitUntilReady: vi.fn().mockResolvedValue(false),
	});
}

function createContractModelCommand() {
	const tokens: Record<string, unknown> = {
		modelProvider: "openai",
		modelId: "gpt-5.5",
		modelRoutes: {
			worker: { provider: "openai", modelId: "gpt-5.3-codex-spark" },
		},
	};
	return createModelCommand({
		loadTokens: async () => tokens,
		saveTokens: vi.fn().mockImplementation(async (update: Record<string, unknown>) => {
			Object.assign(tokens, update);
		}),
	});
}

function createContractSessionsCommand() {
	const session = {
		"@id": "urn:refarm:session:v1:abc123def456",
		"@type": "Session",
		name: "contract session",
		created_at_ns: 1_700_000_000_000_000_000,
		leaf_entry_id: "entry-abc",
	};
	const fork = {
		"@id": "urn:refarm:session:v1:fork123def456",
		"@type": "Session",
		name: "experiment",
		created_at_ns: 1_700_000_000_000_000_001,
		leaf_entry_id: "entry-fork",
		parent_session_id: session["@id"],
	};
	let activeSessionId: string | null = session["@id"];
	const fetch = vi.fn().mockImplementation(async (url: string | URL, init?: RequestInit) => {
		const value = String(url);
		if (value.endsWith("/sessions") && init?.method === "POST") {
			return {
				ok: true,
				status: 200,
				json: async () => ({ session }),
			};
		}
		if (value.endsWith("/sessions")) {
			return {
				ok: true,
				status: 200,
				json: async () => ({ sessions: [session] }),
			};
		}
		if (value.endsWith("/fork")) {
			return {
				ok: true,
				status: 200,
				json: async () => ({ session: fork }),
			};
		}
		if (value.endsWith("/history")) {
			return {
				ok: true,
				status: 200,
				json: async () => ({
					session,
					entries: [
						{
							id: "entry-abc",
							kind: "user",
							content: "hello",
							timestamp_ns: 1_700_000_000_000_000_000,
						},
					],
					total: 1,
				}),
			};
		}
		return {
			ok: false,
			status: 404,
			json: async () => ({ error: "not found" }),
		};
	});
	return createSessionsCommand({
		clearActiveSessionId: vi.fn().mockImplementation(() => {
			activeSessionId = null;
			return true;
		}),
		fetch,
		readActiveSessionId: vi.fn().mockImplementation(() => activeSessionId),
		sidecarUrl: (path) => `http://contract.test${path}`,
		writeActiveSessionIdAndVerify: vi.fn().mockImplementation((sessionId: string) => {
			activeSessionId = sessionId;
		}),
	});
}

function createContractSessionsSubcommand(name: string) {
	const command = createContractSessionsCommand().commands.find((entry) => entry.name() === name);
	if (!command) throw new Error(`Missing sessions subcommand ${name}`);
	return command;
}

function createContractSowCommand() {
	const tokens: Record<string, unknown> = { modelProvider: "openai" };
	return createSowCommand({
		createSilo: () => ({
			loadTokens: vi.fn().mockResolvedValue(tokens),
			saveTokens: vi.fn().mockImplementation(async (update: Record<string, unknown>) => {
				Object.assign(tokens, update);
				return {};
			}),
		}),
		createOperator: () => ({ ask: vi.fn() }),
		env: () => ({}),
		tryOpenUrl: vi.fn(),
		providers: {
			model: {
				id: "model",
				label: "Model Provider",
				collect: vi.fn(),
				collectModel: vi.fn(),
			},
			github: {
				id: "github",
				label: "GitHub",
				collect: vi.fn(),
			},
			cloudflare: {
				id: "cloudflare",
				label: "Cloudflare",
				collect: vi.fn(),
			},
		},
	});
}

function createContractTelemetryCommand() {
	return createTelemetryCommand({
		fetchTelemetry: vi.fn().mockResolvedValue({
			queueDepth: 12,
			inFlight: 5,
			cancelRequests: 0,
			generatedAt: "2026-05-01T00:00:00.000Z",
			total: 20,
			pending: 12,
			inProgress: 5,
			done: 2,
			failed: 1,
			cancelled: 0,
		}),
		fetchTelemetryWindow: vi.fn().mockResolvedValue({
			windowMinutes: 60,
			since: "2026-05-01T00:00:00.000Z",
			terminal: 4,
			failureRatePct: 25,
			generatedAt: "2026-05-01T01:00:00.000Z",
			total: 6,
			pending: 0,
			inProgress: 2,
			done: 3,
			failed: 1,
			cancelled: 0,
		}),
	});
}

function createContractTidyCommand() {
	return createTidyCommand({
		cwd: () => ".",
		run: vi.fn().mockResolvedValue({ exitCode: 0 }),
	});
}

interface ParsedCommandJson {
	handoffs?: Record<string, unknown>;
	nextAction?: string | null;
	nextActions?: string[];
	nextCommand?: string | null;
	nextCommands?: string[];
	templates?: {
		command?: string;
		parameters?: string[];
	}[];
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

	it("keeps package-manager-specific commands out of static executable handoffs", () => {
		const files = [
			...commandSourceFiles(),
			...optionalSourceFiles(PACKAGE_CLI_SRC_DIR),
		];
		const violations = files.flatMap((file) => {
			const source = readFileSync(file, "utf8");
			return ["nextCommand", "nextCommands", "actionCommand"]
				.flatMap((property) => propertyBlocks(source, property)
					.filter(hasHardcodedPackageManagerCommand)
					.map((block) => `${relative(process.cwd(), file)} ${property}: ${block.trim()}`));
		});

		expect(violations).toEqual([]);
	});

	it("keeps generated public nextCommands executable", async () => {
		const config = createTempConfigCommand();
		const init = createContractInitCommand();
		const status = createTempStatusFile(["runtime:not-ready"]);
		try {
			vi.stubGlobal("fetch", makeContractFetch());
			const payloads = await parseCommandJsonSamples([
				{ id: "actions", command: createContractActionsCommand(), args: ["--select", "inspect-trust", "--json"] },
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
					id: "config-get-local",
					command: config.command,
					args: ["get", "operator.openExternalLinks", "--local", "--json"],
				},
				{
					id: "config-unset-local",
					command: config.command,
					args: ["unset", "operator.openExternalLinks", "--local", "--json"],
				},
				{
					id: "deploy-invalid-target",
					command: deployCommand,
					args: ["--target", "workers", "--dry-run", "--json"],
				},
				{
					id: "doctor-input",
					command: doctorCommand,
					args: ["--input", status.path, "--json"],
				},
				{ id: "extension-list", command: extensionCommand, args: ["list", "--json"] },
				{ id: "extension-publish", command: extensionCommand, args: ["publish", "my-tool", "--json"] },
				{ id: "extension-save-missing-scope", command: extensionCommand, args: ["save", "my-tool", "--json"] },
				{ id: "guide", command: createContractGuideCommand(), args: ["--json"] },
				{
					id: "headless-action-request",
					command: headlessCommand,
					args: [
						"--input",
						STATUS_WITH_ACTIONS_FIXTURE ?? "test/fixtures/status-with-actions.json",
						"--action-request",
						"inspect-trust",
					],
				},
				{ id: "health", command: healthCommand, args: ["--json"] },
				{
					id: "init",
					command: init.command,
					args: ["contract-workspace", "--template", "workspace", "--json"],
				},
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
					id: "check",
					command: createContractCheckCommand(),
					args: ["--json"],
				},
				{
					id: "model-current",
					command: createContractModelCommand(),
					args: ["current", "--json"],
				},
				{
					id: "model-providers",
					command: createContractModelCommand(),
					args: ["providers", "--json"],
				},
				{
					id: "model-set-route",
					command: createContractModelCommand(),
					args: ["set", "anthropic/claude-sonnet-4.5", "--json"],
				},
				{
					id: "model-set-fallback",
					command: createContractModelCommand(),
					args: ["fallback", "ollama/qwen2.5-coder", "--json"],
				},
				{
					id: "model-base-url",
					command: createContractModelCommand(),
					args: ["base-url", "http://127.0.0.1:8000", "--json"],
				},
				{
					id: "model-reset-worker",
					command: createContractModelCommand(),
					args: ["reset", "--scope", "worker", "--json"],
				},
				{ id: "plugin-list", command: pluginCommand, args: ["list", "--json"] },
				{ id: "plugin-status", command: pluginCommand, args: ["status", "--json"] },
				{
					id: "plugin-bundle-dry-run",
					command: pluginCommand,
					args: ["bundle", "contract-plugin.wasm", "--dry-run", "--json"],
				},
				{ id: "provision-list", command: provisionCommand, args: ["list", "--json"] },
				{ id: "provision-cloudflare", command: provisionCommand, args: ["cloudflare", "--dry-run", "--json"] },
				{
					id: "provision-cloudflare-turbo-cache",
					command: provisionCommand,
					args: ["cloudflare", "turbo-cache", "--dry-run", "--json"],
				},
				{
					id: "resume",
					command: createResumeCommand({
						resolveStatusPayload: async () => ({ json: makeReadyStatus("tui") }),
						sessionRecorder: {
							rememberRun: vi.fn(),
							rememberStatus: vi.fn(),
							rememberList: vi.fn(),
							rememberLogs: vi.fn(),
							rememberControl: vi.fn(),
							getCheckpoint: vi.fn().mockReturnValue(null),
						},
						finishRecorder: {
							rememberRun: vi.fn(),
							getCheckpoint: vi.fn().mockReturnValue(null),
							getLatest: vi.fn().mockReturnValue(null),
						},
						readActiveSessionId: vi.fn().mockReturnValue(null),
						loadRecentSessions: vi.fn().mockResolvedValue([]),
						loadChatHistory: vi.fn().mockReturnValue([]),
						loadModelTokens: vi.fn().mockResolvedValue({}),
					}),
					args: ["--json"],
				},
				{
					id: "runtime-status",
					command: createContractRuntimeCommand(),
					args: ["status", "--json"],
				},
				{
					id: "runtime-ensure",
					command: createContractRuntimeCommand(),
					args: ["ensure", "--wait", "--json"],
				},
				{
					id: "runtime-start-dry-run",
					command: createContractRuntimeCommand(),
					args: ["start", "--dry-run", "--json"],
				},
				{
					id: "sessions-list",
					command: createContractSessionsCommand(),
					args: ["--json"],
				},
				{
					id: "sessions-new",
					command: createContractSessionsSubcommand("new"),
					args: ["--name", "planning", "--json"],
				},
				{
					id: "sessions-use",
					command: createContractSessionsSubcommand("use"),
					args: ["abc123", "--json"],
				},
				{
					id: "sessions-show",
					command: createContractSessionsSubcommand("show"),
					args: ["abc123", "--json"],
				},
				{
					id: "sessions-fork",
					command: createContractSessionsSubcommand("fork"),
					args: ["abc123", "--name", "experiment", "--json"],
				},
				{
					id: "sessions-clear",
					command: createContractSessionsSubcommand("clear"),
					args: ["--json"],
				},
				{
					id: "sow-model-route",
					command: createContractSowCommand(),
					args: ["--model", "openai/gpt-5.5", "--json"],
				},
				{
					id: "tasks-list",
					command: createTasksCommand(),
					args: ["--json"],
				},
				{
					id: "tasks-show",
					command: createTasksCommand().commands.find((command) => command.name() === "show")!,
					args: ["abc123def456", "--json"],
				},
				{
					id: "task-list",
					command: createContractTaskCommand(),
					args: ["list", "--json"],
				},
				{
					id: "task-status",
					command: createContractTaskCommand(),
					args: ["status", "effort-abc", "--json"],
				},
				{
					id: "task-logs",
					command: createContractTaskCommand(),
					args: ["logs", "effort-abc", "--json"],
				},
				{
					id: "task-retry",
					command: createContractTaskCommand(),
					args: ["retry", "effort-abc", "--json"],
				},
				{
					id: "task-cancel",
					command: createContractTaskCommand(),
					args: ["cancel", "effort-abc", "--json"],
				},
				{
					id: "task-resume",
					command: createContractTaskCommand(),
					args: ["resume", "--json"],
				},
				{
					id: "telemetry",
					command: createContractTelemetryCommand(),
					args: ["--json"],
				},
				{
					id: "tidy-imports-dry-run",
					command: createContractTidyCommand(),
					args: ["imports", "--check", "--dry-run", "--json", "apps/refarm/src/program.ts"],
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
					id: "tree-list-all",
					command: createTreeCommand(),
					args: ["list", "--scope", "all", "--json"],
				},
				{
					id: "tree-session-preview-template",
					command: createTreeCommand(),
					args: ["preview", "abc123", "--json"],
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
			const handoffEntries = generatedHandoffEntries(payloads);
			const placeholders = commandEntries
				.filter(({ command }) => /<[^>]+>/.test(command))
				.map(({ command, sampleId }) => `${sampleId}: ${command}`);
			const actionPlaceholders = actionEntries
				.filter(({ action }) => /<[^>]+>/.test(action))
				.map(({ action, sampleId }) => `${sampleId}: ${action}`);
			const interactiveSow = commandEntries
				.filter(({ command }) => hasInteractiveSowCommand(command))
				.map(({ command, sampleId }) => `${sampleId}: ${command}`);
			const actionInteractiveSow = actionEntries
				.filter(({ action }) => hasInteractiveSowCommand(action))
				.map(({ action, sampleId }) => `${sampleId}: ${action}`);
			const handoffPlaceholders = handoffEntries
				.filter(({ handoff }) => /<[^>]+>/.test(handoff))
				.map(({ handoff, key, sampleId }) => `${sampleId}.${key}: ${handoff}`);
			const replOnly = commandEntries
				.filter(({ command }) => /^\/[A-Za-z]/.test(command))
				.map(({ command, sampleId }) => `${sampleId}: ${command}`);
			const missingNextActions = payloads
				.filter((payload) => !Array.isArray(payload.nextActions))
				.map((payload) => payload.sampleId);
			const missingNextCommands = payloads
				.filter((payload) => !Array.isArray(payload.nextCommands))
				.map((payload) => payload.sampleId);
			const commandFieldPlaceholderLeaks = payloads.flatMap((payload) =>
				generatedCommandFieldPlaceholderLeaks(payload)
					.map((leak) => `${payload.sampleId}.${leak}`),
			);

			expect(placeholders).toEqual([]);
			expect(actionPlaceholders).toEqual([]);
			expect(interactiveSow).toEqual([]);
			expect(actionInteractiveSow).toEqual([]);
			expect(handoffPlaceholders).toEqual([]);
			expect(commandFieldPlaceholderLeaks).toEqual([]);
			expect(replOnly).toEqual([]);
			expect(missingNextActions).toEqual([]);
			expect(missingNextCommands).toEqual([]);
		} finally {
			vi.unstubAllGlobals();
			status.cleanup();
			init.cleanup();
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
			await parseCommandJson({
				id: "package-manager",
				command: createPackageManagerCommand({
					cwd: () => ".",
					env: { REFARM_PACKAGE_MANAGER: "npm" },
				}),
				args: ["--json"],
			}),
		];
		const commands = generatedExecutableCommands(payloads);
		const actions = payloads.flatMap((payload) => payload.nextActions ?? []);
		const templates = generatedTemplates(payloads);
		const templateCommands = templates.map((template) => template.command);
		const templatesWithUndeclaredParameters = templates
			.filter((template) => /<[^>]+>/.test(template.command))
			.filter((template) =>
				commandTemplateParameters(template.command)
					.some((parameter) => !template.parameters.includes(parameter)),
			)
			.map((template) => template.command);

		expect(templateCommands).toContain(
			"refarm agent finish --profile package --workspace <dir> --next-command",
		);
		expect(templateCommands).toContain(
			"refarm agent finish --profile affected --since <ref> --run --json",
		);
		expect(templateCommands).toContain(
			"refarm plugin bundle <plugin.wasm> --dry-run --json",
		);
		expect(commands).not.toContain(
			"refarm agent finish --profile package --workspace <dir> --next-command",
		);
		expect(commands).not.toContain(
			"refarm agent finish --profile affected --since <ref> --run --json",
		);
		expect(commands).not.toContain(
			"refarm plugin bundle <plugin.wasm> --dry-run --json",
		);
		expect(actions).not.toContain(
			"refarm agent finish --profile package --workspace <dir> --next-command",
		);
		expect(actions).not.toContain(
			"refarm agent finish --profile affected --since <ref> --run --json",
		);
		expect(actions).not.toContain(
			"refarm plugin bundle <plugin.wasm> --dry-run --json",
		);
		expect(actions.filter((action) => /<[^>]+>/.test(action))).toEqual([]);
		expect(templatesWithUndeclaredParameters).toEqual([]);
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
				expect.objectContaining({
					command: "refarm plugin bundle <plugin.wasm> --dry-run --json",
					parameters: ["plugin.wasm"],
				}),
			]),
		);
	});
});
