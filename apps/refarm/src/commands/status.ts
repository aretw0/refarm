import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	assertRefarmStatusJson,
	buildRefarmStatusJson,
	formatRefarmStatusSummary,
	parseRefarmStatusJson,
	type RefarmStatusJson,
	type RefarmTractorEngineMode,
} from "@refarm.dev/cli/status";
import { isHomesteadHostRendererKind } from "@refarm.dev/homestead/sdk/host-renderer";
import { Command } from "commander";
import { resolveRefarmRenderer } from "../renderers.js";
import { resolveRefarmHostIdentity } from "./runtime-metadata.js";
import { invokeRefarmStatusSurfaceActionSelection } from "./status-actions.js";
import { withResolvedStatusPayload } from "./status-payload.js";
import { createRefarmStatusHostSurfaceState } from "./status-surfaces.js";
import { runStatusPreflight } from "./status-preflight.js";
import { resolveJsonMarkdownStatusOutputMode } from "./status-output.js";

export interface ResolveStatusPayloadOptions {
	renderer?: string;
	input?: string;
}

export interface ResolveStatusPayloadResult {
	json: RefarmStatusJson;
	shutdown?: () => Promise<void>;
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

function parseTractorEngineMode(value: unknown): RefarmTractorEngineMode | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().toLowerCase();
	return normalized === "auto" || normalized === "rust" || normalized === "ts"
		? normalized
		: null;
}

function readTractorEnginePreference(): RefarmTractorEngineMode {
	const paths = [
		path.join(os.homedir(), ".refarm", "config.json"),
		path.join(process.cwd(), ".refarm", "config.json"),
	];
	let resolved: RefarmTractorEngineMode | null = null;
	for (const filePath of paths) {
		try {
			const config = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
				tractor?: { engine?: string };
			};
			const mode = parseTractorEngineMode(config.tractor?.engine);
			if (mode) resolved = mode;
		} catch {
			// Missing or malformed preference files should not block status output.
		}
	}
	return resolved ?? "auto";
}

function createStatusRuntimeSummary(namespace: string): RefarmStatusJson["runtime"] {
	return {
		ready: true,
		namespace,
		databaseName: namespace,
		engine: {
			configuredEngine: readTractorEnginePreference(),
			activeEngine: "ts",
		},
	};
}

function createStatusTrustSummary(): RefarmStatusJson["trust"] {
	return {
		profile: "strict",
		warnings: 0,
		critical: 0,
	};
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
				if (options.input) {
					throw new Error(
						"--action cannot be combined with --input; use refarm actions --input <path> --select <id-or-index> for dry-run readiness.",
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

			console.log(
				JSON.stringify(
					await invokeRefarmStatusSurfaceActionSelection({
						status: json,
						selection: actionSelection,
					}),
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
	const namespace = readNamespaceFromConfig() ?? "refarm-main";
	const runtime = createStatusRuntimeSummary(namespace);
	const trust = createStatusTrustSummary();
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
