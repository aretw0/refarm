import {
	homesteadHostRendererCan,
	summarizeHomesteadHostSurfaceState,
	type HomesteadHostRendererDescriptor,
	type HomesteadHostStreamState,
	type HomesteadHostSurfaceState,
} from "@refarm.dev/homestead/sdk/host-renderer";
import type {
	RuntimeActiveEngine,
	RuntimeEngineMode,
	RuntimeEngineSummary,
	RuntimeSummary,
} from "@refarm.dev/runtime";
import type { TrustSummary } from "@refarm.dev/trust";

export const STATUS_SCHEMA_VERSION = 1 as const;

export interface StatusSurfaceAction {
	id: string;
	label: string;
	command?: string;
	intent?: string;
	payload?: Record<string, unknown>;
	primary?: boolean;
}

export type HostRuntimeEngineMode = RuntimeEngineMode;
export type ActiveHostRuntimeEngine = RuntimeActiveEngine;
export type HostRuntimeEngineSummary = RuntimeEngineSummary;

export type HostRuntimeStatusSummary = RuntimeSummary & {
	engine?: HostRuntimeEngineSummary;
};

export interface StatusJson {
	schemaVersion: typeof STATUS_SCHEMA_VERSION;
	host: { app: string; command: string; profile: string; mode: string };
	renderer: { id: string; kind: string; capabilities: readonly string[] };
	runtime: HostRuntimeStatusSummary;
	plugins: {
		installed: number;
		active: number;
		rejectedSurfaces: number;
		surfaceActions: number;
		availableActions?: readonly StatusSurfaceAction[];
	};
	trust: TrustSummary;
	streams: { active: number; terminal: number };
	diagnostics: string[];
}

export interface StatusOptions {
	host: { app: string; command: string; profile: string; mode: string };
	renderer: HomesteadHostRendererDescriptor;
	runtime: HostRuntimeStatusSummary;
	trust: TrustSummary;
	streams?: HomesteadHostStreamState;
	plugins?: {
		installed?: number;
		active?: number;
		surfaces?: HomesteadHostSurfaceState;
	};
}

export interface StatusSchemaVersionIssue {
	reason: "missing" | "invalid-type" | "newer" | "older";
	found: unknown;
	supported: typeof STATUS_SCHEMA_VERSION;
	message: string;
}

export const STATUS_DIAGNOSTICS = {
	runtimeNotReady: "runtime:not-ready",
	runtimeSidecarAccessBlocked: "runtime:sidecar-access-blocked",
	trustCriticalPresent: "trust:critical-present",
	trustWarningsPresent: "trust:warnings-present",
	pluginsRejectedSurfacesPresent: "plugins:rejected-surfaces-present",
	pluginsSurfaceActionsAvailable: "plugins:surface-actions-available",
	streamsActivePresent: "streams:active-present",
	rendererNonInteractive: "renderer:non-interactive",
	rendererNoRichHtml: "renderer:no-rich-html",
} as const;

export type StatusDiagnosticCode =
	(typeof STATUS_DIAGNOSTICS)[keyof typeof STATUS_DIAGNOSTICS];

export const STATUS_FAILURE_DIAGNOSTICS = [
	STATUS_DIAGNOSTICS.runtimeNotReady,
	STATUS_DIAGNOSTICS.runtimeSidecarAccessBlocked,
	STATUS_DIAGNOSTICS.trustCriticalPresent,
] as const;

export const STATUS_WARNING_DIAGNOSTICS = [
	STATUS_DIAGNOSTICS.trustWarningsPresent,
	STATUS_DIAGNOSTICS.pluginsRejectedSurfacesPresent,
	STATUS_DIAGNOSTICS.streamsActivePresent,
] as const;

export const STATUS_INFORMATIONAL_DIAGNOSTICS = [
	STATUS_DIAGNOSTICS.rendererNonInteractive,
	STATUS_DIAGNOSTICS.rendererNoRichHtml,
	STATUS_DIAGNOSTICS.pluginsSurfaceActionsAvailable,
] as const;

export interface StatusDiagnosticSummary {
	failures: string[];
	warnings: string[];
	informational: string[];
	hasFailure: boolean;
}

