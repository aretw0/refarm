import fs from "node:fs";
import path from "node:path";
import {
	assertRefarmStatusJson,
	buildRefarmStatusJson,
	formatRefarmStatusSummary,
	parseRefarmStatusJson,
	type RefarmStatusJson,
} from "@refarm.dev/cli/status";
import { isHomesteadHostRendererKind } from "@refarm.dev/homestead/sdk/host-renderer";
import { createRuntimeSummaryFromTractor } from "@refarm.dev/runtime";
import { Tractor } from "@refarm.dev/tractor";
import { createTrustSummaryFromTractor } from "@refarm.dev/trust";
import { Command } from "commander";
import { resolveRefarmRenderer } from "../renderers.js";
import {
	formatRefarmActionIds,
	getRefarmStatusAvailableActions,
	resolveRefarmActionAffordanceSelection,
} from "./action-affordances.js";
import { resolveRefarmHostIdentity } from "./runtime-metadata.js";
import {
	createRefarmStatusSurfaceActionInvocationEnvelope,
	invokeRefarmStatusSurfaceAction,
	resolveRefarmStatusSurfaceActionRequest,
} from "./status-actions.js";
import { withResolvedStatusPayload } from "./status-payload.js";
import { createRefarmStatusHostSurfaceState } from "./status-surfaces.js";
import { runStatusPreflight } from "./status-preflight.js";
import { resolveJsonMarkdownStatusOutputMode } from "./status-output.js";

interface StorageAdapter {
	ensureSchema(): Promise<void>;
	storeNode(
		id: string,
		type: string,
		context: string,
		payload: unknown,
		sourcePlugin: string,
	): Promise<void>;
	queryNodes(type: string): Promise<unknown[]>;
	execute(sql: string, args?: unknown): Promise<unknown[]>;
	query<T>(sql: string, args?: unknown): Promise<T[]>;
	transaction<T>(fn: () => Promise<T>): Promise<T>;
	close(): Promise<void>;
}

interface IdentityAdapter {
	publicKey: string | undefined;
}

export interface ResolveStatusPayloadOptions {
	renderer?: string;
	input?: string;
}

export interface ResolveStatusPayloadResult {
	json: RefarmStatusJson;
	shutdown?: () => Promise<void>;
}

function createMemoryStorage(): StorageAdapter {
	const store = new Map<string, unknown>();
	return {
		async ensureSchema() {},
		async storeNode(id, type, context, payload, sourcePlugin) {
			store.set(id, { id, type, context, payload, sourcePlugin });
		},
		async queryNodes(type: string) {
			return Array.from(store.values()).filter(
				(r) => (r as { type: string }).type === type,
			);
		},
		async execute(_sql: string, _args?: unknown) {
			return [];
		},
		async query<T>(_sql: string, _args?: unknown): Promise<T[]> {
			return [];
		},
		async transaction<T>(fn: () => Promise<T>) {
			return fn();
		},
		async close() {},
	};
}

function createEphemeralIdentity(): IdentityAdapter {
	return { publicKey: undefined };
}

function readNamespaceFromConfig(): string | undefined {
	try {
		const raw = fs.readFileSync(
			path.join(process.cwd(), "refarm.config.json"),
			"utf-8",
		);
		return (JSON.parse(raw) as { brand?: { slug?: string } }).brand?.slug;
	} catch {
		return undefined;
	}
}

export function printStatusSummary(json: RefarmStatusJson): void {
	console.log(formatRefarmStatusSummary(json));
}