export function buildStatusJson(
	options: StatusOptions,
): StatusJson {
	const { host, renderer, runtime, trust, streams, plugins } = options;
	const surfaces = summarizeHomesteadHostSurfaceState(plugins?.surfaces);
	return {
		schemaVersion: STATUS_SCHEMA_VERSION,
		host,
		renderer: {
			id: renderer.id,
			kind: renderer.kind,
			capabilities: renderer.capabilities,
		},
		runtime,
		plugins: {
			installed: plugins?.installed ?? 0,
			active: plugins?.active ?? 0,
			rejectedSurfaces: surfaces.rejected,
			surfaceActions: surfaces.surfaceActions,
			...statusAvailableSurfaceActions(plugins?.surfaces?.availableActions),
		},
		trust,
		streams: {
			active: streams?.active ?? 0,
			terminal: streams?.terminal ?? 0,
		},
		diagnostics: buildStatusDiagnostics({
			renderer,
			runtime,
			trust,
			plugins: {
				rejectedSurfaces: surfaces.rejected,
				surfaceActions: surfaces.surfaceActions,
			},
			streams: {
				active: streams?.active ?? 0,
			},
		}),
	};
}

export function isStatusJson(value: unknown): value is StatusJson {
	if (!isRecord(value)) return false;
	if (value.schemaVersion !== STATUS_SCHEMA_VERSION) return false;

	const host = value.host;
	if (!isRecord(host)) return false;
	if (
		typeof host.app !== "string" ||
		typeof host.command !== "string" ||
		typeof host.profile !== "string" ||
		typeof host.mode !== "string"
	)
		return false;

	const renderer = value.renderer;
	if (!isRecord(renderer)) return false;
	if (
		typeof renderer.id !== "string" ||
		typeof renderer.kind !== "string" ||
		!isStringArray(renderer.capabilities)
	)
		return false;

	const runtime = value.runtime;
	if (!isRecord(runtime)) return false;
	if (
		typeof runtime.ready !== "boolean" ||
		typeof runtime.namespace !== "string" ||
		typeof runtime.databaseName !== "string"
	)
		return false;
	if (typeof runtime.error !== "undefined" && typeof runtime.error !== "string")
		return false;
	if (
		typeof runtime.engine !== "undefined" &&
		!isHostRuntimeEngineSummary(runtime.engine)
	)
		return false;

	const plugins = value.plugins;
	if (!isRecord(plugins)) return false;
	if (
		!isFiniteNumber(plugins.installed) ||
		!isFiniteNumber(plugins.active) ||
		!isFiniteNumber(plugins.rejectedSurfaces) ||
		!isFiniteNumber(plugins.surfaceActions)
	)
		return false;
	if (
		typeof plugins.availableActions !== "undefined" &&
		!isStatusSurfaceActions(plugins.availableActions)
	)
		return false;

	const trust = value.trust;
	if (!isRecord(trust)) return false;
	if (
		typeof trust.profile !== "string" ||
		!isFiniteNumber(trust.warnings) ||
		!isFiniteNumber(trust.critical)
	)
		return false;

	const streams = value.streams;
	if (!isRecord(streams)) return false;
	if (!isFiniteNumber(streams.active) || !isFiniteNumber(streams.terminal)) {
		return false;
	}

	return isStringArray(value.diagnostics);
}

export function assertStatusJson(
	value: unknown,
): asserts value is StatusJson {
	const schemaIssue = getStatusSchemaVersionIssue(value);
	if (schemaIssue) {
		throw new Error(schemaIssue.message);
	}

	if (!isStatusJson(value)) {
		throw new Error(
			`Invalid status payload for schemaVersion=${STATUS_SCHEMA_VERSION}.`,
		);
	}
}

export function getStatusSchemaVersionIssue(
	value: unknown,
): StatusSchemaVersionIssue | null {
	const found = isRecord(value) ? value.schemaVersion : undefined;

	if (typeof found === "undefined") {
		return {
			reason: "missing",
			found,
			supported: STATUS_SCHEMA_VERSION,
			message: `Missing status schemaVersion. Expected schemaVersion=${STATUS_SCHEMA_VERSION}.`,
		};
	}

	if (typeof found !== "number" || !Number.isFinite(found)) {
		return {
			reason: "invalid-type",
			found,
			supported: STATUS_SCHEMA_VERSION,
			message: `Invalid status schemaVersion type (${typeof found}). Expected numeric schemaVersion=${STATUS_SCHEMA_VERSION}.`,
		};
	}

	if (found > STATUS_SCHEMA_VERSION) {
		return {
			reason: "newer",
			found,
			supported: STATUS_SCHEMA_VERSION,
			message: `Unsupported status schemaVersion=${found}. Local CLI supports up to ${STATUS_SCHEMA_VERSION}. Upgrade @refarm.dev/cli.`,
		};
	}

	if (found < STATUS_SCHEMA_VERSION) {
		return {
			reason: "older",
			found,
			supported: STATUS_SCHEMA_VERSION,
			message: `Unsupported legacy status schemaVersion=${found}. Local CLI expects ${STATUS_SCHEMA_VERSION}. Regenerate with a newer status producer.`,
		};
	}

	return null;
}

export function parseStatusJson(
	input: string | unknown,
): StatusJson {
	const value = typeof input === "string" ? parseJsonString(input) : input;
	assertStatusJson(value);
	return value;
}

export function classifyStatusDiagnostics(
	json: StatusJson,
	options: {
		failureCodes?: readonly string[];
		warningCodes?: readonly string[];
	} = {},
): StatusDiagnosticSummary {
	const failureCodes = new Set(
		options.failureCodes ?? STATUS_FAILURE_DIAGNOSTICS,
	);
	const warningCodes = new Set(
		options.warningCodes ?? STATUS_WARNING_DIAGNOSTICS,
	);

	const failures: string[] = [];
	const warnings: string[] = [];
	const informational: string[] = [];

	for (const diagnostic of json.diagnostics) {
		if (failureCodes.has(diagnostic)) {
			failures.push(diagnostic);
			continue;
		}

		if (warningCodes.has(diagnostic)) {
			warnings.push(diagnostic);
			continue;
		}

		informational.push(diagnostic);
	}

	return {
		failures,
		warnings,
		informational,
		hasFailure: failures.length > 0,
	};
}

export function formatStatusMarkdown(json: StatusJson): string {
	const diagnostics =
		json.diagnostics.length > 0
			? json.diagnostics.map((diagnostic) => `- ${diagnostic}`).join("\n")
			: "- none";
	const availableActions = formatStatusAvailableActionsMarkdown(json);

	const frontmatter = [
		"---",
		`schemaVersion: ${json.schemaVersion}`,
		"host:",
		`  app: ${JSON.stringify(json.host.app)}`,
		`  command: ${JSON.stringify(json.host.command)}`,
		`  profile: ${JSON.stringify(json.host.profile)}`,
		`  mode: ${JSON.stringify(json.host.mode)}`,
		"renderer:",
		`  id: ${JSON.stringify(json.renderer.id)}`,
		`  kind: ${JSON.stringify(json.renderer.kind)}`,
		...(json.renderer.capabilities.length > 0
			? [
					"  capabilities:",
					...json.renderer.capabilities.map(
						(capability) => `    - ${JSON.stringify(capability)}`,
					),
				]
			: ["  capabilities: []"]),
		"runtime:",
		`  ready: ${json.runtime.ready}`,
		`  namespace: ${JSON.stringify(json.runtime.namespace)}`,
		`  databaseName: ${JSON.stringify(json.runtime.databaseName)}`,
		...(json.runtime.engine
			? [
					"  engine:",
					...(json.runtime.engine.configuredEngine
						? [
								`    configured: ${JSON.stringify(json.runtime.engine.configuredEngine)}`,
							]
						: []),
					...(json.runtime.engine.activeEngine
						? [`    active: ${JSON.stringify(json.runtime.engine.activeEngine)}`]
						: []),
				]
			: []),
		"trust:",
		`  profile: ${JSON.stringify(json.trust.profile)}`,
		`  warnings: ${json.trust.warnings}`,
		`  critical: ${json.trust.critical}`,
		"plugins:",
		`  installed: ${json.plugins.installed}`,
		`  active: ${json.plugins.active}`,
		`  rejectedSurfaces: ${json.plugins.rejectedSurfaces}`,
		`  surfaceActions: ${json.plugins.surfaceActions}`,
		"streams:",
		`  active: ${json.streams.active}`,
		`  terminal: ${json.streams.terminal}`,
		`diagnosticsCount: ${json.diagnostics.length}`,
		"---",
	].join("\n");

	return [
		frontmatter,
		"",
		"# Status",
		"",
		`- Schema: v${json.schemaVersion}`,
		`- Host: ${json.host.app} (${json.host.mode})`,
		`- Renderer: ${json.renderer.id} (${json.renderer.kind})`,
		`- Runtime: ${json.runtime.ready ? "ready" : "not ready"} (${json.runtime.namespace})${formatRuntimeEngineSuffix(json.runtime.engine)}`,
		`- Trust: ${json.trust.profile} (warnings: ${json.trust.warnings}, critical: ${json.trust.critical})`,
		`- Plugins: ${json.plugins.installed} installed, ${json.plugins.active} active`,
		`- Surfaces: ${json.plugins.rejectedSurfaces} rejected, ${json.plugins.surfaceActions} actions`,
		`- Streams: ${json.streams.active} active, ${json.streams.terminal} terminal`,
		"",
		"## Available Actions",
		availableActions,
		"",
		"## Diagnostics",
		diagnostics,
	].join("\n");
}