export const statusCommand = new Command("status")
	.description("Report host status")
	.option(
		"--input <path>",
		"Read status payload from JSON file (or '-' for stdin) instead of booting runtime",
	)
	.option(
		"--renderer <kind>",
		"Renderer mode: web | tui | headless",
		"headless",
	)
	.option("--markdown", "Output markdown report")
	.option("--json", "Output machine-readable JSON")
	.option(
		"--action <id-or-index>",
		"Invoke a live app-owned status action by available action ID or row index",
	)
	.action(
		async (options: {
			json?: boolean;
			markdown?: boolean;
			renderer?: string;
			input?: string;
			action?: string;
		}) => {
			if (options.action) {
				if (options.json || options.markdown) {
					throw new Error(
						"--action cannot be combined with --json or --markdown.",
					);
				}

				await emitStatusActionInvocation(options);
				return;
			}

			const outputMode = resolveJsonMarkdownStatusOutputMode({
				json: options.json,
				markdown: options.markdown,
				defaultMode: "summary",
			});

			await runStatusPreflight({
				resolveStatusPayload,
				resolveOptions: options,
				outputMode,
				printSummary: printStatusSummary,
			});
		},
	);

async function emitStatusActionInvocation(options: {
	renderer?: string;
	input?: string;
	action?: string;
}): Promise<void> {
	await withResolvedStatusPayload({
		resolveStatusPayload,
		resolveOptions: options,
		run: async (json) => {
			const actionSelection = options.action;
			if (!actionSelection) {
				throw new Error("Missing --action action ID or row index.");
			}

			const selectedAction = resolveRefarmActionAffordanceSelection(
				json,
				actionSelection,
			);

			if (!selectedAction.selected) {
				throw new Error(
					`Status action "${actionSelection}" is not available. Available actions: ${formatRefarmActionIds(selectedAction.rows)}.`,
				);
			}

			const resolution = resolveRefarmStatusSurfaceActionRequest(
				selectedAction.selected.id,
			);

			if (!resolution.request) {
				throw new Error(
					`Status action "${selectedAction.selected.id}" has no live handler. Available actions: ${formatRefarmActionIds(selectedAction.rows)}.`,
				);
			}

			const handled = await invokeRefarmStatusSurfaceAction(
				selectedAction.selected.id,
			);

			console.log(
				JSON.stringify(
					createRefarmStatusSurfaceActionInvocationEnvelope(
						json,
						selectedAction.selection,
						resolution.request,
						handled,
						getRefarmStatusAvailableActions(json),
					),
					null,
					2,
				),
			);
		},
	});
}

export async function resolveStatusPayload(
	options: ResolveStatusPayloadOptions,
): Promise<ResolveStatusPayloadResult> {
	if (options.input) {
		return { json: readStatusPayloadFromInput(options.input) };
	}

	const requestedRenderer = options.renderer ?? "headless";
	if (!isHomesteadHostRendererKind(requestedRenderer)) {
		throw new Error(
			`Invalid renderer kind "${requestedRenderer}". Use one of: web, tui, headless.`,
		);
	}
	const renderer = resolveRefarmRenderer(requestedRenderer);

	const tractor = await Tractor.boot({
		namespace: readNamespaceFromConfig() ?? "refarm-main",
		storage: createMemoryStorage(),
		identity: createEphemeralIdentity(),
		logLevel: "silent",
	});

	const runtime = createRuntimeSummaryFromTractor(tractor);
	const trust = createTrustSummaryFromTractor(tractor);
	const hostIdentity = resolveRefarmHostIdentity();

	const json = buildRefarmStatusJson({
		host: {
			app: hostIdentity.app,
			command: hostIdentity.command,
			profile: hostIdentity.profile,
			mode: renderer.kind,
		},
		renderer,
		runtime,
		trust,
		plugins: {
			surfaces: createRefarmStatusHostSurfaceState(),
		},
	});
	assertRefarmStatusJson(json);

	return {
		json,
		shutdown: tractor.shutdown?.bind(tractor),
	};
}

export function readStatusPayloadFromInput(
	inputPath: string,
): RefarmStatusJson {
	const sourceLabel = inputPath === "-" ? "stdin" : inputPath;
	let raw: string;
	try {
		if (inputPath === "-") {
			raw = fs.readFileSync(0, "utf-8");
		} else {
			const resolvedPath = path.resolve(process.cwd(), inputPath);
			raw = fs.readFileSync(resolvedPath, "utf-8");
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to read status input "${sourceLabel}": ${message}`);
	}

	try {
		return parseRefarmStatusJson(raw);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Failed to parse status input "${sourceLabel}": ${message}`,
		);
	}
}