export function formatStatusSummary(json: StatusJson): string {
	const lines = [
		`Host:      ${json.host.app} (${json.host.mode})`,
		`Renderer:  ${json.renderer.id} (${json.renderer.kind})`,
		`Runtime:   ${json.runtime.ready ? "ready" : "not ready"} — ${json.runtime.namespace}${formatRuntimeEngineSuffix(json.runtime.engine)}`,
		`Trust:     ${json.trust.profile} — warnings: ${json.trust.warnings}, critical: ${json.trust.critical}`,
		`Plugins:   ${json.plugins.installed} installed, ${json.plugins.active} active`,
		`Surfaces:  ${json.plugins.rejectedSurfaces} rejected, ${json.plugins.surfaceActions} actions`,
		`Streams:   ${json.streams.active} active, ${json.streams.terminal} terminal`,
	];

	if (json.plugins.availableActions?.length) {
		lines.push("Available actions:");
		for (const action of json.plugins.availableActions) {
			lines.push(
				`  - ${action.id}: ${action.label}${action.intent ? ` (${action.intent})` : ""}`,
			);
		}
	}

	if (json.diagnostics.length > 0) {
		lines.push("Diagnostics:");
		for (const diagnostic of json.diagnostics) {
			lines.push(`  - ${diagnostic}`);
		}
	}

	return lines.join("\n");
}

export function formatStatusJson(json: StatusJson): string {
	return JSON.stringify(toCanonicalStatusJson(json), null, 2);
}

function formatStatusAvailableActionsMarkdown(
	json: StatusJson,
): string {
	if (!json.plugins.availableActions?.length) return "- none";
	return json.plugins.availableActions
		.map(
			(action) =>
				`- ${action.id}: ${action.label}${action.intent ? ` (${action.intent})` : ""}`,
		)
		.join("\n");
}

function statusAvailableSurfaceActions(
	actions:
		| readonly {
				id: string;
				label: string;
				command?: string;
				intent?: string;
				payload?: Record<string, unknown>;
				primary?: boolean;
		  }[]
		| undefined,
): { availableActions?: StatusSurfaceAction[] } {
	if (!actions?.length) return {};
	return {
		availableActions: actions.map((action) => ({
			id: action.id,
			label: action.label,
			...(action.command ? { command: action.command } : {}),
			...(action.intent ? { intent: action.intent } : {}),
			...(action.payload ? { payload: { ...action.payload } } : {}),
			...(typeof action.primary === "boolean" ? { primary: action.primary } : {}),
		})),
	};
}

function toCanonicalStatusJson(json: StatusJson): StatusJson {
	const availableActions = statusAvailableSurfaceActions(
		json.plugins.availableActions,
	);
	return {
		schemaVersion: json.schemaVersion,
		host: {
			app: json.host.app,
			command: json.host.command,
			profile: json.host.profile,
			mode: json.host.mode,
		},
		renderer: {
			id: json.renderer.id,
			kind: json.renderer.kind,
			capabilities: [...json.renderer.capabilities],
		},
		runtime: {
			ready: json.runtime.ready,
			databaseName: json.runtime.databaseName,
			namespace: json.runtime.namespace,
			...(json.runtime.engine ? { engine: { ...json.runtime.engine } } : {}),
		},
		plugins: {
			installed: json.plugins.installed,
			active: json.plugins.active,
			rejectedSurfaces: json.plugins.rejectedSurfaces,
			surfaceActions: json.plugins.surfaceActions,
			...availableActions,
		},
		trust: {
			profile: json.trust.profile,
			warnings: json.trust.warnings,
			critical: json.trust.critical,
		},
		streams: {
			active: json.streams.active,
			terminal: json.streams.terminal,
		},
		diagnostics: [...json.diagnostics],
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isStringArray(value: unknown): value is string[] {
	return (
		Array.isArray(value) && value.every((item) => typeof item === "string")
	);
}

function isStatusSurfaceActions(
	value: unknown,
): value is StatusSurfaceAction[] {
	return (
		Array.isArray(value) &&
		value.every((item) => {
			if (!isRecord(item)) return false;
			if (typeof item.id !== "string" || typeof item.label !== "string") {
				return false;
			}
			return (
				(typeof item.command === "undefined" ||
					typeof item.command === "string") &&
				(typeof item.intent === "undefined" ||
					typeof item.intent === "string") &&
				(typeof item.payload === "undefined" || isRecord(item.payload)) &&
				(typeof item.primary === "undefined" ||
					typeof item.primary === "boolean")
			);
		})
	);
}

function isHostRuntimeEngineSummary(
	value: unknown,
): value is HostRuntimeEngineSummary {
	if (!isRecord(value)) return false;
	return (
		(typeof value.configuredEngine === "undefined" ||
			value.configuredEngine === "auto" ||
			value.configuredEngine === "rust" ||
			value.configuredEngine === "ts") &&
		(typeof value.activeEngine === "undefined" ||
			value.activeEngine === "rust" ||
			value.activeEngine === "ts" ||
			value.activeEngine === "unknown")
	);
}

function formatRuntimeEngineSuffix(
	engine: HostRuntimeEngineSummary | undefined,
): string {
	if (!engine) return "";
	const active = engine.activeEngine ? `engine: ${engine.activeEngine}` : "engine: unknown";
	const configured =
		engine.configuredEngine && engine.configuredEngine !== engine.activeEngine
			? `, configured: ${engine.configuredEngine}`
			: "";
	return ` (${active}${configured})`;
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function parseJsonString(input: string): unknown {
	try {
		return JSON.parse(input) as unknown;
	} catch {
		throw new Error("Invalid JSON for status payload.");
	}
}

function buildStatusDiagnostics(input: {
	renderer: HomesteadHostRendererDescriptor;
	runtime: RuntimeSummary;
	trust: TrustSummary;
	plugins: { rejectedSurfaces: number; surfaceActions: number };
	streams: { active: number };
}): string[] {
	const { renderer, runtime, trust, plugins, streams } = input;
	const diagnostics: string[] = [];
	if (!homesteadHostRendererCan(renderer, "interactive")) {
		diagnostics.push(STATUS_DIAGNOSTICS.rendererNonInteractive);
	}
	if (!homesteadHostRendererCan(renderer, "rich-html")) {
		diagnostics.push(STATUS_DIAGNOSTICS.rendererNoRichHtml);
	}
	if (!runtime.ready) {
		diagnostics.push(
			isRuntimeSidecarAccessBlocked(runtime)
				? STATUS_DIAGNOSTICS.runtimeSidecarAccessBlocked
				: STATUS_DIAGNOSTICS.runtimeNotReady,
		);
	}
	if (trust.warnings > 0) {
		diagnostics.push(STATUS_DIAGNOSTICS.trustWarningsPresent);
	}
	if (trust.critical > 0) {
		diagnostics.push(STATUS_DIAGNOSTICS.trustCriticalPresent);
	}
	if (plugins.rejectedSurfaces > 0) {
		diagnostics.push(STATUS_DIAGNOSTICS.pluginsRejectedSurfacesPresent);
	}
	if (plugins.surfaceActions > 0) {
		diagnostics.push(STATUS_DIAGNOSTICS.pluginsSurfaceActionsAvailable);
	}
	if (streams.active > 0) {
		diagnostics.push(STATUS_DIAGNOSTICS.streamsActivePresent);
	}
	return diagnostics;
}

function isRuntimeSidecarAccessBlocked(runtime: RuntimeSummary): boolean {
	const error = runtime.error?.toLowerCase();
	return Boolean(
		error &&
			(error.includes("eperm") || error.includes("permission denied")),
	);
}
